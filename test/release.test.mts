import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { releasePackages, loadPackages } from '../scripts/release-github.mjs'
import { registry, githubRegistry } from '../scripts/pack-packages.mjs'

const names = ['@honovel/core', '@honovel/cloudflare', '@honovel/node', '@honovel/create-honovel']
const records = names.map((name) => ({ name, version: '1.2.3', integrity: 'sha512-verified' }))
const defaults = { version: 'v1.2.3', token: 'local-test-placeholder', pack: () => records, log: () => {} }

for (const targetRegistry of [registry, githubRegistry]) {
  test(`preflight, upload configuration and cleanup: ${targetRegistry}`, async () => {
    let requested = 0
    const uploaded: string[] = []
    let authFile
    await releasePackages({ ...defaults, targetRegistry,
      request: async (url, options) => {
        assert.equal(url, targetRegistry + encodeURIComponent(records[requested++].name))
        assert.equal(options.headers.Authorization, 'Bearer local-test-placeholder')
        assert.equal(options.redirect, 'error')
        return new Response('{}', { status: requested === 1 ? 404 : 200 })
      },
      publish: async (record, npmrc, token, selectedRegistry) => {
        assert.equal(requested, 4)
        assert.equal(selectedRegistry, targetRegistry)
        assert.equal(token, defaults.token)
        const text = fs.readFileSync(npmrc, 'utf8')
        assert.ok(text.includes(`@honovel:registry=${targetRegistry}`))
        assert.ok(text.includes(`//${new URL(targetRegistry).host}/:_authToken=\${NODE_AUTH_TOKEN}`))
        assert.ok(!text.includes(defaults.token))
        assert.equal(fs.statSync(npmrc).mode & 0o777, 0o600)
        authFile = npmrc
        uploaded.push(record.name)
      },
    })
    assert.deepEqual(uploaded, names)
    assert.equal(fs.existsSync(authFile), false)
  })
}

test('authentication and version errors stop before packing or publishing', async () => {
  const noWork = () => assert.fail('No packaging or upload expected')
  await assert.rejects(releasePackages({ token: '', oidc: false, pack: noWork }), /Set NODE_AUTH_TOKEN/)
  await assert.rejects(releasePackages({ ...defaults, version: 'v2.0.0', publish: noWork }), /does not match/)
})

test('npm trusted publishing uses OIDC without a stored registry token', async () => {
  let count = 0
  await releasePackages({ ...defaults, token: '', oidc: true, targetRegistry: registry,
    request: async (_url, options) => { assert.deepEqual(options.headers, {}); return new Response('{}', { status: 404 }) },
    publish: async (_record, npmrc) => { assert.ok(!fs.readFileSync(npmrc, 'utf8').includes('_authToken')); count++ },
  })
  assert.equal(count, 4)
})

for (const status of [401, 403, 503]) {
  test(`registry error ${status} prevents every upload`, async () => {
    await assert.rejects(releasePackages({ ...defaults,
      request: async () => new Response('{}', { status }),
      publish: () => assert.fail('No upload expected'),
    }), /preflight failed/)
  })
}

test('a rerun only skips byte-identical already-published artifacts', async () => {
  const existing = (integrity) => async () => new Response(JSON.stringify({ versions: { '1.2.3': { dist: { integrity } } } }))
  await releasePackages({ ...defaults, skipExisting: true, request: existing(records[0].integrity), publish: () => assert.fail('All packages already exist') })
  await assert.rejects(releasePackages({ ...defaults, skipExisting: true, request: existing('different') }), /already exists/)
})

test('upload failure cleans up the temporary authentication file', async () => {
  let authFile
  await assert.rejects(releasePackages({ ...defaults,
    request: async () => new Response('{}', { status: 404 }),
    publish: (_record, npmrc) => { authFile = npmrc; throw new Error('Upload failed') },
  }), /Upload failed/)
  assert.equal(fs.existsSync(authFile), false)
})

test('artifact manifest is rebased, validated and checked for tampering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-artifact-test-'))
  try {
    const artifacts = records.map((record, index) => {
      const filename = `package-${index}.tgz`
      const data = Buffer.from(record.name)
      fs.writeFileSync(path.join(directory, filename), data)
      return { ...record, filename, tarball: '/previous/runner/package.tgz', registry, integrity: 'sha512-' + createHash('sha512').update(data).digest('base64') }
    })
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(artifacts))
    assert.equal(loadPackages(directory, registry)[0].tarball, path.join(directory, artifacts[0].filename))
    assert.throws(() => loadPackages(directory, githubRegistry), /registry/)
    fs.writeFileSync(path.join(directory, artifacts[0].filename), 'modified')
    assert.throws(() => loadPackages(directory, registry), /integrity/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
