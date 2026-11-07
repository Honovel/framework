export type Constructor<T = unknown> = new (...args: any[]) => T
export type InjectionToken<T = unknown> = abstract new (...args: any[]) => T
export type ProviderScope = 'scoped' | 'transient'

export type ProviderFactory<T> = (scope: RequestScope) => T

interface Provider<T = unknown> {
  factory: ProviderFactory<T>
  scope: ProviderScope
}

export class Container {
  private readonly providers = new Map<InjectionToken, Provider>()

  register<T>(
    serviceType: InjectionToken<T>,
    scope: ProviderScope,
    factory: ProviderFactory<T>,
  ): void {
    this.providers.set(serviceType, { factory, scope } as Provider)
  }

  registerAlias<T>(serviceType: InjectionToken<T>, implementationType: InjectionToken<T>): void {
    this.register(serviceType, 'transient', (scope) => scope.resolve(implementationType))
  }

  createScope(): RequestScope {
    return new RequestScope(this.providers)
  }
}

export class RequestScope {
  private readonly instances = new Map<InjectionToken, unknown>()
  private readonly resolving = new Set<InjectionToken>()

  constructor(private readonly providers: ReadonlyMap<InjectionToken, Provider>) {}

  set<T>(serviceType: InjectionToken<T>, instance: T): void {
    this.instances.set(serviceType, instance)
  }

  resolve<T>(serviceType: InjectionToken<T>): T {
    if (this.instances.has(serviceType)) {
      return this.instances.get(serviceType) as T
    }

    const provider = this.providers.get(serviceType)
    if (!provider) {
      throw new Error(`No Honovel DI provider is registered for ${serviceType.name || '<anonymous>'}.`)
    }

    if (this.resolving.has(serviceType)) {
      throw new Error(`Circular Honovel DI dependency detected while resolving ${serviceType.name || '<anonymous>'}.`)
    }

    this.resolving.add(serviceType)

    try {
      const instance = provider.factory(this) as T
      if (provider.scope === 'scoped') this.instances.set(serviceType, instance)
      return instance
    } finally {
      this.resolving.delete(serviceType)
    }
  }
}
