import type { Context, Hono } from 'hono'
import { HTTPException as HonoHTTPException } from 'hono/http-exception'
import { Logger } from '../logging/Logger.js'
import { ValidationException } from './validation.js'
import { honovelIconDataUrl } from './branding.js'

type AnyContext = Context<any, any, any>

export class HttpException extends Error {
  constructor(
    public readonly status: number,
    message: string,
    private readonly responseBody?: unknown,
    public readonly headers?: HeadersInit,
  ) {
    super(message)
    this.name = new.target.name
  }

  toResponse(): unknown {
    return this.responseBody ?? { message: this.message }
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request') {
    super(400, message)
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(401, message)
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(403, message)
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(404, message)
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict') {
    super(409, message)
  }
}

export class TooManyRequestsException extends HttpException {
  readonly retryAfterSeconds?: number

  constructor(message = 'Too Many Requests', retryAfterSeconds?: number) {
    super(
      429,
      message,
      retryAfterSeconds === undefined ? undefined : { message, retryAfterSeconds },
      retryAfterSeconds === undefined ? undefined : { 'Retry-After': String(retryAfterSeconds) },
    )
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function debugEnabled(context: AnyContext): boolean {
  const value = (context.env as Record<string, unknown> | undefined)?.APP_DEBUG

  if (value === true || value === 1) return true
  if (typeof value !== 'string') return false

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function wantsHtml(context: AnyContext): boolean {
  const accept = context.req.header('Accept')?.toLowerCase() ?? ''
  return accept.includes('text/html') && !accept.includes('application/json')
}

function debugResponse(error: unknown): {
  message: string
  exception: string
  stack?: string
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      exception: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }

  return {
    message: String(error),
    exception: 'UnknownError',
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function statusTitle(status: number): string {
  return new Map<number, string>([
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [409, 'Conflict'],
    [422, 'Unprocessable Entity'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
    [503, 'Service Unavailable'],
  ]).get(status) ?? 'Request Failed'
}

type HtmlErrorOptions = {
  status: number
  message: string
  error?: unknown
  validationErrors?: Record<string, string[]>
}

function renderHtmlException(context: AnyContext, options: HtmlErrorOptions): Response {
  const debug = debugEnabled(context)
  const details = options.error === undefined ? undefined : debugResponse(options.error)
  const validationEntries = Object.entries(options.validationErrors ?? {})
  const validationHtml = validationEntries.length > 0
    ? `<section class="validation"><h2>Validation errors</h2><ul>${validationEntries
        .flatMap(([field, messages]) => messages.map((message) => `<li><strong>${escapeHtml(field)}</strong><span>${escapeHtml(message)}</span></li>`))
        .join('')}</ul></section>`
    : ''
  const debugHtml = debug && details
    ? `<section class="debug"><div class="debug-title"><span>Debug details</span><div class="debug-actions"><code>${escapeHtml(details.exception)}</code>${details.stack ? '<button class="copy-stack" type="button" data-copy-stack>Copy</button>' : ''}</div></div>${details.stack ? `<pre data-stacktrace>${escapeHtml(details.stack)}</pre>` : ''}</section>`
    : ''
  const title = statusTitle(options.status)

  return context.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${options.status} ${escapeHtml(title)} · Honovel</title>
  <link rel="icon" type="image/png" href="${honovelIconDataUrl}">
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0d1117; color: #f0f3f6; }
    main { width: min(920px, calc(100% - 40px)); margin: 0 auto; padding: 10vh 0 64px; }
    .brand { display: inline-flex; align-items: center; gap: 9px; margin-bottom: 52px; color: #8b949e; font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .brand-icon { width: 32px; height: 32px; object-fit: contain; }
    .status { color: #8b949e; font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 12px; font-size: clamp(38px, 7vw, 68px); line-height: 1; letter-spacing: -.045em; }
    .message { max-width: 720px; margin: 0; color: #b7c0ca; font-size: 18px; line-height: 1.65; }
    section { margin-top: 36px; border: 1px solid #30363d; border-radius: 14px; background: #161b22; overflow: hidden; }
    section h2 { margin: 0; padding: 16px 18px; border-bottom: 1px solid #30363d; color: #c9d1d9; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }
    .validation ul { list-style: none; margin: 0; padding: 0; }
    .validation li { display: grid; grid-template-columns: minmax(120px, 220px) 1fr; gap: 20px; padding: 14px 18px; border-top: 1px solid #21262d; }
    .validation li:first-child { border-top: 0; }
    .validation strong { color: #f0f3f6; font-size: 14px; }
    .validation span { color: #b7c0ca; font-size: 14px; }
    .debug-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid #30363d; color: #8b949e; font-size: 13px; font-weight: 700; text-transform: uppercase; }
    .debug-title code { color: #c9d1d9; text-transform: none; }
    .debug-actions { display: flex; align-items: center; gap: 10px; }
    .copy-stack { appearance: none; border: 1px solid #30363d; border-radius: 7px; background: #21262d; color: #c9d1d9; padding: 5px 9px; font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
    .copy-stack:hover { background: #2d333b; border-color: #484f58; color: #f0f3f6; }
    .copy-stack:focus-visible { outline: 2px solid #7c5cff; outline-offset: 2px; }
    pre { margin: 0; padding: 18px; overflow: auto; color: #d2a8ff; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
    footer { margin-top: 34px; color: #6e7681; font-size: 13px; }
    @media (prefers-color-scheme: light) {
      body { background: #f6f8fa; color: #1f2328; }
      .message { color: #59636e; }
      section { border-color: #d0d7de; background: #fff; }
      section h2, .debug-title { border-color: #d8dee4; color: #59636e; }
      .validation li { border-color: #eaeef2; }
      .validation strong { color: #1f2328; }
      .validation span { color: #59636e; }
      .debug-title code { color: #1f2328; }
      .copy-stack { border-color: #d0d7de; background: #f6f8fa; color: #59636e; }
      .copy-stack:hover { border-color: #afb8c1; background: #eef1f4; color: #1f2328; }
      pre { color: #6639ba; }
    }
    @media (max-width: 620px) { .validation li { grid-template-columns: 1fr; gap: 5px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><img class="brand-icon" src="${honovelIconDataUrl}" alt="" width="32" height="32">Honovel</div>
    <div class="status">${options.status} · ${escapeHtml(title)}</div>
    <h1>${escapeHtml(debug && details ? details.exception : title)}</h1>
    <p class="message">${escapeHtml(options.message)}</p>
    ${validationHtml}
    ${debugHtml}
    <footer>${debug ? 'APP_DEBUG is enabled.' : ''}</footer>
  </main>
  <script>
    document.querySelector('[data-copy-stack]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      const stack = document.querySelector('[data-stacktrace]')?.textContent ?? ''
      if (!stack) return

      try {
        await navigator.clipboard.writeText(stack)
        button.textContent = 'Copied'
        setTimeout(() => { button.textContent = 'Copy' }, 1400)
      } catch {
        button.textContent = 'Copy failed'
        setTimeout(() => { button.textContent = 'Copy' }, 1400)
      }
    })
  </script>
</body>
</html>`, options.status as never)
}

export type ErrorContext = AnyContext

export type ErrorDetails = {
  status: number
  message: string
  body: unknown
  headers: Headers
  html: boolean
  requestId?: string
  validationErrors?: Record<string, string[]>
  debug?: {
    message: string
    exception: string
    stack?: string
  }
}

export type ErrorRenderer<ErrorBody = unknown> = (
  context: ErrorContext,
  error: unknown,
  details: ErrorDetails,
) => Response | Promise<Response>

const errorRenderers = new WeakMap<object, ErrorRenderer>()

function resolveErrorDetails(
  context: AnyContext,
  error: unknown,
  html: boolean,
): ErrorDetails {
  const requestId = context.get('requestId') as string | undefined
  const base = {
    html,
    requestId,
    headers: new Headers(),
  }

  if (error instanceof ValidationException) {
    const body = error.toResponse()
    return {
      ...base,
      status: 422,
      message: body.message,
      body,
      validationErrors: body.errors,
    }
  }

  if (error instanceof HttpException) {
    return {
      ...base,
      status: error.status,
      message: error.message,
      body: error.toResponse(),
      headers: new Headers(error.headers),
    }
  }

  if (error instanceof HonoHTTPException) {
    return {
      ...base,
      status: error.status,
      message: error.message || statusTitle(error.status),
      body: undefined,
    }
  }

  const debug = debugEnabled(context) ? debugResponse(error) : undefined
  return {
    ...base,
    status: 500,
    message: 'Internal Server Error',
    body: debug ?? { message: 'Internal Server Error' },
    debug: debug
      ? {
          message: debug.message,
          exception: debug.exception,
          ...(debug.stack ? { stack: debug.stack } : {}),
        }
      : undefined,
  }
}

function finalizeErrorResponse(
  context: AnyContext,
  response: Response,
  details: ErrorDetails,
): Response {
  const headerName = context.get('requestIdHeader') as string | undefined ?? 'X-Request-Id'
  const securityHeaders = context.get('securityHeaders') as Record<string, string> | undefined

  response.headers.set('Cache-Control', 'no-store')

  for (const [name, value] of Object.entries(securityHeaders ?? {})) {
    response.headers.set(name, value)
  }
  if (details.requestId) response.headers.set(headerName, details.requestId)
  for (const [name, value] of details.headers) {
    response.headers.set(name, value)
  }

  return response
}

function renderDefaultException(
  context: AnyContext,
  error: unknown,
  details: ErrorDetails,
): Response {
  if (details.html) {
    return renderHtmlException(context, {
      status: details.status,
      message: details.debug?.message ?? details.message,
      error,
      validationErrors: details.validationErrors,
    })
  }

  if (error instanceof HonoHTTPException) {
    return error.getResponse()
  }

  return context.json(details.body as never, details.status as never)
}

function logServerError(context: AnyContext, error: unknown, details: ErrorDetails): void {
  if (details.status < 500) return

  Logger.named(context, 'ExceptionHandler').error(error instanceof Error ? error.message : String(error), 'http.exception', {
    status: details.status,
    method: context.req.method,
    path: context.req.path,
    exception: error instanceof Error ? error.name : 'UnknownError',
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  })
}

export async function renderException(
  context: AnyContext,
  error: unknown,
  renderer?: ErrorRenderer,
): Promise<Response> {
  const details = resolveErrorDetails(context, error, wantsHtml(context))
  logServerError(context, error, details)

  const response = !details.html && renderer
    ? await renderer(context, error, details)
    : renderDefaultException(context, error, details)

  return finalizeErrorResponse(context, response, details)
}

/**
 * Install an application-specific JSON error renderer for one Hono app.
 *
 * Browser requests that prefer HTML keep Honovel's default debug page. The
 * renderer receives normalized status, body and header information, plus the
 * request ID stored by `requestContext()`.
 */
export function setErrorRenderer<ErrorBody = unknown>(
  app: Hono<any, any, any>,
  renderer: ErrorRenderer<ErrorBody>,
): void {
  errorRenderers.set(app, renderer)
}

export function clearErrorRenderer(app: Hono<any, any, any>): void {
  errorRenderers.delete(app)
}

export function registerExceptionHandler(app: Hono<any, any, any>): void {
  app.onError(async (error, context) => {
    const renderer = errorRenderers.get(app)

    try {
      return await renderException(context, error, renderer)
    } catch (rendererError) {
      if (!renderer) throw rendererError

      console.error('[Honovel] Custom error renderer failed.', rendererError)
      return renderException(context, error)
    }
  })
}
