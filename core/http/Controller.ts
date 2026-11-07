import type { Context } from 'hono'

type AnyContext = Context<any, any, any>

const controllerContexts = new WeakMap<BaseController, AnyContext>()

export abstract class BaseController {
  protected get context(): AnyContext {
    const context = controllerContexts.get(this)

    if (!context) {
      throw new Error('Controller context is only available while handling a request.')
    }

    return context
  }

  protected json<T>(data: T, status = 200): Response {
    return this.context.json(data, status as never)
  }

  protected noContent(): Response {
    return this.context.body(null, 204)
  }
}

/**
 * Backwards-compatible Core controller base.
 *
 * New applications normally extend the application-level Controller generated
 * under src/runtime/Controller.ts instead.
 */
export abstract class Controller extends BaseController {}

export function bindControllerContext(
  controller: BaseController,
  context: AnyContext,
): void {
  controllerContexts.set(controller, context)
}
