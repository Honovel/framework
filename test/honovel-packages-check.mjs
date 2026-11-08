import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { packPackages, root, registry, githubRegistry } from '../scripts/pack-packages.mjs'
import { loadPackages } from '../scripts/release-github.mjs'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-packages-'))
const started = performance.now()
const cacheDirectory = process.env.HONOVEL_NPM_CACHE ?? path.join(root, '.local-tests/npm-cache')
const artifactDirectory = process.env.HONOVEL_PACKAGE_ARTIFACTS && path.resolve(process.env.HONOVEL_PACKAGE_ARTIFACTS)
const env = { ...process.env, npm_config_cache: cacheDirectory }
process.env.npm_config_cache = env.npm_config_cache
try {
  const coreMetadata = JSON.parse(fs.readFileSync(path.join(root, 'core/package.json'), 'utf8'))
  const cloudflareMetadata = JSON.parse(fs.readFileSync(path.join(root, 'packages/cloudflare/package.json'), 'utf8'))
  const nodeMetadata = JSON.parse(fs.readFileSync(path.join(root, 'packages/node/package.json'), 'utf8'))
  const initializerMetadata = JSON.parse(fs.readFileSync(path.join(root, 'packages/create-honovel/package.json'), 'utf8'))
  const releaseVersion = process.env.HONOVEL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? '9.9.9'
  const records = packPackages(artifactDirectory ? path.join(artifactDirectory, 'npm') : path.join(temporary, 'tarballs'), releaseVersion)
  assert.equal(records[0].name, '@honovel/core')
  assert.equal(records[1].name, '@honovel/cloudflare')
  assert.equal(records[2].name, '@honovel/node')
  assert.equal(records[3].name, '@honovel/create-honovel')
  assert.equal(records[0].version, releaseVersion.replace(/^v/, ''))
  assert.equal(records[1].version, records[0].version)
  assert.equal(records[2].version, records[0].version)
  assert.equal(records[3].version, records[0].version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'core/package.json'), 'utf8')).version, coreMetadata.version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/cloudflare/package.json'), 'utf8')).version, cloudflareMetadata.version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/node/package.json'), 'utf8')).version, nodeMetadata.version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/create-honovel/package.json'), 'utf8')).version, initializerMetadata.version)
  assert.equal(registry, 'https://registry.npmjs.org/')
  for (const metadata of [coreMetadata, cloudflareMetadata, nodeMetadata, initializerMetadata]) {
    assert.equal(metadata.publishConfig.registry, registry)
    assert.equal(metadata.repository.url, 'git+https://github.com/Honovel/framework.git')
  }
  console.log('[Honovel] Checking packed initializer and Node adapter backend fixture...')
  const cliRoot = path.join(temporary, 'cli')
  fs.mkdirSync(cliRoot)
  execFileSync('npm', ['install', '--prefix', cliRoot, '--ignore-scripts', '--no-audit', '--no-fund', records[3].tarball], { env, stdio: 'pipe' })
  const creator = path.join(cliRoot, 'node_modules/@honovel/create-honovel/bin/create-honovel.mjs')
  for (const options of [['--frontend=unknown'], ['--frontend'], ['--frontend=nuxt', '--api-only'], ['--api-only', '--api-only'], ['--template=node'], ['--template=cloudflare']]) {
    const invalid = spawnSync(process.execPath, [creator, 'invalid-template', ...options, '--no-install'], { cwd: temporary, encoding: 'utf8' })
    assert.notEqual(invalid.status, 0)
    assert.equal(fs.existsSync(path.join(temporary, 'invalid-template')), false)
  }
  execFileSync(process.execPath, [creator, 'default_sample', '--no-install'], { cwd: temporary, stdio: 'pipe' })
  const defaultApplication = path.join(temporary, 'default_sample')
  const defaultMetadata = JSON.parse(fs.readFileSync(path.join(defaultApplication, 'package.json'), 'utf8'))
  assert.equal(defaultMetadata.dependencies['@hono/node-server'], undefined)
  assert.ok(defaultMetadata.devDependencies.wrangler)
  assert.ok(defaultMetadata.dependencies.nuxt)
  assert.ok(fs.existsSync(path.join(defaultApplication, 'frontend')))
  assert.ok(!records[3].files.some(({ path: file }) => file.startsWith('template/node/')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(defaultApplication, 'wrangler.jsonc'), 'utf8')).name, 'default-sample')
  // Existing Node adapter coverage is a test fixture, not a generator template.
  const nodeFixture = path.join(temporary, 'sample')
  fs.mkdirSync(nodeFixture)
  function copyFixture(directory, destination) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const outputName = entry.name === 'env.example.template' ? '.env.example' : entry.name.replace(/\.template$/, '')
      const source = path.join(directory, entry.name)
      const output = path.join(destination, outputName)
      if (entry.isDirectory()) {
        fs.mkdirSync(output, { recursive: true })
        copyFixture(source, output)
      } else if (source.endsWith('.png')) fs.copyFileSync(source, output)
      else fs.writeFileSync(output, fs.readFileSync(source, 'utf8')
        .replaceAll('__PROJECT_NAME__', 'sample').replaceAll('__HONOVEL_VERSION__', records[0].version)
        .replaceAll('__HONOVEL_REGISTRY__', initializerMetadata.publishConfig.registry))
    }
  }
  copyFixture(path.join(root, 'packages/create-honovel/template/common'), nodeFixture)
  copyFixture(path.join(root, 'test/fixtures/node-adapter'), nodeFixture)
  fs.writeFileSync(path.join(nodeFixture, '.env'), 'APP_DEBUG=true\n')
  const application = path.join(temporary, 'sample')
  process.env.DATABASE_URL = path.join(application, 'local.db')
  assert.equal(fs.existsSync(path.join(application, 'core')), false)
  const duplicate = spawnSync(process.execPath, [creator, 'sample', '--no-install'], { cwd: temporary, encoding: 'utf8' })
  assert.notEqual(duplicate.status, 0)
  assert.match(duplicate.stderr, /already exists/)
  assert.doesNotMatch(fs.readFileSync(path.join(application, '.npmrc'), 'utf8'), /authToken/)
  const metadataPath = path.join(application, 'package.json')
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  assert.ok(metadata.dependencies['@hono/node-server'])
  assert.equal(metadata.devDependencies.esbuild, undefined)
  assert.equal(metadata.devDependencies.wrangler, undefined)
  assert.equal(fs.existsSync(path.join(application, 'wrangler.jsonc')), false)
  assert.match(fs.readFileSync(path.join(application, 'tsconfig.json'), 'utf8'), /@honovel\/core\/typescript-plugin/)
  assert.equal(metadata.imports['#src/*'], './src/*.ts')
  assert.equal(metadata.dependencies['@honovel/core'], records[0].version)
  assert.equal(metadata.dependencies['@honovel/node'], records[2].version)
  assert.match(fs.readFileSync(path.join(application, '.env.example'), 'utf8'), /APP_DEBUG=false/)
  assert.match(fs.readFileSync(path.join(application, '.env'), 'utf8'), /APP_DEBUG=true/)
  assert.match(fs.readFileSync(path.join(application, 'agents.md'), 'utf8'), /https:\/\/honovel-docs\.lutze\.workers\.dev\/llms-full\.txt/)
  assert.match(fs.readFileSync(path.join(application, 'agents.md'), 'utf8'), /src\/features\/<feature>\//)
  assert.match(metadata.scripts['dev:backend'], /--env-file-if-exists=\.env/)
  assert.equal(metadata.scripts.dev, 'npm run dev:backend')
  assert.ok(fs.existsSync(path.join(application, 'src/database/main/MainDatabase.ts')))
  assert.equal(fs.existsSync(path.join(application, 'src/database/main/schema/todos.ts')), false)
  assert.match(fs.readFileSync(path.join(application, 'src/database/main/schema/index.ts'), 'utf8'), /export \{\}/)
  assert.equal(fs.existsSync(path.join(application, 'scripts')), false)
  assert.ok(fs.existsSync(path.join(application, 'src/database/main/drizzle.config.ts')))
  assert.ok(fs.existsSync(path.join(application, 'src/runtime/InMemoryCache.ts')))
  assert.ok(fs.existsSync(path.join(application, 'src/runtime/CacheLock.ts')))
  assert.ok(fs.existsSync(path.join(application, 'src/runtime/InMemoryQueue.ts')))
  assert.ok(fs.existsSync(path.join(application, 'src/runtime/Controller.ts')))
  assert.match(fs.readFileSync(path.join(application, 'src/runtime/Controller.ts'), 'utf8'), /@BaseUrl\('\/api'\)/)
  assert.equal(fs.existsSync(path.join(application, 'frontend')), false)
  assert.equal(metadata.dependencies.nuxt, undefined)
  assert.match(fs.readFileSync(path.join(application, 'src/runtime/InMemoryQueue.ts'), 'utf8'), /class AppQueue extends InMemoryQueue/)
  assert.match(fs.readFileSync(path.join(application, 'src/runtime/InMemoryCache.ts'), 'utf8'), /class AppCache extends InMemoryCache/)
  assert.match(fs.readFileSync(path.join(application, 'src/runtime/CacheLock.ts'), 'utf8'), /class AppLock extends CacheLock/)
  assert.doesNotMatch(fs.readFileSync(path.join(application, 'src/runtime/InMemoryQueue.ts'), 'utf8'), /class InMemoryQueue extends Queue/)
  const decoratorsExample = fs.readFileSync(path.join(application, 'src/decorators.ts'), 'utf8')
  assert.match(decoratorsExample, /export const CurrentUser/)
  assert.match(decoratorsExample, /export const Header/)
  assert.match(decoratorsExample, /export const IpRateLimit/)
  assert.match(decoratorsExample, /cache\.increment\(/)
  assert.match(decoratorsExample, /TooManyRequestsException/)
  assert.match(decoratorsExample, /\[UserService, JwtPayload\]/)
  assert.match(fs.readFileSync(path.join(application, 'src/database/main/MainDatabase.ts'), 'utf8'), /local\.db/)
  const vscodeSettings = JSON.parse(fs.readFileSync(path.join(application, '.vscode/settings.json'), 'utf8'))
  assert.equal(vscodeSettings['js/ts.tsdk.path'], './node_modules/typescript/lib')
  assert.equal(vscodeSettings['js/ts.experimental.useTsgo'], false)
  assert.equal(fs.existsSync(path.join(application, 'server.mjs')), false)
  assert.equal(fs.existsSync(path.join(application, 'scripts/bundle.mjs')), false)
  assert.ok(fs.existsSync(path.join(application, '.vscode/launch.json')))
  assert.ok(fs.existsSync(path.join(application, '.vscode/tasks.json')))
  assert.match(fs.readFileSync(path.join(application, '.vscode/launch.json'), 'utf8'), /127\.0\.0\.1:9229/)
  assert.match(fs.readFileSync(path.join(application, 'package.json'), 'utf8'), /dev:build/)
  assert.match(metadata.scripts['dev:backend'], /nodemon/)
  assert.match(metadata.scripts['dev:backend'], /--watch src/)
  assert.match(metadata.scripts['dev:backend'], /--watch index\.ts/)
  assert.match(metadata.scripts['dev:backend'], /--inspect=127\.0\.0\.1:9229/)
  assert.equal(metadata.devDependencies.nodemon, '^3.1.10')
  assert.match(fs.readFileSync(path.join(application, 'src/database/main/MainDatabase.ts'), 'utf8'), /\.\/schema\/index\.js/)
  assert.ok(fs.existsSync(path.join(application, 'src/runtime/InMemoryCache.ts')))
  assert.match(fs.readFileSync(path.join(application, 'index.ts'), 'utf8'), /startCronJobs\(app, \{ bindings \}\)/)
  metadata.dependencies['@honovel/core'] = records[0].tarball
  metadata.dependencies['@honovel/node'] = records[2].tarball
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: application, env, stdio: 'pipe' })
  fs.writeFileSync(path.join(application, 'src/features/health/controllers/HealthController.ts'), `
import { BaseUrl, Get } from '@honovel/core'
import { Controller } from '#src/runtime/Controller'
import { IpRateLimit } from '#src/decorators'

@BaseUrl('/health')
export class HealthController extends Controller {
  @Get('/')
  @IpRateLimit(200)
  show() { return { status: 'ok' } }
}
`)
  execFileSync('npm', ['run', 'dev:build'], { cwd: application, env, stdio: 'pipe' })
  assert.ok(fs.existsSync(path.join(application, '.honovel/index.js')))
  assert.ok(fs.existsSync(path.join(application, '.honovel/index.js.map')))
  assert.match(
    fs.readFileSync(path.join(application, '.honovel/src/features/health/controllers/HealthController.js'), 'utf8'),
    /from ["']\.\.\/\.\.\/\.\.\/decorators\.js["']/,
  )
  const directNodeApp = (await import(pathToFileURL(path.join(application, '.honovel/index.js')).href)).default
  assert.equal((await directNodeApp.request('/api/health')).status, 200)
  const generatedOpenApi = JSON.parse(fs.readFileSync(path.join(application, '.honovel/openapi.json'), 'utf8'))
  assert.equal(generatedOpenApi.info.title, metadata.name)
  assert.equal(generatedOpenApi.info.version, metadata.version)
  const core = path.join(application, 'node_modules/@honovel/core')
  // TypeScript's language-service plugin loader looks for a physical package
  // directory and does not resolve the package exports map here.
  assert.ok(fs.existsSync(path.join(core, 'typescript-plugin/package.json')))
  assert.ok(fs.existsSync(path.join(core, 'typescript-plugin/index.cjs')))
  const run = (...args) => execFileSync(process.execPath, [path.join(core, 'cli/honovel.mjs'), ...args], { cwd: application, stdio: 'pipe' })
  run('make:feature', 'users')
  assert.equal(fs.existsSync(path.join(application, 'src/features/users/dto/requests')), true)
  assert.equal(fs.existsSync(path.join(application, 'src/features/users/dto/responses')), true)
  fs.mkdirSync(path.join(application, 'src/database/main'), { recursive: true })
  fs.writeFileSync(path.join(application, 'src/database/main/MainDatabase.ts'), `
import { defineDatabase } from '@honovel/core'
export class MainDatabase extends defineDatabase(() => ({ value: 'database-ok' })) {}
`)
  fs.mkdirSync(path.join(application, 'src/events'), { recursive: true })
  fs.writeFileSync(path.join(application, 'src/events/BookingConfirmed.ts'), `
export class BookingConfirmed {
  constructor(public readonly id: number) {}
}
`)
  fs.writeFileSync(path.join(application, 'src/events/BookingConfirmedListener.ts'), `
import { QueuedListener } from '@honovel/core'
import { BookingConfirmed } from './BookingConfirmed'
export const handledBookings: number[] = []
export class BookingConfirmedListener extends QueuedListener<BookingConfirmed> {
  async handle(event: BookingConfirmed) { handledBookings.push(event.id) }
}
`)
  fs.writeFileSync(path.join(application, 'src/features/health/controllers/HealthController.ts'), `
import { BaseUrl, Controller, Get, createDecorator, BasicAuth, Binding, Dispatcher } from '@honovel/core'
import { MainDatabase } from '../../../database/main/MainDatabase'
import { BookingConfirmed } from '../../../events/BookingConfirmed'
import { handledBookings } from '../../../events/BookingConfirmedListener'
export const DatabaseValue = createDecorator([MainDatabase], (_context, db) => db.client.value)
@BaseUrl('/health')
export class HealthController extends Controller {
  constructor(private readonly dispatcher: Dispatcher) { super() }
  @Get('/')
  show(@DatabaseValue() value: string) { return { status: 'ok', value } }
  @Get('/dispatch')
  async dispatch() {
    await this.dispatcher.dispatch(new BookingConfirmed(7))
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { handled: [...handledBookings] }
  }
  @BasicAuth({ username: 'user', password: Binding('PASSWORD') })
  @Get('/protected')
  protected() { return { ok: true } }
}
`)
  run('compile')
  const output = fs.readFileSync(path.join(application, '.honovel/app.js'), 'utf8')
  assert.match(output, /@honovel\/core\/internal\/http\/routeRuntime/)
  assert.doesNotMatch(output, /\.\/core\//)
  assert.match(output, /createListenerRegistry/)
  assert.match(output, /queued: true/)
  assert.match(output, /app\.queue = async/)
  assert.match(output, /export async function consumeQueueMessage/)
  assert.match(output, /await consumeQueueMessage\(message\.body, env, executionCtx\)/)
  const generatedType = output.match(/type: "([^"]+)", payload: [^,]+\.BookingConfirmed, listener:/)?.[1]
  assert.ok(generatedType)
  const generatedAppUrl = new URL(pathToFileURL(path.join(application, '.honovel/app.js')).href)
  generatedAppUrl.searchParams.set('compiled', String(Date.now()))
  const generatedAppModule = await import(generatedAppUrl.href)
  const generatedListenerModule = await import(pathToFileURL(path.join(application, '.honovel/src/events/BookingConfirmedListener.js')).href)
  await generatedAppModule.consumeQueueMessage(
    { type: generatedType, payload: { id: 8 } },
    { APP_DEBUG: 'false' },
  )
  assert.deepEqual(generatedListenerModule.handledBookings, [8])
  assert.doesNotMatch(fs.readFileSync(path.join(application, '.honovel/src/features/health/controllers/HealthController.js'), 'utf8'), /__decorate/)
  const require = createRequire(path.join(application, 'package.json'))
  const plugin = require('@honovel/core/typescript-plugin')
  assert.equal(typeof plugin.collectHonovelDiagnostics, 'function')
  async function loadApp(name) {
    const outfile = path.join(application, name)
    await build({ entryPoints: [path.join(application, '.honovel/index.js')], outfile,
      bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' })
    return (await import(pathToFileURL(outfile).href)).default
  }
  const development = await loadApp('development.mjs')
  const response = await development.request('/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', value: 'database-ok' })
  const dispatched = await development.request('/health/dispatch')
  assert.equal(dispatched.status, 200)
  assert.deepEqual(await dispatched.json(), { handled: [7] })
  assert.equal((await development.request('/openapi.json')).status, 200)
  assert.equal((await development.request('/health/protected', undefined, { PASSWORD: 'secret' })).status, 401)
  assert.equal((await development.request('/health/protected', { headers: { Authorization: 'Basic ' + Buffer.from('user:secret').toString('base64') } }, { PASSWORD: 'secret' })).status, 200)
  execFileSync('npm', ['run', 'build'], { cwd: application, env, stdio: 'pipe' })
  const production = await loadApp('production.mjs')
  assert.equal((await production.request('/health')).status, 200)
  assert.equal((await production.request('/openapi.json')).status, 404)
  // Resolve a runtime-only bundle and ensure compiler/Node tooling is not reachable.
  const runtime = await build({ entryPoints: [path.join(core, 'dist/index.js')], bundle: true,
    write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
  assert.ok(!Object.keys(runtime.metafile.inputs).some((file) => /typescript\/lib|drizzle-kit|honovel-build/.test(file)))
  fs.writeFileSync(path.join(application, 'src/Invalid.ts'), `import { MainDatabase } from './database/main/MainDatabase'
export class Invalid { constructor(readonly db: MainDatabase) {} query() { return this.db.client.missing } }`)
  assert.throws(() => run('typecheck'))

  console.log('[Honovel] Checking Cloudflare Nuxt starter: install, build and workerd runtime...')
  execFileSync(process.execPath, [creator, 'worker_sample', '--frontend', 'nuxt', '--no-install'], { cwd: temporary, stdio: 'pipe' })
  const workerRoot = path.join(temporary, 'worker_sample')
  const workerMetadataPath = path.join(workerRoot, 'package.json')
  const workerMetadata = JSON.parse(fs.readFileSync(workerMetadataPath, 'utf8'))
  assert.equal(workerMetadata.dependencies['@honovel/core'], records[0].version)
  assert.equal(workerMetadata.dependencies['@honovel/cloudflare'], records[1].version)
  assert.match(fs.readFileSync(path.join(workerRoot, 'agents.md'), 'utf8'), /https:\/\/honovel-docs\.lutze\.workers\.dev\/llms\.txt/)
  assert.match(fs.readFileSync(path.join(workerRoot, '.env.example'), 'utf8'), /APP_DEBUG=false/)
  assert.match(fs.readFileSync(path.join(workerRoot, '.env'), 'utf8'), /APP_DEBUG=true/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'src/env.ts'), 'utf8'), /APP_DEBUG\?: string/)
  assert.equal(workerMetadata.dependencies['@hono/node-server'], undefined)
  assert.ok(workerMetadata.devDependencies.wrangler)
  assert.equal(fs.existsSync(path.join(workerRoot, 'server.mjs')), false)
  assert.equal(fs.existsSync(path.join(workerRoot, 'scripts/bundle.mjs')), false)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/drizzle.config.ts')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'tsconfig.json'), 'utf8'), /@honovel\/core\/typescript-plugin/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/MainDatabase.ts')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/migrations/.gitkeep')))
  assert.equal(fs.existsSync(path.join(workerRoot, 'scripts')), false)
  assert.equal(fs.existsSync(path.join(workerRoot, 'src/database/main/schema/todos.ts')), false)
  workerMetadata.dependencies['@honovel/core'] = records[0].tarball
  workerMetadata.dependencies['@honovel/cloudflare'] = records[1].tarball
  fs.writeFileSync(workerMetadataPath, JSON.stringify(workerMetadata, null, 2))
  const workerConfig = JSON.parse(fs.readFileSync(path.join(workerRoot, 'wrangler.jsonc'), 'utf8'))
  assert.equal(workerConfig.name, 'worker-sample')
  assert.equal(workerConfig.main, '.honovel/index.js')
  assert.equal(workerConfig.build.command, 'honovel cloudflare:build')
  assert.deepEqual(workerConfig.compatibility_flags, ['no_nodejs_compat', 'no_nodejs_compat_v2'])
  assert.equal(workerConfig.dev, undefined)
  assert.equal(workerMetadata.scripts.dev, 'honovel cloudflare:dev')
  assert.equal(workerMetadata.scripts['dev:debug'], 'honovel cloudflare:dev --debug')
  assert.equal(workerMetadata.scripts['dev:backend'], 'honovel cloudflare:dev-backend')
  assert.equal(workerMetadata.scripts['dev:backend:debug'], 'honovel cloudflare:dev-backend --debug')
  assert.equal(workerMetadata.devDependencies.concurrently, undefined)
  assert.equal(workerConfig.assets.directory, './dist/frontend')
  assert.equal(workerConfig.assets.not_found_handling, 'single-page-application')
  assert.deepEqual(workerConfig.assets.run_worker_first, ['/api/*', '/swagger', '/openapi.json'])
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/runtime/Controller.ts')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'frontend/app/app.vue')))
  assert.deepEqual(fs.readFileSync(path.join(workerRoot, 'frontend/public/honovel-icon.png')), fs.readFileSync(path.join(root, 'docs/public/honovel-icon.png')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'frontend/app/pages/index.vue')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'frontend/nuxt.config.ts')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'frontend/nuxt.config.ts'), 'utf8'), /HONOVEL_BACKEND_DEV_URL/)
  assert.equal(workerMetadata.dependencies.nuxt, '^4.5.2')
  assert.match(workerMetadata.scripts['dev:frontend'], /nuxt dev frontend/)
  assert.match(workerMetadata.scripts['dev:frontend'], /--strictPort/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/runtime/DurableObjectCache.ts')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/runtime/CloudflareQueue.ts')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'src/runtime/CloudflareQueue.ts'), 'utf8'), /class CloudflareQueue extends BaseCloudflareQueue/)
  assert.equal(workerConfig.queues.producers.some((producer) => producer.binding === 'HONOVEL_QUEUE'), true)
  assert.equal(workerConfig.queues.consumers.some((consumer) => consumer.queue === workerConfig.name), true)
  assert.match(fs.readFileSync(path.join(workerRoot, 'src/runtime/DurableObjectCache.ts'), 'utf8'), /class DurableObjectCache extends BaseDurableObjectCache/)
  assert.equal(workerConfig.durable_objects.bindings.some((binding) => binding.name === 'HONOVEL_CACHE'), true)
  assert.equal(workerConfig.durable_objects.bindings.some((binding) => binding.name === 'HONOVEL_LOCK'), false)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/runtime/CacheLock.ts')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'src/runtime/CacheLock.ts'), 'utf8'), /class AppLock extends CacheLock/)
  assert.ok(fs.existsSync(path.join(workerRoot, '.vscode/launch.json')))
  const workerLaunch = fs.readFileSync(path.join(workerRoot, '.vscode/launch.json'), 'utf8')
  assert.match(workerLaunch, /Honovel Cloudflare \(attach\)/)
  assert.doesNotMatch(workerLaunch, /node-terminal/)
  assert.doesNotMatch(workerLaunch, /Honovel Cloudflare \(dev\)/)
  assert.equal(workerConfig.d1_databases[0].binding, 'DB')
  assert.match(workerConfig.d1_databases[0].database_id, /^00000000-0000-0000-0000-/)
  // Bindings are generated from configuration and available to typed application code.
  workerConfig.vars = { MESSAGE: 'worker-ok' }
  fs.writeFileSync(path.join(workerRoot, 'wrangler.jsonc'), JSON.stringify(workerConfig, null, 2))
  fs.writeFileSync(path.join(workerRoot, 'src/features/health/controllers/HealthController.ts'), `
import { BaseUrl, Get } from '@honovel/core'
import { Context } from 'hono'
import { Controller } from '#src/runtime/Controller'
import type { AppEnv } from '../../../env'
@BaseUrl('/health')
export class HealthController extends Controller {
  constructor(private readonly honoContext: Context<AppEnv>) { super() }
  @Get('/')
  show() { return { status: 'ok', message: this.honoContext.env.MESSAGE } }
}
`)
  fs.mkdirSync(path.join(workerRoot, 'src/cron'), { recursive: true })
  fs.writeFileSync(path.join(workerRoot, 'src/cron/CleanupCron.ts'), `
import { Cron, CronJob } from '@honovel/core'
import { Context } from 'hono'
import type { AppEnv } from '../env'
@Cron({ minute: '*/5', weekday: 'MON-FRI' })
export class CleanupCron extends CronJob {
  constructor(private readonly context: Context<AppEnv>) { super() }
  async handle() {
    if (this.context.env.MESSAGE !== 'worker-ok') throw new Error('Cron bindings were not injected.')
  }
}
`)
  const workerEnv = { ...env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(temporary, 'wrangler-logs'), CI: 'true' }
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: workerRoot, env: workerEnv, stdio: 'pipe' })
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /typegen\.mjs/)
  assert.match(workerMetadata.scripts.build, /npm run cf-typegen/)
  assert.match(workerMetadata.scripts.deploy, /npm run cf-typegen/)
  assert.match(workerMetadata.scripts.build, /cloudflare:deploy/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/compile.mjs'), 'utf8'), /HONOVEL_TYPEGEN/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/typegen.mjs'), 'utf8'), /HONOVEL_TYPEGEN/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/wrangler-build.mjs')))
  assert.doesNotMatch(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/wrangler-build.mjs'), 'utf8'), /bin\/wrangler\.js|typegen\.mjs/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev.mjs')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev-backend.mjs')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev.mjs'), 'utf8'), /HONOVEL_BACKEND_DEV_URL/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /assetsDirectory/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev.mjs'), 'utf8'), /probePort\(8788\)/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /--inspector-port', '0'/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/@honovel/core/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /--inspector-port', '9229'/)

  assert.throws(() => execFileSync('npm', ['run', 'deploy'], {
    cwd: workerRoot, env: workerEnv, stdio: 'pipe', encoding: 'utf8',
  }), (error) => {
    assert.equal(error.status, 1)
    assert.match(error.stderr, /D1 binding "DB".*placeholder database_id/)
    assert.match(error.stderr, /wrangler d1 create "worker-sample-main"/)
    assert.doesNotMatch(error.stdout, /Generating project types|building client|Compiled|Starting asset upload/)
    return true
  })
  execFileSync('npm', ['run', 'compile'], { cwd: workerRoot, env: workerEnv, stdio: 'pipe' })
  const generatedWorkerConfig = JSON.parse(fs.readFileSync(path.join(workerRoot, '.honovel.wrangler.jsonc'), 'utf8'))
  assert.deepEqual(generatedWorkerConfig.triggers.crons, ['*/5 * * * MON-FRI'])
  const redirect = JSON.parse(fs.readFileSync(path.join(workerRoot, '.wrangler/deploy/config.json'), 'utf8'))
  assert.equal(typeof redirect.configPath, 'string')
  const generatedConfigPath = path.join(workerRoot, '.honovel.wrangler.jsonc')
  const redirectConfigPath = path.join(workerRoot, '.wrangler/deploy/config.json')
  const generatedConfigMtime = fs.statSync(generatedConfigPath).mtimeMs
  const redirectConfigMtime = fs.statSync(redirectConfigPath).mtimeMs
  execFileSync('npm', ['run', 'compile'], { cwd: workerRoot, env: workerEnv, stdio: 'pipe' })
  assert.equal(fs.statSync(generatedConfigPath).mtimeMs, generatedConfigMtime)
  assert.equal(fs.statSync(redirectConfigPath).mtimeMs, redirectConfigMtime)
  const workerAppOutput = fs.readFileSync(path.join(workerRoot, '.honovel/app.js'), 'utf8')
  // The starter configures a queue consumer even without any queued listeners.
  assert.match(workerAppOutput, /app\.queue = async/)
  assert.match(workerAppOutput, /export async function runCronJob/)
  assert.match(workerAppOutput, /app\.scheduled = async/)
  assert.match(workerAppOutput, /await runCronJob\(controller\.cron, env, executionCtx\)/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'worker-configuration.d.ts'), 'utf8'), /MESSAGE/)
  assert.match(fs.readFileSync(path.join(workerRoot, '.honovel/app.js'), 'utf8'), /registerOpenApiRoutes/)
  const workerBuildLog = execFileSync('npm', ['run', 'build'], {
    cwd: workerRoot, env: workerEnv, stdio: 'pipe', encoding: 'utf8',
  })
  assert.equal((workerBuildLog.match(/\[Honovel\] Compiled /g) ?? []).length, 1)
  assert.doesNotMatch(fs.readFileSync(path.join(workerRoot, '.honovel/app.js'), 'utf8'), /registerOpenApiRoutes/)
  const workerBundle = path.join(workerRoot, 'dist/worker/index.js')
  assert.ok(fs.existsSync(workerBundle))
  assert.deepEqual(fs.readFileSync(path.join(workerRoot, 'dist/frontend/honovel-icon.png')), fs.readFileSync(path.join(root, 'docs/public/honovel-icon.png')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'dist/frontend/index.html'), 'utf8'), /href="\/honovel-icon\.png"/)
  const workerRequire = createRequire(path.join(workerRoot, 'package.json'))
  const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(workerRequire.resolve('miniflare')).href)
  const worker = new Miniflare(convertV4MiniflareOptions({
    name: workerConfig.name,
    modules: true,
    modulesRoot: path.dirname(workerBundle),
    scriptPath: workerBundle,
    compatibilityDate: workerConfig.compatibility_date,
    bindings: workerConfig.vars,
  }))
  try {
    const health = await worker.dispatchFetch('http://localhost/api/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok', message: 'worker-ok' })
    const workerService = await worker.getWorker()
    const emptyQueueBatch = await workerService.queue(workerConfig.name, [])
    assert.equal(emptyQueueBatch.outcome, 'ok')
    const scheduled = await workerService.scheduled({ cron: '*/5 * * * MON-FRI' })
    assert.equal(scheduled.outcome, 'ok')
    assert.equal((await worker.dispatchFetch('http://localhost/openapi.json')).status, 404)
  } finally {
    await worker.dispose()
  }
  console.log('[Honovel] Checking Cloudflare API-only starter without frontend dependencies...')
  execFileSync(process.execPath, [creator, 'api_sample', '--api-only', '--no-install'], { cwd: temporary, stdio: 'pipe' })
  execFileSync(process.execPath, [creator, 'api_alias', '--frontend=none', '--no-install'], { cwd: temporary, stdio: 'pipe' })
  const apiRoot = path.join(temporary, 'api_sample')
  const apiMetadataPath = path.join(apiRoot, 'package.json')
  const apiMetadata = JSON.parse(fs.readFileSync(apiMetadataPath, 'utf8'))
  const aliasMetadata = JSON.parse(fs.readFileSync(path.join(temporary, 'api_alias/package.json'), 'utf8'))
  assert.deepEqual(apiMetadata.dependencies, aliasMetadata.dependencies)
  assert.deepEqual(apiMetadata.devDependencies, aliasMetadata.devDependencies)
  assert.equal(fs.existsSync(path.join(apiRoot, 'frontend')), false)
  assert.equal(fs.existsSync(path.join(apiRoot, 'scripts')), false)
  const allApiDependencies = { ...apiMetadata.dependencies, ...apiMetadata.devDependencies }
  for (const name of ['nuxt', 'vue', 'vite', 'vue-tsc', 'tailwindcss', '@tailwindcss/vite', '@fontsource-variable/manrope', '@honovel/node', '@hono/node-server']) {
    assert.equal(allApiDependencies[name], undefined)
  }
  assert.ok(!Object.keys(apiMetadata.scripts).some((key) => key.includes('frontend')))
  assert.doesNotMatch(JSON.stringify(apiMetadata.scripts), /nuxt|frontend/)
  assert.equal(apiMetadata.scripts.dev, 'honovel cloudflare:dev-backend')
  assert.equal(apiMetadata.scripts['dev:debug'], 'honovel cloudflare:dev-backend --debug')
  const apiConfig = JSON.parse(fs.readFileSync(path.join(apiRoot, 'wrangler.jsonc'), 'utf8'))
  assert.equal(apiConfig.assets, undefined)
  assert.equal(apiConfig.d1_databases[0].binding, 'DB')
  assert.equal(apiConfig.queues.producers[0].binding, 'HONOVEL_QUEUE')
  assert.equal(apiConfig.durable_objects.bindings[0].name, 'HONOVEL_CACHE')
  apiMetadata.dependencies['@honovel/core'] = records[0].tarball
  apiMetadata.dependencies['@honovel/cloudflare'] = records[1].tarball
  fs.writeFileSync(apiMetadataPath, JSON.stringify(apiMetadata, null, 2))
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: apiRoot, env: workerEnv, stdio: 'pipe' })
  assert.equal(fs.existsSync(path.join(apiRoot, 'node_modules/nuxt')), false)
  execFileSync('npm', ['run', 'compile'], { cwd: apiRoot, env: workerEnv, stdio: 'pipe' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(apiRoot, '.honovel.wrangler.jsonc'), 'utf8')).assets, undefined)
  execFileSync('npm', ['run', 'typecheck'], { cwd: apiRoot, env: workerEnv, stdio: 'pipe' })
  execFileSync('npm', ['run', 'build'], { cwd: apiRoot, env: workerEnv, stdio: 'pipe' })
  assert.equal(fs.existsSync(path.join(apiRoot, 'dist/frontend')), false)
  const apiBundle = path.join(apiRoot, 'dist/worker/index.js')
  assert.ok(fs.existsSync(apiBundle))
  const apiWorker = new Miniflare(convertV4MiniflareOptions({
    name: apiConfig.name,
    modules: true,
    modulesRoot: path.dirname(apiBundle),
    scriptPath: apiBundle,
    compatibilityDate: apiConfig.compatibility_date,
  }))
  try {
    const health = await apiWorker.dispatchFetch('http://localhost/api/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })
    assert.equal((await apiWorker.dispatchFetch('http://localhost/')).status, 404)
    assert.equal((await apiWorker.dispatchFetch('http://localhost/openapi.json')).status, 404)
  } finally {
    await apiWorker.dispose()
  }
  // Both registry variants use the same compiled runtime. Do not rebuild after
  // testing; publish jobs receive these verified tarballs as one artifact.
  const githubDirectory = artifactDirectory ? path.join(artifactDirectory, 'github') : path.join(temporary, 'github-tarballs')
  const githubRecords = packPackages(githubDirectory, releaseVersion, { targetRegistry: githubRegistry, prebuilt: true })
  const loaded = loadPackages(githubDirectory, githubRegistry)
  assert.deepEqual(loaded.map((record) => record.name), records.map((record) => record.name))
  for (const record of githubRecords) {
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', record.tarball, 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(metadata.publishConfig.registry, githubRegistry)
    assert.equal(metadata.version, records[0].version)
  }
  const npmDirectory = path.dirname(records[0].tarball)
  assert.equal(loadPackages(npmDirectory, registry).length, 4)
  console.log(`[Honovel] Packed npm/GitHub artifacts, Node adapter, Nuxt and API-only checks passed in ${((performance.now() - started) / 1000).toFixed(1)}s.`)
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout.toString().slice(-8000))
  if (error.stderr) process.stderr.write(error.stderr.toString().slice(-8000))
  throw error
} finally {
  if (process.env.HONOVEL_KEEP_TEST_PROJECTS === '1') {
    console.log(`[Honovel] Retained test projects at ${temporary}`)
  } else {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
