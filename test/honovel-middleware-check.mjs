import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { HTTPException as HonoHTTPException } from 'hono/http-exception'
import { Container } from '../.honovel/core/di/Container.js'
import { bindControllerContext, Controller } from '../.honovel/core/http/Controller.js'
import { BaseMiddleware } from '../.honovel/core/http/Middleware.js'
import { NotFoundException, registerExceptionHandler } from '../.honovel/core/http/exceptions.js'
import {
  createCompiledRequestScope,
  normalizeCompiledResult,
  runCompiledMiddlewareChain,
} from '../.honovel/core/http/routeRuntime.js'
import { ValidationException } from '../.honovel/core/http/validation.js'

const order = []

class BaseControllerMiddleware extends BaseMiddleware {
  async handle(_context, next) {
    order.push('base:before')
    const response = await next()
    order.push('base:after')
    return response
  }
}

class ControllerMiddleware extends BaseMiddleware {
  async handle(_context, next) {
    order.push('controller:before')
    const response = await next()
    order.push('controller:after')
    return response
  }
}

class MethodMiddleware extends BaseMiddleware {
  async handle(_context, next) {
    order.push('method:before')
    const response = await next()
    order.push('method:after')
    return response
  }
}

class TestController extends Controller {
  index() {
    order.push('handler')
    return this.json({ ok: true })
  }

  missing() {
    throw new NotFoundException('Missing fixture')
  }

  invalid() {
    throw new ValidationException(
      [{ message: 'The title is required.', path: ['title'] }],
      'body',
    )
  }

  nativeUnauthorized() {
    throw new HonoHTTPException(401, { message: 'Native unauthorized' })
  }

  unexpected() {
    throw new Error('Unexpected fixture')
  }
}

const app = new Hono()
const container = new Container()
container.register(BaseControllerMiddleware, 'scoped', () => new BaseControllerMiddleware())
container.register(ControllerMiddleware, 'scoped', () => new ControllerMiddleware())
container.register(MethodMiddleware, 'scoped', () => new MethodMiddleware())
container.register(TestController, 'scoped', () => new TestController())
registerExceptionHandler(app)

function registerStaticTestRoute(path, middleware, invoke) {
  app.get(path, async (context) => {
    const scope = createCompiledRequestScope(container, context)

    return runCompiledMiddlewareChain(context, scope, middleware, async () => {
      const controller = scope.resolve(TestController)
      bindControllerContext(controller, context)
      return normalizeCompiledResult(context, await invoke(controller))
    })
  })
}

registerStaticTestRoute(
  '/middleware',
  [BaseControllerMiddleware, ControllerMiddleware, MethodMiddleware],
  (controller) => controller.index(),
)
registerStaticTestRoute('/missing', [], (controller) => controller.missing())
registerStaticTestRoute('/invalid', [], (controller) => controller.invalid())
registerStaticTestRoute('/native-unauthorized', [], (controller) => controller.nativeUnauthorized())
registerStaticTestRoute('/unexpected', [], (controller) => controller.unexpected())

const middlewareResponse = await app.request('/middleware')
assert.equal(middlewareResponse.status, 200)
assert.deepEqual(await middlewareResponse.json(), { ok: true })
assert.deepEqual(order, [
  'base:before',
  'controller:before',
  'method:before',
  'handler',
  'method:after',
  'controller:after',
  'base:after',
])

const missingResponse = await app.request('/missing')
assert.equal(missingResponse.status, 404)
assert.deepEqual(await missingResponse.json(), { message: 'Missing fixture' })

const invalidResponse = await app.request('/invalid')
assert.equal(invalidResponse.status, 422)
assert.deepEqual(await invalidResponse.json(), {
  message: 'The given data was invalid.',
  errors: { title: ['The title is required.'] },
})

const nativeUnauthorizedResponse = await app.request('/native-unauthorized')
assert.equal(nativeUnauthorizedResponse.status, 401)
assert.equal(await nativeUnauthorizedResponse.text(), 'Native unauthorized')

const unexpectedResponse = await app.request('/unexpected')
assert.equal(unexpectedResponse.status, 500)
assert.deepEqual(await unexpectedResponse.json(), { message: 'Internal Server Error' })

const debugUnexpectedResponse = await app.request('/unexpected', undefined, { APP_DEBUG: 'true' })
assert.equal(debugUnexpectedResponse.status, 500)
const debugUnexpectedBody = await debugUnexpectedResponse.json()
assert.equal(debugUnexpectedBody.message, 'Unexpected fixture')
assert.equal(debugUnexpectedBody.exception, 'Error')
assert.match(debugUnexpectedBody.stack, /Unexpected fixture/)

const browserHeaders = { headers: { Accept: 'text/html,application/xhtml+xml' } }

const browserMissingResponse = await app.request('/missing', browserHeaders)
assert.equal(browserMissingResponse.status, 404)
assert.match(browserMissingResponse.headers.get('content-type') ?? '', /text\/html/)
const browserMissingBody = await browserMissingResponse.text()
assert.match(browserMissingBody, /404 · Not Found/)
assert.match(browserMissingBody, /Missing fixture/)

const browserInvalidResponse = await app.request('/invalid', browserHeaders)
assert.equal(browserInvalidResponse.status, 422)
const browserInvalidBody = await browserInvalidResponse.text()
assert.match(browserInvalidBody, /Validation errors/)
assert.match(browserInvalidBody, /title/)
assert.match(browserInvalidBody, /The title is required\./)

const browserNativeResponse = await app.request('/native-unauthorized', browserHeaders)
assert.equal(browserNativeResponse.status, 401)
assert.match(await browserNativeResponse.text(), /Native unauthorized/)

const browserUnexpectedResponse = await app.request('/unexpected', browserHeaders)
assert.equal(browserUnexpectedResponse.status, 500)
const browserUnexpectedBody = await browserUnexpectedResponse.text()
assert.match(browserUnexpectedBody, /Internal Server Error/)
assert.doesNotMatch(browserUnexpectedBody, /Unexpected fixture/)
assert.doesNotMatch(browserUnexpectedBody, /Debug details/)
assert.match(browserUnexpectedBody, /<h1>Internal Server Error<\/h1>/)

const browserDebugUnexpectedResponse = await app.request('/unexpected', browserHeaders, { APP_DEBUG: 'true' })
assert.equal(browserDebugUnexpectedResponse.status, 500)
const browserDebugUnexpectedBody = await browserDebugUnexpectedResponse.text()
assert.match(browserDebugUnexpectedBody, /Unexpected fixture/)
assert.match(browserDebugUnexpectedBody, /Debug details/)
assert.match(browserDebugUnexpectedBody, /Error/)
assert.match(browserDebugUnexpectedBody, /<div class="status">500 · Internal Server Error<\/div>/)
assert.match(browserDebugUnexpectedBody, /<h1>Error<\/h1>/)
assert.match(browserDebugUnexpectedBody, /<p class="message">Unexpected fixture<\/p>/)
assert.match(browserDebugUnexpectedBody, /data-copy-stack/)
assert.match(browserDebugUnexpectedBody, /data-stacktrace/)
assert.match(browserDebugUnexpectedBody, /navigator\.clipboard\.writeText/)

const explicitJsonResponse = await app.request('/unexpected', { headers: { Accept: 'application/json,text/html' } }, { APP_DEBUG: 'true' })
assert.match(explicitJsonResponse.headers.get('content-type') ?? '', /application\/json/)
assert.equal((await explicitJsonResponse.json()).exception, 'Error')

console.log('[Honovel] Middleware and exception runtime check passed.')
