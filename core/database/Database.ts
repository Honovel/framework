import type { Context, Env } from 'hono'

export type DatabaseFactory<TEnv extends Env = Env, TClient = unknown> = (
  context: Context<TEnv>,
) => TClient

export type DatabaseClient<TFactory extends (...args: any[]) => unknown> = ReturnType<TFactory>

export function defineDatabase<TEnv extends Env, TClient>(
  factory: DatabaseFactory<TEnv, TClient>,
): new (context: Context<TEnv>) => Database<TClient> {
  return class DatabaseProvider extends Database<TClient> {
    constructor(context: Context<TEnv>) {
      super(() => factory(context))
    }
  }
}

export class Database<TClient = unknown> {
  static readonly __honovelBuiltin = 'database' as const

  private resolved = false
  private value?: TClient

  constructor(private readonly factory: () => TClient) {}

  get client(): TClient {
    if (!this.resolved) {
      this.value = this.factory()
      this.resolved = true
    }

    return this.value as TClient
  }
}
