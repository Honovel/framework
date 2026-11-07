import assert from 'node:assert/strict'
import { AcquiredLock, Lock, LockException } from '../.honovel/core/lock/Lock.js'

class TestLock extends Lock {
  async acquire(...args) {
    const work = typeof args[1] === 'function' ? args[1] : args[2]
    return work()
  }

  async tryAcquire(...args) {
    const key = typeof args[1] === 'string' ? args[1] : args[0]
    return new AcquiredLock(key, async () => {})
  }
}

const lock = new TestLock()
assert.equal(await lock.acquire('calendar-sync', async () => 'ok'), 'ok')
assert.equal(await lock.acquire('account:123', 'calendar-sync', async () => 'grouped'), 'grouped')
assert.equal((await lock.tryAcquire('calendar-sync'))?.key, 'calendar-sync')
assert.equal((await lock.tryAcquire('account:123', 'calendar-sync'))?.key, 'calendar-sync')

let releases = 0
const acquired = new AcquiredLock('calendar-sync', async () => { releases++ })
await acquired.release()
await acquired.release()
assert.equal(releases, 1)
assert.match(new LockException('calendar-sync').message, /calendar-sync/)

console.log('[Honovel] Runtime-neutral lock contract check passed.')
