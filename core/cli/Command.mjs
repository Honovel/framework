export class Command {
  static signature = ''
  static description = ''

  constructor(context) {
    this.context = context
  }

  async handle() {
    throw new Error(`${this.constructor.name} must implement handle().`)
  }
}
