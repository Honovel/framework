import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'
import type { Readable, Writable } from 'node:stream'

export function forwardFrontendOutput(input: Readable, output: Writable) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false })
  lines.on('line', (line) => {
    const text = stripVTControlCharacters(line).trimEnd()
    if (text.trim()) output.write(`[Nuxt] ${text}\n`)
  })
  return lines
}

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
