import type { InjectionToken, ProviderScope } from './Container'

export interface ScopeOptions {
  lifecycle?: ProviderScope
  provides?: InjectionToken
}

const classDecorator = (): ClassDecorator => () => undefined

export function Scope(lifecycle: ProviderScope): ClassDecorator
export function Scope(options?: ScopeOptions): ClassDecorator
export function Scope(_options: ProviderScope | ScopeOptions = {}): ClassDecorator {
  return classDecorator()
}
