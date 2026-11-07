import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeServiceCommand extends GeneratorCommand {
  static signature = 'make:service <name>'
  static description = 'Create a service'
  targetDirectory = 'services'
  suffix = 'Service'

  render(className) {
    return `export class ${className} {\n}\n`
  }
}
