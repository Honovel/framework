declare module 'cloudflare:workers' {
  interface DurableObjectTransaction {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
  }

  interface DurableObjectStorage extends DurableObjectTransaction {
    deleteAll(): Promise<void>
    transaction<T>(callback: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T>
  }

  interface DurableObjectState {
    readonly storage: DurableObjectStorage
  }

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState
    protected readonly env: Env

    constructor(ctx: DurableObjectState, env: Env)
  }
}
