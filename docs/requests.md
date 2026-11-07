# Requests & Validation

`FormRequest` combines request-body binding, validation and typed access to validated input.

## Create a FormRequest

```ts
export class CreateUserRequest extends FormRequest(z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  age: z.number().int().min(18).optional(),
})) {}
```

Use it directly in a controller:

```ts
@Post('/')
store(request: CreateUserRequest) {
  return this.users.create(request.validated())
}
```

## Access validated input

```ts
const input = request.validated()
const email = request.input('email')
const all = request.all()
```

## Access the underlying request

```ts
const requestId = request.req.header('X-Request-ID')
```

## Reserved field names

`req`, `validated`, `all` and `input` are reserved by FormRequest.

## Validation errors

Invalid input automatically returns `422 Unprocessable Entity` and the controller action does not run.

## Nested validation

```ts
export class CreateBookingRequest extends FormRequest(z.object({
  customer: z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }),
  serviceIds: z.array(z.number().int()).min(1),
  startsAt: z.string().datetime(),
})) {}
```

## Transform values

```ts
export class CreateReportRequest extends FormRequest(z.object({
  year: z.coerce.number().int().min(2000),
})) {}
```

## Query parameters

Query values stay explicit on controller methods:

```ts
@Get('/')
index(
  @Query('page') page = 1,
  @Query('search') search?: string,
) {
  return this.users.paginate({ page, search })
}
```

## Direct field access

Validated object fields are also available directly, for example `request.email`. These values come from the schema output, including coercions and transformations. `validated()`, `all()` and `input()` read the stored validated data; keep that data immutable in application code.

## Validation schema compatibility

`FormRequest` accepts schemas with a synchronous `safeParse()` method or a Standard Schema-compatible `~standard.validate()` method. The latter may return a promise. Output types are inferred for validated fields. This runtime support does not imply that every validator-specific rule can be reproduced in generated OpenAPI; the compiler derives its request schema from the TypeScript output type.

Invalid or missing JSON bodies, invalid primitive route/query input and schema failures share the `422` error path. See [Exceptions & Debugging](/exceptions#validation-errors) for the default body and [custom error schemas](/exceptions#custom-error-schemas) to customize it.

## Validate the complete query

Use `@Query()` on a FormRequest to validate the query object instead of the JSON body:

```ts
import { FormRequest, Get, Query } from '@honovel/core'
import { z } from 'zod'

export class SearchUsersRequest extends FormRequest(z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().optional(),
})) {}

// Inside a controller:
@Get('/')
index(@Query() query: SearchUsersRequest) {
  return this.users.search(query.validated())
}
```

Query input arrives as strings, or arrays of strings for repeated keys. Use schema coercion when numbers are expected. A named `@Query('filter')` binds that query value rather than the complete object. The compiler includes query FormRequests in generated OpenAPI parameters. A controller method can have at most one body FormRequest; explicitly decorated query FormRequests do not consume that body slot.
