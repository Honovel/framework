/**
 * Thrown by `Lock.acquire()` when the requested lock is already held.
 */
export class LockException extends Error {
  constructor(public readonly key: string) {
    super(`Lock ${key} is already acquired.`)
    this.name = 'LockException'
  }
}

/**
 * Handle returned by `Lock.tryAcquire()` for a successfully acquired lock.
 */
export class AcquiredLock {
  private released = false

  constructor(
    public readonly key: string,
    private readonly releaseCallback: () => Promise<void>,
  ) {}

  /**
   * Release the acquired lock.
   *
   * Calling `release()` more than once is safe; subsequent calls are ignored.
   */
  async release(): Promise<void> {
    if (this.released) return

    await this.releaseCallback()
    this.released = true
  }
}

/**
 * Runtime-neutral locking contract.
 *
 * The concrete implementation determines where locks are coordinated, for
 * example in memory, Redis, or a Cloudflare Durable Object.
 */
export abstract class Lock {
  /**
   * Acquire a lock, run `work`, and release the lock afterwards.
   *
   * The lock is released in a `finally` block, so exceptions thrown by `work`
   * are propagated after the lock has been released.
   *
   * @param key Lock key.
   * @param work Callback executed while the lock is held.
   * @param ttlMs Optional lock lease duration in milliseconds. The concrete implementation may define a default.
   * @returns The value returned by `work`.
   * @throws {LockException} When the lock is already acquired.
   */
  abstract acquire<T>(
    key: string,
    work: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T>

  /**
   * Acquire a grouped lock, run `work`, and release the lock afterwards.
   *
   * Grouping lets an implementation colocate or namespace related locks. The
   * lock is released in a `finally` block, so exceptions thrown by `work` are
   * propagated after release.
   *
   * @param group Lock group or namespace.
   * @param key Lock key within the group.
   * @param work Callback executed while the lock is held.
   * @param ttlMs Optional lock lease duration in milliseconds. The concrete implementation may define a default.
   * @returns The value returned by `work`.
   * @throws {LockException} When the lock is already acquired.
   */
  abstract acquire<T>(
    group: string,
    key: string,
    work: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T>

  /**
   * Try to acquire a lock without throwing when it is already held.
   *
   * @param key Lock key.
   * @param ttlMs Optional lock lease duration in milliseconds. The concrete implementation may define a default.
   * @returns An `AcquiredLock` handle when successful, otherwise `null`.
   */
  abstract tryAcquire(
    key: string,
    ttlMs?: number,
  ): Promise<AcquiredLock | null>

  /**
   * Try to acquire a grouped lock without throwing when it is already held.
   *
   * @param group Lock group or namespace.
   * @param key Lock key within the group.
   * @param ttlMs Optional lock lease duration in milliseconds. The concrete implementation may define a default.
   * @returns An `AcquiredLock` handle when successful, otherwise `null`.
   */
  abstract tryAcquire(
    group: string,
    key: string,
    ttlMs?: number,
  ): Promise<AcquiredLock | null>
}
