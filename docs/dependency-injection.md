# Dependency Injection

Honovel provides constructor dependency injection without an `@Injectable()` decorator. Named-exported concrete classes are injectable by default.

## Injecting a service

```ts
export class UserService {
  find(id: number) {
    return { id, name: 'Taylor' }
  }
}
```

```ts
@BaseUrl('/users')
export class UserController extends Controller {
  constructor(private readonly users: UserService) {
    super()
  }

  @Get('/:id')
  show(id: number) {
    return this.users.find(id)
  }
}
```

## Request scope

Services are scoped by default: one instance is shared within the current request or execution scope.

```ts
export class RequestMemo {
  private readonly values = new Map<string, unknown>()

  get(key: string) {
    return this.values.get(key)
  }

  set(key: string, value: unknown) {
    this.values.set(key, value)
  }
}
```

A later request receives a new instance.

## Transient services

```ts
@Scope('transient')
export class CsvParser {}
```

Use transient scope when each injection should receive a new instance.

## Abstract contracts

```ts
export abstract class UserRepository {
  abstract find(id: number): Promise<User | null>
}
```

```ts
export class DatabaseUserRepository extends UserRepository {
  constructor(private readonly database: MainDatabase) {
    super()
  }

  async find(id: number) {
    // query database
    return null
  }
}
```

With exactly one implementation, Honovel binds it automatically.

## Multiple implementations

```ts
export class ApiUserRepository extends UserRepository {
  async find(id: number) {
    return null
  }
}

@Scope({ provides: UserRepository })
export class DatabaseUserRepository extends UserRepository {
  async find(id: number) {
    return null
  }
}
```

`UserRepository` now resolves to `DatabaseUserRepository`, while concrete implementations remain directly injectable. `Scope` options can combine provider selection and lifetime, for example `@Scope({ provides: UserRepository, lifecycle: 'transient' })`. Supported lifetimes are `scoped` (the default) and `transient`; database providers must stay scoped.

## Hono Context

```ts
export class TenantService {
  constructor(private readonly context: Context<AppEnv>) {}

  currentTenantId() {
    return this.context.req.header('X-Tenant-ID')
  }
}
```

Runtime bindings are available through `context.env`.

## HonoRequest

```ts
export class AuditService {
  constructor(private readonly request: HonoRequest) {}

  userAgent() {
    return this.request.header('User-Agent')
  }
}
```

## Compile-time checks

Unresolved dependencies, ambiguous abstract bindings, duplicate defaults and circular dependency graphs fail before deployment.

TypeScript interfaces cannot act as DI contracts because they do not exist at runtime. Use abstract classes instead.
