import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/database/main/schema/*.ts',
  out: './src/database/main/migrations',
  // Preserve the existing journal name so previously applied migrations stay recorded.
  migrations: { table: '__honovel_todos_migrations' },
  // Generation needs no connection. Set the target for Drizzle Kit commands
  // that connect to a database; runtime D1 bindings are configured separately.
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
})
