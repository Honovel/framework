# Honovel Core

A TypeScript compiler and small runtime for Hono applications. Includes class-based dependency injection, controllers, validation, OpenAPI, and typed lazy database providers. Application deployment remains runtime-owned.

Install from the private Honovel Gitea registry after authenticating:

```sh
npm config set @honovel:registry https://npm.pkg.github.com/
npm install @honovel/core hono drizzle-orm zod
```

Create a project with `npm create @honovel/honovel@latest my-app`. The backend is always Cloudflare Workers; the initializer asks whether to include Nuxt or create an API-only project. Select explicitly with `-- --frontend=nuxt` or `-- --api-only` (`--frontend=none` is equivalent). Non-interactive runs include Nuxt by default. The explicit initializer is `npx @honovel/create-honovel@latest my-app`.

The package provides `honovel compile`, `honovel build`, `honovel typecheck`, database commands, and generators. `honovel-build` is also available as a standalone compiler binary.

Public APIs are imported from `@honovel/core`. Configure the editor plugin as `@honovel/core/typescript-plugin`. The `internal/*` exports are compiler implementation details, not stable application APIs.

TypeScript source files are included as type/AST inputs because Honovel's compiler reads class and decorator declarations. Runtime imports resolve to compiled ESM; TypeScript and the compiler are not imported by the runtime entrypoint. No application code, credentials, or database migrations are included in this package.

This package is proprietary and intended for the private Honovel organization registry. See the repository's publishing guide for releases and authentication.

Shared starter tooling is also provided by the CLI: `honovel frontend:build`
generates and copies Nuxt assets. `honovel cloudflare:compile`, `cloudflare:build`,
`cloudflare:typegen`, `cloudflare:dev`, `cloudflare:dev-backend`,
`cloudflare:predeploy`, and `cloudflare:deploy` handle the Workers lifecycle.
These commands run in the application working directory and resolve tools such
as Wrangler from that application's dependencies. Generated projects keep their
configuration and application code, without copies of framework helper scripts.
