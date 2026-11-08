# Create Honovel

The default distribution is public on npmjs and requires no installation login.

Create a Cloudflare Workers application with an optional Nuxt frontend:

```sh
npm create @honovel/honovel@latest my-app
npm create @honovel/honovel@latest my-web-app -- --frontend=nuxt
npm create @honovel/honovel@latest my-api -- --api-only
```

The backend is always Cloudflare Workers. Without an explicit option, the installer asks whether to include Nuxt or create an API-only project. Nuxt is the default in non-interactive environments. `--frontend=none` is equivalent to `--api-only`; both `--frontend=value` and `--frontend value` work. Use `--no-install` to scaffold without installing dependencies. Existing directories are never overwritten.

The explicit initializer is `npx @honovel/create-honovel@latest my-app --frontend=nuxt`. The previous `--template=node|cloudflare` runtime selection has been removed. The Node adapter remains available separately for existing applications.

Both project modes include a health endpoint at `/api/health`, the application-level `/api` controller base, an empty D1 database schema, Durable Object cache/cache-backed locks, a Cloudflare Queue adapter and generated Cron Trigger support. No Todo table or initial SQL migration is created. Shared compiler/dev/build helpers ship in `@honovel/core`, without a copied `scripts/` directory.

With Nuxt, `npm run dev` starts the backend and frontend; open `http://localhost:5173`. Nuxt proxies API and documentation requests to Wrangler. `npm run build` generates the static frontend into `dist/frontend` and bundles the Worker into `dist/worker`; deployment attaches Workers Static Assets.

For API-only projects, `npm run dev` starts only Wrangler at `http://localhost:8788`. There is no `frontend/` directory, Nuxt/Vue/Tailwind dependency, frontend npm script or static assets configuration. Build, typecheck and deployment only process the backend.

Releases publish to npmjs and GitHub Packages, linked to `Honovel/framework`. Each initializer artifact configures its generated project for the registry it was published to. Only the GitHub mirror requires GitHub authentication for installation. Generated projects contain the scope mapping, but never copy tokens.
