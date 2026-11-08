import type { CommandArguments } from '../Command.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Command } from '../Command.mjs'

const featureDirectories = [
  'controllers',
  'dto/requests',
  'dto/responses',
  'repositories',
  'actions',
]

function kebabCase(value) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export class MakeFeatureCommand extends Command {
  static signature = 'make:feature <name>'
  static description = 'Create a feature structure'

  async handle({ name }: CommandArguments) {
    const normalized = name.replace(/\\/g, '/')
    if (normalized.includes('/')) {
      throw new Error('Feature names must be a single name such as appointments or calendar-sync.')
    }

    const featureName = kebabCase(normalized)
    if (!featureName) throw new Error(`Invalid feature name: ${name}`)

    const featureRoot = path.join(this.context.projectRoot, 'src', 'features', featureName)
    if (fs.existsSync(featureRoot)) {
      throw new Error(`${path.relative(this.context.projectRoot, featureRoot)} already exists.`)
    }

    for (const directory of featureDirectories) {
      fs.mkdirSync(path.join(featureRoot, directory), { recursive: true })
    }

    this.context.output(`Created feature ${path.relative(this.context.projectRoot, featureRoot)}`)
  }
}
