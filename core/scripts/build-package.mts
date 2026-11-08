import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildTooling } from './build-tooling.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
await buildTooling(root, ['cli', 'compiler', 'scripts', 'tools', 'typescript-plugin'])
// This directory is generated exclusively by this build; exclude stale chunks from releases.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
const entryPoints = ['index.ts', 'app.ts']
function collectEntries(directory: string): void {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) collectEntries(file)
    else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) entryPoints.push(file)
  }
}
for (const directory of ['cloudflare', 'cache', 'database', 'di', 'dispatch', 'http', 'lock', 'logging', 'openapi', 'queue', 'schedule']) collectEntries(directory)
await build({
  absWorkingDir: root,
  entryPoints,
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  packages: 'external',
  target: 'es2022',
  sourcemap: true,
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, target: 'ES2022', useDefineForClassFields: true } },
})
