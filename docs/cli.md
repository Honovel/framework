# CLI

Honovel includes a CLI for common application-development tasks.

```bash
npm run honovel -- <command>
npm run honovel -- list
```

## Create a project

```bash
npm create @honovel/honovel@latest my-app
npm create @honovel/honovel@latest my-api -- --api-only
npm create @honovel/honovel@latest my-web-app -- --frontend=nuxt
```

The backend always runs on Cloudflare Workers. `--frontend=none` is equivalent to `--api-only`. Without a flag the initializer asks whether to include Nuxt; non-interactive runs default to Nuxt. The old `--template` runtime option is no longer supported.

The equivalent explicit initializer is `npx @honovel/create-honovel@latest my-app`. See [Getting Started](/getting-started) for installation requirements. Run the application commands below inside the generated project directory.

## Create a feature

```bash
npm run honovel -- make:feature appointments
```

## Create application classes

```bash
npm run honovel -- make:controller users/User
npm run honovel -- make:request users/CreateUser
npm run honovel -- make:response users/User
npm run honovel -- make:service users/User
npm run honovel -- make:repository users/User
npm run honovel -- make:action users/CreateUser
npm run honovel -- make:middleware Authentication
```

Generated services and repositories participate in DI automatically.

## Generate a CRUD resource

For an existing Drizzle table:

```bash
npm run honovel -- make:resource \
  appointments/Appointment \
  --table=appointments \
  --database=main
```

This creates the application CRUD layer around the existing table. It does not create or alter the database schema.

A useful workflow is:

```text
1. Add or update Drizzle schema
2. Generate and review migration
3. Run migration
4. Generate application resource
5. Customize generated application logic
```

## Database commands

```bash
npm run honovel -- db:generate add-users
npm run honovel -- db:generate add-users --db=main
npm run honovel -- make:migration backfill-user-slugs --db=main
npm run honovel -- db:migrate --db=main
npm run honovel -- db:migrate --db=main,analytics
npm run honovel -- db:migrate --all
```

## Compiler commands

```bash
npm run honovel -- compile
npm run honovel -- build
npm run honovel -- typecheck
```

For the common cases, the generated root scripts `npm run build` and `npm run typecheck` are shorter.

## Starter tooling

Shared helpers ship in `@honovel/core` and run from your application directory. The generated `package.json` invokes them through the `honovel` binary; there is no generated `scripts/` directory to maintain. Keep using the usual `npm run dev`, `npm run build` and `npm run deploy` entrypoints for the complete starter workflow.

| CLI command | Purpose |
| --- | --- |
| `frontend:build` | Run Nuxt generation and copy its public output to `dist/frontend`. |
| `cloudflare:compile` | Bootstrap missing binding types, then compile the backend; accepts compiler options. |
| `cloudflare:build` | Wrangler custom-build hook; compile unless type generation or a precompiled deployment is in progress. |
| `cloudflare:typegen` | Generate `CloudflareBindings` without recursively compiling through Wrangler's custom build. |
| `cloudflare:dev` | Start Nuxt and Wrangler together in a Nuxt project; accepts `--debug`. |
| `cloudflare:dev-backend` | Generate types and start only Wrangler; accepts `--debug`. |
| `cloudflare:predeploy` | Reject placeholder D1 database IDs before deploying. |
| `cloudflare:deploy` | Compile the backend in production mode and invoke Wrangler deploy; accepts Wrangler options such as `--dry-run`. |

For example:

```bash
npm run honovel -- frontend:build
npm run honovel -- cloudflare:compile --mode production
npm run honovel -- cloudflare:deploy --dry-run --outdir dist/worker
```

The last command builds the backend only; `npm run build` runs the starter checks and also generates the frontend when Nuxt was selected. `honovel build` is a backend compiler command, whereas `honovel cloudflare:build` is the Wrangler hook. Cloudflare commands resolve Wrangler from the application's dependencies. Configuration stays in `wrangler.jsonc`, `frontend/nuxt.config.ts` and the application sources.

In both Cloudflare project modes, `npm run db:migrate` and `db:migrate:remote` invoke Wrangler for local and remote D1 respectively. See [Database](/database#run-migrations).

API-only projects use `cloudflare:dev-backend` for `npm run dev` and `npm run dev:debug`; they have no frontend scripts. Their typecheck/build/deploy commands only process the backend.
