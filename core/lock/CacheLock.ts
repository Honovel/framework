import { Cache } from '../cache/Cache.js'
import { AcquiredLock, Lock, LockException } from './Lock.js'

/**
 * Cache-backed runtime-neutral lock implementation.
 *
 * Applications select it for the `Lock` contract with their own DI binding,
 * e.g. `class AppLock extends CacheLock {}` plus `@Scope({ provides: Lock })`.
 */
export class CacheLock extends Lock {
  constructor(private readonly cache: Cache) {
    super()
  }

  async acquire<T>(
    key: string,
    work: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T>
  async acquire<T>(
    group: string,
    key: string,
    work: () => Promise<T> | T,
    ttlMs?: number,
  ): Promise<T>
  async acquire<T>(
    groupOrKey: string,
    keyOrWork: string | (() => Promise<T> | T),
    workOrTtl?: (() => Promise<T> | T) | number,
    ttlMs = 30_000,
  ): Promise<T> {
    const grouped = typeof keyOrWork === 'string'
    const key = grouped ? keyOrWork : groupOrKey
    const work = (grouped ? workOrTtl : keyOrWork) as () => Promise<T> | T
    const acquired = grouped
      ? await this.tryAcquire(groupOrKey, key, ttlMs)
      : await this.tryAcquire(key, typeof workOrTtl === 'number' ? workOrTtl : 30_000)

    if (!acquired) throw new LockException(key)

    try {
      return await work()
    } finally {
      await acquired.release()
    }
  }

  async tryAcquire(key: string, ttlMs?: number): Promise<AcquiredLock | null>
  async tryAcquire(group: string, key: string, ttlMs?: number): Promise<AcquiredLock | null>
  async tryAcquire(
    groupOrKey: string,
    keyOrTtl?: string | number,
    ttlMs = 30_000,
  ): Promise<AcquiredLock | null> {
    const grouped = typeof keyOrTtl === 'string'
    const key = grouped ? keyOrTtl : groupOrKey
    const group = grouped ? groupOrKey : `__honovel:lock:${key}`
    const ttl = grouped
      ? ttlMs
      : typeof keyOrTtl === 'number' ? keyOrTtl : 30_000
    const cacheKey = `__honovel:lock:${key}`
    const leaseId = crypto.randomUUID()
    const acquired = await this.cache.add(group, cacheKey, leaseId, ttl)

    if (!acquired) return null

    return new AcquiredLock(
      key,
      async () => {
        await this.cache.compareAndDelete(group, cacheKey, leaseId)
      },
    )
  }
}
