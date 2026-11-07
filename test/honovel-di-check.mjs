import assert from 'node:assert/strict'
import { Container } from '../.honovel/core/di/Container.js'

let scopedCreations = 0
let transientCreations = 0

class ScopedService {
  id = ++scopedCreations
}

class TransientService {
  id = ++transientCreations
}

class Consumer {
  constructor(scoped) {
    this.scoped = scoped
  }
}

const container = new Container()
container.register(ScopedService, 'scoped', () => new ScopedService())
container.register(TransientService, 'transient', () => new TransientService())
container.register(Consumer, 'scoped', (scope) => new Consumer(scope.resolve(ScopedService)))

const firstScope = container.createScope()
const firstScoped = firstScope.resolve(ScopedService)
assert.strictEqual(firstScope.resolve(ScopedService), firstScoped)
assert.strictEqual(firstScope.resolve(Consumer).scoped, firstScoped)
assert.notStrictEqual(firstScope.resolve(TransientService), firstScope.resolve(TransientService))

const secondScope = container.createScope()
assert.notStrictEqual(secondScope.resolve(ScopedService), firstScoped)

class ServiceContract {}
class ScopedImplementation extends ServiceContract {}
class TransientContract {}
class TransientImplementation extends TransientContract {}

const aliasContainer = new Container()
aliasContainer.register(ScopedImplementation, 'scoped', () => new ScopedImplementation())
aliasContainer.registerAlias(ServiceContract, ScopedImplementation)
aliasContainer.register(TransientImplementation, 'transient', () => new TransientImplementation())
aliasContainer.registerAlias(TransientContract, TransientImplementation)

const aliasScope = aliasContainer.createScope()
assert.strictEqual(aliasScope.resolve(ServiceContract), aliasScope.resolve(ScopedImplementation))
assert.strictEqual(aliasScope.resolve(ServiceContract), aliasScope.resolve(ServiceContract))
assert.notStrictEqual(aliasScope.resolve(TransientContract), aliasScope.resolve(TransientContract))

class CircularA {
  constructor(dependency) {
    this.dependency = dependency
  }
}

class CircularB {
  constructor(dependency) {
    this.dependency = dependency
  }
}

const circularContainer = new Container()
circularContainer.register(CircularA, 'scoped', (scope) => new CircularA(scope.resolve(CircularB)))
circularContainer.register(CircularB, 'scoped', (scope) => new CircularB(scope.resolve(CircularA)))
assert.throws(
  () => circularContainer.createScope().resolve(CircularA),
  /Circular Honovel DI dependency detected/,
)

console.log('[Honovel] DI container check passed.')
