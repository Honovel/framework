# Logging & Request Context

Honovel emits structured JSON logs. Cloudflare Workers Logs indexes top-level fields, so events can be filtered by `level`, `service`, `event` and `requestId` without parsing nested payloads.

## Request context

Register the middleware once, before the compiled routes are attached:

```ts
import { createHonoApp, requestContext } from '@honovel/core'

const app = createHonoApp()
app.use('*', requestContext())

export default app
```

Every response receives `X-Request-Id`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The request ID is also stored in the Hono context.

```ts
app.use('*', requestContext({
  requestIdHeader: 'X-Trace-Id',
  generateRequestId: () => crypto.randomUUID(),
  securityHeaders: {
    'X-Frame-Options': 'DENY',
  },
}))
```

Incoming `X-Request-Id` headers are not trusted by default. Generate the ID inside the worker or validate/overwrite the incoming value before using it.

Rate-limited and forbidden requests produce a warning automatically:

```json
{"level":"warn","kind":"log","service":"RequestContext","requestId":"…","event":"http.request","status":429,"method":"POST","path":"/api/login","durationMs":3,"timestamp":"…"}
```

Set `log: false` to disable these warnings. Unhandled server errors are logged by the exception handler instead, so a `500` is not logged twice.

## Logger

Inject `Logger` into a service and bind the service name once:

```ts
import { Logger } from '@honovel/core'

export class UserService {
  static readonly serviceName = 'UserService'
  private readonly logger: Logger<UserService>

  constructor(logger: Logger<UserService>) {
    this.logger = logger.forService(UserService)
  }

  async find(id: string) {
    this.logger.info('user.lookup', { userId: id })
    // …
  }
}
```

The logger is request-scoped because the compiler injects the current Hono context. A log line includes the request ID automatically:

```json
{"level":"info","kind":"log","service":"UserService","requestId":"…","event":"user.lookup","userId":"42","timestamp":"…"}
```

Use `audit()` for security-relevant events. It emits `level: "info"` with `kind: "audit"` so audits can be filtered separately. Additional fields are merged as top-level JSON fields; keep values small and never log secrets or personal data.

Available methods:

```ts
logger.debug('cache.miss', { key })
logger.info('campaign.published', { campaignId })
logger.warn('rate_limit.near', { remaining: 2 })
logger.error('stripe.webhook_failed', { eventId })
logger.audit('auth.login_failed', { userId, ip })
```

Create a logger outside DI with `Logger.named(context, 'ServiceName')`.

Load-bearing fields such as `timestamp`, `level`, `kind`, `service`, `requestId` and `event` are written after the custom fields, so callers cannot overwrite them accidentally.

## Error renderer

The default exception handler returns JSON for APIs and Honovel's browser debug page for HTML requests. Applications can install their own JSON shape:

```ts
import { setErrorRenderer } from '@honovel/core'

setErrorRenderer(app, (_context, _error, details) => Response.json({
  error: {
    code: 'REQUEST_FAILED',
    message: details.message,
    requestId: details.requestId,
  },
  validation: details.validationErrors,
}, { status: details.status }))
```

`details` includes `status`, `message`, `body`, `headers`, `html`, `requestId`, `validationErrors` and debug information. The renderer only runs for non-HTML requests. Honovel still applies `Cache-Control: no-store`, the request ID header, security headers and exception headers such as `Retry-After` to the returned response.

If the renderer throws, Honovel logs the failure and falls back to the default renderer. For a complete typed error contract shared with generated OpenAPI, see [Custom error schemas](/exceptions#custom-error-schemas). Register `setErrorRenderer<ApiError>(...)` in the root `index.ts` so the compiler can discover the schema.

## Cloudflare client IP

`CF-Connecting-IP` is set by Cloudflare and cannot be spoofed by the client. Use the `ClientIp` decorator from `@honovel/cloudflare`:

```ts
import { ClientIp } from '@honovel/cloudflare'

@Post('/login')
login(@ClientIp() ip: string) {
  return { ip }
}
```

`X-Forwarded-For` is ignored by default. Only enable it when every request passes through a trusted proxy that overwrites the header:

```ts
@ClientIp({ trustForwardedFor: true }) ip: string
```

If neither header exists, the decorator returns `"unknown"`. Use `resolveClientIp(context, options)` when the value is needed outside a decorator.
