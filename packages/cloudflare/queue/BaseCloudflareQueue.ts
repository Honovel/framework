import { Queue, type LocalQueueConsumer, type QueuedMessage } from '@honovel/core'

export interface CloudflareQueueBinding {
  send(message: QueuedMessage, options?: { delaySeconds?: number }): Promise<unknown>
}

export abstract class BaseCloudflareQueue extends Queue {
  constructor(private readonly queue: CloudflareQueueBinding) {
    super()
  }

  async enqueue(
    message: QueuedMessage,
    delaySeconds = 0,
    _localConsumer?: LocalQueueConsumer,
  ): Promise<void> {
    if (delaySeconds > 86_400) {
      throw new RangeError('Cloudflare Queues support a maximum delay of 86400 seconds (24 hours).')
    }

    await this.queue.send(
      message,
      delaySeconds > 0 ? { delaySeconds } : undefined,
    )
  }
}
