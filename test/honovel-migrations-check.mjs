import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { migrate } from 'drizzle-orm/sql-js/migrator'
import { sql } from 'drizzle-orm'
import { DrizzleKitCommand } from '../core/cli/DrizzleKitCommand.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-migrations-'))
const databases = []
try {
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction')
  const definitions = { main: ['todos', 'billing'], analytics: ['events'] }
  for (const [name, tables] of Object.entries(definitions)) {
    const directory = path.join(root, 'src/database', name)
    fs.mkdirSync(path.join(directory, 'schema'), { recursive: true })
    for (const table of tables) {
      fs.writeFileSync(path.join(directory, 'schema', `${table}.ts`), `
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core'
export const ${table} = sqliteTable('${table}', { id: integer('id').primaryKey() })
`)
    }
    fs.writeFileSync(path.join(directory, 'schema/index.ts'), tables.map((table) => `export * from './${table}'`).join('\n'))
    fs.writeFileSync(path.join(directory, 'drizzle.config.mjs'), `export default ${JSON.stringify({
      dialect: 'sqlite', schema: `./src/database/${name}/schema/*.ts`,
      out: `./src/database/${name}/migrations`,
    })}`)
  }
  const command = new DrizzleKitCommand({ projectRoot: root })
  command.runDrizzleKit(['generate', '--all'])
  const SQL = await initSqlJs()
  for (const [name, tables] of Object.entries(definitions)) {
    const native = new SQL.Database()
    databases.push(native)
    const db = drizzle(native)
    const config = { migrationsFolder: path.join(root, 'src/database', name, 'migrations') }
    migrate(db, config)
    for (const table of tables) {
      db.run(sql`insert into ${sql.identifier(table)} (id) values (1)`)
      assert.equal(db.get(sql`select id from ${sql.identifier(table)}`).id, 1)
    }
    migrate(db, config)
    assert.equal(db.get(sql`select count(*) as count from __drizzle_migrations`).count, 1)
    const other = name === 'main' ? 'events' : 'todos'
    assert.throws(() => db.all(sql`select * from ${sql.identifier(other)}`), /no such table/)
    const snapshot = JSON.parse(fs.readFileSync(path.join(config.migrationsFolder, 'meta/0000_snapshot.json'), 'utf8'))
    assert.deepEqual(Object.keys(snapshot.tables).sort(), [...tables].sort())
  }
  // Multiple schema files and barrel re-exports must not cause duplicate changes.
  command.runDrizzleKit(['generate', '--db=main'])
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'src/database/main/migrations/meta/_journal.json'), 'utf8'))
  assert.equal(journal.entries.length, 1)
  console.log('[Honovel] Central database migrations, multiple schema files, and SQLite isolation passed.')
} finally {
  for (const db of databases) db.close()
  fs.rmSync(root, { recursive: true, force: true })
}
