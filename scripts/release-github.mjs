import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { packPackages, registry } from './pack-packages.mjs'

function publishTarball(record, npmrc, token) {
  execFileSync('npm', ['publish', record.tarball, '--ignore-scripts', '--access=public', `--registry=${registry}`, `--userconfig=${npmrc}`], {
    cwd: path.dirname(npmrc), stdio: 'inherit', env: { ...process.env, NODE_AUTH_TOKEN: token },
  })
}

export async function releasePackages({
  token = process.env.NODE_AUTH_TOKEN,
  version = process.env.HONOVEL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME,
  pack = packPackages,
  request = fetch,
  publish = publishTarball,
  log = console.log,
} = {}) {
  if (!token) throw new Error('Set NODE_AUTH_TOKEN to the workflow GITHUB_TOKEN (packages:write) or a GitHub personal access token (classic) with write:packages. Do not commit the token.')
  const records = pack(undefined, version || undefined)
  // Check every package before the first upload so conflicting versions and
  // authentication failures cannot cause a partial release.
  for (const record of records) {
    const response = await request(`${registry}${encodeURIComponent(record.name)}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`GitHub Packages preflight failed (HTTP ${response.status}). Nothing was published.`)
    const metadata = await response.json()
    if (metadata.versions?.[record.version]) throw new Error(`${record.name}@${record.version} already exists. Nothing was published.`)
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-publish-'))
  try {
    const npmrc = path.join(temporary, 'npmrc')
    fs.writeFileSync(npmrc, `@honovel:registry=${registry}\n//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}\n`, { mode: 0o600 })
    for (const record of records) {
      await publish(record, npmrc, token)
      log(`Published ${record.name}@${record.version} to GitHub Packages.`)
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  releasePackages().catch((error) => {
    console.error(`[Honovel release] ${error.message}`)
    process.exitCode = 1
  })
}
