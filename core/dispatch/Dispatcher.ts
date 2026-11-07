import type { Constructor, RequestScope } from '../di/Container.js'
import { Queue, type QueuedMessage } from '../queue/Queue.js'
import type { Listener } from './Listener.js'

export interface ListenerRegistration<TPayload = unknown> {
  type: string
  payload: Constructor<TPayload>
  listener: Constructor<Listener<TPayload>>
  queued: boolean
}

export interface ListenerRegistry {
  byPayload: ReadonlyMap<Function, ListenerRegistration>
  byType: ReadonlyMap<string, ListenerRegistration>
}

export function createListenerRegistry(
  registrations: readonly ListenerRegistration[],
): ListenerRegistry {
  return {
    byPayload: new Map(registrations.map((entry) => [entry.payload, entry])),
    byType: new Map(registrations.map((entry) => [entry.type, entry])),
  }
}

function serializePayload(payload: object): unknown {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch (error) {
    throw new TypeError(
      `Queued payload ${payload.constructor?.name || '<anonymous>'} must be JSON serializable.`,
      { cause: error },
    )
  }
}

function hydratePayload(registration: ListenerRegistration, value: unknown): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Queued payload ${registration.type} must deserialize to an object.`)
  }

  return Object.assign(Object.create(registration.payload.prototype), value)
}

export class Dispatcher {
  static readonly __honovelBuiltin = 'dispatcher' as const

  constructor(
    private readonly scope: RequestScope,
    private readonly registry: ListenerRegistry,
    private readonly createQueueScope: () => RequestScope,
  ) {}

  async dispatch<TPayload extends object>(
    payload: TPayload,
    delaySeconds = 0,
  ): Promise<void> {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
      throw new RangeError('Dispatcher delaySeconds must be a finite number greater than or equal to 0.')
    }

    const registration = this.registry.byPayload.get(payload.constructor)
    if (!registration) {
      throw new Error(`No Honovel listener is registered for ${payload.constructor?.name || '<anonymous>'}.`)
    }

    if (!registration.queued) {
      if (delaySeconds > 0) {
        throw new Error(
          `${registration.listener.name} is synchronous and cannot be delayed. Extend QueuedListener<${registration.payload.name}> instead.`,
        )
      }

      await this.invoke(registration, payload, this.scope)
      return
    }

    const message: QueuedMessage = {
      type: registration.type,
      payload: serializePayload(payload),
    }
    const queue = this.scope.resolve(Queue)
    await queue.enqueue(
      message,
      delaySeconds,
      async (queuedMessage) => this.consume(queuedMessage, this.createQueueScope()),
    )
  }

  async consume(message: QueuedMessage, scope: RequestScope = this.scope): Promise<void> {
    const registration = this.registry.byType.get(message.type)
    if (!registration) {
      throw new Error(`No Honovel queued listener is registered for message type ${message.type}.`)
    }
    if (!registration.queued) {
      throw new Error(`Message type ${message.type} belongs to a synchronous listener and cannot be consumed from a queue.`)
    }

    await this.invoke(registration, hydratePayload(registration, message.payload), scope)
  }

  private async invoke(
    registration: ListenerRegistration,
    payload: object,
    scope: RequestScope,
  ): Promise<void> {
    const listener = scope.resolve(registration.listener) as Listener<object>
    await listener.handle(payload)
  }
}
