import fs from 'node:fs'
import path from 'node:path'
import { Command } from '../Command.mjs'
import { MakeActionCommand } from './MakeActionCommand.mjs'
import { MakeControllerCommand } from './MakeControllerCommand.mjs'
import { MakeRepositoryCommand } from './MakeRepositoryCommand.mjs'
import { MakeRequestCommand } from './MakeRequestCommand.mjs'
import { MakeResponseCommand } from './MakeResponseCommand.mjs'

function pascalCase(value) {
  return value
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function kebabCase(value) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function singularize(value) {
  if (value.endsWith('ies') && value.length > 3) return `${value.slice(0, -3)}y`
  if (/(?:ches|shes|xes|zes|ses)$/.test(value)) return value.slice(0, -2)
  if (value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us')) return value.slice(0, -1)
  return value
}

function parseOptions(args) {
  const options = { database: 'main' }
  for (const argument of args) {
    const match = argument.match(/^--(database|table)=(.+)$/)
    if (!match) throw new Error(`Unknown resource option: ${argument}`)
    options[match[1]] = match[2]
  }
  if (!options.table) throw new Error('make:resource requires --table=<schema export>.')
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(options.table)) {
    throw new Error('--table must be a valid TypeScript export name.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.database)) {
    throw new Error('--database must be a database directory name.')
  }
  return options
}

export class MakeResourceCommand extends Command {
  static signature = 'make:resource <feature>/<entity> --table=<schema-export> [--database=<name>]'
  static description = 'Create CRUD code for an existing database table'
  static minArgs = 2
  static maxArgs = Number.POSITIVE_INFINITY

  async handle({ name, args = [] }) {
    const normalized = name.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length !== 2) {
      throw new Error('Resource names must be in the form feature/Entity.')
    }

    const featureName = kebabCase(parts[0])
    const entityName = pascalCase(singularize(parts[1]))
    if (!featureName || !entityName) throw new Error(`Invalid resource name: ${name}`)

    const { database, table } = parseOptions(args.slice(1))
    const featureRoot = path.join(this.context.projectRoot, 'src', 'features', featureName)
    if (!fs.existsSync(featureRoot)) {
      throw new Error(`Feature ${featureName} does not exist. Run make:feature ${featureName} first.`)
    }

    const featurePascal = pascalCase(featureName)
    const databasePascal = pascalCase(database)
    const renderContext = {
      database,
      databasePascal,
      entityName,
      featureName,
      featurePascal,
      table,
    }
    const target = (directory) => `features/${featureName}/${directory}`

    await new MakeRepositoryCommand(this.context).handle({
      name: entityName,
      targetDirectory: target('repositories'),
      renderContext,
    })
    await new MakeRequestCommand(this.context).handle({
      name: `Create${entityName}`,
      targetDirectory: target('dto/requests'),
      renderContext,
    })
    await new MakeRequestCommand(this.context).handle({
      name: `Update${entityName}`,
      targetDirectory: target('dto/requests'),
      renderContext,
    })
    await new MakeResponseCommand(this.context).handle({
      name: entityName,
      targetDirectory: target('dto/responses'),
      renderContext,
    })

    const actions = [
      [`List${featurePascal}`, 'list'],
      [`Create${entityName}`, 'create'],
      [`Get${entityName}`, 'get'],
      [`Update${entityName}`, 'update'],
      [`Delete${entityName}`, 'delete'],
    ]
    for (const [actionName, actionKind] of actions) {
      await new MakeActionCommand(this.context).handle({
        name: actionName,
        targetDirectory: target('actions'),
        renderContext: { ...renderContext, actionKind },
      })
    }

    await new MakeControllerCommand(this.context).handle({
      name: entityName,
      targetDirectory: target('controllers'),
      renderContext,
    })

    this.context.output(`Created resource ${featureName}/${entityName}`)
  }
}
