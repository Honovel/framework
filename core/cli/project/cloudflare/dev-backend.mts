import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const debug = process.argv.includes('--debug')
const port = process.env.HONOVEL_BACKEND_PORT || '8788'

// Wrangler validates configured assets before starting. API-only projects have
// no assets binding and should not create a frontend output directory.
const configPath = path.resolve('wrangler.jsonc')
const parsed = ts.parseConfigFileTextToJson(configPath, fs.readFileSync(configPath, 'utf8'))
if (parsed.error) throw new Error('Cannot read wrangler.jsonc. Fix its JSON syntax before starting development.')
const assetsDirectory = parsed.config.assets?.directory
if (typeof assetsDirectory === 'string') fs.mkdirSync(path.resolve(assetsDirectory), { recursive: true })

const require = createRequire(path.resolve('package.json'))
const wranglerDirectory = path.dirname(require.resolve('wrangler/package.json'))
const wrangler = path.join(wranglerDirectory, 'bin/wrangler.js')

const typegen = spawnSync(process.execPath, [fileURLToPath(new URL('./typegen.mjs', import.meta.url))], {
  stdio: 'inherit',
  env: process.env,
})

if (typegen.error) throw typegen.error
if (typegen.status !== 0) process.exit(typegen.status ?? 1)

const args = [wrangler, 'dev', '--port', port]
if (debug) {
  args.push('--inspector-ip', '127.0.0.1', '--inspector-port', '9229')
} else {
  args.push('--inspector-port', '0')
}

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
