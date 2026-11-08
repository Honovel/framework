# Database

Honovel uses Drizzle ORM as its standard database layer. A generated starter contains a database provider, an empty schema barrel, Drizzle configuration and a migrations directory. No application tables or initial SQL migration are generated. New projects always use Cloudflare D1, with or without Nuxt. Tables below are examples that you add yourself.

## Default structure

```text
src/database/main/
  MainDatabase.ts
  drizzle.config.ts
  schema/
    index.ts       # initially exports no tables
  migrations/
```

## Define tables

```ts
// src/database/main/schema/users.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

Export schema files through the barrel:

```ts
// src/database/main/schema/index.ts
export * from './users'
```

## Database provider

Cloudflare D1 example:

```ts
import type { Context } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { defineDatabase } from 'honovel'
import type { AppEnv } from '../../env'
import * as schema from './schema'

export class MainDatabase extends defineDatabase(
  (context: Context<AppEnv>) => drizzle(context.env.DB, { schema }),
) {}
```

## Inject the database

```ts
export class UserRepository {
  constructor(private readonly database: MainDatabase) {}

  all() {
    return this.database.client.select().from(users)
  }
}
```

The provider is lazy and its client is reused within the current request scope.

## Insert data

```ts
async create(input: NewUser) {
  const [user] = await this.database.client
    .insert(users)
    .values(input)
    .returning()

  return user
}
```

## Query data

```ts
async find(id: number) {
  const [user] = await this.database.client
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  return user ?? null
}
```

## Recommended layering

```text
Controller -> Action/Service -> Repository -> MainDatabase
```

This keeps HTTP concerns and persistence details separate.

## Drizzle configuration

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/main/schema/*.ts',
  out: './src/database/main/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

## Generate migrations

```bash
npm run honovel -- db:generate add-users
npm run honovel -- db:generate add-users --db=main
```

Review generated SQL before applying it. For the first migration, add your schema files and export their tables from `schema/index.ts` before running the command. Do not create migration snapshots or journal entries manually.

The starter shortcut `npm run db:generate` selects `main`. After defining and migrating a table, `make:resource users/User --table=users --database=main` can generate CRUD classes around that existing table; it does not define the table for you.

## Manual migration

```bash
npm run honovel -- make:migration backfill-users --db=main
```

## Run migrations

Generated Nuxt and API-only projects both use Wrangler for D1:

```bash
npm run db:migrate                 # local D1 database
npm run db:migrate:remote          # remote D1 database
```

Before remote migrations, create the database named in `wrangler.jsonc` and replace its placeholder `database_id`. Run `npm run compile` after changing bindings to refresh the generated configuration. Migrations do not run automatically when the app starts.

The multi-database Honovel commands below apply to manually configured Drizzle Kit databases. For D1, use the corresponding Wrangler database names and local/remote options.

## Multiple databases

```text
src/database/
  main/
    MainDatabase.ts
    drizzle.config.ts
    schema/
    migrations/
  analytics/
    AnalyticsDatabase.ts
    drizzle.config.ts
    schema/
    migrations/
```

Inject the provider you need:

```ts
export class AnalyticsRepository {
  constructor(private readonly database: AnalyticsDatabase) {}
}
```

Run selected databases:

```bash
npm run honovel -- db:migrate --db=main,analytics
```

or all configured databases:

```bash
npm run honovel -- db:migrate --all
```

## Transactions

Request scope is not a transaction. Use Drizzle transactions explicitly:

```ts
await this.database.client.transaction(async (tx) => {
  await tx.insert(users).values(user)
  await tx.insert(auditLogs).values(log)
})
```

## SQL dialects

Honovel keeps the provider pattern stable but does not hide Drizzle dialect differences. Moving between SQLite, PostgreSQL and MySQL may require schema and query changes.
