import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { packPackages, root } from './pack-packages.mjs'

function fail(message) {
  throw new Error(message)
}

function parseArgs() {
  const [name, ...options] = process.argv.slice(2)
  if (!name || name === '--help' || name === '-h') {
    console.log('Usage: npm run create:local -- <project-name> [--frontend=nuxt|none] [--api-only]')
    process.exit(0)
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    fail('Use a project name containing lowercase letters, digits, hyphens, or underscores.')
  }

  let frontend = 'nuxt'
  let selected = false
  for (let index = 0; index < options.length; index++) {
    const option = options[index]
    if (selected) fail('Select the frontend only once.')
    if (option === '--api-only' || option === '--frontend' || option.startsWith('--frontend=')) {
      selected = true
      frontend = option === '--api-only' ? 'none'
        : option === '--frontend' ? options[++index] : option.slice('--frontend='.length)
    } else fail(`Unknown option: ${option}. Use --frontend=nuxt|none or --api-only.`)
  }
  if (!['nuxt', 'none'].includes(frontend)) fail('Supported frontend options: nuxt, none.')
  return { name, frontend }
}

function npm(args, options = {}) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: 'inherit',
    ...options,
  })
}

function packageRecord(records, name) {
  const record = records.find((candidate) => candidate.name === name)
  if (!record) fail(`Packed package ${name} was not found.`)
  return record
}

function installLocalPackage(metadata, records, packageName, packageDirectory) {
  const record = packageRecord(records, packageName)
  const target = path.join(packageDirectory, record.filename)
  fs.copyFileSync(record.tarball, target)
  metadata.dependencies[packageName] = `file:./.honovel-local-packages/${record.filename}`
}

const { name, frontend } = parseArgs()
const localRoot = path.join(root, '.local-tests')
const target = path.join(localRoot, name)
if (fs.existsSync(target)) fail(`${target} already exists. Remove it or choose another project name.`)

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-create-local-'))
const localVersion = `0.0.0-local.${Date.now()}`

try {
  fs.mkdirSync(localRoot, { recursive: true })

  console.log(`[Honovel local] Packing current worktree as ${localVersion}...`)
  const records = packPackages(path.join(temporary, 'packages'), localVersion)
  const initializer = packageRecord(records, '@honovel/create-honovel')

  const cliRoot = path.join(temporary, 'cli')
  npm(['install', '--prefix', cliRoot, '--ignore-scripts', '--no-audit', '--no-fund', initializer.tarball])
  const creator = path.join(cliRoot, 'node_modules/@honovel/create-honovel/bin/create-honovel.mjs')

  execFileSync(process.execPath, [creator, name, `--frontend=${frontend}`, '--no-install'], {
    cwd: localRoot,
    stdio: 'inherit',
  })

  const metadataPath = path.join(target, 'package.json')
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  const packageDirectory = path.join(target, '.honovel-local-packages')
  fs.mkdirSync(packageDirectory, { recursive: true })

  installLocalPackage(metadata, records, '@honovel/core', packageDirectory)
  installLocalPackage(metadata, records, '@honovel/cloudflare', packageDirectory)

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n')

  console.log('[Honovel local] Installing generated project with local Honovel packages...')
  npm(['install', '--no-audit', '--no-fund'], { cwd: target })

  // Build the selected API-only or Nuxt project using the packed framework.
  console.log('[Honovel local] Running production build...')
  npm(['run', 'build'], { cwd: target })

  console.log(`\n[Honovel local] Ready: ${target}`)
  console.log(`Local package version: ${localVersion}`)
  console.log('\nNext:')
  console.log(`  cd ${path.relative(root, target)}`)
  console.log('  npm run dev')
} catch (error) {
  console.error(`\n[Honovel local] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
