import assert from 'node:assert/strict'
import { Context, Hono } from 'hono'
import { HonoRequest } from 'hono/request'
import { Container } from '#honovel-test/di/Container.js'
import { bindControllerContext, Controller } from '#honovel-test/http/Controller.js'
import { FormRequest } from '#honovel-test/http/FormRequest.js'
import type { FormRequestConstructor } from '../core/http/FormRequest.js'
import {
  createCompiledFormRequest,
  createCompiledRequestScope,
  normalizeCompiledResult,
  readCompiledBody,
} from '#honovel-test/http/routeRuntime.js'

const seenContexts: Context[] = []
const seenRequests: HonoRequest[] = []

class ContextService {
  constructor(readonly context: Context) {}

  describe() {
    return {
      binding: this.context.env.TEST_BINDING,
      url: this.context.req.url,
    }
  }
}

class ContextController extends Controller {
  constructor(readonly service: ContextService) {
    super()
  }

  index() {
    return this.service.describe()
  }
}

class RequestService {
  constructor(readonly request: HonoRequest) {}
}

class RequestController extends Controller {
  constructor(readonly service: RequestService) {
    super()
  }

  raw(request) {
    return {
      sameRequest: request === this.service.request,
      requestId: request.header('x-request-id'),
      path: request.path,
    }
  }

  store(request) {
    return {
      sameRequest: request.req === this.service.request,
      requestId: request.req.header('x-request-id'),
      title: request.title,
    }
  }
}

class CreateRequest extends FormRequest({
  safeParse(input) {
    if (typeof input !== 'object' || input === null || !('title' in input) || typeof input.title !== 'string') {
      return { success: false as const, error: { issues: [{ path: ['title'], message: 'Required' }] } }
    }

    return { success: true as const, data: { title: input.title } }
  },
}) {}

let waitUntilCalls = 0
const execution = {
  waitUntil() {
    waitUntilCalls += 1
  },
  passThroughOnException() {},
  props: {},
}

const app = new Hono()
const container = new Container()
container.register(ContextService, 'scoped', (scope) => {
  const context = scope.resolve(Context)
  seenContexts.push(context)
  return new ContextService(context)
})
container.register(ContextController, 'scoped', (scope) => new ContextController(scope.resolve(ContextService)))
container.register(RequestService, 'scoped', (scope) => {
  const request = scope.resolve(HonoRequest)
  seenRequests.push(request)
  return new RequestService(request)
})
container.register(RequestController, 'scoped', (scope) => new RequestController(scope.resolve(RequestService)))

app.get('/context', async (context) => {
  const scope = createCompiledRequestScope(container, context)
  const controller = scope.resolve(ContextController)
  bindControllerContext(controller, context)
  return normalizeCompiledResult(context, await controller.index())
})

app.get('/request', async (context) => {
  const scope = createCompiledRequestScope(container, context)
  const controller = scope.resolve(RequestController)
  bindControllerContext(controller, context)
  const arg0 = context.req
  return normalizeCompiledResult(context, await controller.raw(arg0))
})

app.post('/form', async (context) => {
  const scope = createCompiledRequestScope(container, context)
  const controller = scope.resolve(RequestController)
  bindControllerContext(controller, context)
  const bodyInput = await readCompiledBody(context)
  const arg0 = await createCompiledFormRequest(context, CreateRequest as FormRequestConstructor, bodyInput, 'body')
  return normalizeCompiledResult(context, await controller.store(arg0))
})

const first = await app.request(
  'https://example.com/context',
  undefined,
  { TEST_BINDING: 'first' },
  execution,
)
assert.equal(first.status, 200)
assert.deepEqual(await first.json(), {
  binding: 'first',
  url: 'https://example.com/context',
})

const second = await app.request(
  'https://example.com/context',
  undefined,
  { TEST_BINDING: 'second' },
  execution,
)
assert.equal(second.status, 200)
assert.deepEqual(await second.json(), {
  binding: 'second',
  url: 'https://example.com/context',
})

seenContexts[0].executionCtx.waitUntil(Promise.resolve())
seenContexts[1].executionCtx.waitUntil(Promise.resolve())
assert.equal(waitUntilCalls, 2)
assert.notStrictEqual(seenContexts[0], seenContexts[1], 'Hono Context must be unique per HTTP request.')
assert.equal(seenContexts[0].env.TEST_BINDING, 'first')
assert.equal(seenContexts[1].env.TEST_BINDING, 'second')

const nodeStyle = await app.request(
  'https://example.com/context',
  undefined,
  { TEST_BINDING: 'node-style' },
)
assert.equal(nodeStyle.status, 200)
assert.deepEqual(await nodeStyle.json(), {
  binding: 'node-style',
  url: 'https://example.com/context',
})
assert.equal(seenContexts[2].env.TEST_BINDING, 'node-style')
assert.throws(() => seenContexts[2].executionCtx, /ExecutionContext|execution context/i)

const raw = await app.request('https://example.com/request', {
  headers: { 'x-request-id': 'raw-request' },
})
assert.equal(raw.status, 200)
assert.deepEqual(await raw.json(), {
  sameRequest: true,
  requestId: 'raw-request',
  path: '/request',
})

const form = await app.request('https://example.com/form', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-request-id': 'form-request',
  },
  body: JSON.stringify({ title: 'Test' }),
})
assert.equal(form.status, 200)
assert.deepEqual(await form.json(), {
  sameRequest: true,
  requestId: 'form-request',
  title: 'Test',
})
assert.notStrictEqual(seenRequests[0], seenRequests[1], 'HonoRequest must be unique per HTTP request.')
assert.throws(
  () => new CreateRequest({ req: 'reserved' } as unknown as { title: string }, seenRequests[0]),
  /FormRequest field "req" is reserved by Honovel/,
)
const request = new CreateRequest({ title: 'Test' }, seenRequests[0])
assert.equal('all' in request, false)
assert.equal('input' in request, false)
assert.equal(request.title, 'Test')
assert.deepEqual(request.validated(), { title: 'Test' })

class AllFieldRequest extends FormRequest({
  safeParse() {
    return { success: true as const, data: { all: true } }
  },
}) {}
const allFieldRequest = new AllFieldRequest({ all: true }, seenRequests[0])
assert.equal(allFieldRequest.all, true)
assert.deepEqual(allFieldRequest.validated(), { all: true })

class InputFieldRequest extends FormRequest({
  safeParse() {
    return { success: true as const, data: { input: 'value' } }
  },
}) {}
const inputFieldRequest = new InputFieldRequest({ input: 'value' }, seenRequests[0])
assert.equal(inputFieldRequest.input, 'value')
assert.deepEqual(inputFieldRequest.validated(), { input: 'value' })

console.log('[Honovel] Hono Context and HonoRequest DI runtime check passed.')
