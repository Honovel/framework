# Maintainer reference: npm releases

Releases publish two public packages to npm:

| Source directory | Package | Purpose |
| --- | --- | --- |
| `core/` | `honovel` | Framework, compiler, CLI, editor plugin and Cloudflare adapters |
| `packages/create-honovel/` | `create-honovel` | Project initializer for `npm create honovel@latest` |

The root workspace is private. Cloudflare adapters are part of `honovel` and exposed through `honovel/cloudflare`; they are not a separate npm dependency. The main runtime entry point does not load `cloudflare:workers`. Node deployment adapters and scoped compatibility packages are not part of releases. Node.js 22 or newer is required for local tooling.

The source repository, releases, Actions workflows and documentation remain on GitHub. Package artifacts are published only to `https://registry.npmjs.org/`.

## npm setup

The publishing account must be able to publish both `honovel` and `create-honovel`. For their first publication, configure the repository's `NPM_TOKEN` secret with a granular token authorized for these packages and non-interactive publication. Never commit tokens.

Once each package exists, configure its trusted publisher:

- GitHub owner: `Honovel`
- Repository: `framework`
- Workflow filename: `release.yml`
- Allow direct publishing from the workflow.

The npm job uses a GitHub-hosted runner, Node 22, npm 11.6.0 and `id-token: write`. `NPM_TOKEN` is an optional bootstrap/fallback; otherwise publication uses npm trusted publishing through OIDC. Both packages must be configured individually.

## Release workflow

A published GitHub release runs `.github/workflows/release.yml`. Its tag determines both package versions, with a leading `v` removed. Use a new tag on the corrected commit after fixing release tooling; rerunning an older workflow still uses that tag's original source.

1. Framework checks build/typecheck the package and run framework plus release-helper tests.
2. Integration checks pack `honovel` and `create-honovel`, test `npm create honovel@latest` against a local registry, install generated Nuxt and API-only applications, and verify production builds and workerd requests/events.
3. Only after successful checks, the integration job uploads the verified npm tarballs and their integrity manifest as `verified-packages`.
4. The npm job downloads these artifacts and publishes them without rebuilding packages.

The integration job never deploys a project or publishes a package. It retains its npm cache across runs and removes generated projects afterward.

The release helper checks artifact names, npm registry, version and SHA-512 integrity before uploading. All registry preflights finish before the first upload. `--skip-existing` skips an already-published version only when its integrity matches the verified artifact. A partial npm release can be resumed while the verified artifact is retained; conflicting artifacts require a new version.

## Local checks

```sh
npm run package:build       # framework + Cloudflare subpath + initializer
npm run typecheck:tooling   # CLI, compiler, plugin, scripts and tests
npm test                   # framework and simulated publishing checks
npm run test:packages      # packed initializer and Workers integration
npm run release:check      # complete local verification
npm run package:pack       # pack both packages into dist/packages
```

The maintained tooling sources use `.mts` for ESM and `.cts` for the CommonJS editor plugin. Installation prepares generated `.mjs`/`.cjs` files, and root commands rebuild them before running. These outputs and their source maps are ignored by Git. Published packages contain executable JavaScript, so consumers need no TypeScript loader.

Tooling uses a separate TypeScript configuration so Node types do not leak into Worker application types. It checks strict nullability and function contracts while allowing implicit parameter types in existing compiler internals. Runtime source retains its strict configuration.

## Dependency security

Audit the repository, documentation and generated applications separately. The initializer templates are named `package.json.template`, so updates to repository dependencies alone do not update new projects. Keep the framework's peer-dependency minimums and starter ranges aligned with security fixes.

The current starter minimums include Hono 4.13.17, Zod 4.6.7 and Wrangler 4.158.0. Updating Wrangler also updates its Miniflare, Undici and Sharp dependencies. Nuxt uses targeted overrides for `@vercel/nft` → Glob 14.0.2+ and `readdir-glob` → Minimatch 11.0.1+ until upstream adopts those patched majors. The initializer merges these with the shared Drizzle/esbuild override; packed-project integration tests cover the combined configuration.

VitePress 1.6 still requests Vite 5, which has no patched release for the current advisories. The docs-only override selects patched Vite 6.4.4+ and is checked with a Pages build and local dev-server smoke test. Remove the override when a stable VitePress release uses a patched Vite version directly.

As of 2026-11-08, Nuxt's Nitro build dependency still includes `deepmerge` 4.3.1, affected by [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). No patched version is published. This produces multiple low-severity audit entries along the same dependency chain; do not treat `npm audit fix --force` suggesting an older Nuxt release as a validated fix. The Nuxt starter prerenders static assets for Workers and does not deploy a Nitro server. Keep tracking the upstream fix rather than hiding the advisory or downgrading dependencies without validation.

## Documentation deployment

The public documentation is [honovel.github.io/framework](https://honovel.github.io/framework/). `.github/workflows/docs.yml` publishes it through GitHub Pages, independently of npm releases. Framework CI also verifies the Pages build.

```sh
HONOVEL_DOCS_TARGET=github-pages HONOVEL_DOCS_BASE=/framework/ npm run docs:build
```

The generated `llms.txt`, `llms-full.txt` and raw Markdown links use the same mount point. Without these variables, the build keeps root-mounted URLs for local development. Optional manual Cloudflare documentation deployment remains available via `npm run docs:deploy`; it does not publish npm packages.

## Consumer quickstart

```sh
npm create honovel@latest my-app
cd my-app
npm run dev
```

The initializer prompts for Nuxt or API-only; non-interactive runs include Nuxt. To select an API-only project directly:

```sh
npm create honovel@latest my-api -- --api-only
```

Generated projects install `honovel`, import framework APIs from `honovel` and adapters from `honovel/cloudflare`, and configure the editor plugin as `honovel/typescript-plugin`. Both modes deploy to Cloudflare Workers and include D1 configuration, Durable Object cache/locks, a Queue adapter and Cron Trigger support. Nuxt adds the frontend and Workers Static Assets configuration. No registry login is required.
