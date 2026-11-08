# __PROJECT_NAME__

```sh
npm run dev
```

The starter runs a Nuxt 4 frontend and the Honovel Worker together. Open `http://localhost:5173`; Nuxt proxies `/api`, `/swagger`, and `/openapi.json` to the local Wrangler backend. Honovel prefers backend port 8788 and automatically picks a free port when 8788 is already in use, while the public frontend URL stays fixed on 5173. The sample frontend calls `GET /api/health`. In production, `nuxt generate` prerenders the frontend and Honovel deploys the generated files with the Worker as Cloudflare Static Assets, so frontend assets and API routes share one origin and one deployment.

The combined dev command uses scrolling logs with `[Nuxt]` prefixes for frontend output. Nuxt's fullscreen terminal UI is disabled so it cannot overwrite the Worker logs or the app link. Press Ctrl+C to stop both servers.

The frontend includes Tailwind CSS through its Vite plugin and a locally bundled Manrope font. Customize colors and typography in `frontend/app/assets/css/main.css` (`@theme`), and use utility classes directly in Vue components. Pages live in `frontend/app/pages/`.

The default production rendering mode is SSG. Nuxt prerenders discoverable pages during the build and hydrates them in the browser. Pure CSR is also possible with `ssr: false` in `frontend/nuxt.config.ts`. Request-time SSR and ISR are not supported by the current Honovel starter because no Nuxt/Nitro server runtime is deployed.

Wrangler serves the Worker locally with automatic rebuilding when application source changes. `/swagger` and `/openapi.json` are enabled in development. Normal `npm run dev` chooses a free backend port when needed and lets Wrangler use an ephemeral inspector port, so multiple Honovel or Wrangler projects can run locally without hard-coded port collisions.

Wrangler executes the Worker in Cloudflare's local `workerd` runtime rather than in the Node process that launched Wrangler. Use `npm run dev` for normal development. When you want to attach an IDE debugger, run `npm run dev:debug`; that pins the Worker inspector to `127.0.0.1:9229` for the included `Honovel Cloudflare (attach)` configuration. Do not launch Wrangler itself through a Node debug terminal, because that debugs Wrangler and Honovel's custom-build Node subprocesses instead of the Worker runtime.

`index.ts` creates and exports the Hono app. Honovel compiles routes to `.honovel/index.js`, the `main` entry in `wrangler.jsonc`. Cloudflare invokes the app's `fetch` handler directly; this template has no Node server adapter or HTTP listener.

```sh
npm run typecheck
npm run build
npm run deploy
```

`build` runs a local Wrangler deployment dry run and writes the production Worker bundle to `dist/`; it does not upload anything. `deploy` publishes the Worker after Cloudflare authentication. Both invoke Honovel's custom build through Wrangler, which selects production mode for deployment and disables documentation by default.

The application-level `src/runtime/Controller.ts` extends Honovel's `BaseController` and declares `@BaseUrl('/api')`. Feature controllers add their own segment, so `@BaseUrl('/users')` becomes `/api/users`. Change that one runtime controller if your application uses a different API prefix.

The frontend is generated into `frontend/.output/public` and copied to `dist/frontend`. `wrangler.jsonc` configures SPA fallback routing and sends only `/api/*`, `/swagger`, and `/openapi.json` through the Worker first; normal static asset requests are served directly by Cloudflare's static asset layer.

`compile` and `typecheck` generate `CloudflareBindings` with `wrangler types`. Add bindings such as D1, KV, or R2 to `wrangler.jsonc`; `src/env.ts` exposes them as `AppEnv`. Keep local secrets in ignored `.dev.vars`, and use `wrangler secret put` for deployed secrets. Node.js is required for tooling only; the Worker runtime does not need `nodejs_compat` for this starter.

The custom build uses `honovel cloudflare:build` from `honovel`. It skips compilation when called by `wrangler types`, because Wrangler also invokes custom builds while inspecting the entrypoint for type generation; this prevents recursive builds.

Wrangler is pinned to the version tested with this starter. Upgrade that dependency and the compatibility date deliberately when adopting newer Workers features.

Generate a feature with `npm run honovel -- make:feature users`. Database schemas, migrations, and provider classes belong under `src/database/<name>/`. Generate CRUD code for an existing table with `make:resource users/User --table=users --database=main`. For additional databases, choose the appropriate Drizzle driver and binding in a database factory.

The starter includes `src/database/main/` with a D1 provider and an empty schema. See `src/database/README.md` for an optional table example; generate your first migration after adding tables. Create a D1 database named exactly like the generated `database_name` (for example `my-app-main`) and replace the placeholder `database_id` in `wrangler.jsonc` with its ID. Run `npm run compile` after changing the ID to refresh the generated Wrangler configuration before applying remote migrations. After generating a migration, run `npm run db:migrate` for the local D1 database; use `npm run db:migrate:remote` for the deployed database. Generate new migrations with `npm run db:generate`.

`npm run deploy` checks for D1 placeholder IDs before type generation, builds, or uploads and prints the setup commands if a database has not been configured. `npm run build` remains usable with placeholder IDs because it only performs a local dry run. This check does not verify that configured databases exist in your Cloudflare account; Wrangler validates them during deployment.

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
npm run db:migrate                 # local D1
npm run db:migrate:remote          # deployed D1
```

`make:feature` creates only the feature structure. `make:resource` generates CRUD code for an existing exported table; it does not create database files. Keep connections and schemas central under `src/database/`, then expose them to features through repositories.

## DI and decorators

Honovel resolves concrete, named-exported classes by constructor. Services are request-scoped by default, which is important in Workers because global mutable state can leak between requests. Inject the concrete `MainDatabase` provider into repositories; it creates a typed Drizzle D1 client lazily from the current Hono context.

The following example assumes you have added and exported the optional `todos` table described in `src/database/README.md`.

```ts
import { BaseUrl, Controller, Get } from 'honovel'
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

The published Core includes the Honovel TypeScript language-service plugin. The generated `tsconfig.json` points editors at `honovel/typescript-plugin`; restart the TypeScript server after installing dependencies to get diagnostics for missing routes, DI dependencies, and decorator usage. The plugin is editor tooling only—the compiler remains the authoritative build/typecheck step.

Keep `index.ts` as the Worker entrypoint and keep runtime bindings in `AppEnv`. Do not access `globalThis` for request state or cache a request-specific D1/Context object. Use Wrangler secrets for credentials, keep `.dev.vars` local, and commit migrations alongside the database they change.

Copy `.env.example` to `.env` for local Wrangler configuration. `APP_DEBUG=false` is the safe default; set it to `true` locally to include the exception name and stack trace in otherwise hidden HTTP 500 responses. Never enable it in production.

The framework and Cloudflare adapters are installed together as `honovel`; no framework source is copied into this project. Import framework APIs from `honovel` and Cloudflare adapters from `honovel/cloudflare`. Installation uses the public npm registry and requires no login.

Build and runtime helpers are shipped in `honovel` and invoked through the `honovel` CLI. The starter does not copy a `scripts/` directory. `honovel frontend:build` generates the Nuxt frontend; Cloudflare tooling is available as `honovel cloudflare:<command>`.

This project was created with `--frontend=nuxt`. For a new API-only project, use `npm create honovel@latest my-api -- --api-only`; its backend remains Cloudflare Workers.
