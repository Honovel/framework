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
const email = request.email
```

## Access the underlying request

```ts
const requestId = request.req.header('X-Request-ID')
```

## Reserved field names

`req` and `validated` are reserved by FormRequest.

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

Validated object fields are also available directly, for example `request.email`. These values come from the schema output, including coercions and transformations. `validated()` returns the stored validated data; keep that data immutable in application code.

## Validation schema compatibility

`FormRequest` accepts schemas with a synchronous `safeParse()` method or a Standard Schema-compatible `~standard.validate()` method. The latter may return a promise. Output types are inferred for validated fields. This runtime support does not imply that every validator-specific rule can be reproduced in generated OpenAPI; the compiler derives its request schema from the TypeScript input type when available, falling back to the output type.

Invalid or missing JSON bodies, invalid primitive route/query input and schema failures share the `422` error path. See [Exceptions & Debugging](/exceptions#validation-errors) for the default body and [custom error schemas](/exceptions#custom-error-schemas) to customize it.

## Validate the complete query

Use `@Query()` on a FormRequest to validate the query object instead of the JSON body:

```ts
import { FormRequest, Get, Query } from 'honovel'
import { z } from 'zod'

export class SearchUsersRequest extends FormRequest(z.object({
  page: z.int().min(1).default(1),
  search: z.string().optional(),
})) {}

// Inside a controller:
@Get('/')
index(@Query() query: SearchUsersRequest) {
  return this.users.search(query.validated())
}
```

Query input arrives as strings, or arrays of strings for repeated keys. For schema inputs typed as `number` or `boolean`, Honovel strictly decodes those values before validation; `z.int()` and `z.boolean()` therefore work without `coerce` or `stringbool`. For a primitive parameter or a FormRequest with primitive output, a named `@Query('filter')` binds that exact query value. For an object FormRequest, the name is a field prefix as shown below. The compiler includes query FormRequests in generated OpenAPI parameters. A controller method can have at most one body FormRequest; explicitly decorated query FormRequests do not consume that body slot.

## Optional query FormRequests

Use `?` to make the entire query FormRequest optional:

```ts
export class MyDataRequest extends FormRequest(z.object({
  name: z.string(),
})) {}

// Inside a controller:
@Get('/')
show(@Query() data?: MyDataRequest) {
  return { name: data?.name, data: data?.validated() }
}
```

With no query parameters, `data` is `undefined`. With `?name=Flo`, the query object is validated and `data.name` is `"Flo"`. Once any query parameters are supplied, the complete schema must pass validation; `?other=value` still fails if `name` is required. To make individual fields optional while always receiving a FormRequest, keep the controller parameter required and use `.optional()` on those schema fields instead.

For an optional named object FormRequest, only fields under its prefix determine whether it is present. For example, `@Query('data') data?: MyDataRequest` is `undefined` unless query keys starting with `data.` are supplied. Once such keys are present, the complete object schema is validated.

OpenAPI lists the fields of an unnamed query FormRequest as individual query parameters. For an optional FormRequest these parameters are marked optional; supplied query input must still satisfy the schema as a whole.

## Named query objects

For an object FormRequest, `@Query('custom')` uses the name as a prefix:

```ts
export class MyDataRequest extends FormRequest(z.object({
  name: z.string().min(1),
  age: z.int().min(0),
})) {}

// Inside a controller:
@Get('/')
show(@Query('custom') data: MyDataRequest) {
  return data.validated()
}
```

Call it with:

```text
?custom.name=Flo&custom.age=30
```

Honovel collects matching keys, removes `custom.`, strictly decodes the numeric input, and validates `{ name: 'Flo', age: 30 }`. OpenAPI lists `custom.name` and `custom.age` as separate query parameters so Swagger sends these same keys.

Only the prefix is removed; dots inside the remaining field name are not expanded into nested objects. This binding supports flat object fields. Repeated values still arrive as arrays of strings, for example `?custom.tags=a&custom.tags=b`; array normalization and element decoding are not automatic in this first stage. It does not parse a JSON string from `?custom={...}`. Named FormRequests with arrays of objects or mixed object/primitive unions remain compiler errors.

Different prefixes can be used in the same action:

```ts
show(
  @Query('first') first: MyDataRequest,
  @Query('second') second?: MyDataRequest,
) {
  return { first: first.validated(), second: second?.validated() }
}
```

The two objects bind independently from `first.name`, `first.age`, `second.name` and `second.age`. With no `second.*` fields, the optional `second` parameter is `undefined`.

## Strict query and route values

Direct `number` and `boolean` parameters and query FormRequest fields follow the same decoding rules. FormRequest decoding is generated from the schema's **input** type, so a string-to-number schema transformation still receives a string. Normal schema validation runs afterward, including integer checks, bounds, refinements, defaults and transformations. JSON bodies are not decoded this way.

| Expected input | Accepted transport values |
| --- | --- |
| `string` | One unchanged string; `"001"` stays `"001"` |
| `number` | A finite number in JSON number syntax, including decimal fractions and exponents |
| `boolean` | Exactly `true`, `false`, `1` or `0` |

Empty numeric values, whitespace, hexadecimal/binary notation, leading `+`, leading zeros such as `01`, `NaN` and infinity are rejected with `422`. Boolean input is case-sensitive; `yes`, `no` and empty strings are rejected. Repeated keys for a supported scalar field also return `422` rather than selecting one value silently.

A missing optional field stays missing and can use a schema default. An explicitly empty field is present: `?age=` fails numeric decoding even when `age` is optional. String fields may contain empty strings if their schema permits them.

The first stage only automatically decodes scalar strings, numbers and booleans. Other schema inputs (arrays, dates, bigint, null, nested objects or ambiguous unions) produce compiler/editor warnings and retain their raw query representation. Receive strings and parse those explicitly. In particular, one occurrence of a query key remains a string; repeated occurrences become an array of strings. No automatic comma splitting, array wrapping or JSON parsing is performed.

The compiler reads schema input metadata such as Zod's input type or Standard Schema's `~standard.types.input`; it does not inspect validator internals at runtime. Schemas with unknown or unavailable input types also produce a warning and receive raw input. This preserves explicit coercions and preprocessors. Warnings do not stop the build; existing errors for unsupported direct parameter bindings remain errors.
