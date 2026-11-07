import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export function checkDeployConfig() {
  // Read the source config, not the generated file which may be stale.
  const configPath = path.resolve('wrangler.jsonc')
  const parsed = ts.parseConfigFileTextToJson(configPath, fs.readFileSync(configPath, 'utf8'))
  if (parsed.error) {
    throw new Error('[Honovel] Cannot read wrangler.jsonc. Fix its JSON syntax before deploying.')
  }

  const databases = (parsed.config.d1_databases ?? []).filter(
    (database) => database.database_id === '00000000-0000-0000-0000-000000000000',
  )
  if (databases.length === 0) return

  const instructions = databases.map((database) => [
    `D1 binding ${JSON.stringify(database.binding)} (${database.database_name}) still has the placeholder database_id.`,
    `  1. Create the database: npx wrangler d1 create ${JSON.stringify(database.database_name)}`,
    '     If it already exists, find its ID with: npx wrangler d1 list',
    '  2. Replace database_id in the existing binding in wrangler.jsonc with the real ID.',
    '     Keep the binding name and migrations_dir; do not edit .honovel.wrangler.jsonc.',
    '  3. Regenerate the config: npm run compile',
    `  4. Apply migrations: npx wrangler d1 migrations apply ${JSON.stringify(database.database_name)} --remote`,
  ].join('\n')).join('\n\n')

  throw new Error(`[Honovel] Deployment stopped before uploading assets or provisioning resources.\n\n${instructions}\n\nThen run npm run deploy again.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkDeployConfig()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
