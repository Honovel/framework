import assert from 'node:assert/strict'
import { Cache } from '#honovel-test/cache/Cache.js'
import type { CacheLookup } from '../core/cache/Cache.js'


class TestCache extends Cache {
  groups = new Map()

  async read<T>(group: string, key: string): Promise<CacheLookup<T>> {
    const entry = this.groups.get(group)?.get(key)
    if (!entry) return { found: false }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.groups.get(group)?.delete(key)
      return { found: false }
    }
    return { found: true, value: entry.value as T }
  }

  async write(group, key, value, ttlMs) {
    let entries = this.groups.get(group)
    if (!entries) {
      entries = new Map()
      this.groups.set(group, entries)
    }
    entries.set(key, { value, expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs })
  }

  async writeIfAbsent(group, key, value, ttlMs) {
    const existing = await this.read(group, key)
    if (existing.found) return false
    await this.write(group, key, value, ttlMs)
    return true
  }

  async incrementEntry(group, key, amount, ttlMs) {
    const existing = await this.read(group, key)
    if (existing.found && typeof existing.value !== 'number') {
      throw new TypeError(`Cache entry "${group}:${key}" is not numeric.`)
    }

    const current = existing.found ? existing.value : 0
    const value = current + amount
    const expiresAt = existing.found
      ? this.groups.get(group)?.get(key)?.expiresAt ?? null
      : ttlMs === undefined ? null : Date.now() + ttlMs

    let entries = this.groups.get(group)
    if (!entries) {
      entries = new Map()
      this.groups.set(group, entries)
    }
    entries.set(key, { value, expiresAt })
    return value
  }

  async deleteEntryIfValueMatches(group, key, expectedValue) {
    const entry = this.groups.get(group)?.get(key)
    if (!entry) return false
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.groups.get(group)?.delete(key)
      return false
    }
    if (!Object.is(entry.value, expectedValue)) return false
    this.groups.get(group)?.delete(key)
    return true
  }

  async deleteEntry(group, key) {
    this.groups.get(group)?.delete(key)
  }

  async deleteGroup(group) {
    this.groups.delete(group)
  }
}

const cache = new TestCache()
assert.equal(await cache.get('account:1', 'missing'), null)
assert.deepEqual(await cache.get('account:1', 'missing', []), [])

await cache.put('account:1', 'bookings', [1, 2, 3])
assert.deepEqual(await cache.get('account:1', 'bookings'), [1, 2, 3])

let calls = 0
assert.deepEqual(await cache.remember('account:1', 'bookings', 1000, () => { calls++; return [4] }), [1, 2, 3])
assert.equal(calls, 0)
assert.equal(await cache.remember('account:1', 'settings', 1000, () => { calls++; return 'fresh' }), 'fresh')
assert.equal(calls, 1)
assert.equal(await cache.get('account:1', 'settings'), 'fresh')

assert.equal(await cache.add('account:1', 'atomic', 'first', 1000), true)
assert.equal(await cache.add('account:1', 'atomic', 'second', 1000), false)
assert.equal(await cache.get('account:1', 'atomic'), 'first')
assert.equal(await cache.compareAndDelete('account:1', 'atomic', 'other'), false)
assert.equal(await cache.get('account:1', 'atomic'), 'first')
assert.equal(await cache.compareAndDelete('account:1', 'atomic', 'first'), true)
assert.equal(await cache.get('account:1', 'atomic'), null)

assert.equal(await cache.increment('rate-limit', 'api', 1, 1000), 1)
assert.equal(await cache.increment('rate-limit', 'api'), 2)
assert.equal(await cache.increment('rate-limit', 'api', 3), 5)
assert.equal(await cache.get('rate-limit', 'api'), 5)

await cache.put('rate-limit', 'invalid', 'not-a-number')
await assert.rejects(
  () => cache.increment('rate-limit', 'invalid'),
  /is not numeric/,
)

await cache.delete('account:1', 'bookings')
assert.equal(await cache.get('account:1', 'bookings'), null)
assert.equal(await cache.get('account:1', 'settings'), 'fresh')
await cache.delete('account:1')
assert.equal(await cache.get('account:1', 'settings'), null)

await cache.put('', 'simple', 42)
assert.equal(await cache.get('', 'simple'), 42)
assert.equal(cache.groups.has('default'), true)

await cache.put('ttl', 'short', 'value', 1)
await new Promise((resolve) => setTimeout(resolve, 5))
assert.equal(await cache.get('ttl', 'short'), null)

console.log('[Honovel] Runtime-neutral cache contract check passed.')
