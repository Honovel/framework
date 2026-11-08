import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'
import type { Readable, Writable } from 'node:stream'

// Only the combined Nuxt/Worker dev command filters Wrangler's internal URL.
// Standalone API projects keep Wrangler's normal output and interactive UI.
export function forwardBackendOutput(input: Readable, output: Writable, { appUrl, backendPort }: { appUrl: string; backendPort: number }) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  const ready = new RegExp(`\\bReady on https?://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${backendPort}(?:/)?(?:\\s|$)`)

  lines.on('line', (line) => {
    if (ready.test(stripVTControlCharacters(line))) {
      output.write(`[Honovel] Backend ready on internal port ${backendPort} (proxied by Nuxt)\n`)
      output.write(`[Honovel] Open app: ${appUrl}\n`)
    } else {
      output.write(`${line}\n`)
    }
  })
  return lines
}
