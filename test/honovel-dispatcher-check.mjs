import assert from 'node:assert/strict'
import { Context } from 'hono'
import { Container } from '../.honovel/core/di/Container.js'
import { Dispatcher, createListenerRegistry } from '../.honovel/core/dispatch/Dispatcher.js'
import { Listener, QueuedListener } from '../.honovel/core/dispatch/Listener.js'
import { Queue } from '../.honovel/core/queue/Queue.js'

class SyncPayload {
  constructor(id) { this.id = id }
}
class QueuedPayload {
  constructor(id) { this.id = id }
}

const seen = []
class SyncPayloadListener extends Listener {
  async handle(payload) { seen.push(['sync', payload instanceof SyncPayload, payload.id]) }
}
class QueuedPayloadListener extends QueuedListener {
  async handle(payload) { seen.push(['queued', payload instanceof QueuedPayload, payload.id]) }
}

class TestQueue extends Queue {
  messages = []
  async enqueue(message, delaySeconds = 0, localConsumer) {
    this.messages.push({ message, delaySeconds })
    if (localConsumer && delaySeconds === 0) await localConsumer(message)
  }
}

const container = new Container()
const queue = new TestQueue()
container.register(Queue, 'scoped', () => queue)
container.register(SyncPayloadListener, 'scoped', () => new SyncPayloadListener())
container.register(QueuedPayloadListener, 'scoped', () => new QueuedPayloadListener())

const registry = createListenerRegistry([
  { type: 'sync', payload: SyncPayload, listener: SyncPayloadListener, queued: false },
  { type: 'queued', payload: QueuedPayload, listener: QueuedPayloadListener, queued: true },
])

const makeScope = () => {
  const scope = container.createScope()
  scope.set(Context, { env: { VALUE: 'ok' } })
  return scope
}

const scope = makeScope()
const dispatcher = new Dispatcher(scope, registry, makeScope)
await dispatcher.dispatch(new SyncPayload(1))
assert.deepEqual(seen.shift(), ['sync', true, 1])
await assert.rejects(() => dispatcher.dispatch(new SyncPayload(1), 1), /cannot be delayed/)

await dispatcher.dispatch(new QueuedPayload(2))
assert.equal(queue.messages.length, 1)
assert.deepEqual(seen.shift(), ['queued', true, 2])

await dispatcher.dispatch(new QueuedPayload(3), 30)
assert.equal(queue.messages[1].delaySeconds, 30)
assert.equal(queue.messages[1].message.type, 'queued')
assert.deepEqual(queue.messages[1].message.payload, { id: 3 })

await dispatcher.consume({ type: 'queued', payload: { id: 4 } }, makeScope())
assert.deepEqual(seen.shift(), ['queued', true, 4])
await assert.rejects(() => dispatcher.dispatch({}), /No Honovel listener is registered/)
await assert.rejects(() => dispatcher.consume({ type: 'missing', payload: {} }), /No Honovel queued listener/)

console.log('[Honovel] Unified listener dispatcher and queue runtime check passed.')
