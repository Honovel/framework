import type { Context } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { defineDatabase } from '../../../core'
import type { AppEnv } from '../../env'
import * as schema from './schema'

export class MainDatabase extends defineDatabase(
  (context: Context<AppEnv>) => drizzle(context.env.DB, { schema }),
) {}
