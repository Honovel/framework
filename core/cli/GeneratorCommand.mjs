import fs from 'node:fs'
import path from 'node:path'
import { Command } from './Command.mjs'

function pascalCase(value) {
  return value
    .replace(/\.(?:ts|js)$/i, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export class GeneratorCommand extends Command {
  targetDirectory = ''
  suffix = ''

  normalizeName(input) {
    const normalized = input.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalized || normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error('Generator names must be relative names such as User or Admin/User.')
    }

    const parts = normalized.split('/')
    const rawName = parts.pop()
    const baseName = pascalCase(rawName)
    if (!baseName) throw new Error(`Invalid class name: ${input}`)

    const className = baseName.endsWith(this.suffix) ? baseName : `${baseName}${this.suffix}`
    return { className, directories: parts.map(pascalCase) }
  }

  async handle({ name, targetDirectory = this.targetDirectory, renderContext = {} }) {
    const { className, directories } = this.normalizeName(name)
    const directory = path.join(this.context.projectRoot, 'src', targetDirectory, ...directories)
    const target = path.join(directory, `${className}.ts`)

    if (fs.existsSync(target)) {
      throw new Error(`${path.relative(this.context.projectRoot, target)} already exists.`)
    }

    let coreImport = path.relative(directory, path.join(this.context.projectRoot, 'core')).split(path.sep).join('/')
    if (!coreImport.startsWith('.')) coreImport = `./${coreImport}`
    if (this.context.frameworkImport) coreImport = this.context.frameworkImport

    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(target, this.render(className, { ...renderContext, coreImport, projectRoot: this.context.projectRoot }), 'utf8')
    this.context.output(`Created ${path.relative(this.context.projectRoot, target)}`)
  }

  render() {
    throw new Error(`${this.constructor.name} must implement render().`)
  }
}
