import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { MakeActionCommand } from '../core/cli/commands/MakeActionCommand.mjs'
import { DatabaseMigrateCommand } from '../core/cli/commands/DatabaseMigrateCommand.mjs'
import { DrizzleKitCommand } from '../core/cli/DrizzleKitCommand.mjs'
import { MakeControllerCommand } from '../core/cli/commands/MakeControllerCommand.mjs'
import { MakeFeatureCommand } from '../core/cli/commands/MakeFeatureCommand.mjs'
import { MakeMiddlewareCommand } from '../core/cli/commands/MakeMiddlewareCommand.mjs'
import { MakeMigrationCommand } from '../core/cli/commands/MakeMigrationCommand.mjs'
import { MakeRepositoryCommand } from '../core/cli/commands/MakeRepositoryCommand.mjs'
import { MakeRequestCommand } from '../core/cli/commands/MakeRequestCommand.mjs'
import { MakeResourceCommand } from '../core/cli/commands/MakeResourceCommand.mjs'
import { MakeResponseCommand } from '../core/cli/commands/MakeResponseCommand.mjs'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-cli-'))
const messages: string[] = []
const context = { projectRoot, output: (message) => messages.push(message) }

try {
  fs.mkdirSync(path.join(projectRoot, 'src/database/main'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'src/database/main/drizzle.config.ts'), '')
  const drizzleCommand = new DrizzleKitCommand(context)
  assert.deepEqual(
    drizzleCommand.drizzleKitArgs(['generate']),
    ['generate', '--config=src/database/main/drizzle.config.ts'],
  )
  assert.deepEqual(
    drizzleCommand.drizzleKitArgs(['generate', '--config=custom.mjs']),
    ['generate', '--config=custom.mjs'],
  )

  await assert.rejects(
    () => new DatabaseMigrateCommand(context).handle({ name: '', args: [] }),
    /Drizzle Kit is not installed/,
  )
  await assert.rejects(
    () => new MakeMigrationCommand(context).handle({ name: 'bad migration', args: ['bad migration'] }),
    /Migration names may only contain/,
  )

  fs.mkdirSync(path.join(projectRoot, 'src/database/analytics'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'src/database/analytics/drizzle.config.ts'), '')
  await new MakeFeatureCommand(context).handle({ name: 'Appointments' })
  fs.cpSync(path.resolve('src/database/main'), path.join(projectRoot, 'src/database/main'), { recursive: true })
  fs.copyFileSync(path.resolve('src/env.ts'), path.join(projectRoot, 'src/env.ts'))
  await new MakeResourceCommand(context).handle({
    name: 'appointments/Todo',
    args: ['appointments/Todo', '--table=todos'],
  })
  fs.writeFileSync(path.join(projectRoot, 'src/features/appointments/dto/requests/CreateTodoRequest.ts'), `
import { z } from 'zod'
import { FormRequest } from '../../../../../core'

export class CreateTodoRequest extends FormRequest(
  z.object({ title: z.string(), completed: z.boolean().optional() }),
) {}
`)
  fs.writeFileSync(path.join(projectRoot, 'src/features/appointments/dto/requests/UpdateTodoRequest.ts'), `
import { z } from 'zod'
import { FormRequest } from '../../../../../core'

export class UpdateTodoRequest extends FormRequest(
  z.object({ title: z.string().optional(), completed: z.boolean().optional() }),
) {}
`)
  assert.throws(() => drizzleCommand.drizzleKitRuns(['migrate']), /Multiple databases/)
  assert.deepEqual(drizzleCommand.drizzleKitRuns(['migrate', '--db=main,analytics']), [
    ['migrate', '--config=src/database/main/drizzle.config.ts'],
    ['migrate', '--config=src/database/analytics/drizzle.config.ts'],
  ])
  assert.deepEqual(drizzleCommand.drizzleKitRuns(['generate', '--all']), [
    ['generate', '--config=src/database/analytics/drizzle.config.ts'],
    ['generate', '--config=src/database/main/drizzle.config.ts'],
  ])
  assert.throws(() => drizzleCommand.drizzleKitRuns(['migrate', '--db=missing']), /No Drizzle config/)
  assert.throws(() => drizzleCommand.drizzleKitRuns(['migrate', '--db=..']), /requires database names/)
  assert.throws(() => drizzleCommand.drizzleKitRuns(['migrate', '--all', '--config=custom.ts']), /not a combination/)
  await new MakeControllerCommand(context).handle({ name: 'Admin/User' })
  await new MakeMiddlewareCommand(context).handle({ name: 'Auth' })
  const packageContext = { ...context, frameworkImport: 'honovel' }
  await new MakeControllerCommand(packageContext).handle({ name: 'Package/User' })
  await new MakeMiddlewareCommand(packageContext).handle({ name: 'Admin/Auth' })
  await new MakeRequestCommand(context).handle({ name: 'CreateUser' })
  await new MakeRequestCommand(packageContext).handle({ name: 'Package/CreateUser' })
  await new MakeResponseCommand(context).handle({ name: 'User' })
  await new MakeRepositoryCommand(context).handle({ name: 'User' })
  await new MakeActionCommand(context).handle({ name: 'CreateUser' })

  const featureRoot = path.join(projectRoot, 'src/features/appointments')
  const expectedFeatureFiles = [
    'controllers/TodoController.ts',
    'dto/requests/CreateTodoRequest.ts',
    'dto/requests/UpdateTodoRequest.ts',
    'dto/responses/TodoResponse.ts',
    'repositories/TodoRepository.ts',
    'actions/ListAppointmentsAction.ts',
    'actions/CreateTodoAction.ts',
    'actions/GetTodoAction.ts',
    'actions/UpdateTodoAction.ts',
    'actions/DeleteTodoAction.ts',
  ]
  for (const file of expectedFeatureFiles) {
    assert.equal(fs.existsSync(path.join(featureRoot, file)), true, `${file} should be generated`)
  }
  assert.equal(fs.existsSync(path.join(featureRoot, 'models')), false)
  assert.equal(fs.existsSync(path.join(featureRoot, 'requests')), false)
  assert.equal(fs.existsSync(path.join(featureRoot, 'responses')), false)
  assert.equal(fs.existsSync(path.join(featureRoot, 'database')), false)

  const controller = fs.readFileSync(path.join(featureRoot, 'controllers/TodoController.ts'), 'utf8')
  assert.match(controller, /@Get\('\/'\)/)
  assert.match(controller, /@Post\('\/'\)/)
  assert.match(controller, /@Get\('\/:id'\)/)
  assert.match(controller, /@Put\('\/:id'\)/)
  assert.match(controller, /@Delete\('\/:id'\)/)
  assert.match(controller, /GetTodoAction/)

  const createAction = fs.readFileSync(path.join(featureRoot, 'actions/CreateTodoAction.ts'), 'utf8')
  assert.match(createAction, /TodoRepository/)
  assert.match(createAction, /NewTodo/)
  assert.match(createAction, /repository\.create\(input\)/)

  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(projectRoot, 'node_modules'), 'junction')
  const program = ts.createProgram({
    rootNames: expectedFeatureFiles.map((file) => path.join(featureRoot, file)),
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      experimentalDecorators: true,
    },
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(
    diagnostics.length,
    0,
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'),
  )

  const middleware = fs.readFileSync(path.join(projectRoot, 'src/middleware/Admin/AuthMiddleware.ts'), 'utf8')
  assert.match(middleware, /from 'honovel'/)
  const packageController = fs.readFileSync(path.join(projectRoot, 'src/controllers/Package/UserController.ts'), 'utf8')
  assert.match(packageController, /from 'honovel'/)
  const packageRequest = fs.readFileSync(path.join(projectRoot, 'src/requests/Package/CreateUserRequest.ts'), 'utf8')
  assert.match(packageRequest, /from 'honovel'/)

  await assert.rejects(() => new MakeFeatureCommand(context).handle({ name: 'appointments' }), /already exists/)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/controllers/Admin/UserController.ts')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/middleware/AuthMiddleware.ts')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/requests/CreateUserRequest.ts')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/responses/UserResponse.ts')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/repositories/UserRepository.ts')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/actions/CreateUserAction.ts')), true)
  await assert.rejects(() => new MakeControllerCommand(context).handle({ name: 'Admin/User' }), /already exists/)
  console.log('[Honovel] CLI generator check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
