# @honovel/cloudflare

Cloudflare runtime adapters for Honovel.

## Client IP

Use `ClientIp` to resolve Cloudflare's trusted `CF-Connecting-IP` header:

```ts
import { ClientIp } from '@honovel/cloudflare'

@Get('/')
index(@ClientIp() ip: string) {
  return { ip }
}
```

`X-Forwarded-For` is ignored unless `{ trustForwardedFor: true }` is passed. If neither header is present, the decorator returns `"unknown"`. Use `resolveClientIp(context, options)` outside a decorator.

## Durable Object cache

The Cloudflare package exports `BaseDurableObjectCache`, while generated applications provide their concrete `DurableObjectCache` class and bind it to the Core `Cache` contract.

The Cloudflare starter binds `HONOVEL_CACHE` to `HonovelCacheDurableObject`. Each cache group maps to one Durable Object. Entries inside that group can have independent TTLs, and atomic cache operations such as `add()` and `compareAndDelete()` are coordinated by that object.

```ts
import { Context } from 'hono'
import { Cache, Scope } from '@honovel/core'
import { BaseDurableObjectCache } from '@honovel/cloudflare'
import type { AppEnv } from '../env'

@Scope({ provides: Cache })
export class DurableObjectCache extends BaseDurableObjectCache {
  constructor(context: Context<AppEnv>) {
    super(context.env.HONOVEL_CACHE)
  }
}
```

## Locks

`CacheLock` now lives in `@honovel/core` because it only depends on the runtime-neutral `Cache` contract. Runtime packages therefore do not need their own lock implementation. The starter only selects it for the application:

```ts
import { CacheLock, Lock, Scope } from '@honovel/core'

@Scope({ provides: Lock })
export class AppLock extends CacheLock {}
```

Honovel's compiler follows the inherited `CacheLock` constructor, so the application's configured `Cache` implementation is injected automatically. On Cloudflare this means `AppLock` uses `DurableObjectCache`; no separate lock Durable Object or binding is required.
