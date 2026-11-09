# Controllers & Routing

Controllers group related HTTP endpoints. New applications normally extend the application-level `Controller` generated under `src/runtime/Controller.ts` and declare their feature-specific prefix with `@BaseUrl()`.

## Application controller

Honovel Core provides `BaseController`, which contains the shared controller helpers and request context support. The generated starter then owns a small application-specific controller:

```ts
import { BaseController, BaseUrl } from 'honovel'

@BaseUrl('/api')
export abstract class Controller extends BaseController {}
```

This class lives in `src/runtime/Controller.ts`. Generated feature controllers import it through `#src/runtime/Controller`.

`@BaseUrl()` values are composed across controller inheritance. If the application controller declares `/api` and a feature controller declares `/users`, the resulting route prefix is `/api/users`. You can therefore change or remove the global API prefix in one application-owned file without changing every controller.

Core still exports `Controller` for compatibility with existing applications. New starter projects use the application-level controller so routing conventions remain application-owned.

## Basic controller

```ts
import { BaseUrl, Get } from 'honovel'
import { Controller } from '#src/runtime/Controller'

@BaseUrl('/users')
export class UserController extends Controller {
  @Get('/')
  index() {
    return [{ id: 1, name: 'Taylor' }]
  }
}
```

With the generated application controller, this route is available at `/api/users`.

## HTTP methods

```ts
@Get('/')
@Post('/')
@Put('/:id')
@Patch('/:id')
@Delete('/:id')
```

A CRUD controller can combine them:

```ts
@BaseUrl('/users')
export class UserController extends Controller {
  @Get('/') index() {}
  @Get('/:id') show(id: number) {}
  @Post('/') store(request: CreateUserRequest) {}
  @Put('/:id') update(id: number, request: UpdateUserRequest) {}
  @Delete('/:id') destroy(id: number) {}
}
```

## Path parameters

```ts
@Get('/:id')
show(id: number) {
  return { id }
}
```

The parameter name must match the route placeholder. To use another variable name:

```ts
@Get('/:id')
show(@Param('id') userId: number) {
  return { id: userId }
}
```

## Query parameters

```ts
@Get('/')
index(
  @Query('page') page?: number,
  @Query('search') search?: string,
) {
  return { page, search }
}
```

`@Query()` without an explicit name can use the parameter name.

## Request access

```ts
@Get('/request-info')
requestInfo(request: HonoRequest) {
  return {
    userAgent: request.header('User-Agent'),
    url: request.url,
  }
}
```

## Returning responses

Plain values are serialized normally:

```ts
@Get('/:id')
show(id: number) {
  return { id, name: 'Taylor' }
}
```

Set an explicit status code with controller helpers:

```ts
@Post('/')
store(request: CreateUserRequest) {
  const user = createUser(request.validated())
  return this.json(user, 201)
}
```

## Dependency injection

```ts
constructor(private readonly users: UserRepository) {
  super()
}
```

## Inherited prefixes

Controller prefixes are inherited and composed rather than replaced:

```ts
@BaseUrl('/api')
export abstract class ApiController extends BaseController {}

@BaseUrl('/admin')
export abstract class AdminController extends ApiController {}

@BaseUrl('/users')
export class UserController extends AdminController {
  @Get('/')
  index() {}
}
```

The resulting route is `/api/admin/users`. This composition happens at compile time and is reflected in generated OpenAPI paths and the TypeScript language-service diagnostics.

## Multiple prefixes

```ts
@BaseUrl(['/v1/users', '/v2/users'])
export class UserController extends Controller {}
```

Honovel emits separate routes and OpenAPI paths for each prefix. When the controller extends the generated application `Controller`, its inherited `/api` prefix is applied to each path as well, producing `/api/v1/users` and `/api/v2/users` with the default starter configuration.

## Empty and native responses

`return this.noContent()` sends `204 No Content`. A handler returning `undefined` also produces a `204` response. Returned `Response` objects pass through unchanged; other values are serialized as JSON. You can use the protected `this.context` inside a handler for Hono-specific response helpers.

Primitive route/query bindings support strings, numbers and booleans. Boolean input accepts `true`/`1` and `false`/`0`. Numbers must be finite and use JSON number syntax; empty values, whitespace, hexadecimal notation and infinity are rejected. Repeated query keys for scalar parameters are also rejected. Missing required values and invalid conversions return `422`; optional parameters and default values allow omitted input. Use a FormRequest when input needs richer validation.
