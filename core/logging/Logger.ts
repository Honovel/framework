import type { Context } from 'hono'

type AnyContext = Context<any, any, any>
type NamedService = {
  readonly serviceName?: string
  readonly name?: string
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogKind = 'log' | 'audit'
export type LogFields = Record<string, unknown>

function serviceNameOf(service: string | NamedService): string {
  if (typeof service === 'string') return service
  return service.serviceName ?? service.name ?? 'App'
}

/**
 * Request-scoped structured logger.
 *
 * Inject it into services and bind the emitting service once:
 *
 *   private readonly logger: Logger<AuthService>
 *   constructor(logger: Logger<AuthService>) {
 *     this.logger = logger.forService(AuthService)
 *   }
 *
 * Services may declare `static readonly serviceName = 'AuthService'` so logs
 * keep a stable name after bundling and minification.
 */
export class Logger<T = unknown> {
  static readonly __honovelBuiltin = 'logger'

  private serviceName = 'App'

  constructor(
    private readonly context: AnyContext,
    service?: string | NamedService,
  ) {
    if (service) this.serviceName = serviceNameOf(service)
  }

  static named(context: AnyContext, service: string | NamedService): Logger {
    return new Logger(context, service)
  }

  forService<U = T>(service: string | NamedService): Logger<U> {
    return new Logger<U>(this.context, service)
  }

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', 'log', event, fields)
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', 'log', event, fields)
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', 'log', event, fields)
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', 'log', event, fields)
  }

  audit(event: string, fields: LogFields = {}): void {
    this.write('info', 'audit', event, fields)
  }

  private write(level: LogLevel, kind: LogKind, event: string, fields: LogFields): void {
    const requestId = this.context.get('requestId') as string | undefined
    const line = JSON.stringify({
      ...fields,
      timestamp: new Date().toISOString(),
      level,
      kind,
      service: this.serviceName,
      ...(requestId ? { requestId } : {}),
      event,
    })

    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else if (level === 'debug') console.debug(line)
    else console.log(line)
  }
}
