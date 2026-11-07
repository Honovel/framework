import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-framework-'))
function run(entry, args = []) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: temporary, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${entry} failed (${result.status ?? result.signal}).`)
}
try {
  fs.cpSync(path.join(root, 'test/fixtures/application'), temporary, { recursive: true })
  fs.cpSync(path.join(root, 'core'), path.join(temporary, 'core'), { recursive: true })
  fs.mkdirSync(path.join(temporary, 'test'))
  const checks = fs.readdirSync(path.join(root, 'test')).filter((name) => name.endsWith('-check.mjs') && name !== 'honovel-packages-check.mjs').sort()
  for (const name of checks) fs.copyFileSync(path.join(root, 'test', name), path.join(temporary, 'test', name))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'junction')
  const [command, ...args] = process.argv.slice(2)
  if (['dev', 'deploy', 'cf-typegen'].includes(command)) {
    for (const name of ['.env', '.dev.vars']) {
      if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(temporary, name))
    }
    const wranglerArgs = command === 'dev' ? ['dev', '--port', '8788']
      : command === 'deploy' ? ['deploy', '--minify'] : ['types', '--env-interface', 'CloudflareBindings']
    run(path.join(root, 'node_modules/wrangler/bin/wrangler.js'), [...wranglerArgs, ...args])
  } else if (command) {
    if (!['compile', 'build', 'typecheck'].includes(command)) throw new Error(`Unknown fixture command: ${command}`)
    run('core/cli/honovel.mjs', [command, ...args])
  } else {
    run('core/compiler/honovel-build.mjs')
    for (const name of checks) run(`test/${name}`)
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
