import { createHonoApp } from './core'
import type { AppEnv } from './src/env'
import { basicAuth } from 'hono/basic-auth'

const app = createHonoApp<AppEnv>()


export default app
