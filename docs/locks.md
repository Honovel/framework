# Locks

Honovel's `Lock` abstraction prevents concurrent execution of the same protected operation. The standard implementation is `CacheLock`, which builds distributed-lock semantics on top of the application's configured `Cache` implementation.

That relationship is important: Honovel does not need a separate lock backend when the cache backend already supports the required atomic primitives.

## How the default lock works

Generated applications include this binding:

```ts
import { CacheLock, Lock, Scope } from 'honovel'

@Scope({ provides: Lock })
export class AppLock extends CacheLock {}
```

`CacheLock` injects the application's selected `Cache`. It acquires a lease with atomic `cache.add()` and releases it with ownership-safe `cache.compareAndDelete()`.

As a result:

- new Nuxt and API-only projects both use the Durable Object cache for locks by default;
- replacing the application's `Cache` provider also changes the storage used by `CacheLock` automatically.

You normally do not need to replace `AppLock` when changing cache backends.

## Inject Lock

```ts
import { Lock } from 'honovel'

export class InvoiceService {
  constructor(private readonly lock: Lock) {}
}
```

## Acquire and run

```ts
return this.lock.acquire(
  `invoice:${invoiceId}`,
  async () => this.generateInvoice(invoiceId),
)
```

`acquire()` obtains the lock, runs the callback and releases the lock in a `finally` block. The lock is therefore released even when the callback throws.

## Default lease duration

If no TTL is supplied, `CacheLock` uses a **30 second lease**:

```ts
await lock.acquire('daily-import', async () => {
  await importer.run()
})
```

This is equivalent to a `30_000` millisecond lease.

You can override it per acquisition:

```ts
await lock.acquire(
  'large-import',
  async () => importer.run(),
  120_000,
)
```

Choose a lease long enough for the protected operation. If the lease expires while the callback is still running, another worker may acquire the same lock. Locks with long-running work should therefore use an appropriate TTL or split the operation into shorter units.

The TTL is a maximum lease duration, not a delay before release. A successful callback normally releases the lock immediately when it finishes.

## Handle contention

`acquire()` throws `LockException` if the lock is already held:

```ts
try {
  await this.lock.acquire('daily-import', async () => {
    await this.importer.run()
  })
} catch (error) {
  if (error instanceof LockException) {
    return { alreadyRunning: true }
  }

  throw error
}
```

Use this form when lock contention is exceptional.

## Try to acquire

Use `tryAcquire()` when contention is an expected branch:

```ts
const acquired = await this.lock.tryAcquire(
  `booking:${bookingId}`,
  10_000,
)

if (!acquired) return null

try {
  return await this.bookings.confirm(bookingId)
} finally {
  await acquired.release()
}
```

Without an explicit TTL, `tryAcquire()` also uses 30 seconds.

`release()` is idempotent, so calling it more than once is safe.

## Lock groups

Locks can optionally use an explicit group:

```ts
await this.lock.acquire(
  'invoices',
  String(invoiceId),
  async () => this.generateInvoice(invoiceId),
)
```

The group is passed through to the cache implementation. This can matter for backends where a group maps to a physical coordination boundary.

On the default Cloudflare cache, each group maps to one Durable Object. Grouping related locks can therefore deliberately colocate their coordination in the same Durable Object.

Without an explicit group, `CacheLock` creates an internal group based on the lock key.

## Cloudflare behavior

The Cloudflare starter uses `DurableObjectCache`. The same `AppLock` therefore stores leases through Durable Objects.

No additional `HONOVEL_LOCK` binding is required. Cache and lock coordination share the existing `HONOVEL_CACHE` infrastructure.

## Replacing the lock implementation

You can also replace the `Lock` contract itself when your infrastructure provides a dedicated lock service:

```ts
import { Lock, Scope } from 'honovel'

@Scope({ provides: Lock })
export class DatabaseLock extends Lock {
  // implement acquire() and tryAcquire()
}
```

This is only necessary when you do not want to use `CacheLock`. In most applications it is simpler to replace the cache backend and keep the standard lock implementation.

## Typical use cases

Locks are useful for preventing duplicate invoice generation, duplicate webhook processing, concurrent account synchronization, expensive cache rebuilds and duplicate scheduled work.

A lock is not a database transaction. Locks coordinate concurrent execution; transactions guarantee atomic database changes.