import assert from 'node:assert/strict'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { forwardBackendOutput } from '../core/cli/project/cloudflare/dev-output.mjs'

async function capture(chunks, backendPort = 8788) {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''
  output.on('data', (chunk) => { text += chunk.toString() })
  const lines = forwardBackendOutput(input, output, { appUrl: 'http://localhost:5173', backendPort })
  const closed = once(lines, 'close')
  for (const chunk of chunks) input.write(chunk)
  input.end()
  await closed
  return text
}

// Wrangler can finish after Nuxt, and its readiness line can span pipe chunks.
const startup = await capture([
  'Compiling worker...\r\n[wrangler:info] Ready on http://127.0.',
  '0.1:8788\r\n',
])
assert.equal(startup, [
  'Compiling worker...',
  '[Honovel] Backend ready on internal port 8788 (proxied by Nuxt)',
  '[Honovel] Open app: http://localhost:5173',
  '',
].join('\n'))
assert.ok(!startup.includes('http://127.0.0.1:8788'))

// Keep useful errors, request URLs, color, and a final line without a newline.
const diagnostics = '\u001b[31mWorker error\u001b[0m\nGET http://127.0.0.1:8788/api failed\nLast warning'
assert.equal(await capture([diagnostics]), `${diagnostics}\n`)

// Port fallback, alternate local host names, ANSI colors, and worker restarts.
for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
  const ready = `\u001b[32m[wrangler:info] Ready on http://${host}:49152/\u001b[0m\n`
  const output = await capture([ready, ready], 49152)
  assert.equal(output.match(/Open app: http:\/\/localhost:5173/g)?.length, 2)
  assert.ok(!output.includes(`http://${host}:49152`))
}

console.log('[Honovel] Dev output check passed.')
