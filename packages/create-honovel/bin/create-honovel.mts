#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm create honovel@latest <project-name> [--frontend=nuxt|none] [--api-only] [--no-install]\nThe backend is always Cloudflare Workers. If no frontend option is given, the installer asks whether to include Nuxt (the non-interactive default).')
    return
  }
  const [name, ...options] = args
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('Use a project name containing lowercase letters, digits, hyphens, or underscores.')
  let frontend = 'nuxt'
  let frontendSelected = false
  let install = true
  for (let index = 0; index < options.length; index++) {
    const option = options[index]
    if (option === '--no-install') {
      install = false
    } else if (option === '--api-only' || option === '--frontend' || option.startsWith('--frontend=')) {
      if (frontendSelected) throw new Error('Select the frontend only once; do not combine --api-only and --frontend.')
      frontendSelected = true
      frontend = option === '--api-only' ? 'none'
        : option === '--frontend' ? options[++index] : option.slice('--frontend='.length)
      if (!['nuxt', 'none'].includes(frontend)) throw new Error('Supported frontend options: nuxt, none.')
    } else if (option === '--template' || option.startsWith('--template=')) {
      throw new Error('All projects use Cloudflare Workers. Use --frontend=nuxt, --frontend=none or --api-only.')
    } else throw new Error('Unknown option. Supported: --frontend=nuxt|none, --api-only, --no-install')
  }
  if (!frontendSelected) frontend = await chooseFrontend()
  if (name.length > 63) throw new Error('Cloudflare project names must be at most 63 characters long.')
  const target = path.resolve(name)
  if (fs.existsSync(target)) throw new Error(`${name} already exists. Choose a new directory.`)
  fs.mkdirSync(target)
  function copy(directory, destination) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name)
      const outputName = entry.name === 'env.example.template'
        ? '.env.example'
        : entry.name.replace(/\.template$/, '')
      const output = path.join(destination, outputName)
      if (entry.isDirectory()) {
        fs.mkdirSync(output, { recursive: true })
        copy(source, output)
      } else {
        if (/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(entry.name)) {
          fs.copyFileSync(source, output)
          continue
        }
        const content = fs.readFileSync(source, 'utf8')
          .replaceAll('__PROJECT_NAME__', name)
          .replaceAll('__WORKER_NAME__', name.replaceAll('_', '-'))
          .replaceAll('__HONOVEL_VERSION__', metadata.version)
        if (fs.existsSync(output) && ['package.json', 'wrangler.jsonc'].includes(outputName)) {
          const current = JSON.parse(fs.readFileSync(output, 'utf8'))
          const overlay = JSON.parse(content)
          const merged = { ...current, ...overlay }
          if (outputName === 'package.json') {
            for (const section of ['scripts', 'dependencies', 'devDependencies', 'overrides']) {
              merged[section] = { ...current[section], ...overlay[section] }
            }
          }
          fs.writeFileSync(output, JSON.stringify(merged, null, 2) + '\n')
        } else fs.writeFileSync(output, content)
      }
    }
  }
  copy(path.join(packageRoot, 'template/common'), target)
  copy(path.join(packageRoot, 'template/cloudflare'), target)
  if (frontend === 'nuxt') copy(path.join(packageRoot, 'template/nuxt'), target)
  const envExamplePath = path.join(target, '.env.example')
  const envPath = path.join(target, '.env')
  if (fs.existsSync(envExamplePath) && !fs.existsSync(envPath)) {
    const localEnv = fs.readFileSync(envExamplePath, 'utf8')
      .replace(/^APP_DEBUG=.*$/m, 'APP_DEBUG=true')
    fs.writeFileSync(envPath, localEnv, { flag: 'wx' })
  }
  if (install) {
    // Drizzle Kit 0.31 still declares deprecated loader packages upstream.
    // Keep the scaffold output focused on actionable install/audit information.
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--loglevel=error'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' })
    if (result.error || result.status !== 0) {
      throw new Error(`Project created at ${target}, but npm install failed. Check the npm output above and run npm install there to retry.`)
    }
  }
  console.log(`Created ${target} (Cloudflare Workers, ${frontend === 'nuxt' ? 'Nuxt frontend' : 'API-only'})\n\nNext:\n  cd ${name}\n${install ? '' : '  npm install\n'}  npm run dev`)
}

async function chooseFrontend() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('[Honovel] No interactive terminal detected; including Nuxt. Pass --api-only or --frontend=none for an API-only project.')
    return 'nuxt'
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('\nCloudflare Workers backend — choose your frontend:\n\n  1) Nuxt frontend (recommended)\n  2) API-only (no frontend)\n')
    const answer = await prompt.question('Select a project setup [1]: ')
    const selected = answer.trim().toLowerCase()
    if (!selected || selected === '1' || selected === 'nuxt') return 'nuxt'
    if (selected === '2' || selected === 'none' || selected === 'api-only') return 'none'
    throw new Error('Choose 1 for Nuxt or 2 for API-only.')
  } finally {
    prompt.close()
  }
}

main().catch((error) => {
  console.error(`[Honovel] ${error.message}`)
  process.exitCode = 1
})
