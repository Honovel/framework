import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Command } from './Command.mjs'

export class DrizzleKitCommand extends Command {
  drizzleKitRuns(args: string[]) {
    const forwarded: string[] = []
    let databaseNames: string[] | undefined
    let all = false
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]
      if (argument === '--feature' || argument.startsWith('--feature=')) {
        throw new Error('Database configurations now live in src/database/<name>. Use --db instead of --feature.')
      }
      if (argument === '--all') {
        all = true
      } else if (argument === '--db' || argument.startsWith('--db=')) {
        if (databaseNames) throw new Error('Use one --db option with comma-separated database names in migration order.')
        const value = argument === '--db' ? args[++index] : argument.slice('--db='.length)
        databaseNames = value?.split(',')
        if (!databaseNames?.length || databaseNames.some((name) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) {
          throw new Error('--db requires database names such as main or main,analytics.')
        }
        if (new Set(databaseNames).size !== databaseNames.length) throw new Error('Duplicate database selection.')
      } else forwarded.push(argument)
    }
    const hasConfig = args.some((argument) =>
      argument === '--config' || argument.startsWith('--config='),
    )
    if ((all && databaseNames) || (hasConfig && (all || databaseNames))) {
      throw new Error('Choose --config, --db, or --all, not a combination.')
    }
    if (hasConfig) return [forwarded]

    const root = path.join(this.context.projectRoot, 'src/database')
    const available = fs.existsSync(root)
      ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
      : []
    const configurations = new Map<string, string>()
    for (const name of databaseNames ?? available) {
      const configs = ['ts', 'mjs', 'js', 'mts', 'cts', 'cjs']
        .map((extension) => `src/database/${name}/drizzle.config.${extension}`)
        .filter((file) => fs.existsSync(path.join(this.context.projectRoot, file)))
      if (configs.length > 1) throw new Error(`Multiple Drizzle configs found for database ${name}; select one with --config.`)
      if (configs.length) configurations.set(name, configs[0])
      else if (databaseNames) throw new Error(`No Drizzle config found for database ${name}.`)
    }
    if (!databaseNames && !all && configurations.size > 1) {
      throw new Error('Multiple databases found. Select --db=name, --db=first,second, or --all.')
    }
    if (configurations.size) {
      return [...configurations.values()].map((config) => [...forwarded, `--config=${config}`])
    }
    if (all || databaseNames) throw new Error('No database configurations found.')
    return [forwarded]
  }

  drizzleKitArgs(args: string[]) {
    const runs = this.drizzleKitRuns(args)
    if (runs.length !== 1) throw new Error('Multiple databases selected; use drizzleKitRuns().')
    return runs[0]
  }

  runDrizzleKit(args: string[]) {
    // Resolve every selection before starting any migration.
    const runs = this.drizzleKitRuns(args)
    const entry = path.join(this.context.projectRoot, 'node_modules', 'drizzle-kit', 'bin.cjs')
    if (!fs.existsSync(entry)) {
      throw new Error('Drizzle Kit is not installed. Run "npm install --save-dev drizzle-kit" first.')
    }

    for (const run of runs) {
      const result = spawnSync(process.execPath, [entry, ...run], {
        cwd: this.context.projectRoot,
        stdio: 'inherit',
      })
      if (result.error) throw result.error
      if (result.status !== 0) {
        throw new Error(`Drizzle Kit exited with code ${result.status ?? 'unknown'}. Remaining databases were not processed.`)
      }
    }
  }
}
