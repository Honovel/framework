import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const registry = 'https://registry.npmjs.org/'
export const githubRegistry = 'https://npm.pkg.github.com/'
export const packageDirectories = ['core', 'packages/cloudflare', 'packages/node', 'packages/create-honovel']

export function packPackages(destination = path.join(root, 'dist/packages'), version, { targetRegistry = registry, prebuilt = false } = {}) {
  if (![registry, githubRegistry].includes(targetRegistry)) throw new Error('Unsupported package registry.')
  fs.mkdirSync(destination, { recursive: true })
  if (!prebuilt) {
    execFileSync(process.execPath, ['core/scripts/build-package.mjs'], { cwd: root, stdio: 'inherit' })
    execFileSync(process.execPath, ['packages/cloudflare/scripts/build-package.mjs'], { cwd: root, stdio: 'inherit' })
    execFileSync(process.execPath, ['packages/node/scripts/build-package.mjs'], { cwd: root, stdio: 'inherit' })
  }
  const staging = version || targetRegistry !== registry ? fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-package-stage-')) : null
  try {
    const records = packageDirectories.map((directory) => {
      const source = path.join(root, directory)
      const packageRoot = staging ? path.join(staging, directory) : source
      if (staging) {
        fs.cpSync(source, packageRoot, { recursive: true })
        const metadataPath = path.join(packageRoot, 'package.json')
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        metadata.publishConfig = { ...metadata.publishConfig, registry: targetRegistry }
        if (version) metadata.version = version.replace(/^v/, '')
        if (version && metadata.peerDependencies?.['@honovel/core']) {
          metadata.peerDependencies['@honovel/core'] = version.replace(/^v/, '')
        }
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
      }
      const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
      if (metadata.publishConfig?.registry !== targetRegistry || metadata.publishConfig?.access !== 'public') {
        throw new Error(`${directory} must target the selected public package registry.`)
      }
      const [record] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
        cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
      }))
      const forbidden = record.files.filter(({ path: file }) => /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.git\/|node_modules\/|testing\/|.*-check\.mjs$)/.test(file))
      if (forbidden.length) throw new Error(`Unexpected files in ${metadata.name}: ${forbidden.map((file) => file.path).join(', ')}`)
      return { ...record, tarball: path.join(destination, record.filename), directory, registry: targetRegistry }
    })
    if (!version && records.some((record) => record.version !== records[0].version)) {
      throw new Error('All Honovel packages must have matching release versions.')
    }
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(records, null, 2) + '\n')
    return records
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const record of packPackages()) console.log(`${record.name}@${record.version}: ${record.tarball}`)
}
