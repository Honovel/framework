import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-logger-di-'))
const source = String.raw`
import { BaseUrl, Controller, Get, Logger } from '../../core'

export class FixtureService {
  static readonly serviceName = 'FixtureService'
  private readonly logger: Logger<FixtureService>

  constructor(logger: Logger<FixtureService>) {
    this.logger = logger.forService(FixtureService)
  }

  run() {
    this.logger.info('service.event', { answer: 42 })
    return { ok: true }
  }
}

@BaseUrl('/__honovel-logger')
export class LoggerController extends Controller {
  constructor(private readonly service: FixtureService) {
    super()
  }

  @Get('/')
  index() {
    return this.service.run()
  }
}
`

try {
  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(projectRoot, 'node_modules'), 'junction')
  fs.mkdirSync(path.join(projectRoot, 'src', 'controllers'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"module"}\n')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      experimentalDecorators: true,
      rootDir: '.',
      outDir: '.honovel',
    },
    include: ['index.ts', 'src/**/*.ts', 'core/**/*.ts'],
  }))
  fs.writeFileSync(path.join(projectRoot, 'index.ts'), `
import { createHonoApp } from './core'
export default createHonoApp()
`)
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/LoggerController.ts'), source)

  execFileSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
  })

  const appEntryPath = path.join(projectRoot, '.honovel/app.js')
  const generated = fs.readFileSync(appEntryPath, 'utf8')
  assert.match(generated, /import \{ Logger \} from/)
  assert.match(generated, /container\.register\(Logger, "scoped"/)
  assert.match(generated, /FixtureService\(scope\.resolve\(Logger\)\)/)

  const bundlePath = path.join(projectRoot, '.honovel/logger-di-test.mjs')
  await build({
    entryPoints: [appEntryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })

  const { registerHonovel } = await import(pathToFileURL(bundlePath).href)
  const { requestContext } = await import(
    pathToFileURL(path.join(projectRoot, '.honovel/core/http/requestContext.js')).href
  )

  const app = new Hono()
  app.use('*', requestContext({ generateRequestId: () => 'logger-request' }))
  registerHonovel(app)

  const original = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(' '))
  try {
    const response = await app.request('/__honovel-logger')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    console.log = original
  }

  assert.equal(lines.length, 1)
  const log = JSON.parse(lines[0])
  assert.equal(log.level, 'info')
  assert.equal(log.service, 'FixtureService')
  assert.equal(log.requestId, 'logger-request')
  assert.equal(log.event, 'service.event')
  assert.equal(log.answer, 42)

  console.log('[Honovel] Logger DI compiler and runtime check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
