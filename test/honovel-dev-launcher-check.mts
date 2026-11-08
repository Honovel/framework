import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Use real child processes to exercise the combined launcher's terminal setup,
// stream forwarding, and shutdown when one of the tools fails.
if (process.platform !== 'win32') {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-dev-launcher-'))
  try {
    fs.writeFileSync(path.join(temporary, 'npm'), `#!/usr/bin/env node
const assert = require('node:assert/strict')
assert.equal(Boolean(process.stdin.isTTY), false)
assert.equal(Boolean(process.stdout.isTTY), false)
assert.equal(Boolean(process.stderr.isTTY), false)
assert.equal(process.argv[2], '--silent')
assert.equal(process.argv[3], 'run')
if (process.argv[4] === 'dev:frontend') {
  assert.equal(process.env.NUXT_TUI, 'plain')
  console.log('Frontend ready')
  console.error('Frontend warning')
  setTimeout(() => process.exit(17), 300)
} else {
  assert.equal(process.argv[4], 'dev:backend')
  setTimeout(() => console.log('[wrangler:info] Ready on ' + process.env.HONOVEL_BACKEND_DEV_URL), 50)
  setInterval(() => {}, 1000)
}
`, { mode: 0o755 })
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../core/cli/project/cloudflare/dev.mjs', import.meta.url))], {
      cwd: temporary,
      env: { ...process.env, PATH: `${temporary}${path.delimiter}${process.env.PATH}`, NUXT_TUI: 'force' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 17, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[Nuxt\] Frontend ready/)
    assert.match(result.stderr, /\[Nuxt\] Frontend warning/)
    assert.match(result.stdout, /Backend ready on internal port/)
    assert.match(result.stdout, /Backend ready on internal port[^\n]*\n\[Honovel\] Open app: http:\/\/localhost:5173\n/)
    assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1:\d+/)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

console.log('[Honovel] Dev launcher terminal and shutdown check passed.')
