# Frontend

Select `--frontend=nuxt` during project creation to include a Nuxt 4 frontend under `frontend/`. Both Nuxt and API-only projects use Cloudflare Workers as their backend. Honovel remains responsible for the backend/API; Nuxt provides pages, layouts, client navigation, SEO metadata, assets and the frontend build.

## Rendering modes

The default production build uses **static site generation (SSG)**.

| Mode | Supported | Behavior |
| --- | --- | --- |
| SSG / prerendering | Yes, default | Nuxt renders pages at build time with `nuxt generate` and Honovel deploys the generated static files. |
| CSR | Yes | Nuxt hydrates the generated application in the browser. Projects that want a pure client-rendered SPA can set `ssr: false` in `frontend/nuxt.config.ts`. |
| SSR | No | Honovel does not deploy a Nuxt/Nitro server runtime, so pages are not rendered per request. |
| ISR | No | Incremental regeneration requires a server runtime and is not part of the current starter. |

The important distinction is that Nuxt may use server rendering **during the build** to prerender HTML, but Honovel does not run Nuxt server rendering when a production request arrives.

For most public pages this still provides the SEO benefit of rendered HTML while keeping production deployment fully static on the frontend.

## Default build

The shared frontend build runs Nuxt generation:

```bash
npm run build:frontend
```

Internally, the starter calls `honovel frontend:build` from `honovel`, which runs `nuxt generate frontend` in the application directory. Nuxt writes its generated site to `frontend/.output/public`; Honovel then copies that output to:

```text
dist/frontend/
```

Only files generated during the build can contain prerendered HTML. Nuxt's prerender crawler discovers linked routes automatically. Routes that cannot be discovered at build time, such as some dynamic parameter combinations, should be added to Nuxt prerender configuration or loaded client-side.

There is no Nitro server in the production runtime.

## Frontend structure

```text
frontend/
  nuxt.config.ts
  tsconfig.json
  app/
    app.vue
    assets/
      css/
        main.css
    pages/
      index.vue
      about.vue
```

Use normal Nuxt conventions as the application grows, for example `app/layouts/`, `app/components/`, `app/composables/` and additional files under `app/pages/`.

The starter includes Tailwind CSS through its Vite plugin and bundles the Manrope font locally.

## Pages and SEO

Nuxt file-based routing is available normally. For example:

```text
frontend/app/pages/pricing.vue
```

becomes `/pricing` and is prerendered by the default SSG build when Nuxt discovers the route.

Nuxt SEO APIs can be used directly:

```ts
useSeoMeta({
  title: 'Pricing',
  description: 'Simple pricing for our application.',
})
```

Because the default build prerenders the page, the generated HTML contains its rendered content and metadata before it is served to the browser.

## Client-side rendering

After the initial static HTML is loaded, Nuxt hydrates the application and normal navigation happens client-side.

If an application does not need prerendered HTML at all, it can switch to a pure CSR build:

```ts
export default defineNuxtConfig({
  ssr: false,
})
```

The same Honovel deployment model still applies: the resulting frontend is built as static files and served separately from `/api/*`.

## Calling the Honovel API

Frontend code should normally use relative URLs:

```ts
const users = await $fetch('/api/users')
```

or:

```ts
const response = await fetch('/api/users')
```

No separate API hostname or CORS configuration is required by the default starter.

During development, Nuxt proxies `/api`, `/swagger` and `/openapi.json` to the local Honovel backend. In production, frontend and API routes are served from the same origin.

## Local development

Start the complete application with:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Nuxt is the public development entrypoint. Backend ports are implementation details and are proxied by Nuxt.

The Cloudflare starter prefers port `8788` for the internal Wrangler server and automatically selects another free port when necessary.

## Production delivery

### Cloudflare

Cloudflare publishes `dist/frontend` as Workers Static Assets. Static frontend requests can therefore be served directly by Cloudflare without invoking the Honovel Worker. `/api/*`, `/swagger` and `/openapi.json` are configured to run the Worker first.

## API-only applications

Create an API-only project directly:

```bash
npm create honovel@latest my-api -- --api-only
```

`--frontend=none` is equivalent. This omits `frontend/`, Nuxt/Vue/Tailwind dependencies, frontend npm scripts and Wrangler's static assets binding. `npm run dev` serves the API directly at `http://localhost:8788`; typechecking, building and deployment only process the Worker. Backend services, controllers, DI and validation are unchanged.

## SSR

Request-time Nuxt SSR is intentionally not supported by the current starter. Supporting it would require deploying a Nuxt/Nitro server runtime in addition to or alongside the Honovel runtime.

The current architecture deliberately keeps the frontend deployment static: use SSG for pages that need generated HTML and SEO, and CSR for application screens that do not.
