export type CacheLookup<T> =
  | { found: true; value: T }
  | { found: false }

export type CacheComparable = string | number | boolean | null

/**
 * Runtime-neutral cache contract used by Honovel services and infrastructure.
 *
 * Cache entries are addressed by a `group` and `key`. Passing an empty group
 * (`''`) uses the default cache group. TTL values are always expressed in
 * milliseconds.
 */
export abstract class Cache {
  /**
   * Read a cached value.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @returns The cached value, or `null` when the entry does not exist or has expired.
   */
  async get<T>(group: string, key: string): Promise<T | null>

  /**
   * Read a cached value and return `defaultValue` when the entry is missing.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param defaultValue Value returned when no valid cache entry exists.
   */
  async get<T>(group: string, key: string, defaultValue: T): Promise<T>
  async get<T>(group: string, key: string, defaultValue?: T): Promise<T | null> {
    const result = await this.read<T>(this.normalizeGroup(group), key)
    if (result.found) return result.value
    return arguments.length >= 3 ? defaultValue as T : null
  }

  /**
   * Store or replace a cache entry.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param value Value to cache.
   * @param ttlMs Optional time-to-live in milliseconds. Omit for no expiry.
   */
  async put<T>(group: string, key: string, value: T, ttlMs?: number): Promise<void> {
    await this.write(this.normalizeGroup(group), key, value, ttlMs)
  }

  /**
   * Atomically store a value only when no valid entry exists for the key.
   *
   * This is intended for coordination primitives such as locks and should be
   * implemented atomically by the cache backend.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param value Value to cache when the key is absent.
   * @param ttlMs Optional time-to-live in milliseconds. Omit for no expiry.
   * @returns `true` when the value was stored, otherwise `false`.
   */
  async add<T>(group: string, key: string, value: T, ttlMs?: number): Promise<boolean> {
    return this.writeIfAbsent(this.normalizeGroup(group), key, value, ttlMs)
  }

  /**
   * Atomically increment a numeric cache entry.
   *
   * Missing or expired entries start at `0`. When a new entry is created, the
   * optional TTL is applied to that entry. Existing entries keep their current
   * expiry so repeated increments do not extend a fixed window.
   *
   * This is useful for counters, quotas, and user-defined rate-limit decorators.
   * Cache backends must implement the operation atomically.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param amount Amount to add. Defaults to `1`.
   * @param ttlMs Optional time-to-live used only when creating the entry.
   * @returns The incremented value.
   */
  async increment(
    group: string,
    key: string,
    amount = 1,
    ttlMs?: number,
  ): Promise<number> {
    return this.incrementEntry(this.normalizeGroup(group), key, amount, ttlMs)
  }

  /**
   * Atomically delete a cache entry only when its value matches `expectedValue`.
   *
   * Useful for ownership-safe coordination, for example releasing a lock only
   * when the current lease still belongs to the caller.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param expectedValue Primitive value that must match the stored value.
   * @returns `true` when the matching entry was deleted, otherwise `false`.
   */
  async compareAndDelete(
    group: string,
    key: string,
    expectedValue: CacheComparable,
  ): Promise<boolean> {
    return this.deleteEntryIfValueMatches(
      this.normalizeGroup(group),
      key,
      expectedValue,
    )
  }

  /**
   * Return a cached value or compute, store, and return it when missing.
   *
   * `remember()` does not provide stampede protection. Concurrent callers may
   * execute the callback more than once when the entry is missing.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Cache entry key.
   * @param ttlMs Time-to-live in milliseconds, or `undefined` for no expiry.
   * @param callback Callback used to compute the value on a cache miss.
   * @returns The cached or newly computed value.
   */
  async remember<T>(
    group: string,
    key: string,
    ttlMs: number | undefined,
    callback: () => Promise<T> | T,
  ): Promise<T> {
    const result = await this.read<T>(this.normalizeGroup(group), key)
    if (result.found) return result.value

    const value = await callback()
    await this.write(this.normalizeGroup(group), key, value, ttlMs)
    return value
  }

  /**
   * Delete one cache entry or, when `key` is omitted, clear the entire group.
   *
   * @param group Cache group. Use `''` for the default group.
   * @param key Optional key. Omit it to delete all entries in the group.
   */
  async delete(group: string, key?: string): Promise<void> {
    const normalizedGroup = this.normalizeGroup(group)
    if (key === undefined) {
      await this.deleteGroup(normalizedGroup)
      return
    }

    await this.deleteEntry(normalizedGroup, key)
  }

  protected normalizeGroup(group: string): string {
    return group === '' ? 'default' : group
  }

  protected abstract read<T>(group: string, key: string): Promise<CacheLookup<T>>
  protected abstract write<T>(group: string, key: string, value: T, ttlMs?: number): Promise<void>
  protected abstract writeIfAbsent<T>(group: string, key: string, value: T, ttlMs?: number): Promise<boolean>
  protected abstract incrementEntry(group: string, key: string, amount: number, ttlMs?: number): Promise<number>
  protected abstract deleteEntryIfValueMatches(group: string, key: string, expectedValue: CacheComparable): Promise<boolean>
  protected abstract deleteEntry(group: string, key: string): Promise<void>
  protected abstract deleteGroup(group: string): Promise<void>
}
