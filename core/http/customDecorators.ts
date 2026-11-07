import type { Context } from 'hono'
import type { JwtVariables } from 'hono/jwt'
import type { InjectionToken } from '../di/Container'

export interface CustomDecoratorOptions {
  cache?: boolean
}

interface DecoratorMetadata {
  readonly __honovelDecoratorDependencies: readonly DecoratorDependency[]
  readonly __honovelDecoratorCache: boolean
}

export type DecoratorResolver<
  TArgs extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> = (context: Context, ...args: TArgs) => TResult | Promise<TResult>

export type HonovelDecorator<
  TArgs extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> = ((...args: TArgs) => ClassDecorator & MethodDecorator & ParameterDecorator) & {
  readonly __honovelDecoratorResolver: DecoratorResolver<TArgs, TResult>
} & DecoratorMetadata

export type DecoratorDependency =
  | InjectionToken
  | HonovelDecorator<any, unknown>

type DecoratorDependencyValue<TDependency> =
  TDependency extends HonovelDecorator<any, infer TResult>
    ? Awaited<TResult>
    : TDependency extends abstract new (...args: any[]) => infer TInstance
      ? TInstance
      : never

type DecoratorDependencyValues<TDependencies extends readonly DecoratorDependency[]> = {
  [TIndex in keyof TDependencies]: DecoratorDependencyValue<TDependencies[TIndex]>
}

type ResolverValues<TResolver> =
  TResolver extends (context: Context, ...values: infer TValues) => any
    ? TValues
    : never

type DropDecoratorDependencyValues<
  TValues extends readonly unknown[],
  TDependencies extends readonly DecoratorDependency[],
> = TDependencies extends readonly [DecoratorDependency, ...infer TRestDependencies]
  ? TRestDependencies extends readonly DecoratorDependency[]
    ? TValues extends readonly [unknown, ...infer TRestValues]
      ? DropDecoratorDependencyValues<TRestValues, TRestDependencies>
      : []
    : TValues
  : TValues

export type InjectedDecoratorResolver<
  TDependencies extends readonly DecoratorDependency[],
  TArgs extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> = (
  context: Context,
  ...values: [...DecoratorDependencyValues<TDependencies>, ...TArgs]
) => TResult | Promise<TResult>

function defineDecorator(
  dependencies: readonly DecoratorDependency[],
  resolver: (...args: any[]) => unknown,
  cache: boolean,
): HonovelDecorator<any, unknown> {
  const decorator = ((..._args: unknown[]) =>
    (() => undefined) as ClassDecorator & MethodDecorator & ParameterDecorator
  ) as HonovelDecorator<any, unknown>

  Object.defineProperties(decorator, {
    __honovelDecoratorResolver: {
      value: resolver,
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __honovelDecoratorDependencies: {
      value: Object.freeze([...dependencies]),
      enumerable: false,
      configurable: false,
      writable: false,
    },
    __honovelDecoratorCache: {
      value: cache,
      enumerable: false,
      configurable: false,
      writable: false,
    },
  })

  return decorator
}

export function createDecorator<
  TArgs extends readonly unknown[],
  TResult,
>(
  resolver: DecoratorResolver<TArgs, TResult>,
  options?: CustomDecoratorOptions,
): HonovelDecorator<TArgs, TResult>

export function createDecorator<
  const TDependencies extends readonly DecoratorDependency[],
  TResolver extends (context: Context, ...values: any[]) => any,
>(
  dependencies: TDependencies,
  resolver: TResolver & ((
    context: Context,
    ...values: [...DecoratorDependencyValues<TDependencies>, ...any[]]
  ) => any),
  options?: CustomDecoratorOptions,
): HonovelDecorator<
  DropDecoratorDependencyValues<ResolverValues<TResolver>, TDependencies>,
  Awaited<ReturnType<TResolver>>
>

export function createDecorator(
  dependenciesOrResolver: readonly DecoratorDependency[] | DecoratorResolver,
  resolverOrOptions?: ((...args: any[]) => unknown) | CustomDecoratorOptions,
  maybeOptions?: CustomDecoratorOptions,
): HonovelDecorator<any, unknown> {
  const dependencies = Array.isArray(dependenciesOrResolver)
    ? dependenciesOrResolver as readonly DecoratorDependency[]
    : []
  const resolver = Array.isArray(dependenciesOrResolver)
    ? resolverOrOptions
    : dependenciesOrResolver
  const options = Array.isArray(dependenciesOrResolver)
    ? maybeOptions
    : resolverOrOptions as CustomDecoratorOptions | undefined

  if (typeof resolver !== 'function') {
    throw new Error('createDecorator() requires a resolver function.')
  }

  return defineDecorator(dependencies, resolver, options?.cache !== false)
}

export type JwtPayload = JwtVariables['jwtPayload']

export const JwtPayload = createDecorator(
  (context): JwtPayload => context.get('jwtPayload') as JwtPayload,
)
