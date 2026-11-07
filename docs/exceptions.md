# Exceptions & Debugging

Honovel converts framework and application exceptions into HTTP responses through one global exception handler.

## Built-in HTTP exceptions

```ts
throw new BadRequestException('Invalid request')
throw new UnauthorizedException()
throw new ForbiddenException()
throw new NotFoundException('User not found')
throw new ConflictException('Email already exists')
throw new TooManyRequestsException()
```

| Exception | Status |
| --- | ---: |
| `BadRequestException` | 400 |
| `UnauthorizedException` | 401 |
| `ForbiddenException` | 403 |
| `NotFoundException` | 404 |
| `ConflictException` | 409 |
| `TooManyRequestsException` | 429 |

## Throw from services

```ts
async findOrFail(id: number) {
  const user = await this.find(id)

  if (!user) {
    throw new NotFoundException(`User ${id} was not found`)
  }

  return user
}
```

The calling controller does not need its own error handling.

## Custom HTTP exceptions

```ts
export class SubscriptionRequiredException extends HttpException {
  constructor() {
    super(402, 'An active subscription is required')
  }
}
```

## Response headers

Pass additional headers as the fourth `HttpException` argument:

```ts
throw new HttpException(
  402,
  'An active subscription is required',
  { message: 'Subscription required' },
  { 'WWW-Authenticate': 'Bearer realm="billing"' },
)
```

`TooManyRequestsException` sets `Retry-After` for you:

```ts
throw new TooManyRequestsException('Slow down', 30)
```

The response body is `{ "message": "Slow down", "retryAfterSeconds": 30 }` and the header is `Retry-After: 30`.

Honovel also adds `Cache-Control: no-store`, the request ID header and the security headers installed by `requestContext()` to every exception response.

## Custom JSON error shape

Use `setErrorRenderer()` to replace the JSON error body while keeping Honovel's browser debug page for HTML requests:

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

The renderer receives the normalized `ErrorDetails`. Its response still gets the standard cache, request ID, security and exception headers. If it throws, Honovel logs the failure and renders the default response instead. See [Logging & Request Context](/logging) for the complete contract.

## Custom error schemas

Use a shared TypeScript contract when every API error should have a consistent body. For example, create `src/http/ApiError.ts`:

```ts
export interface ApiError {
  error: {
    code: string
    message: string
    requestId?: string
  }
  validation?: Record<string, string[]>
}
```

Register the renderer in the root `index.ts`, alongside application setup. The minimal example below shows the relevant setup; keep the starter's existing Cloudflare Durable Object exports when adding it to a real project:

```ts
import { createHonoApp, requestContext, setErrorRenderer } from '@honovel/core'
import type { ApiError } from '#src/http/ApiError'

const app = createHonoApp()
app.use('*', requestContext())

setErrorRenderer<ApiError>(app, (_context, _error, details) => {
  const body = {
    error: {
      code: `HTTP_${details.status}`,
      message: details.message,
      ...(details.requestId ? { requestId: details.requestId } : {}),
    },
    ...(details.validationErrors ? { validation: details.validationErrors } : {}),
  } satisfies ApiError

  return Response.json(body, { status: details.status })
})

export default app
```

This applies the JSON shape to framework HTTP exceptions, validation errors and unexpected server errors. `details.message` hides unexpected exception messages behind `Internal Server Error`; debug information is available separately in `details.debug`. The renderer decides whether to include it. Requests preferring HTML continue to use Honovel's browser error page.

The explicit `<ApiError>` argument tells the compiler which schema to use for inferred OpenAPI error responses, including `401`, `422` and `500`. Keep this typed registration in root `index.ts`: the compiler does not discover it inside an imported setup function, and accepts only one typed registration there. A type alias or interface can be imported from another file or package.

The generic argument is documentation metadata, not runtime validation of the emitted JSON. The `satisfies ApiError` check above verifies the constructed body in TypeScript; the renderer must still produce the promised shape on each error path. A callback typed only as `ErrorRenderer<ApiError>` does not replace the explicit type argument on the registration for compiler discovery.

The third callback argument is `ErrorDetails`:

| Field | Meaning |
| --- | --- |
| `status`, `message` | Normalized HTTP status and public message. |
| `body` | Default response body; preserve or map application-specific exception fields explicitly if needed. |
| `headers` | Headers from Honovel HTTP exceptions, such as `Retry-After`. |
| `requestId` | Optional ID supplied by request-context middleware. |
| `validationErrors` | Optional map of field paths to arrays of validation messages. |
| `html` | Whether HTML was requested; custom renderers only run for non-HTML requests. |
| `debug` | Optional unexpected-error message, exception name and stack when debug mode is enabled. |

Renderers may return a `Response` asynchronously. Honovel reapplies exception headers and `Cache-Control: no-store`, plus request ID and security headers when configured. If the renderer fails, Honovel falls back to its default body; that fallback may differ from your custom schema. `clearErrorRenderer(app)` removes the runtime customization.

## Per-exception JSON bodies

For a domain-specific body without a global renderer, pass the body to `HttpException`:

```ts
export class SubscriptionRequiredException extends HttpException {
  constructor() {
    super(402, 'Subscription required', {
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Choose a plan to continue',
    })
  }
}
```

The default JSON renderer uses this body. A global custom renderer receives it as `details.body` and controls the final JSON. To document a consistent custom contract in OpenAPI, use the typed renderer registration above; a custom body alone does not declare a global error schema.

## Validation errors

FormRequest and parameter validation failures return `422 Unprocessable Entity` automatically. The default JSON body is:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "customer.email": ["Invalid email address"]
  }
}
```

Nested field paths use dots, including array indices such as `items.0.name`. Issues without a field path use `request`; malformed JSON is reported there as well. A custom renderer receives the same field map through `details.validationErrors`.

## Browser errors

Requests preferring HTML receive Honovel's browser error page. API requests receive JSON.

## Debug mode

```text
APP_DEBUG=true
```

With debug enabled, development errors can include exception details and stack traces. Keep it disabled in production.

## Debugging in your IDE

### Cloudflare Workers

The Cloudflare starter runs the local Worker through Wrangler/workerd. Normal `npm run dev` uses an ephemeral inspector port so multiple local projects do not fight over `9229`. For IDE debugging, start the dedicated debug command instead:

```bash
npm run dev:debug
```

Do not start Wrangler itself through a normal Node debugger. Wrangler launches the Worker in workerd, so your IDE must attach to the Worker inspector instead.

#### VS Code

The generated Cloudflare project already contains `.vscode/launch.json` with the `Honovel Cloudflare (attach)` configuration. After `npm run dev:debug` is running:

1. Open **Run and Debug**.
2. Select **Honovel Cloudflare (attach)**.
3. Start debugging.
4. Set breakpoints in your TypeScript source files and trigger a request.

The generated configuration attaches to `127.0.0.1:9229` and enables source maps, so breakpoints resolve back to your application source.

If you need to recreate the configuration manually, the important values are:

```json
{
  "type": "node",
  "request": "attach",
  "address": "127.0.0.1",
  "port": 9229,
  "cwd": "/",
  "resolveSourceMapLocations": null,
  "sourceMaps": true
}
```

#### WebStorm / IntelliJ IDEA

Create a **Node.js/Chrome** attach configuration:

1. Start the application with `npm run dev:debug`.
2. Open **Run → Edit Configurations**.
3. Add **Attach to Node.js/Chrome** (called **Node.js/Chrome** in some JetBrains versions).
4. Set **Host** to `127.0.0.1` or `localhost`.
5. Set **Port** to `9229`.
6. Enable automatic reconnect if available.
7. Start the debugger and trigger a request to hit your breakpoint.

Cloudflare's Worker inspector speaks the Chrome DevTools protocol, so JetBrains can attach to it even though the Worker itself is running in workerd rather than Node.js.

The `--debug` flag passed by `npm run dev:debug` selects inspector IP `127.0.0.1` and port `9229` in the Core launcher. The starter does not configure a fixed inspector port in `wrangler.jsonc`. Normal development disables the fixed port by passing inspector port `0`.

## OpenAPI

Statically reachable `HttpException` subclasses can be inferred into generated endpoint responses automatically.
