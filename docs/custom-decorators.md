# Custom Decorators

Custom decorators package reusable request-level behavior into expressive application APIs.

## Parameter decorator

```ts
export const Header = createDecorator(
  (context, name: string) => context.req.header(name),
)
```

```ts
@Get('/')
index(@Header('X-Request-ID') requestId?: string) {
  return { requestId }
}
```

## Client IP

`honovel/cloudflare` exports a `ClientIp` decorator backed by Cloudflare's trusted `CF-Connecting-IP` header:

```ts
import { ClientIp } from 'honovel/cloudflare'

@Get('/')
index(@ClientIp() ip: string) {
  return { ip }
}
```

`X-Forwarded-For` is opt-in because clients can spoof it unless a trusted proxy overwrites the header. See [Logging & Request Context](/logging#cloudflare-client-ip).

## Inject dependencies

```ts
export const CurrentUser = createDecorator(
  [UserRepository, JwtPayload],
  async (_context, users, jwt) =>
    users.findOrFail(Number(jwt.sub)),
)
```

```ts
@Get('/me')
me(@CurrentUser() user: User) {
  return user
}
```

## Compose decorators

```ts
export const Can = createDecorator(
  [CurrentUser],
  async (_context, user, permission: string) => {
    if (!user.permissions.includes(permission)) {
      throw new ForbiddenException()
    }
    return true
  },
)
```

Use it as a route guard:

```ts
@Put('/:id')
@Can('users.update')
update(id: number, request: UpdateUserRequest) {}
```

or at controller level:

```ts
@Can('admin.access')
@BaseUrl('/admin')
export class AdminController extends Controller {}
```

## Caching

Decorator results are cached for the current request by decorator identity and arguments, including in-flight promises.

Disable caching for side effects:

```ts
export const TrackUsage = createDecorator(
  async (context, event: string) => analytics.track(event, context.req.path),
  { cache: false },
)
```

Decorator arguments must be statically analyzable literals, arrays or objects.
