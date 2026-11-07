import { Cache, type CacheComparable, type CacheLookup } from '@honovel/core'
import { DurableObject } from 'cloudflare:workers'

export interface DurableObjectCacheStub {
  getValue<T>(key: string): Promise<CacheLookup<T>>
  putValue<T>(key: string, value: T, ttlMs?: number): Promise<void>
  addValue<T>(key: string, value: T, ttlMs?: number): Promise<boolean>
  incrementValue(key: string, amount: number, ttlMs?: number): Promise<number>
  compareAndDeleteValue(key: string, expectedValue: CacheComparable): Promise<boolean>
  deleteValue(key: string): Promise<void>
  deleteAll(): Promise<void>
}

export interface DurableObjectCacheNamespace {
  getByName(name: string): unknown
}

type StoredCacheEntry<T> = {
  value: T
  expiresAt: number | null
}

export abstract class BaseDurableObjectCache extends Cache {
  constructor(private readonly namespace: DurableObjectCacheNamespace) {
    super()
  }

  protected async read<T>(group: string, key: string): Promise<CacheLookup<T>> {
    return this.stub(group).getValue<T>(key)
  }

  protected async write<T>(group: string, key: string, value: T, ttlMs?: number): Promise<void> {
    await this.stub(group).putValue(key, value, ttlMs)
  }

  protected async writeIfAbsent<T>(group: string, key: string, value: T, ttlMs?: number): Promise<boolean> {
    return this.stub(group).addValue(key, value, ttlMs)
  }

  protected async incrementEntry(
    group: string,
    key: string,
    amount: number,
    ttlMs?: number,
  ): Promise<number> {
    return this.stub(group).incrementValue(key, amount, ttlMs)
  }

  protected async deleteEntryIfValueMatches(
    group: string,
    key: string,
    expectedValue: CacheComparable,
  ): Promise<boolean> {
    return this.stub(group).compareAndDeleteValue(key, expectedValue)
  }

  protected async deleteEntry(group: string, key: string): Promise<void> {
    await this.stub(group).deleteValue(key)
  }

  protected async deleteGroup(group: string): Promise<void> {
    await this.stub(group).deleteAll()
  }

  private stub(group: string): DurableObjectCacheStub {
    return this.namespace.getByName(group) as DurableObjectCacheStub
  }
}

export class HonovelCacheDurableObject extends DurableObject {
  async getValue<T>(key: string): Promise<CacheLookup<T>> {
    const entry = await this.ctx.storage.get<StoredCacheEntry<T>>(key)
    if (!entry) return { found: false }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key)
      return { found: false }
    }

    return { found: true, value: entry.value }
  }

  async putValue<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (ttlMs !== undefined && ttlMs <= 0) {
      await this.ctx.storage.delete(key)
      return
    }

    await this.ctx.storage.put(key, {
      value,
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    } satisfies StoredCacheEntry<T>)
  }

  async addValue<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
    if (ttlMs !== undefined && ttlMs <= 0) return false

    return this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<StoredCacheEntry<T>>(key)
      const now = Date.now()
      if (existing && (existing.expiresAt === null || existing.expiresAt > now)) return false

      await transaction.put(key, {
        value,
        expiresAt: ttlMs === undefined ? null : now + ttlMs,
      } satisfies StoredCacheEntry<T>)
      return true
    })
  }

  async incrementValue(key: string, amount: number, ttlMs?: number): Promise<number> {
    if (ttlMs !== undefined && ttlMs <= 0) return amount

    return this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<StoredCacheEntry<unknown>>(key)
      const now = Date.now()
      const active = existing && (existing.expiresAt === null || existing.expiresAt > now)

      if (active && typeof existing.value !== 'number') {
        throw new TypeError(`Cache entry "${key}" is not numeric.`)
      }

      const value = (active ? existing.value as number : 0) + amount
      await transaction.put(key, {
        value,
        expiresAt: active
          ? existing.expiresAt
          : ttlMs === undefined ? null : now + ttlMs,
      } satisfies StoredCacheEntry<number>)

      return value
    })
  }

  async compareAndDeleteValue(
    key: string,
    expectedValue: CacheComparable,
  ): Promise<boolean> {
    return this.ctx.storage.transaction(async (transaction) => {
      const entry = await transaction.get<StoredCacheEntry<CacheComparable>>(key)
      if (!entry) return false

      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        await transaction.delete(key)
        return false
      }

      if (!Object.is(entry.value, expectedValue)) return false

      await transaction.delete(key)
      return true
    })
  }

  async deleteValue(key: string): Promise<void> {
    await this.ctx.storage.delete(key)
  }

  async deleteAll(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
