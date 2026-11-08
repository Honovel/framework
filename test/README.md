# Framework tests

Run `npm test` from the repository root. `run.mjs` copies the Todo fixture from
`fixtures/application/`, the framework and the checks into a temporary project,
links the repository dependencies, and compiles before running the checks.
The temporary project is deleted even if a check fails. The fixture keeps its
original import paths because it runs at the root of that isolated project.

`npm run compile`, `npm run build`, `npm run typecheck` and `npm run dev` use the
same isolated fixture. They do not generate application artifacts in this repo.

Run `npm run test:packages` for the separate package integration suite. It packs
and installs the real packages, creates Cloudflare Nuxt and API-only projects,
checks compilation and production builds, and exercises Workers requests plus a
separate internal Node adapter fixture. It needs access to the npm registry for the starters' dependencies; no deployment is performed.

`fixtures/node-adapter/` preserves Node adapter coverage for existing applications.
It is an internal test fixture and is not included in the project initializer.

Release helper checks run separately with `npm run test:release` (also included in
`npm test`). They use simulated registries and uploads, not live publication.
Integration tests retain their npm download cache under `.local-tests/npm-cache`
(or `HONOVEL_NPM_CACHE`) while deleting generated test projects. The Node adapter
fixture is backend-only; the Cloudflare Nuxt starter owns the frontend build test.

CI and releases share `.github/workflows/checks.yml`, running framework and
integration checks in parallel. On releases, the integration job retains verified
npm and GitHub tarballs in `HONOVEL_PACKAGE_ARTIFACTS`. Publishing jobs consume
those artifacts without rebuilding or installing the framework dependencies.
