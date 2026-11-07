<p><img src="docs/public/honovel-icon.png" alt="Honovel" width="96" height="96"></p>

# Honovel

Honovel is a TypeScript framework for building Hono applications with controllers, constructor dependency injection, validation and generated OpenAPI documentation. The backend runs on Cloudflare Workers. Choose a Nuxt frontend or a lean API-only project.

[Documentation](https://honovel-docs.lutze.workers.dev) · [GitHub](https://github.com/Honovel/framework)

## Create a project

Use Node.js 22 or newer and npm 11.6 or newer.

```bash
npm create @honovel/honovel@latest my-app
cd my-app
npm run dev
```

The initializer asks whether to include Nuxt or create an API-only project. To choose explicitly:

```bash
npm create @honovel/honovel@latest my-web-app -- --frontend=nuxt
npm create @honovel/honovel@latest my-api -- --api-only
```

With Nuxt, open `http://localhost:5173`; the frontend proxies API requests to Wrangler. For API-only projects, use `http://localhost:8788` directly. In both cases, `GET /api/health` is ready to try. Swagger is available at `/swagger` and the OpenAPI document at `/openapi.json` during development.

`--frontend=none` is equivalent to `--api-only`. API-only projects have no `frontend/` directory, frontend dependencies, frontend scripts or static assets binding. Without an option, non-interactive runs include Nuxt.

Your project starts with runtime providers and an empty database schema. No Todo model, CRUD feature or initial SQL migration is created. Define your own tables when you need persistence.

## Add a feature

From your new application's directory, create a feature:

```bash
npm run honovel -- make:feature users
```

A feature groups controllers, requests, responses, actions and repositories under `src/features/users/`. Add application services there as needed.

Create `src/features/users/services/UserService.ts`:

```ts
export class UserService {
  all() {
    return [
      { id: 1, name: 'Taylor' },
      { id: 2, name: 'Abigail' },
    ]
  }
}
```

## Add a controller and inject the service

Create `src/features/users/controllers/UserController.ts`:

```ts
import { BaseUrl, Get } from '@honovel/core'
import { Controller } from '#src/runtime/Controller'
import { UserService } from '../services/UserService'

@BaseUrl('/users')
export class UserController extends Controller {
  constructor(private readonly users: UserService) {
    super()
  }

  @Get('/')
  index() {
    return this.users.all()
  }
}
```

Visit `/api/users` on your development server (`localhost:5173` with Nuxt or `localhost:8788` for API-only). The starter's application controller supplies the `/api` prefix, and Honovel discovers your named-exported classes automatically.

Constructor injection needs no `@Injectable()` decorator or manual registration for concrete services. Services are shared within the current request scope; a later request gets a new instance. Use abstract classes as DI contracts when selecting between implementations.

## Validate input

Create `src/features/users/dto/requests/CreateUserRequest.ts`:

```ts
import { FormRequest } from '@honovel/core'
import { z } from 'zod'

export class CreateUserRequest extends FormRequest(z.object({
  name: z.string().min(2),
  email: z.string().email(),
})) {}
```

Add `Post` to the controller's Core imports, import `CreateUserRequest` from `../dto/requests/CreateUserRequest`, and add this method:

```ts
@Post('/')
store(request: CreateUserRequest) {
  return this.json(request.validated(), 201)
}
```

This example validates and echoes the input. Invalid input receives `422` automatically; persistence belongs in your application service or repository. Routes, request types and responses appear in generated OpenAPI documentation.

## Add persistence and build

Database providers and schemas live under `src/database/<name>/`. The default database uses Cloudflare D1 in both project modes. After defining tables and exporting them from `src/database/main/schema/index.ts`:

```bash
npm run db:generate
# Review the generated SQL, then apply it locally:
npm run db:migrate
```

For Cloudflare deployment, create the D1 database and replace its placeholder ID in `wrangler.jsonc` before applying remote migrations or deploying. See the [database guide](docs/database.md) and [deployment guide](docs/deployment.md).

```bash
npm run typecheck
npm run build
```

These check and build the backend plus Nuxt when selected. API-only projects only process the Worker. Use `npm run deploy` to publish the Cloudflare application.

## Next steps

- [Controllers and routing](docs/controllers.md)
- [Dependency injection](docs/dependency-injection.md)
- [Requests and validation](docs/requests.md)
- [Custom error schemas](docs/exceptions.md#custom-error-schemas)
- [Cache](docs/cache.md), [locks](docs/locks.md), [events and queues](docs/events-queues.md), [cron jobs](docs/cron.md)
- [CLI commands](docs/cli.md)
