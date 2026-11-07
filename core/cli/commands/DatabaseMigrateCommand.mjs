import { DrizzleKitCommand } from '../DrizzleKitCommand.mjs'

export class DatabaseMigrateCommand extends DrizzleKitCommand {
  static signature = 'db:migrate [drizzle-options...]'
  static description = 'Apply pending Drizzle migrations'
  static minArgs = 0
  static maxArgs = Number.POSITIVE_INFINITY

  async handle({ args = [] } = {}) {
    this.runDrizzleKit(['migrate', ...args])
  }
}
