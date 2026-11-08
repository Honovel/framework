# Cache

Honovel exposes a runtime-neutral `Cache` abstraction. Application code depends only on the `Cache` contract; new Nuxt and API-only projects both bind the Cloudflare Durable Object implementation by default.

Entries are addressed by a `group` and a `key`. TTL values are always expressed in milliseconds.

## Why cache groups exist

The group is more than a cosmetic prefix. It gives related entries an explicit namespace and allows a backend to map that namespace to its own storage primitive.

For example:

```ts
await cache.put('users', '42', user, 60_000)
await cache.put('permissions', '42', permissions, 60_000)
```

Both entries can use the same key without colliding because they live in different groups.

Groups are also useful when an entire category should be invalidated at once:

```ts
await cache.delete('users')
```

This removes the whole `users` group.

The distinction is especially important on Cloudflare. The default Durable Object cache maps **one cache group to one Durable Object**. All keys inside that group are stored and coordinated by the same Durable Object instance. Atomic operations such as `add()`, `increment()` and `compareAndDelete()` therefore execute within that group's Durable Object.

Choose groups around data that belongs together. Examples are `users`, `permissions`, `rate-limit`, `appointments` or `account:42`.

## Default group

Use an empty string when you do not need an explicit namespace:

```ts
await cache.put('', 'maintenance-mode', true)
```

Honovel normalizes `''` to the internal `default` group.

## Inject Cache

```ts
import { Cache } from 'honovel'

export class UserService {
  constructor(private readonly cache: Cache) {}
}
```

Your service does not need to know whether the application uses an in-memory cache, Durable Objects, Redis or another implementation.

## Store a value

```ts
await this.cache.put(
  'users',
  '42',
  { id: 42, name: 'Taylor' },
  60_000,
)
```

Omit the TTL for a non-expiring entry:

```ts
await this.cache.put('settings', 'application', settings)
```

## Read a value

```ts
const user = await this.cache.get<User>('users', '42')
```

Missing or expired entries return `null`.

Use a default value when useful:

```ts
const count = await this.cache.get('stats', 'visits', 0)
```

## Remember a value

`remember()` returns an existing cached value or computes and stores a new one:

```ts
const user = await this.cache.remember(
  'users',
  `user:${id}`,
  60_000,
  () => this.users.findOrFail(id),
)
```

`remember()` intentionally does not provide stampede protection. Several concurrent cache misses may execute the callback more than once. Use a lock as well when the calculation must only happen once.

## Delete entries

Delete one entry:

```ts
await this.cache.delete('users', '42')
```

Clear a whole group by omitting the key:

```ts
await this.cache.delete('users')
```

## Add only when absent

`add()` writes atomically only when the key does not already exist:

```ts
const created = await this.cache.add(
  'jobs',
  'daily-import',
  'running',
  5 * 60_000,
)

if (!created) {
  return
}
```

The concrete cache implementation must provide atomic semantics for this operation. Honovel's lock implementation relies on this guarantee.

## Atomic counters

`increment()` is useful for counters, quotas and rate limiting:

```ts
const attempts = await this.cache.increment(
  'rate-limit',
  `api:${ip}`,
  1,
  60_000,
)

if (attempts > 60) {
  throw new TooManyRequestsException()
}
```

Missing counters start at `0`. The TTL is applied when the counter is created. Later increments keep the original expiry instead of extending the window.

## Compare and delete

`compareAndDelete()` removes an entry only if its primitive value still equals the expected value:

```ts
await this.cache.put('processing', 'invoice:42', 'worker-a', 30_000)
await this.cache.compareAndDelete('processing', 'invoice:42', 'worker-a')
```

This is primarily useful for ownership-safe coordination. A process should not delete a lease that has already expired and been acquired by somebody else.

## Cloudflare default implementation

The Cloudflare template binds `DurableObjectCache` to the `Cache` contract:

```ts
import { Context } from 'hono'
import { Cache, Scope } from 'honovel'
import { BaseDurableObjectCache } from 'honovel/cloudflare'
import type { AppEnv } from '../env'

@Scope({ provides: Cache })
export class DurableObjectCache extends BaseDurableObjectCache {
  constructor(context: Context<AppEnv>) {
    super(context.env.HONOVEL_CACHE)
  }
}
```

The generated `wrangler.jsonc` contains the corresponding `HONOVEL_CACHE` Durable Object binding. One cache group maps to one named Durable Object, and keys in that group are stored in the Durable Object's persistent storage.

This also gives the default Cloudflare cache a natural place to coordinate atomic cache operations. You do not need a separate Durable Object specifically for locks.

## Replacing the cache implementation

Cache backends are selected through normal Honovel dependency injection. To replace the default, create a class extending `Cache` and bind it using `@Scope({ provides: Cache })`.

A Redis-backed application could look conceptually like this:

```ts
import {
  Cache,
  Scope,
  type CacheComparable,
  type CacheLookup,
} from 'honovel'

@Scope({ provides: Cache })
export class RedisCache extends Cache {
  constructor(private readonly redis: RedisService) {
    super()
  }

  protected async read<T>(group: string, key: string): Promise<CacheLookup<T>> {
    return this.redis.read<T>(group, key)
  }

  protected async write<T>(group: string, key: string, value: T, ttlMs?: number) {
    await this.redis.write(group, key, value, ttlMs)
  }

  protected async writeIfAbsent<T>(group: string, key: string, value: T, ttlMs?: number) {
    return this.redis.add(group, key, value, ttlMs)
  }

  protected async incrementEntry(group: string, key: string, amount: number, ttlMs?: number) {
    return this.redis.increment(group, key, amount, ttlMs)
  }

  protected async deleteEntryIfValueMatches(
    group: string,
    key: string,
    expectedValue: CacheComparable,
  ) {
    return this.redis.compareAndDelete(group, key, expectedValue)
  }

  protected async deleteEntry(group: string, key: string) {
    await this.redis.delete(group, key)
  }

  protected async deleteGroup(group: string) {
    await this.redis.deleteGroup(group)
  }
}
```

The backend-specific details belong to the application. Honovel only requires that the cache contract's atomic methods really are atomic.

Once this class becomes the selected `Cache` provider, existing services do not need to change. The default `CacheLock` also starts using this new cache automatically.