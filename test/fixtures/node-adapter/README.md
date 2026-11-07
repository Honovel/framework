# __PROJECT_NAME__

```sh
npm run dev
```

The starter runs a Nuxt 4 frontend and the Honovel Node server together. Open `http://localhost:5173`; Nuxt proxies `/api`, `/swagger`, and `/openapi.json` to the internal Node server on port 3000. The sample frontend calls `GET /api/health`. The frontend port is strict so the public development URL cannot silently move to another port.

The frontend includes Tailwind CSS through its Vite plugin and a locally bundled Manrope font. Customize colors and typography in `frontend/app/assets/css/main.css` (`@theme`), and use utility classes directly in Vue components. The Overview and The stack pages are in `frontend/app/pages/`.

The default production rendering mode is SSG: `nuxt generate` prerenders discoverable pages and the browser hydrates the generated application. Pure CSR is also possible with `ssr: false` in `frontend/nuxt.config.ts`. Request-time SSR and ISR are not supported by the current Honovel starter because no Nuxt/Nitro server runtime is deployed.

The starter uses the Node adapter directly in `index.ts`. During `npm run dev`, `http://localhost:5173` is the public application URL, including `/swagger` and `/openapi.json`; port 3000 is only the internal backend target for Nuxt's proxy. Static frontend middleware is disabled during development, so no production `dist/frontend` directory is expected. The backend starts with the Node Inspector on `127.0.0.1:9229`; source maps are kept so breakpoints resolve to TypeScript. Use `npm run build && npm start` for production, where documentation is disabled by default and the statically generated Nuxt frontend is served from `dist/frontend`.

The HTTP port (`3000`) and the debugger port (`9229`) are separate. VS Code can start and attach to the project with the `Honovel Node (dev)` configuration in `.vscode/launch.json` (F5). In PHPStorm, start `npm run dev` and use a Node.js remote debug/attach configuration for `127.0.0.1:9229`.

`index.ts` creates and exports the Hono application and calls Hono's Node adapter directly. Honovel compiles it to `.honovel/index.js`, which is the development and production entrypoint. Deploying to another Hono runtime means replacing that adapter call and dependency, not changing the Core package. A separate `--template=cloudflare` starter provides the Wrangler setup.

The Node starter also installs `@honovel/node`. Its reusable `InMemoryCache` and `InMemoryQueue` classes do not bind themselves to Core contracts; the generated `AppCache` and `AppQueue` wrapper classes select them with `@Scope({ provides: ... })`, so applications can replace them with Redis, BullMQ, or other providers. `AppLock` extends Core's runtime-neutral `CacheLock` in the same way.

The application-level `src/runtime/Controller.ts` extends Honovel's `BaseController` and declares `@BaseUrl('/api')`. Feature controllers add their own segment, so `@BaseUrl('/users')` becomes `/api/users`. Change that one runtime controller if your application uses a different API prefix.

Compiler-discovered `CronJob`s are started with Croner through `startCronJobs(app, { bindings })`. Each running Node process owns its own schedules; multiple replicas currently execute the same CronJob independently.

Generate a feature with `npm run honovel -- make:feature users`. Database configuration and schemas belong under `src/database/<name>/`; feature repositories inject the corresponding database class. Generate CRUD code for an existing table with `make:resource users/User --table=users --database=main`.

The starter includes `src/database/main/` with a local SQLite connection backed by `local.db` and an empty schema. See `src/database/README.md` for an optional table example. After adding your tables, run `npm run db:generate` and `npm run db:migrate`. Set `DATABASE_URL` to use another SQLite file. Generate new migrations with `npm run db:generate`.

## Honovel commands

```sh
npm run honovel -- list
npm run honovel -- compile             # development compile
npm run honovel -- build               # production compile
npm run honovel -- typecheck
npm run honovel -- make:feature users
npm run honovel -- make:resource users/User --table=users --database=main
npm run honovel -- make:controller users/User
npm run honovel -- make:repository users/UserRepository
npm run honovel -- make:service users/UserService
npm run honovel -- make:action users/CreateUser
npm run honovel -- make:request users/CreateUserRequest
npm run honovel -- make:response users/UserResponse
npm run honovel -- make:middleware Auth
npm run honovel -- make:migration add-index
npm run db:generate
npm run db:migrate
```

`make:feature` creates only the feature structure. `make:resource` generates CRUD code for an existing exported table; it does not create database files. Keep connections and schemas central under `src/database/`, then expose them to features through repositories.

## DI and decorators

Honovel resolves concrete, named-exported classes by constructor. Services are request-scoped by default, so keep request data and mutable state on the instance. Inject the concrete `MainDatabase` provider into repositories; its Drizzle client is lazy and shared within the request.

The following example assumes you have added and exported the optional `todos` table described in `src/database/README.md`.

```ts
import { BaseUrl, Controller, Get } from '@honovel/core'
import { MainDatabase } from '../../../database/main/MainDatabase'
import { todos } from '../../../database/main/schema'

@BaseUrl('/todos')
export class TodoController extends Controller {
  constructor(private readonly database: MainDatabase) { super() }

  @Get('/')
  list() {
    return this.database.client.select().from(todos)
  }
}
```

Use `@Get`, `@Post`, `@Put`, `@Patch`, and `@Delete` for routes, `@BaseUrl` for a controller prefix, and `@Query`/`@Param` for typed route parameters. `@Middleware` attaches middleware. Use `@Scope('transient')` only for stateless, independently-created helpers; database providers must remain request-scoped. Custom decorators can be built with `createDecorator` and explicit DI dependencies. Validation uses `FormRequest(schema)` or standard schemas and keeps request parsing at the route boundary.

The published Core includes the Honovel TypeScript language-service plugin. The generated `tsconfig.json` points editors at `@honovel/core/typescript-plugin`; restart the TypeScript server after installing dependencies to get diagnostics for missing routes, DI dependencies, and decorator usage. The plugin is editor tooling only—the compiler remains the authoritative build/typecheck step.

Keep the runtime-specific `serve(...)` call in `index.ts`, where the complete Hono startup is visible. Keep environment secrets in `.env`/process environment and never in source or migrations.

Copy `.env.example` to `.env` when local environment configuration is needed. `APP_DEBUG=false` is the safe default; set it to `true` locally to include the exception name and stack trace in otherwise hidden HTTP 500 responses. Never enable it in production.

The Core and compiler come from the `@honovel/core` package on GitHub Packages, with no copied `core/` directory. Configure GitHub Packages authentication in your user npm config or CI secrets. The project `.npmrc` contains only the scope-to-registry mapping.

Build and runtime helpers are shipped in `@honovel/core` and invoked through the `honovel` CLI. The starter does not copy a `scripts/` directory. `honovel frontend:build` generates the Nuxt frontend; Cloudflare tooling is available as `honovel cloudflare:<command>`.
