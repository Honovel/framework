# Databases

Keep each database under its own directory here, e.g. `main/MainDatabase.ts`, `main/schema/*.ts`, `main/drizzle.config.ts`, and `main/migrations/`.

Nuxt and API-only projects both include a configured `main` D1 database with an empty schema and no initial SQL migration. No Todo table or CRUD feature is created.

For example, create `main/schema/todos.ts` with:

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
})
```

Export it from `main/schema/index.ts` with `export * from './todos'`. Then run `npm run db:generate` and `npm run db:migrate`. Only add the table if your application needs it. Create `<project>-main` and replace the placeholder `database_id` in `wrangler.jsonc` before remote migrations or deployment.

Import `MainDatabase` and the tables only in feature repositories. Additional connections can be added as sibling directories under `src/database/`, each with its own provider, schema, Drizzle config, and migrations.

Database providers extend `defineDatabase(...)`, are lazy and request-scoped, and should be injected into repositories rather than controllers. Keep long-lived driver clients/pools outside the provider factory where the runtime supports it; do not cache a request-specific Hono context or binding globally.

The starter uses the stable Drizzle Kit 0.31 line and overrides its nested esbuild version to a secure release. The upstream Kit package still declares deprecated `@esbuild-kit` loader packages; the initializer suppresses those non-actionable npm deprecation notices during its automatic install. Revisit this workaround when Drizzle Kit 1.0 is stable.

Generate migrations with `npm run db:generate`, then apply them through Wrangler using `npm run db:migrate` (local D1) or `npm run db:migrate:remote` (remote D1).
