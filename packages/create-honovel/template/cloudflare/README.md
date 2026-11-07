# __PROJECT_NAME__

This Honovel project runs on Cloudflare Workers and is API-only. No frontend directory, frontend dependencies or static assets binding are generated.

```sh
npm run dev
```

The API is available at `http://localhost:8788/api/health`. Development Swagger and OpenAPI are served at `/swagger` and `/openapi.json`. Use `npm run dev:debug` to attach an IDE to the Worker inspector on `127.0.0.1:9229`; normal development uses an ephemeral inspector port.

## Application structure

`index.ts` creates the Hono app and exports the Durable Object cache class. `src/runtime/Controller.ts` supplies the `/api` prefix. Add feature controllers, DTOs, actions, repositories and services under `src/features/`.

```sh
npm run honovel -- make:feature users
npm run honovel -- list
npm run typecheck
npm run build
```

`build` generates binding types, compiles for production and performs a local Wrangler deployment dry run. It writes the Worker bundle to `dist/worker`; it does not upload anything. Production documentation routes are disabled by default.

Build/dev helpers are provided by `@honovel/core` through the `honovel` CLI. This project has no copied `scripts/` directory. `npm run dev` launches Wrangler directly without a frontend server.

## Runtime services and database

The project selects D1 for SQL, Durable Objects for cache and cache-backed locks, Cloudflare Queues for queued listeners and Cron Triggers for schedules. Application runtime wrappers under `src/runtime/` select those providers through DI.

The configured `main` database has an empty schema and no initial SQL migration. Add tables and export them from `src/database/main/schema/index.ts`, then run:

```sh
npm run db:generate
npm run db:migrate                  # local D1
```

See `src/database/README.md` for an optional table example. Before deployment, create the database named in `wrangler.jsonc`, replace its placeholder `database_id`, run `npm run compile` and apply any migrations with `npm run db:migrate:remote`. `npm run deploy` rejects placeholder IDs before builds or uploads.

```sh
npm run cf-typegen                  # after changing bindings
npm run deploy
```

Edit `wrangler.jsonc`; `.honovel.wrangler.jsonc` and `.honovel/` are generated files. Keep secrets in local environment files or Wrangler secrets. The generated local `.env` enables `APP_DEBUG=true`; disable debug details in production.

Framework documentation: https://honovel-docs.lutze.workers.dev
