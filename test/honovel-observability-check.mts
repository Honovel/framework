import type { ContentfulStatusCode } from 'hono/utils/http-status'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import {
  HttpException,
  Logger,
  TooManyRequestsException,
  registerExceptionHandler,
  requestContext,
  setErrorRenderer,
} from '#honovel-test/index.js'

function captureConsole(method, run) {
  const original = console[method]
  const lines: string[] = []
  console[method] = (...args) => lines.push(args.join(' '))
  return Promise.resolve(run()).finally(() => {
    console[method] = original
  }).then(() => lines)
}

const app = new Hono()
app.use('*', requestContext({ generateRequestId: () => 'request-1' }))
app.get('/ok', (context) => context.json({ ok: true }))
app.get('/limited', () => {
  throw new TooManyRequestsException('Slow down', 12)
})
app.get('/boom', () => {
  throw new Error('fixture failure')
})
app.get('/log', (context) => {
  Logger.named(context, 'FixtureService').info('Fixture message', 'fixture.event', { answer: 42 })
  return context.json({ ok: true })
})
const loggerMethods = ['debug', 'info', 'warn', 'error', 'audit'] as const
for (const method of loggerMethods) {
  app.get(`/overloads/${method}`, (context) => {
    const logger = Logger.named(context, 'OverloadService')
    const fields = {
      custom: { answer: 42 },
      event: 'spoofed', message: 'spoofed', level: 'spoofed', kind: 'spoofed',
      service: 'spoofed', requestId: 'spoofed', timestamp: 'spoofed',
    }
    logger[method]('My message', 'cleanup.complete', fields)
    logger[method]('My message', fields)
    logger[method]('My message', 'cleanup.complete')
    logger[method]('My message')
    return context.json({ ok: true })
  })
}
registerExceptionHandler(app)

const ok = await app.request('/ok')
assert.equal(ok.status, 200)
assert.equal(ok.headers.get('x-request-id'), 'request-1')
assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
assert.equal(ok.headers.get('referrer-policy'), 'no-referrer')

const warnLines = await captureConsole('warn', async () => {
  const response = await app.request('/limited')
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '12')
  assert.equal(response.headers.get('x-request-id'), 'request-1')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(await response.json(), {
    message: 'Slow down',
    retryAfterSeconds: 12,
  })
})
assert.equal(warnLines.length, 1)
const warn = JSON.parse(warnLines[0])
assert.equal(warn.level, 'warn')
assert.equal(warn.kind, 'log')
assert.equal(warn.service, 'RequestContext')
assert.equal(warn.requestId, 'request-1')
assert.equal(warn.event, 'http.request')
assert.equal(warn.status, 429)

const errorLines = await captureConsole('error', async () => {
  const response = await app.request('/boom')
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('x-request-id'), 'request-1')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { message: 'Internal Server Error' })
})
assert.equal(errorLines.length, 1)
const error = JSON.parse(errorLines[0])
assert.equal(error.level, 'error')
assert.equal(error.service, 'ExceptionHandler')
assert.equal(error.requestId, 'request-1')
assert.equal(error.event, 'http.exception')
assert.equal(error.message, 'fixture failure')
assert.equal(error.exception, 'Error')

const logLines = await captureConsole('log', async () => {
  const response = await app.request('/log')
  assert.equal(response.status, 200)
})
assert.equal(logLines.length, 1)
const log = JSON.parse(logLines[0])
assert.equal(log.level, 'info')
assert.equal(log.kind, 'log')
assert.equal(log.service, 'FixtureService')
assert.equal(log.requestId, 'request-1')
assert.equal(log.event, 'fixture.event')
assert.equal(log.message, 'Fixture message')
assert.equal(log.answer, 42)

for (const method of loggerMethods) {
  const consoleMethod = method === 'info' || method === 'audit' ? 'log' : method
  const lines = await captureConsole(consoleMethod, async () => {
    const response = await app.request(`/overloads/${method}`)
    assert.equal(response.status, 200)
  })
  assert.equal(lines.length, 4)
  for (const [index, line] of lines.entries()) {
    const entry = JSON.parse(line)
    assert.equal(entry.message, 'My message')
    assert.equal(entry.event, index % 2 === 0 ? 'cleanup.complete' : 'log')
    assert.equal(entry.level, method === 'audit' ? 'info' : method)
    assert.equal(entry.kind, method === 'audit' ? 'audit' : 'log')
    assert.equal(entry.service, 'OverloadService')
    assert.equal(entry.requestId, 'request-1')
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)))
    if (index < 2) assert.deepEqual(entry.custom, { answer: 42 })
    else assert.equal(Object.hasOwn(entry, 'custom'), false)
  }
}

const customApp = new Hono()
customApp.use('*', requestContext({ generateRequestId: () => 'request-2' }))
customApp.get('/custom', () => {
  throw new HttpException(
    418,
    'Teapot',
    { message: 'teapot body' },
    { 'X-Custom-Error': 'yes' },
  )
})
setErrorRenderer(customApp, (context, _error, details) => context.json({
  error: {
    status: details.status,
    message: details.message,
    requestId: details.requestId,
  },
}, details.status as ContentfulStatusCode))
registerExceptionHandler(customApp)

const custom = await customApp.request('/custom')
assert.equal(custom.status, 418)
assert.equal(custom.headers.get('x-request-id'), 'request-2')
assert.equal(custom.headers.get('x-custom-error'), 'yes')
assert.deepEqual(await custom.json(), {
  error: {
    status: 418,
    message: 'Teapot',
    requestId: 'request-2',
  },
})

const browser = await customApp.request('/custom', {
  headers: { Accept: 'text/html,application/xhtml+xml' },
})
assert.equal(browser.status, 418)
assert.match(browser.headers.get('content-type') ?? '', /text\/html/)
assert.match(await browser.text(), /418 · Im a Teapot|418 · Request Failed|418/)

console.log('[Honovel] Request context, logger and error renderer check passed.')
