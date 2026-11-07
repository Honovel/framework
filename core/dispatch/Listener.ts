export abstract class Listener<TPayload> {
  abstract handle(payload: TPayload): Promise<void> | void
}

/** Marker base class for listeners that must execute through the configured queue. */
export abstract class QueuedListener<TPayload> extends Listener<TPayload> {}
