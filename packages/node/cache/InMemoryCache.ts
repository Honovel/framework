import { Cache, type CacheComparable, type CacheLookup } from '@honovel/core'

type CacheEntry = {
  value: unknown
  expiresAt: number | null
}

/** In-process cache for Node applications. Not shared across processes or replicas. */
export class InMemoryCache extends Cache {
  private static readonly groups = new Map<string, Map<string, CacheEntry>>()

  protected async read<T>(group: string, key: string): Promise<CacheLookup<T>> {
    const entries = InMemoryCache.groups.get(group)
    const entry = entries?.get(key)
    if (!entry) return { found: false }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries?.delete(key)
      if (entries?.size === 0) InMemoryCache.groups.delete(group)
      return { found: false }
    }

    return { found: true, value: entry.value as T }
  }

  protected async write<T>(group: string, key: string, value: T, ttlMs?: number): Promise<void> {
    if (ttlMs !== undefined && ttlMs <= 0) {
      await this.deleteEntry(group, key)
      return
    }

    let entries = InMemoryCache.groups.get(group)
    if (!entries) {
      entries = new Map()
      InMemoryCache.groups.set(group, entries)
    }

    entries.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    })
  }

  protected async writeIfAbsent<T>(group: string, key: string, value: T, ttlMs?: number): Promise<boolean> {
    if (ttlMs !== undefined && ttlMs <= 0) return false

    const entries = InMemoryCache.groups.get(group)
    const existing = entries?.get(key)
    const now = Date.now()
    if (existing && (existing.expiresAt === null || existing.expiresAt > now)) return false

    let target = entries
    if (!target) {
      target = new Map()
      InMemoryCache.groups.set(group, target)
    }

    target.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : now + ttlMs,
    })
    return true
  }

  protected async incrementEntry(
    group: string,
    key: string,
    amount: number,
    ttlMs?: number,
  ): Promise<number> {
    if (ttlMs !== undefined && ttlMs <= 0) return amount

    let entries = InMemoryCache.groups.get(group)
    if (!entries) {
      entries = new Map()
      InMemoryCache.groups.set(group, entries)
    }

    const now = Date.now()
    const existing = entries.get(key)
    const active = existing && (existing.expiresAt === null || existing.expiresAt > now)

    if (active && typeof existing.value !== 'number') {
      throw new TypeError(`Cache entry "${group}:${key}" is not numeric.`)
    }

    const value = (active ? existing.value as number : 0) + amount
    entries.set(key, {
      value,
      expiresAt: active
        ? existing.expiresAt
        : ttlMs === undefined ? null : now + ttlMs,
    })

    return value
  }

  protected async deleteEntryIfValueMatches(
    group: string,
    key: string,
    expectedValue: CacheComparable,
  ): Promise<boolean> {
    const entries = InMemoryCache.groups.get(group)
    const entry = entries?.get(key)
    if (!entry) return false

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries?.delete(key)
      if (entries?.size === 0) InMemoryCache.groups.delete(group)
      return false
    }

    if (!Object.is(entry.value, expectedValue)) return false

    entries?.delete(key)
    if (entries?.size === 0) InMemoryCache.groups.delete(group)
    return true
  }

  protected async deleteEntry(group: string, key: string): Promise<void> {
    const entries = InMemoryCache.groups.get(group)
    entries?.delete(key)
    if (entries?.size === 0) InMemoryCache.groups.delete(group)
  }

  protected async deleteGroup(group: string): Promise<void> {
    InMemoryCache.groups.delete(group)
  }
}
