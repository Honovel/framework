# Maintainer reference: private package publishing

This internal page describes the existing private Gitea release scripts and their credentials. It is excluded from the public documentation site and agent documentation. For the public installation commands used by framework consumers, see [Getting Started](/getting-started).

The repository contains four independently publishable npm projects:

| Directory | Package | Purpose |
| --- | --- | --- |
| `core/` | `@honovel/core` | Runtime, compiler, generators, editor plugin |
| `packages/cloudflare/` | `@honovel/cloudflare` | Durable Object cache, Cloudflare queue and client IP adapters |
| `packages/node/` | `@honovel/node` | In-memory cache/queue and Croner runtime |
| `packages/create-honovel/` | `@honovel/create-honovel` | New-project CLI and template |

The root project is a private framework development workspace. Framework checks live in `test/`, and the Todo application lives in `test/fixtures/application/` as a test fixture. It is not published or copied into generated projects. No duplicate Core source tree is needed. Gitea packages belong to the **Honovel organization**; the source repository and npm package names are configured separately.

Registry: `https://npm.pkg.github.com/`.

## Private release access and authentication

**The Honovel organization must be private.** Gitea derives package access from the owner; `publishConfig.access: restricted` alone is not sufficient to establish Gitea privacy. A private source repository or a site-wide sign-in requirement is also insufficient. The release script checks the organization's authenticated API visibility and refuses an upload unless it is `private`.

For installation, configure the scope and a token environment-variable reference in your user npm configuration:

```sh
npm config set --location=user @honovel:registry https://npm.pkg.github.com/
npm config set --location=user -- '//npm.pkg.github.com/:_authToken' '${GITEA_TOKEN}'
```

Supply `GITEA_TOKEN` in your shell through your secret manager before npm commands; the single-quoted command above stores the variable reference, not the token. An installation token needs package read permission; publishing requires package write permission. The release script additionally requires organization read permission to verify privacy. Authentication belongs in your user-level npm config or CI secrets, never in tracked files. The repository and generated project `.npmrc` files contain only a scope mapping.

## Local checks and release

```sh
npm ci
npm test
npm run test:packages
npm run package:pack
```

Tarballs and an inventory are written to ignored `dist/packages/`. The integration test packs all four packages and installs the relevant runtime packages into fresh Cloudflare Nuxt and API-only projects, plus an internal Node adapter fixture, generates a feature, checks compiler diagnostics and database DI, and executes development/production Hono requests. The Cloudflare variant generates binding types, runs a Wrangler deployment dry run, and executes the bundle locally in Miniflare/workerd. It also checks that the browser runtime bundle cannot reach compiler tooling. It needs npm access for public dependencies but no Gitea or Cloudflare authentication, and performs no deployment.

The Git release tag is the package version; package manifests do not need to be updated for every release. The release checks can be run explicitly with `npm run release:check`; they create temporary integration projects under the system temp directory and remove them afterward. To publish, expose a Gitea personal access token through the `GITEA_TOKEN` environment variable using your local secret-management method, then run:

```sh
npm run release:private
```

The command verifies organization privacy, builds the four tarballs, checks whether any version already exists, and publishes Core, the Cloudflare adapter, the Node adapter and then the initializer to the fixed Gitea registry. It does not run the integration suite or scaffold test projects. It never uses the public npm registry as a publishing fallback. Existing versions are not overwritten. If a later upload fails after an earlier one succeeds, the release is partially published; inspect the registry and publish only the missing artifact after correcting the failure, retaining the privacy check. The script intentionally refuses a blind full retry when a version already exists.

The four package manifests currently declare `license: MIT`; registry access is configured separately through `publishConfig` and organization visibility. The Core publishes the TypeScript source needed for static compiler analysis alongside compiled ESM. Runtime import resolution does not load the compiler or TypeScript. Installed dependencies do include TypeScript for build-time compilation; bundlers can tree-shake runtime exports.

## Framework development checks

`npm test` runs the framework checks in `test/`. The runner copies `test/fixtures/application/` and Core into a temporary project, links the workspace dependencies, compiles and executes the checks, and removes the temporary files even on failure. This keeps test applications and generated artifacts out of framework source and published packages.

At the repository root, `npm run compile`, `npm run build`, `npm run typecheck` and `npm run dev` also use the isolated fixture. Their generated application files are temporary. These repository commands differ from the same commands in a generated consumer project, where output remains under that project's `.honovel/` and `dist/` directories.

`npm run package:build` builds the distributable runtime packages. `npm run create:local -- my-app --frontend=nuxt` (or `--api-only`) packs the current sources, installs a consumer project under ignored `.local-tests/`, and runs its production build. This is useful when you need to inspect or run a generated project after the check finishes. Neither command publishes packages.

## GitHub Actions

The workflows live under `.github/workflows/`:

- `ci.yml` checks runtime package builds, framework tests and packed Nuxt/API-only integration projects on pushes to `main` and pull requests. A separate job verifies the GitHub Pages documentation build.
- `docs.yml` builds and publishes the documentation on every push to `main`. It can also be started manually. The build uploads a Pages artifact, and the dependent deployment job publishes it to the `github-pages` environment. Deployment is restricted to `main`.
- `release.yml` runs on published GitHub releases and uses `github.event.release.tag_name` as the package version. It retains the existing private-registry publishing script and requires the repository secret `HONOVEL_PACKAGES_TOKEN` with the Gitea permissions described above. Moving the workflow to GitHub does not change the package registry.

The obsolete `.gitea/workflows/release.yml` has been replaced by the GitHub release workflow.

## Documentation deployment

For `Honovel/framework`, the default project-site URL is `https://honovel.github.io/framework/`. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** in the GitHub repository. Subsequent pushes to `main` are published by `docs.yml`, without a Cloudflare token or a separate deployment branch. The workflow uses the Pages metadata to determine the site's base path, including when a custom domain serves it at `/`.

The documentation build supports two environment variables:

| Variable | Purpose |
| --- | --- |
| `HONOVEL_DOCS_TARGET=github-pages` | Generate `.html` page links for GitHub Pages, which does not provide the existing clean-URL rewrites. |
| `HONOVEL_DOCS_BASE=/framework/` | Prefix assets, navigation, favicons and generated agent-documentation URLs with the deployment mount path. |

Check the Pages build locally:

```sh
HONOVEL_DOCS_TARGET=github-pages HONOVEL_DOCS_BASE=/framework/ npm run docs:build
HONOVEL_DOCS_TARGET=github-pages HONOVEL_DOCS_BASE=/framework/ npm run docs:preview
```

Both VitePress and the generated `llms.txt`, `llms-full.txt` and `raw/*.md` documents use the same base path. Generated Markdown under `public/` is served as raw assets rather than being rendered as duplicate documentation pages.

Without these variables, `npm run docs:build` keeps the root-mounted clean-URL build used for local development and the existing Cloudflare site. Manual Cloudflare preview/deployment remains available through `npm run docs:preview:cloudflare` and `npm run docs:deploy`, using `docs/wrangler.jsonc`. The automatic GitHub Pages workflow does not invoke those commands.

## Public consumer quickstart

The public installation instructions follow [Honovel/framework on GitHub](https://github.com/Honovel/framework) and the published npm initializer:

```sh
npm create @honovel/honovel@latest my-app
cd my-app
npm run dev
```

This resolves the npm initializer `@honovel/create-honovel`. The explicit equivalent is `npx @honovel/create-honovel@latest my-app`. Without a `--template` option the initializer asks whether to include Nuxt; non-interactive runs include Nuxt. The backend is always Cloudflare Workers. To create an API-only project:

```sh
npm create @honovel/honovel@latest my-api -- --api-only
cd my-api
npm run dev
```

For the public distribution, the initializer installs `@honovel/core`, its selected runtime adapter and public dependencies from npm. Private Gitea registry/token configuration above belongs to the internal release workflow. Both project modes serve `GET /api/health` and include a central `src/database/main` with a provider, an empty schema barrel and a migrations directory. Both export the Worker app directly and Wrangler compiles `.honovel/index.js`. Nuxt projects additionally include frontend source and a Workers Static Assets binding; API-only projects omit all frontend files and dependencies. Both project modes include the full Honovel CLI, the published TypeScript language-service plugin, and shared Core CLI helpers. Application tables and SQL migrations are not pre-generated; add/export a schema and generate/review a migration before applying it. Additional databases remain under `src/database/<name>/`.

References: [Gitea npm registry](https://docs.gitea.com/usage/packages/npm/), [Gitea package ownership and access](https://docs.gitea.com/usage/packages/overview/#access-restrictions).
