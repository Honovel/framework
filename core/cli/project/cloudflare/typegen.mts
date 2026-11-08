import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(path.resolve('package.json'))
const directory = path.dirname(require.resolve('wrangler/package.json'))
const result = spawnSync(
  process.execPath,
  [path.join(directory, 'bin/wrangler.js'), 'types', '--env-interface', 'CloudflareBindings'],
  {
    stdio: 'inherit',
    env: { ...process.env, HONOVEL_TYPEGEN: '1' },
  },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
