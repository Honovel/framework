import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { packPackages, root, registry } from '../scripts/pack-packages.mjs'
import { loadPackages } from '../scripts/release.mjs'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-packages-'))
const started = performance.now()
const cacheDirectory = process.env.HONOVEL_NPM_CACHE ?? path.join(root, '.local-tests/npm-cache')
const artifactDirectory = process.env.HONOVEL_PACKAGE_ARTIFACTS && path.resolve(process.env.HONOVEL_PACKAGE_ARTIFACTS)
const env = { ...process.env, npm_config_cache: cacheDirectory }
process.env.npm_config_cache = env.npm_config_cache
try {
  const coreMetadata = JSON.parse(fs.readFileSync(path.join(root, 'core/package.json'), 'utf8'))
  const initializerMetadata = JSON.parse(fs.readFileSync(path.join(root, 'packages/create-honovel/package.json'), 'utf8'))
  const releaseVersion = process.env.HONOVEL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? '9.9.9'
  const records = packPackages(artifactDirectory ? path.join(artifactDirectory, 'npm') : path.join(temporary, 'tarballs'), releaseVersion)
  assert.deepEqual(records.map((record) => record.name), ['honovel', 'create-honovel'])
  assert.equal(records[0].version, releaseVersion.replace(/^v/, ''))
  assert.equal(records[1].version, records[0].version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'core/package.json'), 'utf8')).version, coreMetadata.version)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/create-honovel/package.json'), 'utf8')).version, initializerMetadata.version)
  for (const metadata of [coreMetadata, initializerMetadata]) {
    assert.equal(metadata.publishConfig.registry, registry)
    assert.equal(metadata.repository.url, 'git+https://github.com/Honovel/framework.git')
  }
  assert.ok(coreMetadata.exports['./cloudflare'])
  assert.equal(coreMetadata.exports['./node'], undefined)
  assert.equal(coreMetadata.dependencies.croner, undefined)
  assert.ok(!records[0].files.some((file) => /^node\//.test(file.path)))
  // Exercise npm's actual `honovel` -> `create-honovel` resolution against an
  // isolated registry serving the packed artifact. Nothing is published.
  console.log('[Honovel] Checking npm create honovel@latest against a local registry...')
  const shortInitializer = records[1]
  const shortMetadata = JSON.parse(execFileSync('tar', ['-xOf', shortInitializer.tarball, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(shortMetadata.name, 'create-honovel')
  assert.equal(shortMetadata.publishConfig.registry, registry)
  assert.deepEqual(shortMetadata.bin, initializerMetadata.bin)
  let servedInitializer = false
  const localRegistry = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    if (url.pathname === '/create-honovel') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        name: 'create-honovel',
        'dist-tags': { latest: shortInitializer.version },
        versions: {
          [shortInitializer.version]: {
            ...shortMetadata,
            dist: { tarball: `${url.origin}/create-honovel.tgz`, integrity: shortInitializer.integrity },
          },
        },
      }))
    } else if (url.pathname === '/create-honovel.tgz') {
      servedInitializer = true
      response.setHeader('content-type', 'application/octet-stream')
      fs.createReadStream(shortInitializer.tarball).pipe(response)
    } else {
      response.writeHead(404).end('{}')
    }
  })
  localRegistry.listen(0, '127.0.0.1')
  await once(localRegistry, 'listening')
  try {
    const address = localRegistry.address()
    assert.ok(address && typeof address !== 'string')
    const { stdout } = await promisify(execFile)(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'create', '--yes', `--registry=http://127.0.0.1:${address.port}`, 'honovel@latest', 'short-command-sample', '--', '--api-only', '--no-install',
    ], { cwd: temporary, env: { ...env, npm_config_cache: path.join(temporary, 'short-command-cache') }, encoding: 'utf8', timeout: 60_000 })
    assert.ok(servedInitializer)
    assert.match(stdout, /Created .*short-command-sample/)
    const shortProject = path.join(temporary, 'short-command-sample')
    const shortProjectMetadata = JSON.parse(fs.readFileSync(path.join(shortProject, 'package.json'), 'utf8'))
    assert.equal(shortProjectMetadata.dependencies['honovel'], records[0].version)
    assert.ok(!Object.keys(shortProjectMetadata.dependencies).some((name) => name.startsWith('@honovel/')))
    assert.equal(fs.existsSync(path.join(shortProject, 'frontend')), false)
    assert.equal(fs.existsSync(path.join(shortProject, 'node_modules')), false)
    assert.equal(fs.existsSync(path.join(shortProject, '.npmrc')), false)
  } finally {
    const closed = once(localRegistry, 'close')
    localRegistry.close()
    await closed
  }

  console.log('[Honovel] Checking packed initializer...')
  const cliRoot = path.join(temporary, 'cli')
  fs.mkdirSync(cliRoot)
  execFileSync('npm', ['install', '--prefix', cliRoot, '--ignore-scripts', '--no-audit', '--no-fund', shortInitializer.tarball], { env, stdio: 'pipe' })
  const creator = path.join(cliRoot, 'node_modules/create-honovel/bin/create-honovel.mjs')
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
  assert.ok(!shortInitializer.files.some(({ path: file }) => file.startsWith('template/node/')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(defaultApplication, 'wrangler.jsonc'), 'utf8')).name, 'default-sample')
  console.log('[Honovel] Checking Cloudflare Nuxt starter: install, build and workerd runtime...')
  execFileSync(process.execPath, [creator, 'worker_sample', '--frontend', 'nuxt', '--no-install'], { cwd: temporary, stdio: 'pipe' })
  const workerRoot = path.join(temporary, 'worker_sample')
  const workerMetadataPath = path.join(workerRoot, 'package.json')
  const workerMetadata = JSON.parse(fs.readFileSync(workerMetadataPath, 'utf8'))
  assert.equal(workerMetadata.dependencies['honovel'], records[0].version)
  assert.match(fs.readFileSync(path.join(workerRoot, 'agents.md'), 'utf8'), /https:\/\/honovel\.github\.io\/framework\/llms\.txt/)
  assert.match(fs.readFileSync(path.join(workerRoot, '.env.example'), 'utf8'), /APP_DEBUG=false/)
  assert.match(fs.readFileSync(path.join(workerRoot, '.env'), 'utf8'), /APP_DEBUG=true/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'src/env.ts'), 'utf8'), /APP_DEBUG\?: string/)
  assert.equal(workerMetadata.dependencies['@hono/node-server'], undefined)
  assert.ok(workerMetadata.devDependencies.wrangler)
  assert.equal(fs.existsSync(path.join(workerRoot, 'server.mjs')), false)
  assert.equal(fs.existsSync(path.join(workerRoot, 'scripts/bundle.mjs')), false)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/drizzle.config.ts')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'tsconfig.json'), 'utf8'), /honovel\/typescript-plugin/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/MainDatabase.ts')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/database/main/migrations/.gitkeep')))
  assert.equal(fs.existsSync(path.join(workerRoot, 'scripts')), false)
  assert.equal(fs.existsSync(path.join(workerRoot, 'src/database/main/schema/todos.ts')), false)
  workerMetadata.dependencies['honovel'] = records[0].tarball
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
  assert.equal(workerMetadata.dependencies.nuxt, '^4.6.4')
  assert.equal(workerMetadata.devDependencies.wrangler, '4.158.0')
  assert.equal(workerMetadata.overrides['@esbuild-kit/core-utils'].esbuild, '^0.25.12')
  assert.equal(workerMetadata.overrides['@vercel/nft'].glob, '^14.0.2')
  assert.equal(workerMetadata.overrides['readdir-glob'].minimatch, '^11.0.1')
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
import { BaseUrl, Get, Cache, Queue, createDecorator, BasicAuth, Binding, defineDatabase } from 'honovel'
import { BaseDurableObjectCache, BaseCloudflareQueue, ClientIp } from 'honovel/cloudflare'
import { Context } from 'hono'
import { Controller } from '#src/runtime/Controller'
import type { AppEnv } from '../../../env'
export class ProbeDatabase extends defineDatabase(() => ({ value: 'database-ok' })) {}
export const DatabaseValue = createDecorator([ProbeDatabase], (_context, database) => database.client.value)
@BaseUrl('/health')
export class HealthController extends Controller {
  constructor(private readonly honoContext: Context<AppEnv>) { super() }
  @Get('/')
  show() { return { status: 'ok', message: this.honoContext.env.MESSAGE } }
  @Get('/identity')
  identity() {
    return {
      cache: BaseDurableObjectCache.prototype instanceof Cache,
      queue: BaseCloudflareQueue.prototype instanceof Queue,
    }
  }
  @Get('/ip')
  ip(@ClientIp({ trustForwardedFor: true }) address: string) { return { address } }
  @Get('/database')
  database(@DatabaseValue() value: string) { return { value } }
  @BasicAuth({ username: 'user', password: Binding('MESSAGE') })
  @Get('/protected')
  protected() { return { ok: true } }
}
`)
  fs.mkdirSync(path.join(workerRoot, 'src/cron'), { recursive: true })
  fs.writeFileSync(path.join(workerRoot, 'src/cron/CleanupCron.ts'), `
import { Cron, CronJob } from 'honovel'
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
  const installedCore = path.join(workerRoot, 'node_modules/honovel')
  const installedRequire = createRequire(path.join(workerRoot, 'package.json'))
  assert.equal(typeof installedRequire('honovel/typescript-plugin').collectHonovelDiagnostics, 'function')
  assert.ok(fs.existsSync(path.join(installedCore, 'typescript-plugin/index.cjs')))
  assert.equal(installedRequire(path.join(installedCore, 'typescript-plugin/index.cjs')), installedRequire('honovel/typescript-plugin'))
  assert.throws(() => installedRequire.resolve('honovel/node'), /not defined by "exports"/)
  const runtime = await build({ entryPoints: [path.join(installedCore, 'dist/index.js')], bundle: true,
    write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
  assert.ok(!Object.keys(runtime.metafile.inputs).some((file) => /typescript\/lib|drizzle-kit|honovel-build|\/cloudflare\/|croner/.test(file)))
  assert.ok(!runtime.outputFiles.some((file) => file.text.includes('cloudflare:workers')))
  // Exercise generator paths from the installed package, without copied helpers.
  execFileSync(process.execPath, [path.join(installedCore, 'cli/honovel.mjs'), 'make:feature', 'users'], { cwd: workerRoot, stdio: 'pipe' })
  assert.ok(fs.existsSync(path.join(workerRoot, 'src/features/users/dto/requests')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /typegen\.mjs/)
  assert.match(workerMetadata.scripts.build, /npm run cf-typegen/)
  assert.match(workerMetadata.scripts.deploy, /npm run cf-typegen/)
  assert.match(workerMetadata.scripts.build, /cloudflare:deploy/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/compile.mjs'), 'utf8'), /HONOVEL_TYPEGEN/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/typegen.mjs'), 'utf8'), /HONOVEL_TYPEGEN/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/wrangler-build.mjs')))
  assert.doesNotMatch(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/wrangler-build.mjs'), 'utf8'), /bin\/wrangler\.js|typegen\.mjs/)
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev.mjs')))
  assert.ok(fs.existsSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev-backend.mjs')))
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev.mjs'), 'utf8'), /HONOVEL_BACKEND_DEV_URL/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /assetsDirectory/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev.mjs'), 'utf8'), /probePort\(8788\)/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /--inspector-port["'], ["']0["']/)
  assert.match(fs.readFileSync(path.join(workerRoot, 'node_modules/honovel/cli/project/cloudflare/dev-backend.mjs'), 'utf8'), /--inspector-port["'], ["']9229["']/)

  assert.throws(() => execFileSync('npm', ['run', 'deploy'], {
    cwd: workerRoot, env: workerEnv, stdio: 'pipe', encoding: 'utf8',
  }), (error: NodeJS.ErrnoException & { status?: number; stdout?: string; stderr?: string }) => {
    assert.equal(error.status, 1)
    assert.match(error.stderr ?? '', /D1 binding "DB".*placeholder database_id/)
    assert.match(error.stderr ?? '', /wrangler d1 create "worker-sample-main"/)
    assert.doesNotMatch(error.stdout ?? '', /Generating project types|building client|Compiled|Starting asset upload/)
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
  assert.match(workerAppOutput, /honovel\/internal\/http\/routeRuntime/)
  assert.doesNotMatch(workerAppOutput, /\.\/core\//)
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
    const identity = await worker.dispatchFetch('http://localhost/api/health/identity')
    assert.deepEqual(await identity.json(), { cache: true, queue: true })
    const ip = await worker.dispatchFetch('http://localhost/api/health/ip', { headers: { 'X-Forwarded-For': '203.0.113.42' } })
    // The local Workers runtime supplies CF-Connecting-IP itself. It must take
    // precedence over the request's forwarded header.
    assert.deepEqual(await ip.json(), { address: '127.0.0.1' })
    const database = await worker.dispatchFetch('http://localhost/api/health/database')
    assert.deepEqual(await database.json(), { value: 'database-ok' })
    assert.equal((await worker.dispatchFetch('http://localhost/api/health/protected')).status, 401)
    assert.equal((await worker.dispatchFetch('http://localhost/api/health/protected', {
      headers: { Authorization: 'Basic ' + Buffer.from('user:worker-ok').toString('base64') },
    })).status, 200)
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
  apiMetadata.dependencies['honovel'] = records[0].tarball
  fs.writeFileSync(apiMetadataPath, JSON.stringify(apiMetadata, null, 2))
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: apiRoot, env: workerEnv, stdio: 'pipe' })
  assert.equal(fs.existsSync(path.join(apiRoot, 'node_modules/nuxt')), false)
  assert.equal(fs.existsSync(path.join(apiRoot, 'node_modules/croner')), false)
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
  const npmDirectory = path.dirname(records[0].tarball)
  assert.deepEqual(loadPackages(npmDirectory).map((record) => record.name), ['honovel', 'create-honovel'])
  console.log(`[Honovel] Packed npm artifacts, Nuxt and API-only checks passed in ${((performance.now() - started) / 1000).toFixed(1)}s.`)
} catch (error) {
  if (error && typeof error === 'object' && 'stdout' in error && error.stdout) process.stderr.write(error.stdout.toString().slice(-8000))
  if (error && typeof error === 'object' && 'stderr' in error && error.stderr) process.stderr.write(error.stderr.toString().slice(-8000))
  throw error
} finally {
  if (process.env.HONOVEL_KEEP_TEST_PROJECTS === '1') {
    console.log(`[Honovel] Retained test projects at ${temporary}`)
  } else {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
