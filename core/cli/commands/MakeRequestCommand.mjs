import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeRequestCommand extends GeneratorCommand {
  static signature = 'make:request <name>'
  static description = 'Create a request model'
  targetDirectory = 'requests'
  suffix = 'Request'

  render(className, { coreImport }) {
    return `import { z } from 'zod'\nimport { FormRequest } from '${coreImport}'\n\nexport class ${className} extends FormRequest(\n  z.object({}),\n) {}\n`
  }
}
