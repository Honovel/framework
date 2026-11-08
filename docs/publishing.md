# Maintainer reference: npmjs and GitHub Packages

Releases publish four packages to public npmjs and mirror them to GitHub Packages:

| Directory | Package |
| --- | --- |
| `core/` | `@honovel/core` |
| `packages/cloudflare/` | `@honovel/cloudflare` |
| `packages/node/` | `@honovel/node` |
| `packages/create-honovel/` | `@honovel/create-honovel` |

The root workspace is private and is not published. Package source metadata targets `https://registry.npmjs.org/`. Mirror tarballs have their own `publishConfig.registry` pointing to `https://npm.pkg.github.com/`; the initializer's generated scope mapping follows its selected registry. Merely passing another registry to `npm publish` is insufficient when the tarball still contains a different publish configuration.

## npmjs setup

The publishing account must have access to the `@honovel` scope on npm. Packages use `--access=public`, so consumers do not need authentication to install from npmjs.

For a first publication, set the repository's `NPM_TOKEN` secret to an npm granular access token authorized to publish these packages, with the required 2FA bypass for non-interactive publishing. This token is optional once trusted publishing is configured. Never commit a token.

For tokenless releases, configure a trusted publisher on each npm package:

- GitHub owner: `Honovel`
- Repository: `framework`
- Workflow filename: `release.yml`
- Allow direct `npm publish` from that workflow.

The npm release job runs on a GitHub-hosted runner with Node 22, npm 11.6.0 and `id-token: write`. Without `NPM_TOKEN`, npm uses its OIDC identity. Trusted publishing automatically produces provenance for public packages from a public repository. A new package may need its initial publication before its package-level trusted publisher settings can be configured.

## GitHub Packages setup

The mirror job uses the built-in `GITHUB_TOKEN` with `packages: write`; no separate GitHub publishing token is needed for packages associated with the workflow repository. Existing packages must grant the repository Actions access. GitHub's package visibility settings are separate from the npm `--access` flag: check or change visibility in package settings if the mirror should be public.

Installation from GitHub Packages requires authentication even for public packages. This is optional for consumers now that npmjs is the default:

```sh
npm config set --location=user @honovel:registry https://npm.pkg.github.com/
npm login --scope=@honovel --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use a GitHub personal access token (classic) with `read:packages`. To switch back to npmjs, set the scope registry to `https://registry.npmjs.org/`.

## Release workflow

A published GitHub release runs `.github/workflows/release.yml`. The release tag determines all package and peer-dependency versions, with a leading `v` removed. After fixing release tooling, create a new tag on the corrected commit: re-running an old workflow run still uses its original sources.

The workflow calls `.github/workflows/checks.yml`:

1. Framework checks build/typecheck runtime packages and run framework plus publishing unit tests.
2. Integration checks run in parallel: pack the current sources, install temporary Node-backend/Nuxt/API-only applications, and test compilation, production builds and runtime requests.
3. The integration job creates registry-specific npm and GitHub tarballs from the same compiled runtime and uploads `verified-packages` only after all checks pass.
4. Separate npmjs and GitHub jobs install the tooling dependencies, download those tarballs and publish them without rebuilding the verified packages.

The integration npm cache persists between CI runs. No test project is deployed. Temporary apps are intentional end-to-end checks that the published initializer and compiler work together; generated projects are deleted afterward. The old Node adapter fixture is backend-only, so Nuxt is installed and built only for the actual Cloudflare Nuxt starter.

The publish helper checks artifact integrity and release version before use. Registry failures stop uploading. On reruns, `--skip-existing` only skips an existing version when its registry integrity exactly matches the prepared tarball; a different or unverifiable artifact requires a new version. Cross-registry publication is not atomic: one registry can succeed while the other fails. Re-run the failed job while the verified artifact is retained (seven days).

## Local checks and publishing

All maintained JavaScript tooling is written in TypeScript: `.mts` for ESM and `.cts` for the CommonJS TypeScript language-service plugin. `npm install` prepares the executable files, and the root commands rebuild them before running. `npm run build:tooling` regenerates the `.mjs`/`.cjs` files and source maps beside their sources; those outputs are ignored by Git. Published packages include the generated Node entry points, so consumers need no TypeScript loader and still use Node.js 22 or newer.

`npm run typecheck:tooling` checks the CLI, compiler, plugin, scripts, documentation helpers and tests. Tooling has its own configuration so its Node types do not leak into application/Worker types. The migrated tooling checks strict nullability and function contracts; implicit parameter types are still allowed for existing compiler internals. Runtime source retains its existing strict configuration.

```sh
npm test                    # framework checks plus fast release-helper tests
npm run test:release        # simulated publishing only
npm run test:packages       # real packed starter integration tests
npm run release:check       # complete local verification
```

Use `HONOVEL_NPM_CACHE` to choose the integration download cache and `HONOVEL_PACKAGE_ARTIFACTS` to retain verified npm/GitHub tarballs. Other generated files stay temporary.

Publishing entrypoints are `npm run release:npm` and `npm run release:github`. Supply `NODE_AUTH_TOKEN` for manual publishing and `HONOVEL_RELEASE_TAG` for the desired version. CI can publish verified archives with `-- --packages-dir <directory> --skip-existing`. The manifest is rebased to the downloaded artifact path and every tarball is checked against its recorded SHA-512 integrity. A temporary npm configuration references the token by environment variable and is removed after publishing, including on errors. Tokens are never written into package artifacts.

## CI and Pages

`ci.yml` calls the same framework/integration workflow on pull requests and pushes to `main`, plus a documentation build check. `docs.yml` remains the VitePress deployment workflow on every push to `main`. Set **Settings → Pages → Source: GitHub Actions**; do not use the branch-based Jekyll build for this VitePress site.

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

For the public distribution, the initializer installs `@honovel/core` and `@honovel/cloudflare` from the public npm registry by default. The additional GitHub mirror requires authentication and an explicit scope mapping. Both project modes serve `GET /api/health` and include a central `src/database/main` with a provider, an empty schema barrel and a migrations directory. Both export the Worker app directly and Wrangler compiles `.honovel/index.js`. Nuxt projects additionally include frontend source and a Workers Static Assets binding; API-only projects omit all frontend files and dependencies. Both project modes include the full Honovel CLI, the published TypeScript language-service plugin, and shared Core CLI helpers. Application tables and SQL migrations are not pre-generated; add/export a schema and generate/review a migration before applying it. Additional databases remain under `src/database/<name>/`.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [Publishing Node.js packages](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).
