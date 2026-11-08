import type { CommandArguments } from '../Command.mjs'
import type { RenderContext } from '../Command.mjs'
import { GeneratorCommand } from '../GeneratorCommand.mjs'

export class MakeMiddlewareCommand extends GeneratorCommand {
  static signature = 'make:middleware <name>'
  static description = 'Create middleware'
  targetDirectory = 'middleware'
  suffix = 'Middleware'

  render(className: string, { coreImport }: RenderContext): string {
    return `import type { Context } from 'hono'\nimport { BaseMiddleware, type MiddlewareNext } from '${coreImport}'\n\nexport class ${className} extends BaseMiddleware {\n  async handle(context: Context, next: MiddlewareNext): Promise<Response> {\n    return next()\n  }\n}\n`
  }
}
