export interface QueuedMessage {
  type: string
  payload: unknown
}

export type LocalQueueConsumer = (message: QueuedMessage) => Promise<void>

/** Runtime-neutral queue transport used by queued listeners. */
export abstract class Queue {
  abstract enqueue(
    message: QueuedMessage,
    delaySeconds?: number,
    localConsumer?: LocalQueueConsumer,
  ): Promise<void>
}
