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
 * Execution-scoped structured logger for HTTP requests and background work.
 *
 * The compiler automatically binds injected loggers to the receiving class:
 *
 *   constructor(private readonly logger: Logger) {}
 *
 * Services may declare `static readonly serviceName = 'Authentication'` to
 * override the name. The default class name remains stable after minification.
 */
export class Logger {
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

  forService(service: string | NamedService): Logger {
    return new Logger(this.context, service)
  }

  debug(message: string): void
  debug(message: string, fields: LogFields): void
  debug(message: string, event: string): void
  debug(message: string, event: string, fields: LogFields): void
  debug(message: string, eventOrFields: string | LogFields = 'log', fields: LogFields = {}): void {
    this.write('debug', 'log', message, eventOrFields, fields)
  }

  info(message: string): void
  info(message: string, fields: LogFields): void
  info(message: string, event: string): void
  info(message: string, event: string, fields: LogFields): void
  info(message: string, eventOrFields: string | LogFields = 'log', fields: LogFields = {}): void {
    this.write('info', 'log', message, eventOrFields, fields)
  }

  warn(message: string): void
  warn(message: string, fields: LogFields): void
  warn(message: string, event: string): void
  warn(message: string, event: string, fields: LogFields): void
  warn(message: string, eventOrFields: string | LogFields = 'log', fields: LogFields = {}): void {
    this.write('warn', 'log', message, eventOrFields, fields)
  }

  error(message: string): void
  error(message: string, fields: LogFields): void
  error(message: string, event: string): void
  error(message: string, event: string, fields: LogFields): void
  error(message: string, eventOrFields: string | LogFields = 'log', fields: LogFields = {}): void {
    this.write('error', 'log', message, eventOrFields, fields)
  }

  audit(message: string): void
  audit(message: string, fields: LogFields): void
  audit(message: string, event: string): void
  audit(message: string, event: string, fields: LogFields): void
  audit(message: string, eventOrFields: string | LogFields = 'log', fields: LogFields = {}): void {
    this.write('info', 'audit', message, eventOrFields, fields)
  }

  private write(
    level: LogLevel,
    kind: LogKind,
    message: string,
    eventOrFields: string | LogFields,
    fields: LogFields,
  ): void {
    const event = typeof eventOrFields === 'string' ? eventOrFields : 'log'
    const customFields = typeof eventOrFields === 'string' ? fields : eventOrFields
    // Queue and cron scopes provide environment bindings without HTTP variables.
    const requestId = this.context.get?.('requestId') as string | undefined
    const line = JSON.stringify({
      ...customFields,
      timestamp: new Date().toISOString(),
      level,
      kind,
      service: this.serviceName,
      ...(requestId ? { requestId } : {}),
      event,
      message,
    })

    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else if (level === 'debug') console.debug(line)
    else console.log(line)
  }
}
