import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { packPackages, registry, githubRegistry } from './pack-packages.mjs'
import { createHash } from 'node:crypto'

interface ReleaseOptions {
  token?: string
  version?: string
  targetRegistry?: string
  packagesDirectory?: string
  skipExisting?: boolean
  oidc?: boolean
  pack?: typeof packPackages
  request?: typeof fetch
  publish?: typeof publishTarball
  log?: (message: string) => void
}

function publishTarball(record, npmrc, token, targetRegistry) {
  execFileSync('npm', ['publish', record.tarball, '--ignore-scripts', '--access=public', `--registry=${targetRegistry}`, `--tag=${record.version.split('+')[0].includes('-') ? 'next' : 'latest'}`, `--userconfig=${npmrc}`], {
    cwd: path.dirname(npmrc), stdio: 'inherit', env: { ...process.env, NODE_AUTH_TOKEN: token ?? '' },
  })
}

export function loadPackages(directory, targetRegistry) {
  const records = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  if (!Array.isArray(records) || records.length !== 4) throw new Error('Expected four verified release packages.')
  const expected = new Set(['@honovel/core', '@honovel/cloudflare', '@honovel/node', '@honovel/create-honovel'])
  return records.map((record) => {
    if (!expected.delete(record.name) || record.registry !== targetRegistry || path.basename(record.filename) !== record.filename) {
      throw new Error('Package artifact does not match the selected registry or expected packages.')
    }
    const tarball = path.resolve(directory, record.filename)
    const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')
    if (integrity !== record.integrity) throw new Error(`Artifact integrity check failed for ${record.name}.`)
    return { ...record, tarball }
  })
}

export async function releasePackages({
  token = process.env.NODE_AUTH_TOKEN,
  version = process.env.HONOVEL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME,
  targetRegistry = githubRegistry,
  packagesDirectory,
  skipExisting = false,
  oidc = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  pack = packPackages,
  request = fetch,
  publish = publishTarball,
  log = console.log,
}: ReleaseOptions = {}) {
  if (![registry, githubRegistry].includes(targetRegistry)) throw new Error('Unsupported package registry.')
  if (!token && !(targetRegistry === registry && oidc)) throw new Error('Set NODE_AUTH_TOKEN for the selected registry, or configure npm trusted publishing (OIDC). GitHub Packages uses GITHUB_TOKEN with packages:write. Do not commit the token.')
  const records = packagesDirectory ? loadPackages(packagesDirectory, targetRegistry) : pack(undefined, version || undefined, { targetRegistry })
  if (version && records.some((record) => record.version !== version.replace(/^v/, ''))) throw new Error('Package artifact version does not match the release tag.')
  const pending: Array<{ name: string; version: string; tarball: string }> = []
  // Check every package before the first upload so conflicting versions and
  // authentication failures cannot cause a partial release.
  for (const record of records) {
    const response = await request(`${targetRegistry}${encodeURIComponent(record.name)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) { pending.push(record); continue }
    if (!response.ok) throw new Error(`Package registry preflight failed (HTTP ${response.status}). Nothing was published.`)
    const metadata = await response.json()
    const existing = metadata.versions?.[record.version]
    if (existing) {
      if (!skipExisting || !record.integrity || existing.dist?.integrity !== record.integrity) {
        throw new Error(`${record.name}@${record.version} already exists with an unverified or different artifact. Nothing was published.`)
      }
      log(`Already published: ${record.name}@${record.version} (${targetRegistry})`)
    } else pending.push(record)
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-publish-'))
  try {
    const npmrc = path.join(temporary, 'npmrc')
    const authentication = token ? `//${new URL(targetRegistry).host}/:_authToken=\${NODE_AUTH_TOKEN}\n` : ''
    fs.writeFileSync(npmrc, `@honovel:registry=${targetRegistry}\n${authentication}`, { mode: 0o600 })
    for (const record of pending) {
      await publish(record, npmrc, token, targetRegistry)
      log(`Published ${record.name}@${record.version} to ${targetRegistry}.`)
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

export function releaseFromCli(targetRegistry) {
  const args = process.argv.slice(2)
  let packagesDirectory
  let skipExisting = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--packages-dir' && args[index + 1]) packagesDirectory = args[++index]
    else if (args[index] === '--skip-existing') skipExisting = true
    else throw new Error(`Unknown or incomplete release option: ${args[index]}`)
  }
  return releasePackages({ targetRegistry, packagesDirectory, skipExisting })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => releaseFromCli(githubRegistry)).catch((error) => {
    console.error(`[Honovel release] ${error.message}`)
    process.exitCode = 1
  })
}
