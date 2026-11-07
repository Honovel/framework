import type { MiddlewareConstructor } from './Middleware'

export type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

const classDecorator = (): ClassDecorator => () => undefined
const methodDecorator = (): MethodDecorator => () => undefined
const classOrMethodDecorator = (): ClassDecorator & MethodDecorator => (() => undefined) as ClassDecorator & MethodDecorator
const parameterDecorator = (): ParameterDecorator => () => undefined

export const BaseUrl = (paths: string | readonly string[]): ClassDecorator => classDecorator()
export const Get = (path: string): MethodDecorator => methodDecorator()
export const Post = (path: string): MethodDecorator => methodDecorator()
export const Put = (path: string): MethodDecorator => methodDecorator()
export const Patch = (path: string): MethodDecorator => methodDecorator()
export const Delete = (path: string): MethodDecorator => methodDecorator()
export const Middleware = (
  ...middleware: (MiddlewareConstructor | readonly MiddlewareConstructor[])[]
): ClassDecorator & MethodDecorator => classOrMethodDecorator()
export const Query = (key?: string): ParameterDecorator => parameterDecorator()
export const Param = (key?: string): ParameterDecorator => parameterDecorator()
