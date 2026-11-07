#!/usr/bin/env node
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseGenerateCommand } from './commands/DatabaseGenerateCommand.mjs'
import { DatabaseMigrateCommand } from './commands/DatabaseMigrateCommand.mjs'
import { MakeActionCommand } from './commands/MakeActionCommand.mjs'
import { MakeControllerCommand } from './commands/MakeControllerCommand.mjs'
import { MakeFeatureCommand } from './commands/MakeFeatureCommand.mjs'
import { MakeMiddlewareCommand } from './commands/MakeMiddlewareCommand.mjs'
import { MakeMigrationCommand } from './commands/MakeMigrationCommand.mjs'
import { MakeRepositoryCommand } from './commands/MakeRepositoryCommand.mjs'
import { MakeRequestCommand } from './commands/MakeRequestCommand.mjs'
import { MakeResourceCommand } from './commands/MakeResourceCommand.mjs'
import { MakeResponseCommand } from './commands/MakeResponseCommand.mjs'
import { MakeServiceCommand } from './commands/MakeServiceCommand.mjs'

const commands = [
  DatabaseGenerateCommand,
  DatabaseMigrateCommand,
  MakeActionCommand,
  MakeControllerCommand,
  MakeFeatureCommand,
  MakeMiddlewareCommand,
  MakeMigrationCommand,
  MakeRequestCommand,
  MakeResourceCommand,
  MakeResponseCommand,
  MakeRepositoryCommand,
  MakeServiceCommand,
]

function commandName(CommandType) {
  return CommandType.signature.split(/\s+/)[0]
}

function printHelp() {
  console.log('Honovel CLI')
  console.log('')
  console.log('Usage: npm run honovel -- <command> [arguments]')
  console.log('')
  console.log('Commands:')
  console.log('  compile [options]'.padEnd(32) + 'Compile the application to Hono')
  console.log('  build [options]'.padEnd(32) + 'Compile in production mode')
  console.log('  typecheck'.padEnd(32) + 'Check types and Honovel diagnostics')
  console.log('  frontend:build'.padEnd(32) + 'Generate and copy the frontend assets')
  console.log('  cloudflare:<command>'.padEnd(32) + 'compile, build, typegen, dev, dev-backend, predeploy, deploy')
  console.log('  list'.padEnd(32) + 'List available commands')
  for (const CommandType of commands) {
    console.log(`  ${CommandType.signature}`.padEnd(32) + CommandType.description)
  }
}

async function main() {
  const [requestedCommand, ...args] = process.argv.slice(2)
  if (!requestedCommand || requestedCommand === 'list' || requestedCommand === '--help' || requestedCommand === '-h') {
    printHelp()
    return
  }

  if (['compile', 'build', 'typecheck'].includes(requestedCommand)) {
    process.argv = [process.argv[0], process.argv[1], ...args,
      ...(requestedCommand === 'build' ? ['--mode=production'] : []),
      ...(requestedCommand === 'typecheck' ? ['--no-emit'] : []),
    ]
    await import('../compiler/honovel-build.mjs')
    return
  }

  const projectCommands = {
    'frontend:build': 'build-frontend',
    'cloudflare:compile': 'cloudflare/compile',
    'cloudflare:build': 'cloudflare/wrangler-build',
    'cloudflare:typegen': 'cloudflare/typegen',
    'cloudflare:dev': 'cloudflare/dev',
    'cloudflare:dev-backend': 'cloudflare/dev-backend',
    'cloudflare:predeploy': 'cloudflare/deploy-preflight',
    'cloudflare:deploy': 'cloudflare/wrangler-deploy',
  }
  if (Object.hasOwn(projectCommands, requestedCommand)) {
    const { spawnSync } = await import('node:child_process')
    const entry = fileURLToPath(new URL(`./project/${projectCommands[requestedCommand]}.mjs`, import.meta.url))
    const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
    return
  }

  const CommandType = commands.find((candidate) => commandName(candidate) === requestedCommand)
  if (!CommandType) throw new Error(`Unknown command "${requestedCommand}". Run "npm run honovel -- list" to see available commands.`)

  const minArgs = CommandType.minArgs ?? 1
  const maxArgs = CommandType.maxArgs ?? 1
  if (args.length < minArgs) throw new Error(`${CommandType.signature} requires more arguments.`)
  if (args.length > maxArgs) throw new Error(`${CommandType.signature} received too many arguments.`)

  const command = new CommandType({
    projectRoot: process.cwd(),
    frameworkImport: path.resolve(fileURLToPath(new URL('../', import.meta.url))) === path.join(process.cwd(), 'core')
      ? undefined
      : JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name,
    output: (message) => console.log(`[Honovel] ${message}`),
  })
  await command.handle({ name: args[0], args })
}

main().catch((error) => {
  console.error(`[Honovel] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
