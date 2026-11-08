# Honovel

A TypeScript application framework for Hono and Cloudflare Workers. Includes dependency injection, controllers, validation, OpenAPI, typed lazy database providers and Cloudflare adapters.

Create a project:

```sh
npm create honovel@latest my-app
```

Choose a Nuxt frontend or an API-only project. Select explicitly with `-- --frontend=nuxt` or `-- --api-only`. Both run on Cloudflare Workers; Node.js 22 or newer is required for local tooling only.

For an existing Workers application, install the public npm package:

```sh
npm install honovel hono drizzle-orm zod
```

Import framework APIs from `honovel`, Cloudflare adapters from `honovel/cloudflare`, and configure the editor plugin as `honovel/typescript-plugin`. Cloudflare-specific code is kept out of the main runtime entry point. The `internal/*` exports are compiler implementation details.

The package provides `honovel compile`, `honovel build`, `honovel typecheck`, database commands and generators. The `honovel cloudflare:<command>` and `honovel frontend:build` commands provide shared dev/build/deploy helpers without copying scripts into applications.

TypeScript sources are included as type/AST inputs because the compiler reads class and decorator declarations. Runtime imports resolve to compiled ESM; the runtime entry points do not load TypeScript or compiler tooling. No application credentials or migrations are included.

Documentation: [honovel.github.io/framework](https://honovel.github.io/framework/). Source: [Honovel/framework](https://github.com/Honovel/framework). Packages are published to npm only.
