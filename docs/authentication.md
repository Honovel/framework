# Authentication

Honovel integrates Hono's authentication middleware through compile-time decorators. It deliberately does not define your application's user model, sessions, roles or permissions.

## Available decorators

Honovel provides `@BasicAuth()`, `@BearerAuth()` and `@JwtAuth()`. Each decorator accepts the corresponding Hono middleware options and can be placed on a controller or an individual endpoint.

Deployment-specific option values can be represented with `Binding()` references. Honovel resolves those references from the runtime environment exposed through Hono `context.env`.

This keeps environment-specific authentication configuration outside your application logic.

## Controller-level authentication

Authentication middleware can protect all routes on a controller. This is useful for API sections where every endpoint requires the same authentication mechanism.

Use `Binding()` when an option should come from the runtime environment instead of being embedded in application source. For example, a JWT option such as the algorithm can be resolved from `context.env`:

```ts
import {
  BaseUrl,
  Binding,
  Controller,
  Get,
  JwtAuth,
  JwtPayload,
  type JwtPayload as JwtPayloadType,
} from '@honovel/core'

@JwtAuth({
  secret: Binding('JWT_SECRET'),
  alg: 'HS256',
})
@BaseUrl('/api')
export class ApiController extends Controller {
  @Get('/me')
  me(@JwtPayload() payload: JwtPayloadType) {
    return {
      subject: payload.sub,
    }
  }
}
```

`Binding('JWT_SECRET')` tells Honovel not to treat the value as a literal. At runtime it reads `context.env.JWT_SECRET` and passes that value to Hono's JWT middleware. The same mechanism can be used for other string-valued JWT options that should be supplied by the runtime environment, including signing configuration.

With Cloudflare, the referenced name must exist as a Worker binding. With Node, expose the corresponding value through the Hono environment passed to the application.

`Binding()` also works recursively inside supported nested option objects and arrays, and can be used with `@BasicAuth()`, `@BearerAuth()` and `@JwtAuth()`.

The options object itself must remain statically analyzable because Honovel emits the middleware at compile time. `Binding()` is the mechanism for individual values that are only known when the application runs.

## Route-level authentication

You can protect only selected endpoints:

```ts
@BaseUrl('/reports')
export class ReportController extends Controller {
  @Get('/public')
  publicReport() {
    return this.reports.publicSummary()
  }

  @Get('/private')
  @BearerAuth({ token: Binding('API_TOKEN') })
  privateReport() {
    return this.reports.privateSummary()
  }
}
```

Authentication decorators and `@Middleware()` share the same ordered middleware chain.

## JWT payload

After JWT middleware verifies a request, inject the verified Hono payload with `@JwtPayload()`:

```ts
@Get('/me')
me(@JwtPayload() payload: JwtPayload) {
  return {
    userId: payload.sub,
  }
}
```

`JwtPayload` can also be used as a dependency of your own custom decorators.

## Resolve the current user

Most applications map the authenticated payload to a domain user. A request-scoped service is a convenient place for that lookup:

```ts
export class AuthService {
  private userPromise?: Promise<User>

  constructor(
    private readonly context: Context,
    private readonly users: UserRepository,
  ) {}

  user(): Promise<User> {
    return this.userPromise ??= this.users.findOrFail(
      Number(this.context.get('jwtPayload').sub),
    )
  }
}
```

Because Honovel services are scoped by default, the resolved user is memoized only during the current request.

## Current-user decorator

Wrap that service in a custom decorator:

```ts
export const CurrentUser = createDecorator(
  [AuthService],
  (_context, auth) => auth.user(),
)
```

Then inject the domain user directly:

```ts
@Get('/me')
me(@CurrentUser() user: User) {
  return user
}
```

## Authorization

Authentication establishes identity. Authorization remains application-specific.

A permission decorator can build on the current-user decorator:

```ts
export const Can = createDecorator(
  [CurrentUser],
  async (_context, user, permission: string) => {
    if (!user.permissions.includes(permission)) {
      throw new ForbiddenException()
    }
  },
)
```

Protect one endpoint:

```ts
@Put('/:id')
@Can('users.update')
update(id: number, request: UpdateUserRequest) {
  return this.users.update(id, request.validated())
}
```

or an entire controller:

```ts
@Can('admin.access')
@BaseUrl('/admin')
export class AdminController extends Controller {}
```

## Runtime bindings

Cloudflare applications define environment-specific values through Wrangler and expose them in `AppEnv`. After changing Cloudflare bindings, regenerate their types:

```bash
npm run cf-typegen
```

Node applications can expose equivalent values through their Hono environment.

## OpenAPI integration

Basic, Bearer and JWT decorators automatically contribute matching OpenAPI security schemes. Protected routes receive security requirements, so Swagger UI can expose its built-in authorization controls without separate documentation decorators.
