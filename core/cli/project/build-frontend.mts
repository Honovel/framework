import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const npm = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(npm, ['nuxt', 'generate', 'frontend'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error || result.status !== 0) process.exit(result.status ?? 1)

const generated = path.join(root, 'frontend', '.output', 'public')
const target = path.join(root, 'dist', 'frontend')
if (!existsSync(generated)) throw new Error(`Nuxt output not found at ${generated}`)
rmSync(target, { recursive: true, force: true })
mkdirSync(path.dirname(target), { recursive: true })
cpSync(generated, target, { recursive: true })
