import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeRepositoryCommand extends GeneratorCommand {
  static signature = 'make:repository <name>'
  static description = 'Create a repository'
  targetDirectory = 'repositories'
  suffix = 'Repository'

  render(className, context) {
    if (!context.entityName) return `export class ${className} {\n}\n`

    const { entityName } = context
    if (context.database && context.table) {
      const schemaImport = `../../../database/${context.database}/schema`
      const databaseImport = `../../../database/${context.database}/${context.databasePascal}Database`
      return `import type { ${entityName}, New${entityName} } from '${schemaImport}'\nimport { ${context.table} } from '${schemaImport}'\nimport { ${context.databasePascal}Database } from '${databaseImport}'\n\nexport class ${className} {\n  constructor(private readonly database: ${context.databasePascal}Database) {}\n\n  all(): Promise<${entityName}[]> {\n    return this.database.client.select().from(${context.table})\n  }\n\n  create(_input: New${entityName}): Promise<${entityName}> {\n    throw new Error('Not implemented.')\n  }\n\n  find(_id: number): Promise<${entityName} | undefined> {\n    throw new Error('Not implemented.')\n  }\n\n  update(_id: number, _input: Partial<New${entityName}>): Promise<${entityName} | undefined> {\n    throw new Error('Not implemented.')\n  }\n\n  delete(_id: number): Promise<void> {\n    throw new Error('Not implemented.')\n  }\n}\n`
    }

    return `export class ${className} {\n  all(): Promise<unknown[]> {\n    throw new Error('Not implemented.')\n  }\n\n  create(_input: Record<string, unknown>): Promise<unknown> {\n    throw new Error('Not implemented.')\n  }\n\n  find(_id: number): Promise<unknown | undefined> {\n    throw new Error('Not implemented.')\n  }\n\n  update(_id: number, _input: Record<string, unknown>): Promise<unknown | undefined> {\n    throw new Error('Not implemented.')\n  }\n\n  delete(_id: number): Promise<void> {\n    throw new Error('Not implemented.')\n  }\n}\n`
  }
}
