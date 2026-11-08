# Getting Started

Honovel creates Cloudflare Workers applications with either a Nuxt 4 frontend or an API-only setup. Both modes use the same controllers, validation, dependency injection and runtime services.

## Requirements

Use Node.js 22 or newer and npm 11.6 or newer for local tooling. The backend runs on Cloudflare Workers in both modes. The framework source is hosted at [Honovel/framework on GitHub](https://github.com/Honovel/framework); the quickstart uses the public initializer published to npmjs.

## Package registry

The default distribution is public on npmjs and requires no login for installation. GitHub Packages remains an additional release destination.

If you previously configured the Honovel scope to use GitHub Packages, switch it to npmjs before using this quickstart:

```bash
npm config set --location=user @honovel:registry https://registry.npmjs.org/
```

Installing from the optional GitHub Packages mirror still requires GitHub authentication, including for public packages. See the repository's `docs/publishing.md` for maintainer and mirror setup.

## Create a project

```bash
npm create @honovel/honovel@latest my-app
```

Choose **Nuxt frontend** or **API-only** interactively, or select explicitly:

```bash
npm create @honovel/honovel@latest my-web-app -- --frontend=nuxt
npm create @honovel/honovel@latest my-api -- --api-only
```

`--frontend=none` is equivalent to `--api-only`. Both `--frontend=value` and `--frontend value` work. Without an explicit option, non-interactive runs include Nuxt. Runtime selection through `--template=node|cloudflare` has been removed: new projects always target Cloudflare Workers.

`npm create @honovel/honovel` resolves the `@honovel/create-honovel` initializer. The equivalent explicit form is:

```bash
npx @honovel/create-honovel@latest my-api --api-only
```

Use `--no-install` to scaffold without installing dependencies:

```bash
npm create @honovel/honovel@latest my-api -- --api-only --no-install
```

Existing directories are never overwritten. The initializer writes `.env.example` with `APP_DEBUG=false` and a local `.env` with `APP_DEBUG=true`; keep the local file out of version control.

## Start the application

```bash
cd my-app
npm run dev
```

| Setup | Development URL | Behavior |
| --- | --- | --- |
| Nuxt | `http://localhost:5173` | Nuxt and Wrangler start together; Nuxt proxies API and documentation requests. |
| API-only | `http://localhost:8788` | Only Wrangler starts; there is no frontend folder, dependency, script or static assets binding. |

Try `GET /api/health`, `/swagger` and `/openapi.json` on your development origin. These routes work in both modes. The starter has an empty database schema and no initial SQL migration or Todo feature. Add/export tables, generate migrations and apply them before using your tables. See [Database](/database).

## Cloudflare runtime services

Both project modes include:

- D1 through `MainDatabase`;
- Durable Object cache through the `Cache` contract;
- `CacheLock` backed by that cache;
- Cloudflare Queues for queued listeners;
- generated Cron Triggers for `@Cron()` jobs.

The generated wrappers under `src/runtime/` select implementations through DI. Each cache group maps to a Durable Object, which is also the coordination boundary for cache-backed locks.

Regenerate types after changing bindings:

```bash
npm run cf-typegen
```

Before deployment, create the D1 database named in `wrangler.jsonc`, replace its placeholder ID and apply any remote migrations. See [Runtime & Deployment](/deployment).

## Optional Nuxt frontend

Nuxt projects include pages and styles under `frontend/`. Development requests for `/api`, `/swagger` and `/openapi.json` are proxied to Wrangler; the backend prefers port 8788 and picks a free port when needed. `npm run build` generates static frontend files into `dist/frontend` and the Worker bundle into `dist/worker`. Deployment attaches Workers Static Assets, keeping the frontend and API on the same origin.

The default frontend mode is SSG; CSR is also supported. A Nuxt/Nitro server for request-time SSR is not deployed. API-only projects install none of this frontend tooling. See [Frontend](/frontend).

## Your first controller

Create one with the CLI:

```bash
npm run honovel -- make:controller users/User
```

```ts
import { BaseUrl, Get } from '@honovel/core'
import { Controller } from '#src/runtime/Controller'

@BaseUrl('/users')
export class UserController extends Controller {
  @Get('/')
  index() {
    return [
      { id: 1, name: 'Taylor' },
      { id: 2, name: 'Abigail' },
    ]
  }
}
```

The generated application-level `Controller` already declares `@BaseUrl('/api')`, so this endpoint is available at `/api/users`. Change `src/runtime/Controller.ts` if your application should use another API prefix.

## Add a validated endpoint

```ts
import { FormRequest } from '@honovel/core'
import { z } from 'zod'

export class CreateUserRequest extends FormRequest(z.object({
  name: z.string().min(2),
  email: z.string().email(),
})) {}
```

```ts
@Post('/')
store(request: CreateUserRequest) {
  const input = request.validated()

  return {
    id: 3,
    ...input,
  }
}
```

Invalid requests receive a `422` response automatically.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run build
npm run honovel -- list
```

`typecheck` checks backend TypeScript/Honovel diagnostics and, when selected, Nuxt types. `build` compiles the Worker and generates the static frontend only in Nuxt projects. Shared build and Cloudflare launch helpers come from `@honovel/core`; generated projects do not contain copies in a `scripts/` directory. See [CLI](/cli#starter-tooling) for the underlying commands.