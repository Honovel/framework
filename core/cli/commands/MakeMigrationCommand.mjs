import { DrizzleKitCommand } from '../DrizzleKitCommand.mjs'

export class MakeMigrationCommand extends DrizzleKitCommand {
  static signature = 'make:migration <name>'
  static description = 'Create an empty custom Drizzle migration'
  static maxArgs = Number.POSITIVE_INFINITY

  async handle({ name, args = [] }) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error('Migration names may only contain letters, numbers, dashes, and underscores.')
    }

    this.runDrizzleKit(['generate', '--custom', `--name=${name}`, ...args.slice(1)])
  }
}
