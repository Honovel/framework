export type BindingReference<T = string> = {
  readonly __honovelBinding: true
  readonly name: string
  readonly __type?: T
}

export const Binding = <T = string>(name: string): BindingReference<T> => ({
  __honovelBinding: true,
  name,
})

type StaticAuthValue<T> =
  T extends string ? T | BindingReference<string>
    : T extends readonly (infer TValue)[] ? readonly StaticAuthValue<TValue>[]
      : T extends (...args: any[]) => any ? never
        : T extends object ? { [TKey in keyof T]: StaticAuthValue<T[TKey]> }
          : T

export type BasicAuthOptions = StaticAuthValue<
  Parameters<typeof import('hono/basic-auth').basicAuth>[0]
>

export type BearerAuthOptions = StaticAuthValue<
  Parameters<typeof import('hono/bearer-auth').bearerAuth>[0]
>

export type JwtAuthOptions = StaticAuthValue<
  Parameters<typeof import('hono/jwt').jwt>[0]
>

const classOrMethodDecorator = (): ClassDecorator & MethodDecorator =>
  (() => undefined) as ClassDecorator & MethodDecorator

export const BasicAuth = (_options: BasicAuthOptions): ClassDecorator & MethodDecorator =>
  classOrMethodDecorator()

export const BearerAuth = (_options: BearerAuthOptions): ClassDecorator & MethodDecorator =>
  classOrMethodDecorator()

export const JwtAuth = (_options: JwtAuthOptions): ClassDecorator & MethodDecorator =>
  classOrMethodDecorator()
