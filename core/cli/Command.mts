export interface CommandContext {
  projectRoot: string
  frameworkImport?: string
  output: (message: string) => void
}

export interface RenderContext {
  coreImport: string
  projectRoot: string
  actionKind?: string
  database?: string
  databasePascal?: string
  entityName?: string
  featureName?: string
  featurePascal?: string
  table?: string
}

export interface CommandArguments {
  name: string
  args?: string[]
  targetDirectory?: string
  renderContext?: Partial<RenderContext>
}

export class Command {
  static signature = ''
  static description = ''
  static minArgs = 1
  static maxArgs = 1

  constructor(readonly context: CommandContext) {}

  async handle(_arguments: CommandArguments): Promise<void> {
    throw new Error(`${this.constructor.name} must implement handle().`)
  }
}
