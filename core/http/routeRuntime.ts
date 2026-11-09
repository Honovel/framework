import { Context, type MiddlewareHandler } from 'hono'
import { HonoRequest } from 'hono/request'

import type { Container, InjectionToken, RequestScope } from '../di/Container.js'
import type { FormRequestConstructor } from './FormRequest.js'
import type { MiddlewareConstructor } from './Middleware.js'
import type { HonovelDecorator } from './customDecorators.js'
import { ValidationException, validateSchema, type ValidationIssue } from './validation.js'

export type CompiledSource = 'body' | 'param' | 'query'
export type CompiledQueryDecoder = 'raw' | 'string' | 'number' | 'boolean'
  | { fields: [string, 'raw' | 'string' | 'number' | 'boolean'][] }

type RuntimeDecorator = HonovelDecorator<any, unknown>
type DecoratorCache = WeakMap<RuntimeDecorator, Map<string, Promise<unknown>>>

const requestDecoratorCaches = new WeakMap<RequestScope, DecoratorCache>()

export async function readCompiledBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json()
  } catch {
    throw new ValidationException(
      [{ message: 'The request body must contain valid JSON.', path: [] }],
      'body',
    )
  }
}

export function readCompiledQuery(context: Context): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(context.req.queries()).map(([key, values]) => [
      key,
      values.length === 1 ? values[0] : values,
    ]),
  )
}

/** Bind the fields under a named query prefix without parsing JSON values. */
export function readCompiledQueryObject(
  query: Record<string, string | string[]>,
  prefix: string,
): Record<string, string | string[]> {
  const start = `${prefix}.`
  return Object.fromEntries(
    Object.entries(query)
      .filter(([key]) => key.startsWith(start) && key.length > start.length)
      .map(([key, value]) => [key.slice(start.length), value]),
  )
}

function invalidPrimitive(
  source: CompiledSource,
  key: string,
  message: string,
): ValidationException {
  const path: ValidationIssue['path'] = key ? [key] : []
  return new ValidationException([{ message, path }], source)
}

function missingPrimitive(
  value: unknown,
  required: boolean,
  source: CompiledSource,
  key: string,
): value is undefined {
  if (value !== undefined) return false
  if (required) throw invalidPrimitive(source, key, 'The value is required.')
  return true
}

export function coerceCompiledString(
  value: unknown,
  required: boolean,
  source: CompiledSource,
  key: string,
): string | undefined {
  if (missingPrimitive(value, required, source, key)) return undefined
  if (typeof value !== 'string') throw invalidPrimitive(source, key, 'The value must be a single string.')
  return value
}

export function coerceCompiledNumber(
  value: unknown,
  required: boolean,
  source: CompiledSource,
  key: string,
): number | undefined {
  if (missingPrimitive(value, required, source, key)) return undefined

  if (typeof value !== 'number' && (
    typeof value !== 'string'
    || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )) throw invalidPrimitive(source, key, 'The value must be a finite decimal number.')
  const number = Number(value)
  if (!Number.isFinite(number)) throw invalidPrimitive(source, key, 'The value must be a finite decimal number.')
  return number
}

export function coerceCompiledBoolean(
  value: unknown,
  required: boolean,
  source: CompiledSource,
  key: string,
): boolean | undefined {
  if (missingPrimitive(value, required, source, key)) return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  throw invalidPrimitive(source, key, 'The value must be a boolean.')
}

export async function createCompiledFormRequest(
  context: Context,
  RequestType: FormRequestConstructor,
  raw: unknown,
  source: CompiledSource,
  queryDecoder: CompiledQueryDecoder = 'raw',
): Promise<InstanceType<FormRequestConstructor>> {
  const input = source === 'query' ? decodeCompiledQuery(raw, queryDecoder) : raw
  const result = await validateSchema(RequestType.schema, input)
  if (!result.success) throw new ValidationException(result.issues, source)
  return new RequestType(result.data as never, context.req)
}

function decodeCompiledQuery(raw: unknown, decoder: CompiledQueryDecoder, key = ''): unknown {
  if (raw === undefined || decoder === 'raw') return raw
  if (decoder === 'string') return coerceCompiledString(raw, false, 'query', key)
  if (decoder === 'number') return coerceCompiledNumber(raw, false, 'query', key)
  if (decoder === 'boolean') return coerceCompiledBoolean(raw, false, 'query', key)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const fields = new Map(decoder.fields)
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [
    name, decodeCompiledQuery(value, fields.get(name) ?? 'raw', name),
  ]))
}

export function normalizeCompiledResult(context: Context, result: unknown): Response {
  if (result instanceof Response) return result
  if (result === undefined) return context.body(null, 204)
  return context.json(result as never)
}

export function createCompiledRequestScope(
  container: Container,
  context: Context,
): RequestScope {
  const scope = container.createScope()
  scope.set(Context, context)
  scope.set(HonoRequest, context.req)
  return scope
}

/** Create a fresh DI scope for a queued listener execution. */
export function createCompiledQueueScope(
  container: Container,
  env: unknown,
  executionCtx?: unknown,
): RequestScope {
  const scope = container.createScope()
  const context = { env, executionCtx } as Context
  scope.set(Context, context)
  return scope
}

function stableDecoratorValue(value: unknown): string {
  if (value === undefined) return 'undefined'

  if (Array.isArray(value)) {
    return `[${value.map(stableDecoratorValue).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableDecoratorValue(item)}`)
    return `{${entries.join(',')}}`
  }

  return JSON.stringify(value)
}

function decoratorCacheFor(scope: RequestScope): DecoratorCache {
  let cache = requestDecoratorCaches.get(scope)
  if (!cache) {
    cache = new WeakMap()
    requestDecoratorCaches.set(scope, cache)
  }
  return cache
}

export async function resolveCompiledDecorator(
  context: Context,
  scope: RequestScope,
  decorator: RuntimeDecorator,
  args: readonly unknown[],
  resolving: Set<RuntimeDecorator> = new Set(),
): Promise<unknown> {
  const resolver = decorator.__honovelDecoratorResolver
  const dependencies = decorator.__honovelDecoratorDependencies
  const cacheEnabled = decorator.__honovelDecoratorCache !== false

  if (typeof resolver !== 'function') {
    throw new Error('Compiled custom decorator is missing its Honovel resolver.')
  }

  if (resolving.has(decorator)) {
    throw new Error('Circular Honovel custom decorator dependency detected at runtime.')
  }

  const execute = async (): Promise<unknown> => {
    resolving.add(decorator)

    try {
      const resolvedDependencies: unknown[] = []
      for (const dependency of dependencies ?? []) {
        if (
          typeof dependency === 'function'
          && '__honovelDecoratorResolver' in dependency
        ) {
          resolvedDependencies.push(
            await resolveCompiledDecorator(context, scope, dependency as RuntimeDecorator, [], resolving),
          )
          continue
        }

        resolvedDependencies.push(scope.resolve(dependency as InjectionToken))
      }

      return resolver(context, ...resolvedDependencies, ...args)
    } finally {
      resolving.delete(decorator)
    }
  }

  if (!cacheEnabled) return execute()

  const decoratorCache = decoratorCacheFor(scope)
  let values = decoratorCache.get(decorator)
  if (!values) {
    values = new Map()
    decoratorCache.set(decorator, values)
  }

  const cacheKey = stableDecoratorValue(args)
  const cached = values.get(cacheKey)
  if (cached) return cached

  const pending = execute()
  values.set(cacheKey, pending)
  return pending
}

export async function runCompiledHonoMiddleware(
  context: Context,
  middleware: MiddlewareHandler,
  terminal: () => Promise<Response>,
): Promise<Response> {
  let downstreamResponse: Response | undefined
  const result = await middleware(context, async () => {
    downstreamResponse = await terminal()
    context.res = downstreamResponse
  })

  if (result instanceof Response) return result
  if (downstreamResponse) return downstreamResponse
  return context.res
}

export async function runCompiledMiddlewareChain(
  context: Context,
  scope: RequestScope,
  middleware: readonly MiddlewareConstructor[],
  terminal: () => Promise<Response>,
): Promise<Response> {
  let lastIndex = -1

  const dispatch = async (index: number): Promise<Response> => {
    if (index <= lastIndex) {
      throw new Error('Honovel middleware next() may only be called once.')
    }
    lastIndex = index

    if (index === middleware.length) return terminal()

    const MiddlewareType = middleware[index]
    const instance = scope.resolve(MiddlewareType)
    const response = await instance.handle(context, () => dispatch(index + 1))

    if (!(response instanceof Response)) {
      throw new Error(`${MiddlewareType.name || '<anonymous>'}.handle() must return a Response.`)
    }

    return response
  }

  return dispatch(0)
}
