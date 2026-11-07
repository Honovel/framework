# Middleware

Middleware runs code around controller endpoints and participates in Honovel dependency injection.

## Create middleware

```bash
npm run honovel -- make:middleware RequestLogging
```

```ts
import { BaseMiddleware, type MiddlewareNext } from '@honovel/core'
import type { Context } from 'hono'

export class RequestLoggingMiddleware extends BaseMiddleware {
  async handle(context: Context, next: MiddlewareNext) {
    const startedAt = Date.now()
    const response = await next()
    console.log(context.req.method, context.req.path, `${Date.now() - startedAt}ms`)
    return response
  }
}
```

## Controller middleware

```ts
@BaseUrl('/admin')
@Middleware(AdminMiddleware)
export class AdminController extends Controller {}
```

## Route middleware

```ts
@Get('/export')
@Middleware(AuditMiddleware)
exportData() {
  return this.reports.export()
}
```

## Base-controller middleware

```ts
@Middleware(RequestLoggingMiddleware)
export abstract class ApiController extends Controller {}
```

```ts
@BaseUrl('/users')
@Middleware(AuthenticationMiddleware)
export class UserController extends ApiController {
  @Get('/:id')
  @Middleware(AuditMiddleware)
  show(id: number) {
    return { id }
  }
}
```

Execution order is base controller, concrete controller, endpoint.

## Multiple middleware classes

```ts
@Middleware(AuthenticationMiddleware, TenantMiddleware)
```

or:

```ts
@Middleware([AuthenticationMiddleware, TenantMiddleware])
```

## Inject dependencies

```ts
import { BaseMiddleware, ForbiddenException, type MiddlewareNext } from '@honovel/core'
import type { Context } from 'hono'

export class TenantMiddleware extends BaseMiddleware {
  constructor(private readonly tenants: TenantRepository) {
    super()
  }

  async handle(context: Context, next: MiddlewareNext) {
    const tenantId = context.req.header('X-Tenant-ID')

    if (!tenantId || !await this.tenants.exists(tenantId)) {
      throw new ForbiddenException('Unknown tenant')
    }

    return next()
  }
}
```

## Response contract

`MiddlewareNext` returns `Promise<Response>`. Return the downstream response from `handle()` or return your own `Response` to stop the chain early. Code after `await next()` runs in reverse order as middleware unwinds. Calling `next()` twice is rejected. Native Hono middleware can be registered on `app` in root `index.ts` before compiled routes are attached.
