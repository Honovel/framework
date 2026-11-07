import { Queue, type LocalQueueConsumer, type QueuedMessage } from '@honovel/core'

/** Development-oriented in-process queue. Pending messages are lost on process exit. */
export class InMemoryQueue extends Queue {
  async enqueue(
    message: QueuedMessage,
    delaySeconds = 0,
    localConsumer?: LocalQueueConsumer,
  ): Promise<void> {
    if (!localConsumer) {
      throw new Error('InMemoryQueue requires Honovel\'s local queue consumer.')
    }

    const delayMs = delaySeconds * 1000
    setTimeout(() => {
      void localConsumer(message).catch((error) => console.error('[Honovel] Queued listener failed.', error))
    }, delayMs)
  }
}
