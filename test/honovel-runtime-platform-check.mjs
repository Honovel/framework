import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

function compile(...args) {
  execFileSync(process.execPath, ['core/compiler/honovel-build.mjs', ...args], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })
}

async function importCompiledEntry(fixtureRoot, name) {
  const outfile = path.join(fixtureRoot, `${name}.mjs`)
  await build({
    entryPoints: [path.resolve('.honovel/index.js')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  return import(`${pathToFileURL(outfile).href}?${Date.now()}`)
}

for (const artifact of ['.honovel/index.js', '.honovel/app.js', '.honovel/openapi.json']) {
  assert.ok(fs.existsSync(artifact), `Compiler did not emit ${artifact}.`)
}
for (const artifact of ['.honovel/app.d.ts', '.honovel/entry.js', '.honovel/node-entry.js', '.honovel/honovel.config.js']) {
  assert.equal(fs.existsSync(artifact), false, `Compiler must not emit legacy runtime artifact ${artifact}.`)
}

const sourceEntry = fs.readFileSync('index.ts', 'utf8')
let compiledEntry = fs.readFileSync('.honovel/index.js', 'utf8')
let appEntry = fs.readFileSync('.honovel/app.js', 'utf8')
const emittedTodoController = fs.readFileSync('.honovel/src/features/todos/controllers/TodoController.js', 'utf8')

assert.match(sourceEntry, /createHonoApp<AppEnv>\(\)/)
assert.doesNotMatch(sourceEntry, /\.honovel|registerHonovel/)
assert.match(compiledEntry, /import __honovelRegister from ["']\.\/app\.js["']/)
assert.match(compiledEntry, /const app = createHonoApp\(\)/)
assert.match(compiledEntry, /__honovelRegister\(app\)/)
const middlewareIndex = compiledEntry.indexOf('app.use(')
const registrationIndex = compiledEntry.indexOf('__honovelRegister(app)')
if (sourceEntry.includes('app.use(')) {
  assert.ok(middlewareIndex !== -1, 'Root Hono middleware must be preserved in the compiled entry.')
  assert.ok(registrationIndex > middlewareIndex, 'Honovel routes must be registered after root Hono middleware.')
}
assert.doesNotMatch(appEntry, /process\.env|cloudflare:workers|@hono\/node-server|resolveConfig|honovel\.config/)
assert.match(appEntry, /export function registerHonovel\(app\)/)
assert.match(appEntry, /registerOpenApiRoutes\(app, openApiDocument/)
assert.match(appEntry, /"swaggerPath":"\/swagger"/)
assert.match(appEntry, /"openApiPath":"\/openapi\.json"/)
assert.doesNotMatch(appEntry, /registerCompiledRoute|kind:\s*["'](?:primitive|formRequest|honoRequest)["']/)
assert.match(appEntry, /app\.get\("\/todos\/:id", async \(context\) =>/)
assert.match(appEntry, /context\.req\.param\("id"\)/)
assert.match(appEntry, /coerceCompiledNumber\(/)
assert.match(appEntry, /readCompiledBody\(context\)/)
assert.doesNotMatch(emittedTodoController, /__decorate|Reflect\.decorate/)
assert.doesNotMatch(emittedTodoController, /BaseUrl\(|Get\(|Post\(/)
assert.doesNotMatch(emittedTodoController, /\b(?:BaseUrl|Get|Post)\b/)

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-portable-app-'))
try {
  const sourceOnlyOutfile = path.join(fixtureRoot, 'source-only.mjs')
  await build({
    entryPoints: [path.resolve('index.ts')],
    outfile: sourceOnlyOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const sourceOnlyBundle = fs.readFileSync(sourceOnlyOutfile, 'utf8')
  assert.doesNotMatch(sourceOnlyBundle, /\.honovel|registerHonovel/)

  let { default: localApp } = await importCompiledEntry(fixtureRoot, 'development-app')
  assert.equal((await localApp.request('/swagger')).status, 200)
  assert.equal((await localApp.request('/openapi.json')).status, 200)

  compile('--mode', 'production')
  appEntry = fs.readFileSync('.honovel/app.js', 'utf8')
  compiledEntry = fs.readFileSync('.honovel/index.js', 'utf8')
  assert.doesNotMatch(appEntry, /registerOpenApiRoutes|openApiDocument|core\/openapi\/runtime/)
  assert.match(compiledEntry, /__honovelRegister\(app\)/)
  assert.ok(fs.existsSync('.honovel/openapi.json'), 'Production builds must still emit the OpenAPI artifact.')

  ;({ default: localApp } = await importCompiledEntry(fixtureRoot, 'production-app'))
  assert.equal((await localApp.request('/swagger')).status, 404)
  assert.equal((await localApp.request('/openapi.json')).status, 404)

  compile(
    '--mode', 'production',
    '--swagger-enabled',
    '--swagger-path', '/docs',
    '--openapi-path', '/schema.json',
  )
  appEntry = fs.readFileSync('.honovel/app.js', 'utf8')
  assert.match(appEntry, /registerOpenApiRoutes/)
  assert.match(appEntry, /"swaggerPath":"\/docs"/)
  assert.match(appEntry, /"openApiPath":"\/schema\.json"/)

  const { default: customDocsApp } = await importCompiledEntry(fixtureRoot, 'production-docs-app')
  assert.equal((await customDocsApp.request('/docs')).status, 200)
  assert.equal((await customDocsApp.request('/schema.json')).status, 200)
  assert.equal((await customDocsApp.request('/swagger')).status, 404)
  assert.equal((await customDocsApp.request('/openapi.json')).status, 404)
} finally {
  compile('--mode', 'development')
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log('[Honovel] createHonoApp source entry, root middleware ordering, runtime-neutral compiled entry, and build-time docs configuration check passed.')
