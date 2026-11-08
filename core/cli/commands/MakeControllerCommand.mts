import type { RenderContext } from '../Command.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { GeneratorCommand } from '../GeneratorCommand.mjs'

function controllerImports(context) {
  const applicationController = path.join(context.projectRoot, 'src', 'runtime', 'Controller.ts')
  if (fs.existsSync(applicationController)) {
    return [
      "import { BaseUrl, Delete, Get, Post, Put } from '__CORE__'",
      "import { Controller } from '#src/runtime/Controller'",
    ]
  }

  return ["import { BaseUrl, Controller, Delete, Get, Post, Put } from '__CORE__'"]
}

function resourceName(className) {
  return className
    .replace(/Controller$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

function renderResourceController(className, context) {
  const source = [
    ...controllerImports(context),
    "import { Create__ENTITY__Request } from '../dto/requests/Create__ENTITY__Request'",
    "import { Update__ENTITY__Request } from '../dto/requests/Update__ENTITY__Request'",
    "import type { __ENTITY__Response } from '../dto/responses/__ENTITY__Response'",
    "import { List__FEATURE__Action } from '../actions/List__FEATURE__Action'",
    "import { Create__ENTITY__Action } from '../actions/Create__ENTITY__Action'",
    "import { Get__ENTITY__Action } from '../actions/Get__ENTITY__Action'",
    "import { Update__ENTITY__Action } from '../actions/Update__ENTITY__Action'",
    "import { Delete__ENTITY__Action } from '../actions/Delete__ENTITY__Action'",
    '',
    "@BaseUrl('/__ROUTE__')",
    'export class __CLASS__ extends Controller {',
    '  constructor(',
    '    private readonly list__FEATURE__: List__FEATURE__Action,',
    '    private readonly create__ENTITY__: Create__ENTITY__Action,',
    '    private readonly get__ENTITY__: Get__ENTITY__Action,',
    '    private readonly update__ENTITY__: Update__ENTITY__Action,',
    '    private readonly delete__ENTITY__: Delete__ENTITY__Action,',
    '  ) {',
    '    super()',
    '  }',
    '',
    "  @Get('/')",
    '  async index(): Promise<__ENTITY__Response[]> {',
    '    return this.list__FEATURE__.execute()',
    '  }',
    '',
    "  @Post('/')",
    '  async store(request: Create__ENTITY__Request): Promise<__ENTITY__Response> {',
    '    return this.create__ENTITY__.execute(request.validated())',
    '  }',
    '',
    "  @Get('/:id')",
    '  async get(id: number): Promise<__ENTITY__Response | undefined> {',
    '    return this.get__ENTITY__.execute(id)',
    '  }',
    '',
    "  @Put('/:id')",
    '  async update(id: number, request: Update__ENTITY__Request): Promise<__ENTITY__Response | undefined> {',
    '    return this.update__ENTITY__.execute(id, request.validated())',
    '  }',
    '',
    "  @Delete('/:id')",
    '  async destroy(id: number): Promise<void> {',
    '    await this.delete__ENTITY__.execute(id)',
    '  }',
    '}',
  ].join('\n') + '\n'

  return source
    .replaceAll('__CORE__', context.coreImport)
    .replaceAll('__ENTITY__', context.entityName)
    .replaceAll('__FEATURE__', context.featurePascal)
    .replaceAll('__ROUTE__', context.featureName)
    .replaceAll('__CLASS__', className)
}

export class MakeControllerCommand extends GeneratorCommand {
  static signature = 'make:controller <name>'
  static description = 'Create a REST controller'
  targetDirectory = 'controllers'
  suffix = 'Controller'

  render(className: string, context: RenderContext): string {
    if (context.featureName && context.entityName) {
      return renderResourceController(className, context)
    }

    const resource = resourceName(className)
    return [
      ...controllerImports(context),
      '',
      "@BaseUrl('/__RESOURCE__s')",
      'export class __CLASS__ extends Controller {',
      "  @Get('/')",
      '  index() {',
      '    return []',
      '  }',
      '',
      "  @Post('/')",
      '  store() {',
      '    return {}',
      '  }',
      '',
      "  @Get('/:id')",
      '  get(id: number) {',
      '    return { id }',
      '  }',
      '',
      "  @Put('/:id')",
      '  update(id: number) {',
      '    return { id }',
      '  }',
      '',
      "  @Delete('/:id')",
      '  destroy(id: number) {',
      '    return { id }',
      '  }',
      '}',
    ].join('\n')
      .replaceAll('__CORE__', context.coreImport)
      .replaceAll('__RESOURCE__', resource)
      .replaceAll('__CLASS__', className) + '\n'
  }
}
