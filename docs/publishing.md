# Maintainer reference: GitHub Packages

This page describes releases of the four Honovel npm packages to GitHub Packages. It is excluded from the public documentation site and agent documentation; consumer setup is covered in [Getting Started](/getting-started#github-packages-authentication).

| Directory | Package | Purpose |
| --- | --- | --- |
| `core/` | `@honovel/core` | Runtime, compiler, generators, editor plugin |
| `packages/cloudflare/` | `@honovel/cloudflare` | Cloudflare runtime adapters |
| `packages/node/` | `@honovel/node` | Adapters for existing Node applications |
| `packages/create-honovel/` | `@honovel/create-honovel` | Project initializer and templates |

All packages target `https://npm.pkg.github.com/` and use `git+https://github.com/Honovel/framework.git` as their repository, with the corresponding monorepo directory. This associates the packages with the workflow repository. The root workspace stays private and is not published.

## Authentication and permissions

The GitHub release workflow uses the built-in `GITHUB_TOKEN`, passed as `NODE_AUTH_TOKEN`, with `contents: read` and `packages: write`. No additional publishing secret is required for packages associated with the workflow repository. If a package already exists under different permissions, grant the `Honovel/framework` repository Actions access to that package.

For local installation or manual publishing, configure the scope and authenticate:

```sh
npm config set --location=user @honovel:registry https://npm.pkg.github.com/
npm login --scope=@honovel --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use a personal access token (classic): `read:packages` for installation or `write:packages` for publishing. GitHub Packages requires authentication for installing public packages as well. Keep tokens in user npm configuration or CI secrets; repository and generated project `.npmrc` files contain only the scope mapping.

GitHub initially publishes packages with private visibility. Set the desired package visibility in GitHub package settings; `publishConfig.access` does not replace those settings.

## Checks and release

```sh
npm ci
npm run release:check
npm run package:pack
```

Tarballs and their manifest are written to ignored `dist/packages/`. Package integration tests install both Cloudflare project modes and an internal Node adapter fixture. Release tests simulate registry responses and uploads; tests do not publish real packages.

Publishing a GitHub release runs `.github/workflows/release.yml`. Its checkout uses the release tag: after changing release tooling, create a new tag on the corrected commit. Re-running an older failed run still uses its original workflow and tagged sources. Its tag, such as `v0.1.10`, determines all package and peer-dependency versions; the leading `v` is removed for package metadata. The workflow builds and checks the packages, then runs:

```sh
npm run release:github
```

For a manual run, supply `NODE_AUTH_TOKEN` through your secret-management method and `HONOVEL_RELEASE_TAG` as the desired version before invoking that command. The script checks all four package versions against GitHub Packages before the first upload. Failed authentication, registry errors and existing versions stop publishing. Uploads use a temporary npm configuration containing an environment-variable reference; the temporary configuration is removed afterward. The script does not fall back to another registry.

A later upload can still fail after an earlier package has published. Inspect the package versions before retrying: an existing version is never overwritten, and the full script refuses to republish it. Run the tests before manual publication; the publishing command itself builds tarballs but does not run the full integration suite.

## Framework development checks

`npm test` runs the framework checks in `test/`. The runner copies `test/fixtures/application/` and Core into a temporary project, links the workspace dependencies, compiles and executes the checks, and removes the temporary files even on failure. This keeps test applications and generated artifacts out of framework source and published packages.

At the repository root, `npm run compile`, `npm run build`, `npm run typecheck` and `npm run dev` also use the isolated fixture. Their generated application files are temporary. These repository commands differ from the same commands in a generated consumer project, where output remains under that project's `.honovel/` and `dist/` directories.

`npm run package:build` builds the distributable runtime packages. `npm run create:local -- my-app --frontend=nuxt` (or `--api-only`) packs the current sources, installs a consumer project under ignored `.local-tests/`, and runs its production build. This is useful when you need to inspect or run a generated project after the check finishes. Neither command publishes packages.

## GitHub Actions

The workflows live under `.github/workflows/`:

- `ci.yml` checks runtime package builds, framework tests and packed Nuxt/API-only integration projects on pushes to `main` and pull requests. A separate job verifies the GitHub Pages documentation build.
- `docs.yml` builds and publishes the documentation on every push to `main`. It can also be started manually. The build uploads a Pages artifact, and the dependent deployment job publishes it to the `github-pages` environment. Deployment is restricted to `main`.
- `release.yml` runs on published GitHub releases and uses `github.event.release.tag_name` as the package version. It runs `npm run release:github` and authenticates to GitHub Packages using `GITHUB_TOKEN` with `packages: write`.

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

For the public distribution, the initializer installs `@honovel/core` and `@honovel/cloudflare` from GitHub Packages and other dependencies from the public npm registry. Configure the scope and authentication first. Both project modes serve `GET /api/health` and include a central `src/database/main` with a provider, an empty schema barrel and a migrations directory. Both export the Worker app directly and Wrangler compiles `.honovel/index.js`. Nuxt projects additionally include frontend source and a Workers Static Assets binding; API-only projects omit all frontend files and dependencies. Both project modes include the full Honovel CLI, the published TypeScript language-service plugin, and shared Core CLI helpers. Application tables and SQL migrations are not pre-generated; add/export a schema and generate/review a migration before applying it. Additional databases remain under `src/database/<name>/`.

References: [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [Publishing Node.js packages](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).
