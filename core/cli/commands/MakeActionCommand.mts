import type { RenderContext } from '../Command.mjs'
import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeActionCommand extends GeneratorCommand {
  static signature = 'make:action <name>'
  static description = 'Create an action'
  targetDirectory = 'actions'
  suffix = 'Action'

  render(className: string, context: RenderContext): string {
    const { actionKind, entityName } = context
    if (!actionKind || !entityName) {
      return `export class ${className} {\n  execute(): void {\n  }\n}\n`
    }

    const repositoryName = `${entityName}Repository`
    const schemaImport = context.database ? `../../../database/${context.database}/schema` : undefined
    const typeImports = schemaImport
      ? `import type { ${entityName}, New${entityName} } from '${schemaImport}'\n`
      : ''
    const header = `${typeImports}import { ${repositoryName} } from '../repositories/${repositoryName}'\n\nexport class ${className} {\n  constructor(private readonly repository: ${repositoryName}) {}\n\n`
    const footer = `}\n`

    if (actionKind === 'list') {
      return `${header}  execute(): Promise<${entityName}[]> {\n    return this.repository.all()\n  }\n${footer}`
    }
    if (actionKind === 'create') {
      return `${header}  execute(input: New${entityName}): Promise<${entityName}> {\n    return this.repository.create(input)\n  }\n${footer}`
    }
    if (actionKind === 'get') {
      return `${header}  execute(id: number): Promise<${entityName} | undefined> {\n    return this.repository.find(id)\n  }\n${footer}`
    }
    if (actionKind === 'update') {
      return `${header}  execute(id: number, input: Partial<New${entityName}>): Promise<${entityName} | undefined> {\n    return this.repository.update(id, input)\n  }\n${footer}`
    }
    if (actionKind === 'delete') {
      return `${header}  execute(id: number): Promise<void> {\n    return this.repository.delete(id)\n  }\n${footer}`
    }

    throw new Error(`Unknown action kind: ${actionKind}`)
  }
}
