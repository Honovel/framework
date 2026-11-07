import type { Context } from 'hono'

type AnyContext = Context<any, any, any>

export type MiddlewareNext = () => Promise<Response>

export abstract class BaseMiddleware {
  protected declare readonly __honovelMiddlewareBrand: void

  abstract handle(
    context: AnyContext,
    next: MiddlewareNext,
  ): Response | Promise<Response>
}

export type MiddlewareConstructor<TMiddleware extends BaseMiddleware = BaseMiddleware> =
  new (...args: any[]) => TMiddleware
