import {AnyD1Database} from "drizzle-orm/d1";

export type AppBindings = {
  JWT_SECRET: string,
  DB: AnyD1Database
}

export type AppEnv = {
  Bindings: AppBindings
}
