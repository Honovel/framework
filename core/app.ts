import { Hono, type Env } from 'hono'

export function createHonoApp<TEnv extends Env = Env>(): Hono<TEnv> {
  return new Hono<TEnv>()
}
