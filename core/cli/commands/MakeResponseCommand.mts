import type { RenderContext } from '../Command.mjs'
import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeResponseCommand extends GeneratorCommand {
  static signature = 'make:response <name>'
  static description = 'Create a response model'
  targetDirectory = 'responses'
  suffix = 'Response'

  render(className: string, context: RenderContext): string {
    if (context.entityName && context.database && context.table) {
      return `import type { ${context.entityName} } from '../../../../database/${context.database}/schema'\n\nexport type ${className} = ${context.entityName}\n`
    }

    return `export interface ${className} {\n}\n`
  }
}
