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
import { Context } from 'hono'
import { BaseUrl, Controller, Cron, CronJob, Get, Logger, Queue, QueuedListener, Scope } from '../../core'

@Cron({ minute: '*/5' })
export class CronLogJob extends CronJob {
  constructor(private readonly logger: Logger, private readonly context: Context) {
    super()
  }

  async handle() {
    this.logger.info('Starting scheduled cleanup', 'cron.injected')
    Logger.named(this.context, 'CleanupWorker').info('cron.named', 'cron.named')
  }
}

export class QueuePayload {
  constructor(public readonly jobId: number) {}
}

@Scope({ provides: Queue })
export class TestQueue extends Queue {
  async enqueue() {}
}

export class QueueLogListener extends QueuedListener<QueuePayload> {
  constructor(private readonly logger: Logger, private readonly context: Context) {
    super()
  }

  async handle(event: QueuePayload) {
    this.logger.info('queue.injected', 'queue.injected', { jobId: event.jobId })
    Logger.named(this.context, 'QueueWorker').info('queue.named', 'queue.named', { jobId: event.jobId })
  }
}

export class FixtureService {
  static readonly serviceName = 'CustomFixtureService'
  constructor(private readonly logger: Logger) {}

  run() {
    this.logger.info('service.event', 'service.event', { answer: 42 })
    return { ok: true }
  }
}

export class OtherService {
  constructor(private readonly logger: Logger) {}

  run() {
    this.logger.info('other.event', 'other.event')
    this.logger.forService('ExplicitName').info('explicit.event', 'explicit.event')
    this.logger.info('other.after', 'other.after')
  }
}

@BaseUrl('/__honovel-logger')
export class LoggerController extends Controller {
  constructor(
    private readonly service: FixtureService,
    private readonly other: OtherService,
    private readonly logger: Logger,
  ) {
    super()
    this.logger.info('controller.constructed', 'controller.constructed')
  }

  @Get('/')
  index() {
    this.other.run()
    this.logger.info('controller.event', 'controller.event')
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
  assert.match(generated, /FixtureService\(scope\.resolve\(Logger\)\.forService\(M\d+\.FixtureService\.serviceName \?\? "FixtureService"\)\)/)

  const bundlePath = path.join(projectRoot, '.honovel/logger-di-test.mjs')
  await build({
    entryPoints: [appEntryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    logLevel: 'silent',
  })

  const { registerHonovel, consumeQueueMessage, runCronJob } = await import(pathToFileURL(bundlePath).href)
  const { requestContext } = await import(
    pathToFileURL(path.join(projectRoot, '.honovel/core/http/requestContext.js')).href
  )

  const app = new Hono()
  let requestNumber = 0
  app.use('*', requestContext({ generateRequestId: () => `logger-request-${++requestNumber}` }))
  registerHonovel(app)

  const original = console.log
  const lines: string[] = []
  console.log = (...args) => lines.push(args.join(' '))
  try {
    for (let request = 0; request < 2; request++) {
      const response = await app.request('/__honovel-logger')
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
    }
  } finally {
    console.log = original
  }

  const expected = [
    ['controller.constructed', 'LoggerController'],
    ['other.event', 'OtherService'],
    ['explicit.event', 'ExplicitName'],
    ['other.after', 'OtherService'],
    ['controller.event', 'LoggerController'],
    ['service.event', 'CustomFixtureService'],
  ]
  assert.equal(lines.length, expected.length * 2)
  const logs = lines.map((line) => JSON.parse(line))
  for (const [index, log] of logs.entries()) {
    const [event, service] = expected[index % expected.length]
    assert.equal(log.level, 'info')
    assert.equal(log.service, service)
    assert.equal(log.requestId, `logger-request-${Math.floor(index / expected.length) + 1}`)
    assert.equal(log.event, event)
    assert.equal(log.message, event)
    if (event === 'service.event') assert.equal(log.answer, 42)
  }

  const queueLines: string[] = []
  console.log = (...args) => queueLines.push(args.join(' '))
  try {
    for (const jobId of [1, 2]) {
      await consumeQueueMessage({
        type: 'src/controllers/LoggerController#QueuePayload',
        payload: { jobId },
      })
    }
  } finally {
    console.log = original
  }
  assert.equal(queueLines.length, 4)
  for (const [index, line] of queueLines.entries()) {
    const log = JSON.parse(line)
    assert.equal(log.level, 'info')
    assert.equal(log.event, index % 2 === 0 ? 'queue.injected' : 'queue.named')
    assert.equal(log.service, index % 2 === 0 ? 'QueueLogListener' : 'QueueWorker')
    assert.equal(log.jobId, Math.floor(index / 2) + 1)
    assert.equal(Object.hasOwn(log, 'requestId'), false)
  }

  const cronLines: string[] = []
  console.log = (...args) => cronLines.push(args.join(' '))
  try {
    await runCronJob('*/5 * * * *')
    await runCronJob('*/5 * * * *')
  } finally {
    console.log = original
  }
  assert.equal(cronLines.length, 4)
  for (const [index, line] of cronLines.entries()) {
    const log = JSON.parse(line)
    assert.equal(log.level, 'info')
    assert.equal(log.event, index % 2 === 0 ? 'cron.injected' : 'cron.named')
    assert.equal(log.service, index % 2 === 0 ? 'CronLogJob' : 'CleanupWorker')
    assert.equal(Object.hasOwn(log, 'requestId'), false)
    if (index % 2 === 0) assert.equal(log.message, 'Starting scheduled cleanup')
  }

  console.log('[Honovel] Logger DI compiler and runtime check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
