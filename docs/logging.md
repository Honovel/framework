# Logging & Request Context

Honovel emits structured JSON logs. Cloudflare Workers Logs indexes top-level fields, so events can be filtered by `level`, `service`, `event` and `requestId` without parsing nested payloads.

## Request context

Register the middleware once, before the compiled routes are attached:

```ts
import { createHonoApp, requestContext } from 'honovel'

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
{"level":"warn","kind":"log","service":"RequestContext","requestId":"…","event":"http.request","message":"http.request","status":429,"method":"POST","path":"/api/login","durationMs":3,"timestamp":"…"}
```

Set `log: false` to disable these warnings. Unhandled server errors are logged by the exception handler instead, so a `500` is not logged twice.

## Logger

Inject `Logger` into a controller, service, listener or cron job. The compiler automatically sets the receiving class name as the log's `service`:

```ts
import { Logger } from 'honovel'

export class UserService {
  constructor(private readonly logger: Logger) {}

  async find(id: string) {
    this.logger.info('Looking up user', 'user.lookup', { userId: id })
    // …
  }
}
```

The logger is request-scoped because the compiler injects the current Hono context. Each receiving class gets its own named logger; naming one does not change another class's logger. A log line includes the request ID automatically:

```json
{"level":"info","kind":"log","service":"UserService","requestId":"…","event":"user.lookup","message":"Looking up user","userId":"42","timestamp":"…"}
```

The compiler preserves the class name even when the bundle is minified. Set `static readonly serviceName = 'Users'` on the receiving class to override it. Use `logger.forService('OtherName')` when an individual logger needs a different name.

Injected loggers can be used in constructors. The controller's `this.context` is only available after construction, while handling a request, so `Logger.named(this.context, ...)` cannot be used in a controller constructor.

Use `audit()` for security-relevant events. It emits `level: "info"` with `kind: "audit"` so audits can be filtered separately. Additional fields are merged as top-level JSON fields; keep values small and never log secrets or personal data.

Available methods:

```ts
logger.debug('Cache entry missing', 'cache.miss', { key })
logger.info('Campaign published', 'campaign.published', { campaignId })
logger.warn('Rate limit approaching', 'rate_limit.near', { remaining: 2 })
logger.error('Webhook processing failed', 'stripe.webhook_failed', { eventId })
logger.audit('Login failed', 'auth.login_failed', { userId, ip })
```

### Event names and messages

The first argument is always written to `message`. The optional second argument sets `event`; when omitted, `event` defaults to `"log"`. All methods (`debug`, `info`, `warn`, `error` and `audit`) support these four forms:

```ts
logger.info('My message', 'cleanup.complete', { custom: data })
logger.info('My message', { custom: data }) // event: "log"
logger.info('My message', 'cleanup.complete')
logger.info('My message') // event: "log"
```

Use a stable event name when logs should be filtered or grouped by an operation. For example:

```ts
logger.info('Invoice generated successfully', 'invoice.generate.completed', {
  invoiceId: 42,
})
```

This produces `"message": "Invoice generated successfully"`, `"event": "invoice.generate.completed"` and `"invoiceId": 42`. Framework logs retain their explicit events such as `http.exception` and `http.request`.

Create a logger outside DI with `Logger.named(context, 'ServiceName')`.

Load-bearing fields such as `timestamp`, `level`, `kind`, `service`, `requestId`, `event` and `message` are written after the custom fields, so callers cannot overwrite them accidentally.

## Logging in queued listeners

Inject `Logger` into a `QueuedListener` just as you would into a controller. The compiler sets the listener's service name automatically, and services called by the listener receive their own named loggers:

```ts
import { Logger, QueuedListener } from 'honovel'
import { GenerateInvoice } from './GenerateInvoice'

export class GenerateInvoiceListener extends QueuedListener<GenerateInvoice> {
  constructor(private readonly logger: Logger) {
    super()
  }

  async handle(event: GenerateInvoice) {
    this.logger.info('Generating invoice', 'invoice.generate.started', { invoiceId: event.invoiceId })
    // Generate the invoice…
    this.logger.info('Invoice generated', 'invoice.generate.completed', { invoiceId: event.invoiceId })
  }
}
```

Queued listeners execute in a fresh scope without the original HTTP request. Their logs include `service`, `message`, `event`, `level`, `kind` and `timestamp`, but no automatic HTTP `requestId`. Include an invoice ID or another correlation field in the payload and log fields when you need to connect dispatch and processing. See [Events & Queues](/events-queues) for queue configuration and dispatching.

`Logger.named()` also works with the context injected into a queued listener. For an explicit name, replace the constructor above with:

```ts
// Add this import at the top of the module:
import { Context } from 'hono'

// Inside GenerateInvoiceListener:
private readonly logger: Logger

constructor(context: Context) {
  super()
  this.logger = Logger.named(context, 'InvoiceWorker')
}
```

The injected queue context supplies environment bindings; it is not an HTTP request context. Pass that injected context to `Logger.named()`, not the Cloudflare `ExecutionContext`. To rename an injected logger without injecting `Context`, use `logger.forService('InvoiceWorker')` instead.

## Logging in cron jobs

Cron jobs support the same logger injection and `Logger.named(context, 'Name')` pattern as queued listeners. For example:

```ts
import { Cron, CronJob, Logger } from 'honovel'

@Cron({ minute: '*/5' })
export class CleanupExpiredSessions extends CronJob {
  constructor(private readonly logger: Logger) {
    super()
  }

  async handle() {
    this.logger.info('Starting scheduled session cleanup', 'sessions.cleanup.started')
    // Delete expired sessions…
    this.logger.info('Session cleanup completed', 'sessions.cleanup.completed')
  }
}
```

The service name is `CleanupExpiredSessions`. Each execution gets a fresh scope without an HTTP request, so no automatic HTTP `requestId` is included. Services called by the job can inject `Logger` as usual. See [Cron Jobs](/cron) for scheduling and execution details.

## Error renderer

The default exception handler returns JSON for APIs and Honovel's browser debug page for HTML requests. Applications can install their own JSON shape:

```ts
import { setErrorRenderer } from 'honovel'

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

`CF-Connecting-IP` is set by Cloudflare and cannot be spoofed by the client. Use the `ClientIp` decorator from `honovel/cloudflare`:

```ts
import { ClientIp } from 'honovel/cloudflare'

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
