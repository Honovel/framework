# Framework tests

Run `npm run package:build` and `npm test` from the repository root. `test/run.mts` copies the application fixture, framework and checks into an isolated temporary project, links repository dependencies and compiles before running the checks. Generated JavaScript tooling is prepared automatically by root commands.

The checks run in Node as a test host. The supported application deployment runtime is Cloudflare Workers. `npm run compile`, `build`, `typecheck` and `dev` use the same isolated fixture and leave no application output in the repository.

`npm run test:packages` packs and installs the real `honovel` and `create-honovel` artifacts. It tests the short npm create command against a local registry, creates Nuxt/API-only starters, checks compilation and production builds, and runs requests and events in workerd. It also checks that the main runtime entry point does not load Cloudflare bindings, compiler tooling or Node adapters.

The suite needs npm access for starter dependencies and keeps its cache under `.local-tests/npm-cache` (or `HONOVEL_NPM_CACHE`). Test projects are removed unless `HONOVEL_KEEP_TEST_PROJECTS=1`; nothing is deployed or published.

`npm run test:release` checks simulated npm registry requests and publication, authentication-file cleanup, artifact integrity and preflight failures. It is also included in `npm test`.

CI and releases share `.github/workflows/checks.yml`. Release integration checks retain verified npm tarballs under `HONOVEL_PACKAGE_ARTIFACTS`; the publishing job uploads these artifacts without rebuilding packages.
