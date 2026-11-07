import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Wrangler invokes this script as its custom build, including while running
// `wrangler types`. Never compile from here during type generation, otherwise
// Wrangler can recursively invoke its own custom build.
if (process.env.HONOVEL_TYPEGEN === '1' || process.env.HONOVEL_PRECOMPILED === '1') {
  process.exit(0)
}

const directory = fileURLToPath(new URL('../../../', import.meta.url))
const result = spawnSync(
  process.execPath,
  [path.join(directory, 'cli/honovel.mjs'), 'compile'],
  { stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
