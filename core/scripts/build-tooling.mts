import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

/** Emit Node entry points beside their TypeScript sources, preserving runtime paths. */
export async function buildTooling(root: string, directories: string[]): Promise<void> {
  const sources: string[] = []
  function collect(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.vitepress', '.honovel', '.local-tests'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(file)
      else if (/\.(?:mts|cts)$/.test(entry.name) && !/\.d\.(?:mts|cts)$/.test(entry.name)) sources.push(file)
    }
  }
  for (const directory of directories) collect(path.join(root, directory))

  for (const [extension, format, outputExtension] of [
    ['.mts', 'esm', '.mjs'],
    ['.cts', 'cjs', '.cjs'],
  ] as const) {
    const entryPoints = sources.filter((file) => file.endsWith(extension))
    if (!entryPoints.length) continue
    await build({
      absWorkingDir: root,
      entryPoints,
      outbase: root,
      outdir: root,
      outExtension: { '.js': outputExtension },
      bundle: false,
      format,
      platform: 'node',
      target: 'node22',
      sourcemap: 'linked',
    })
  }
}
