# Events & Queues

Honovel uses one payload-and-listener model for immediate events and queued work. Application code dispatches payload objects; whether work executes immediately or through a queue depends on the discovered listener type.

## Immediate event

Create a payload:

```ts
export class BookingConfirmed {
  constructor(public readonly bookingId: number) {}
}
```

Handle it with `Listener<T>`:

```ts
export class BookingConfirmedListener extends Listener<BookingConfirmed> {
  constructor(private readonly audit: AuditService) {
    super()
  }

  async handle(event: BookingConfirmed) {
    await this.audit.record('booking.confirmed', event.bookingId)
  }
}
```

## Dispatch an event

```ts
export class BookingService {
  constructor(private readonly dispatcher: Dispatcher) {}

  async confirm(bookingId: number) {
    await this.dispatcher.dispatch(new BookingConfirmed(bookingId))
  }
}
```

A normal `Listener<T>` runs immediately in the current DI scope.

## Queued listener

Switch the handler to `QueuedListener<T>`:

```ts
export class BookingConfirmedListener extends QueuedListener<BookingConfirmed> {
  constructor(private readonly mailer: Mailer) {
    super()
  }

  async handle(event: BookingConfirmed) {
    await this.mailer.sendBookingConfirmation(event.bookingId)
  }
}
```

The dispatching code stays the same. Honovel routes the payload through the configured `Queue` because its handler is queued.

## Delayed work

```ts
await this.dispatcher.dispatch(
  new SendBookingReminder(bookingId),
  300,
)
```

The delay is specified in seconds and only applies to queued listeners.

## Jobs without data

Payload classes do not need properties:

```ts
export class CleanupExpiredSessions {}
```

```ts
await this.dispatcher.dispatch(new CleanupExpiredSessions())
```

## Payload serialization

Queued payloads must be JSON-serializable. Prefer identifiers and simple values:

```ts
export class GenerateInvoice {
  constructor(public readonly invoiceId: number) {}
}
```

Avoid embedding live request objects, database clients or runtime-specific objects in payloads.

## Fresh execution scope

Queued listeners run in a fresh Honovel DI scope. Services and repositories are resolved again for the queue execution.

The original HTTP request is not preserved. Runtime environment bindings are made available by the queue runtime instead.

## One handler per payload

Each payload type has exactly one discovered `Listener<T>` or `QueuedListener<T>`. Duplicate handlers are rejected during compilation.

## Cloudflare default queue

The Cloudflare starter binds the `Queue` contract to a Cloudflare Queue adapter using the generated `HONOVEL_QUEUE` binding.

The generated `wrangler.jsonc` contains both producer and consumer configuration. Dispatching a payload handled by `QueuedListener<T>` therefore leaves the original request and is processed through Cloudflare Queues.

This is a durable runtime service rather than an in-process timer.

Listener code remains ordinary Honovel application code:

```ts
export class RebuildReportListener extends QueuedListener<RebuildReport> {
  constructor(private readonly reports: ReportService) {
    super()
  }

  async handle(event: RebuildReport) {
    await this.reports.rebuild(event.reportId)
  }
}
```

## Node.js adapter queue

An existing Node application using `@honovel/node` intentionally starts with `InMemoryQueue`:

```ts
import { Queue, Scope } from '@honovel/core'
import { InMemoryQueue } from '@honovel/node'

@Scope({ provides: Queue })
export class AppQueue extends InMemoryQueue {}
```

The queue schedules work with an in-process timer. Pending messages are lost when the Node process exits, and another application replica cannot consume those messages.

This keeps the starter dependency-free and works well for development and tests. It should not be confused with a durable production queue.

## Replacing the Node queue

For production Node applications, implement the `Queue` contract using your preferred transport and select it through DI:

```ts
import { Queue, Scope, type QueuedMessage } from '@honovel/core'

@Scope({ provides: Queue })
export class PersistentQueue extends Queue {
  constructor(private readonly broker: QueueBroker) {
    super()
  }

  async enqueue(message: QueuedMessage, delaySeconds = 0) {
    await this.broker.publish(message, { delaySeconds })
  }
}
```

The transport could be BullMQ/Redis, RabbitMQ, SQS or another queue. The adapter's responsibility is to persist and later deliver Honovel's serialized queued message to the Honovel consumer runtime.

Application dispatching code does not change when the queue backend changes.

## Infrastructure choice

New Nuxt and API-only projects both use Cloudflare-native services. The separately available Node adapter supplies in-memory implementations for existing or manually configured Node applications. The initializer no longer creates Node projects; the framework contracts remain available to existing runtime adapters.

## Queue failures and delivery

The generated Cloudflare queue handler acknowledges each successfully handled message and requests a retry when its listener throws. Listener operations should therefore tolerate repeated delivery, for example by using an application-level idempotency key. Retry limits and dead-letter routing belong to the queue transport configuration.

Queued payloads are serialized through JSON and later hydrated onto the payload class prototype without calling its constructor. Dates become strings, and constructor validation or side effects are not replayed; load current domain data using IDs in the listener. Delay values must be finite and non-negative, and a positive delay on an immediate listener is rejected.

For a custom transport consumer, the compiled `.honovel/app.js` exports `consumeQueueMessage(message, bindings, executionCtx?)`. It creates a fresh execution scope and invokes the registered queued listener. Call it from the runtime bootstrap that integrates your broker, and let the broker handle acknowledgment/retry. Keep business-code imports directed at source modules and `@honovel/core`, not generated files.
