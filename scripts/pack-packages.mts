import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const registry = 'https://registry.npmjs.org/'
export const packageDefinitions = [
  { directory: 'core', name: 'honovel' },
  { directory: 'packages/create-honovel', name: 'create-honovel' },
]

export function packPackages(destination = path.join(root, 'dist/packages'), version?: string, { prebuilt = false } = {}) {
  fs.mkdirSync(destination, { recursive: true })
  if (!prebuilt) {
    execFileSync(process.execPath, ['core/scripts/build-package.mjs'], { cwd: root, stdio: 'inherit' })
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: path.join(root, 'packages/create-honovel'), stdio: 'inherit',
    })
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-package-stage-'))
  try {
    const records = packageDefinitions.map(({ directory, name }) => {
      const source = path.join(root, directory)
      const packageRoot = path.join(staging, name)
      fs.cpSync(source, packageRoot, { recursive: true })
      const metadataPath = path.join(packageRoot, 'package.json')
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      if (metadata.name !== name) throw new Error(`Unexpected package name in ${directory}: ${metadata.name}.`)
      if (version) metadata.version = version.replace(/^v/, '')
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
      if (metadata.publishConfig?.registry !== registry || metadata.publishConfig?.access !== 'public') {
        throw new Error(`${directory} must target the public npm registry.`)
      }
      const [record] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
        cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
      }))
      const forbidden = record.files.filter(({ path: file }) => /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.git\/|node_modules\/|testing\/|.*-check\.mjs$)/.test(file))
      if (forbidden.length) throw new Error(`Unexpected files in ${metadata.name}: ${forbidden.map((file) => file.path).join(', ')}`)
      return { ...record, tarball: path.join(destination, record.filename), directory, registry }
    })
    if (!version && records.some((record) => record.version !== records[0].version)) {
      throw new Error('All Honovel packages must have matching release versions.')
    }
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(records, null, 2) + '\n')
    return records
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const record of packPackages()) console.log(`${record.name}@${record.version}: ${record.tarball}`)
}
