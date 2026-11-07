# @honovel/node

Node.js runtime adapters for Honovel.

The package provides reusable implementations without selecting them as application DI defaults:

- `InMemoryCache` implements Core `Cache`.
- `InMemoryQueue` implements Core `Queue` for development and tests.
- `startCronJobs()` runs compiler-discovered `CronJob`s with Croner.

Applications choose their bindings explicitly, for example:

```ts
import { Cache, Scope } from '@honovel/core'
import { InMemoryCache } from '@honovel/node'

@Scope({ provides: Cache })
export class AppCache extends InMemoryCache {}
```

This keeps Redis, BullMQ, database-backed caches, or other application-specific replacements straightforward.

`startCronJobs(app, { bindings })` reads the generated cron metadata attached to the compiled Hono application and invokes the same generated `runCronJob()` path used by other runtimes. Each Node process starts its own Croner timers.
