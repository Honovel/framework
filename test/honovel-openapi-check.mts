import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { Hono } from 'hono'
import { createOpenApiDocument } from '../core/compiler/openapi.mjs'
import { registerOpenApiRoutes } from '#honovel-test/openapi/runtime.js'

assert.ok(fs.existsSync('.honovel/openapi.json'), 'Compiler did not emit .honovel/openapi.json.')
const generated = JSON.parse(fs.readFileSync('.honovel/openapi.json', 'utf8'))
assert.equal(generated.openapi, '3.1.0')
assert.ok(Object.keys(generated.paths).length > 0, 'Generated OpenAPI document has no paths.')
assert.equal(generated.paths['/todos'].get.responses['422'], undefined, 'Routes without validated input must not imply validation errors.')
assert.equal(generated.components.schemas.CreateTodoRequest.properties.req, undefined, 'FormRequest.req must not appear in request schemas.')

const fileName = '/honovel-openapi-fixture.ts'
const source = `
class HttpException extends Error {}
class NotFoundException extends HttpException {}
class ForbiddenException extends HttpException {}
class GuardMiddleware {
  handle() {
    throw new ForbiddenException()
  }
}
class Service {
  get(): { id: number; name: string } {
    throw new NotFoundException()
  }
}
class TestController {
  constructor(private readonly service: Service) {}
  show(id: number): { id: number; name: string } {
    return this.service.get()
  }
}
type ApiError = { error: { code: 'NOT_FOUND' | 'INTERNAL_ERROR'; message: string; requestId: string } }
`
const options = {
  noLib: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
}
const host = ts.createCompilerHost(options)
const originalGetSourceFile = host.getSourceFile.bind(host)
const originalFileExists = host.fileExists.bind(host)
const originalReadFile = host.readFile.bind(host)
host.fileExists = (candidate) => candidate === fileName || originalFileExists(candidate)
host.readFile = (candidate) => candidate === fileName ? source : originalReadFile(candidate)
host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
  if (candidate === fileName) return ts.createSourceFile(candidate, source, languageVersion, true, ts.ScriptKind.TS)
  return originalGetSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile)
}

const program = ts.createProgram([fileName], options, host)
const checker = program.getTypeChecker()
const sourceFile = program.getSourceFile(fileName)
assert.ok(sourceFile)
const classes = new Map(
  sourceFile.statements
    .filter(ts.isClassDeclaration)
    .filter((declaration) => declaration.name)
    .map((declaration) => [declaration.name!.text, declaration]),
)
const serviceDeclaration = classes.get('Service')
const controllerDeclaration = classes.get('TestController')
assert.ok(controllerDeclaration)
const middlewareDeclaration = classes.get('GuardMiddleware')
const errorTypeDeclaration = sourceFile.statements.find(
  (statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'ApiError',
)
const serviceProvider = {
  declaration: serviceDeclaration,
  dependencies: [],
}
const controllerProvider = {
  declaration: controllerDeclaration,
  dependencies: [{ provider: serviceProvider }],
}
const handlerDeclaration = controllerDeclaration.members.find(
  (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && member.name.getText() === 'show',
)
assert.ok(handlerDeclaration)
assert.ok(errorTypeDeclaration)
const parameter = handlerDeclaration.parameters[0]
const errorResponseType = checker.getTypeAtLocation(errorTypeDeclaration.name)
const document = createOpenApiDocument({
  ts,
  checker,
  routes: [{
    method: 'get',
    path: '/users/:id',
    controllerName: 'TestController',
    controllerDeclaration,
    handlerName: 'show',
    handlerDeclaration,
    middleware: [{ declaration: middlewareDeclaration }],
    bindings: [{
      source: 'param',
      kind: 'primitive',
      key: 'id',
      primitive: 'number',
      required: true,
      parameter,
    }],
  }],
  providers: [serviceProvider, controllerProvider],
  providerBindings: [],
  errorResponseType,
  projectRoot: '/',
  fail: (message) => { throw new Error(message) },
})
assert.ok(document.paths['/users/{id}'].get.responses['200'])
assert.ok(document.paths['/users/{id}'].get.responses['404'], 'DI-reachable NotFoundException was not inferred.')
assert.ok(document.paths['/users/{id}'].get.responses['403'], 'Middleware ForbiddenException was not inferred.')
assert.ok(document.paths['/users/{id}'].get.responses['422'])
assert.ok(document.paths['/users/{id}'].get.responses['500'])
assert.deepEqual(document.paths['/users/{id}'].get.responses['404'].content['application/json'].schema, {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { oneOf: [{ type: 'string', const: 'NOT_FOUND' }, { type: 'string', const: 'INTERNAL_ERROR' }] },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['code', 'message', 'requestId'],
    },
  },
  required: ['error'],
}, 'Custom error response types should be used for inferred exception responses.')

const app = new Hono()
registerOpenApiRoutes(app, document, {
  swaggerPath: '/swagger',
  openApiPath: '/openapi.json',
})
const specResponse = await app.request('/openapi.json')
assert.equal(specResponse.status, 200)
const runtimeDocument = await specResponse.json()
assert.equal(runtimeDocument.info.title, 'Honovel')
assert.equal(runtimeDocument.info.version, '1.0.0')

const swaggerResponse = await app.request('/swagger')
assert.equal(swaggerResponse.status, 200)
assert.match(await swaggerResponse.text(), /SwaggerUIBundle/)

console.log('[Honovel] OpenAPI and Swagger check passed.')
