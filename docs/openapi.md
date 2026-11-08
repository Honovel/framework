# OpenAPI & Swagger

Honovel generates OpenAPI documentation from your application code. You do not need separate API-documentation decorators on every controller method.

The compiler uses routes, parameters, FormRequests, return values, authentication decorators and reachable HTTP exceptions.

## Swagger UI in development

Swagger UI is enabled by default at:

```text
/swagger
```

The generated JSON document is available at:

```text
/openapi.json
```

## Request schemas

```ts
export class CreateUserRequest extends FormRequest(z.object({
  name: z.string().min(2),
  email: z.string().email(),
})) {}
```

```ts
@Post('/')
store(request: CreateUserRequest) {
  return this.users.create(request.validated())
}
```

The request body is documented automatically.

## Path parameters

```ts
@Get('/:id')
show(id: number) {
  return this.users.findOrFail(id)
}
```

## Query parameters

```ts
@Get('/')
index(
  @Query('page') page?: number,
  @Query('search') search?: string,
) {
  return this.users.search({ page, search })
}
```

## Response status codes

```ts
@Post('/')
store(request: CreateUserRequest) {
  const user = this.users.create(request.validated())
  return this.json(user, 201)
}
```

## Exception responses

If a statically reachable service can throw `NotFoundException`, Honovel can add `404` to the generated operation. Validation contributes `422`, and the global fallback contributes `500`.

Applications with a custom JSON error renderer can declare the response body type on
`setErrorRenderer`. Honovel uses this type for generated exception, validation and
fallback error responses:

```ts
// root index.ts
import { setErrorRenderer } from 'honovel'
import type { ApiError } from '#src/http/ApiError'

setErrorRenderer<ApiError>(app, renderApiError)
```

The type argument is compile-time metadata; the renderer still controls the runtime
response body. Register it directly in root `index.ts`, with at most one typed
registration. Imported setup functions are not scanned for this metadata. Honovel
does not infer the global schema from arbitrary renderer JSON or validate its
output at runtime. See [Custom error schemas](/exceptions#custom-error-schemas) for
a complete implementation with a shared contract and validation fields.

## Authentication

`@BasicAuth()`, `@BearerAuth()` and `@JwtAuth()` create matching OpenAPI security schemes and integrate with Swagger's authorization UI.

## Production behavior

Production compilation disables the served Swagger and OpenAPI routes by default while still emitting:

```text
.honovel/openapi.json
```

Enable served docs explicitly:

```bash
npm run compile -- --mode production --swagger-enabled
```

Customize the routes:

```bash
npm run compile -- \
  --mode production \
  --swagger-enabled \
  --swagger-path /docs \
  --openapi-path /schema.json
```

Disable them explicitly in development:

```bash
npm run compile -- --swagger-enabled=false
```

The generated OpenAPI file can be used for client generation, API tools, contract tests and coding agents.
