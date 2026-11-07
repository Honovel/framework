# Runtime & Deployment

New Honovel applications always use Cloudflare Workers. Project creation selects an optional Nuxt frontend or an API-only setup; both use the same backend and runtime services.

## Full-stack starter

Projects created with `--frontend=nuxt` include a Nuxt 4 application under `frontend/`. Nuxt provides the frontend development server and proxies `/api`, `/swagger` and `/openapi.json` to the local Honovel backend. Application code can therefore use relative requests such as:

```ts
fetch('/api/users')
```

No separate frontend API URL or CORS configuration is needed for the default setup.

The default production frontend is statically generated with Nuxt (`nuxt generate`) and copied to `dist/frontend`. Cloudflare deploys that output as Workers Static Assets alongside the Worker, keeping frontend and API on the same origin.

Honovel currently supports this static-generation model and client-side rendering, but does not deploy a Nuxt/Nitro runtime for request-time SSR or ISR. See [Frontend](/frontend) for the rendering model and frontend structure.

Use `--api-only` (or `--frontend=none`) to generate a project without frontend files, dependencies, scripts or static assets configuration.

## Runtime defaults at a glance

| Capability | Nuxt and API-only projects |
| --- | --- |
| HTTP runtime | Cloudflare Workers / `workerd` |
| Database | D1 with an initially empty schema |
| Cache and locks | Durable Object cache and Core `CacheLock` |
| Queue | Cloudflare Queues |
| Cron | Cloudflare Cron Triggers |
| Configuration | Wrangler bindings and application runtime wrappers |
| Frontend | Optional Nuxt SSG/CSR via Workers Static Assets |

Infrastructure is selected through DI contracts. Applications can replace cache, queue and lock implementations without changing business services. The commands below use the initializer from GitHub Packages after the [authentication setup](/getting-started#github-packages-authentication); source is available on [GitHub](https://github.com/Honovel/framework).

## Cloudflare Workers

Create a Cloudflare project:

```bash
npm create @honovel/honovel@latest my-app -- --frontend=nuxt
```

The generated application installs `@honovel/cloudflare` and configures Cloudflare-native infrastructure.

### Default database

The starter contains a D1 `MainDatabase` provider and a D1 binding named `DB` in `wrangler.jsonc`.

The schema is initially empty. After adding tables, generate and review migrations with `npm run db:generate` and apply them locally with `npm run db:migrate`.

Before remote deployment, create the database using the generated `database_name` (for example `my-app-main`):

```bash
npx wrangler d1 create my-app-main
```

Replace the placeholder `database_id` in the existing source binding in `wrangler.jsonc`, keeping `binding` and `migrations_dir`. Then run `npm run compile` to refresh the generated config and `npm run db:migrate:remote` to apply your migrations remotely. For an existing D1 database, use its ID instead of creating another one.

`npm run deploy` checks placeholder IDs before type generation, frontend generation or upload. Local `npm run build` remains usable with placeholder IDs because it only performs a dry run. The check does not verify whether a real ID exists in your account.

### Default cache

Cloudflare applications use a Durable Object-backed cache by default. The generated `wrangler.jsonc` contains a `HONOVEL_CACHE` binding pointing to `HonovelCacheDurableObject`.

The generated application binds a concrete `DurableObjectCache` to Honovel's `Cache` contract:

```ts
@Scope({ provides: Cache })
export class DurableObjectCache extends BaseDurableObjectCache {
  constructor(context: Context<AppEnv>) {
    super(context.env.HONOVEL_CACHE)
  }
}
```

Each cache group maps to one named Durable Object. This is why cache groups are significant on Cloudflare: they define the Durable Object that stores and coordinates those keys.

### Default locks

The starter does not create a separate lock Durable Object. `AppLock` extends Core's `CacheLock`, which automatically injects the selected `Cache` implementation.

Therefore Cloudflare locks use the same Durable Object cache infrastructure by default.

### Default queue

The Cloudflare starter configures a `HONOVEL_QUEUE` binding and binds the Honovel `Queue` contract to the Cloudflare queue adapter. `QueuedListener` work therefore uses Cloudflare Queues instead of staying inside the request process.

### Local development

```bash
npm run dev
```

This starts Wrangler and Nuxt together. Open `http://localhost:5173` for the application. Nuxt proxies `/api`, `/swagger` and `/openapi.json` to the local Wrangler backend. The launcher prefers port 8788 and automatically selects another free backend port when necessary. The Worker still runs in Cloudflare's local `workerd` runtime and rebuilds the Honovel output as application source changes.

### Static assets

`nuxt generate` prerenders the frontend and Honovel copies `frontend/.output/public` to `dist/frontend`. `wrangler.jsonc` attaches that directory as Workers Static Assets with SPA fallback routing:

```json
{
  "assets": {
    "directory": "./dist/frontend",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/swagger", "/openapi.json"]
  }
}
```

Normal frontend asset requests can be served directly by Cloudflare's asset layer. API and documentation routes are explicitly sent through the Worker first. Worker code and static assets are deployed together as one application.

### Runtime bindings

Configure D1, R2, KV, Queues and variables in `wrangler.jsonc`, then regenerate types:

```bash
npm run cf-typegen
```

Use typed bindings through Hono context:

```ts
export class FileService {
  constructor(private readonly context: Context<AppEnv>) {}

  async save(key: string, value: ArrayBuffer) {
    await this.context.env.UPLOADS.put(key, value)
  }
}
```

### Build and deploy

```bash
npm run build
npm run deploy
```

`build` typechecks and statically generates the Nuxt frontend, compiles Honovel for production and performs a Wrangler deployment dry run. The frontend output lives in `dist/frontend`; the dry-run Worker bundle is written separately under `dist/worker`. `deploy` generates the frontend and uploads the Worker together with its static assets. No Nuxt server bundle is deployed.

Cron schedules discovered from `@Cron()` jobs are included in generated `.honovel.wrangler.jsonc`. Edit the source `wrangler.jsonc`, not that generated file or Wrangler's deploy redirect. The Core tooling compiles before Wrangler reads the effective configuration and avoids re-entering the compiler during `wrangler types` or an already compiled deployment.

The shared launch/build scripts are provided by `@honovel/core`; see [Starter tooling](/cli#starter-tooling).

## API-only projects

```bash
npm create @honovel/honovel@latest my-api -- --api-only
cd my-api
npm run dev
```

Open `http://localhost:8788/api/health`. Only Wrangler runs. The project contains no `frontend/` directory, Nuxt dependencies, frontend scripts or `assets` configuration. Unknown frontend paths return normal API 404 responses instead of a SPA fallback.

`npm run typecheck` checks only the backend. `npm run build` generates binding types, compiles in production mode and performs a Wrangler dry run into `dist/worker`. `npm run deploy` deploys only the Worker after the D1 placeholder check. The D1, cache, lock, queue and cron defaults are the same as in Nuxt projects.

## Existing Node applications

The initializer no longer creates Node projects. The separate `@honovel/node` adapter remains available to existing or manually configured Node applications; Core's runtime contracts remain unchanged. New project scaffolding always uses Cloudflare Workers.

## Replacing runtime implementations

Runtime infrastructure is wired through Honovel DI contracts. Application-owned wrappers can select alternative implementations:

```ts
@Scope({ provides: Cache })
export class AppCache extends MySharedCache {}

@Scope({ provides: Queue })
export class AppQueue extends MyPersistentQueue {}

@Scope({ provides: Lock })
export class AppLock extends CacheLock {}
```

You can replace any of those providers with an application-specific implementation.

For example, replacing `AppCache` with a Redis-backed `Cache` implementation changes all normal cache injections. Because `AppLock` depends on the `Cache` contract, locks also begin using Redis automatically.

A queue replacement works independently:

```ts
@Scope({ provides: Queue })
export class AppQueue extends MyPersistentQueue {}
```

Controllers, listeners and services continue to inject Honovel's `Queue`, `Cache` and `Lock` contracts rather than infrastructure-specific classes.

## Environment configuration

Keep deployment-specific values outside application source. Cloudflare uses typed runtime bindings; Node applications can map process environment and runtime resources into Hono's environment.

## Debug mode

Enable debug details locally and disable them in production:

```text
APP_DEBUG=true
```

## Database migrations

Migrations are explicit and do not run automatically at startup:

```bash
npm run honovel -- db:migrate --db=main
```

For Cloudflare D1 use the starter's `npm run db:migrate` (local) or `npm run db:migrate:remote` (remote), which invoke Wrangler instead of Drizzle Kit. See [Database](/database#run-migrations). Treat migration execution as a controlled deployment step.