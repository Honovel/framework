import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { packPackages, registry, root } from './pack-packages.mjs'

async function main() {
  if (!process.env.GITEA_TOKEN) throw new Error('Set GITEA_TOKEN to a Gitea token with write:package and read:organization permissions. Do not commit the token.')
  const headers = { Authorization: `token ${process.env.GITEA_TOKEN}` }
  const organizationResponse = await fetch('https://api.github.com/orgs/Honovel', { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!organizationResponse.ok) throw new Error(`Could not verify Honovel organization privacy (HTTP ${organizationResponse.status}). Nothing was published.`)
  const organization = await organizationResponse.json()
  if (organization.visibility !== 'private') throw new Error('Honovel organization must have private visibility before publishing. Nothing was published.')

  // The Git tag is the publish version. Package manifests are only used as a
  // fallback for local publishing when no release tag is present.
  const releaseTag = process.env.HONOVEL_RELEASE_TAG ?? process.env.GITHUB_REF_NAME
  const records = packPackages(undefined, releaseTag || undefined)
  for (const record of records) {
    const response = await fetch(`${registry}${encodeURIComponent(record.name)}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`Registry preflight failed (HTTP ${response.status}). Nothing was published.`)
    const metadata = await response.json()
    if (metadata.versions?.[record.version]) throw new Error(`${record.name}@${record.version} already exists. Nothing was published.`)
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-publish-'))
  try {
    const npmrc = path.join(temporary, 'npmrc')
    fs.writeFileSync(npmrc, `@honovel:registry=${registry}\n//npm.pkg.github.com/:_authToken=\${GITEA_TOKEN}\n`, { mode: 0o600 })
    for (const record of records) {
      execFileSync('npm', ['publish', record.tarball, '--ignore-scripts', '--access=restricted', `--registry=${registry}`, `--userconfig=${npmrc}`], { cwd: temporary, stdio: 'inherit' })
      console.log(`Published ${record.name}@${record.version} to the private Honovel registry.`)
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[Honovel release] ${error.message}`)
  process.exitCode = 1
})
