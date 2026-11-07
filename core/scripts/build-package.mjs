import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
// This directory is generated exclusively by this build; exclude stale chunks from releases.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
const entryPoints = ['index.ts', 'app.ts']
for (const directory of ['cache', 'database', 'di', 'dispatch', 'http', 'lock', 'logging', 'openapi', 'queue', 'schedule']) {
  for (const file of fs.readdirSync(path.join(root, directory))) {
    if (file.endsWith('.ts')) entryPoints.push(`${directory}/${file}`)
  }
}
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
