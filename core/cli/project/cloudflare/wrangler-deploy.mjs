import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { checkDeployConfig } from './deploy-preflight.mjs'

// Also protect direct invocation of this script. Local dry runs need no remote DB.
if (!process.argv.slice(2).some((arg) => arg === '--dry-run' || arg === '--dry-run=true')) {
  try {
    checkDeployConfig()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

function run(entry, args, env = process.env) {
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Generate the Worker and Cron configuration before Wrangler reads its config.
run(fileURLToPath(new URL('./compile.mjs', import.meta.url)), ['--mode', 'production'])

const require = createRequire(path.resolve('package.json'))
const wranglerDirectory = path.dirname(require.resolve('wrangler/package.json'))
// Skip only this deployment's custom build; direct Wrangler commands still compile.
run(path.join(wranglerDirectory, 'bin/wrangler.js'), ['deploy', ...process.argv.slice(2)], {
  ...process.env,
  HONOVEL_PRECOMPILED: '1',
})
