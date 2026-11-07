import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// `wrangler types` invokes Wrangler's configured custom build while it is
// generating worker-configuration.d.ts. At that point the generated Cloudflare
// types may not exist yet, so the custom build must not compile the application.
if (process.env.HONOVEL_TYPEGEN === '1') {
  process.exit(0)
}

function runNode(entry, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Keep `npm run compile` usable immediately after scaffolding. Normal dev/build
// commands run cf-typegen explicitly, so this is only a first-run bootstrap.
if (!fs.existsSync(path.resolve('worker-configuration.d.ts'))) {
  runNode(fileURLToPath(new URL('./typegen.mjs', import.meta.url)))
}

const directory = fileURLToPath(new URL('../../../', import.meta.url))
runNode(
  path.join(directory, 'cli/honovel.mjs'),
  ['compile', ...process.argv.slice(2)],
)
