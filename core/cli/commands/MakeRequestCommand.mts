import type { RenderContext } from '../Command.mjs'
import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeRequestCommand extends GeneratorCommand {
  static signature = 'make:request <name>'
  static description = 'Create a request model'
  targetDirectory = 'requests'
  suffix = 'Request'

  render(className: string, { coreImport }: RenderContext): string {
    return `import { z } from 'zod'\nimport { FormRequest } from '${coreImport}'\n\nexport class ${className} extends FormRequest(\n  z.object({}),\n) {}\n`
  }
}
