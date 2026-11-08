import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })

await build({
  absWorkingDir: root,
  entryPoints: ['index.ts'],
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  packages: 'external',
  target: 'es2022',
  sourcemap: true,
})
