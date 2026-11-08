import type { CommandArguments } from '../Command.mjs'
import { DrizzleKitCommand } from '../DrizzleKitCommand.mjs'

export class DatabaseGenerateCommand extends DrizzleKitCommand {
  static signature = 'db:generate [name] [drizzle-options...]'
  static description = 'Generate a Drizzle migration from the current schema'
  static minArgs = 0
  static maxArgs = Number.POSITIVE_INFINITY

  async handle({ args = [] }: CommandArguments) {
    const drizzleArgs = ['generate']
    if (args[0] && !args[0].startsWith('-')) {
      drizzleArgs.push(`--name=${args[0]}`, ...args.slice(1))
    } else {
      drizzleArgs.push(...args)
    }
    this.runDrizzleKit(drizzleArgs)
  }
}
