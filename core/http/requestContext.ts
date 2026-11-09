import type { Context, MiddlewareHandler } from 'hono'
import { Logger } from '../logging/Logger.js'

type AnyContext = Context<any, any, any>

export const requestIdKey = 'requestId'
export const requestIdHeader = 'X-Request-Id'

export type RequestContextOptions = {
  /** Response header used for the generated request ID. */
  requestIdHeader?: string
  /** Factory used to create a request ID. Defaults to `crypto.randomUUID()`. */
  generateRequestId?: () => string
  /** Additional headers added to every response handled by this middleware. */
  securityHeaders?: Record<string, string>
  /** Emit a structured warning for rate-limited and forbidden requests. */
  log?: boolean
}

const defaultSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function logRejectedRequest(
  context: AnyContext,
  requestId: string,
  startedAt: number,
  status: number,
): void {
  if (status !== 403 && status !== 429) return

  Logger.named(context, 'RequestContext').warn('http.request', 'http.request', {
    requestId,
    method: context.req.method,
    path: context.req.path,
    status,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * Attach a request ID, security headers and structured request logs.
 *
 * The request ID is written to the Hono context under `requestId`, which
 * `Logger` and the default exception handler use automatically.
 */
export function requestContext(options: RequestContextOptions = {}): MiddlewareHandler {
  const headerName = options.requestIdHeader ?? requestIdHeader
  const generateRequestId = options.generateRequestId ?? (() => crypto.randomUUID())
  const securityHeaders = {
    ...defaultSecurityHeaders,
    ...options.securityHeaders,
  }
  const log = options.log ?? true

  return async (context, next) => {
    const requestId = generateRequestId()
    const startedAt = Date.now()
    context.set(requestIdKey, requestId)
    context.set('requestIdHeader', headerName)
    context.set('securityHeaders', securityHeaders)

    try {
      await next()
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status: number }).status
        : 500

      if (log) logRejectedRequest(context, requestId, startedAt, status)
      throw error
    }

    const response = context.res
    for (const [name, value] of Object.entries(securityHeaders)) {
      response.headers.set(name, value)
    }
    response.headers.set(headerName, requestId)

    if (log) logRejectedRequest(context, requestId, startedAt, response.status)

    return response
  }
}
