import { createDecorator } from '../../http/customDecorators.js'
import type { Context } from 'hono'

type AnyContext = Context<any, any, any>

export type ClientIpOptions = {
  /**
   * Trust the first `X-Forwarded-For` entry when Cloudflare's
   * `CF-Connecting-IP` header is absent. Keep this disabled unless every
   * request reaches the worker through a proxy that overwrites the header.
   */
  trustForwardedFor?: boolean
}

export function resolveClientIp(
  context: AnyContext,
  options: ClientIpOptions = {},
): string {
  const connectingIp = context.req.header('CF-Connecting-IP')
  if (connectingIp) return connectingIp

  if (options.trustForwardedFor) {
    const forwardedFor = context.req.header('X-Forwarded-For')
    const first = forwardedFor?.split(',')[0]?.trim()
    if (first) return first
  }

  return 'unknown'
}

/**
 * Resolve the client IP from Cloudflare's trusted `CF-Connecting-IP` header.
 *
 * `X-Forwarded-For` is ignored by default because clients can spoof it unless
 * a trusted proxy overwrites the header.
 */
export const ClientIp = createDecorator(
  (context: AnyContext, options: ClientIpOptions = {}) => resolveClientIp(context, options),
  { cache: false },
)
