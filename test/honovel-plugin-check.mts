import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const plugin = require('../core/tools/honovel-typescript-plugin/index.cjs')
const { collectHonovelDiagnostics } = plugin

if (typeof plugin !== 'function' || typeof collectHonovelDiagnostics !== 'function') {
  throw new Error('Honovel TypeScript plugin did not expose the expected API.')
}

const fileName = '/honovel-plugin-test.ts'
const honoContextFileName = '/node_modules/hono/dist/types/context.d.ts'
const honoRequestFileName = '/node_modules/hono/dist/types/request.d.ts'
const honoContextSource = `
declare class Context {}
`
const honoRequestSource = `
declare class HonoRequest {}
`
const source = `
class Controller {}
declare function Get(path: string): MethodDecorator
declare function BaseUrl(paths: string | readonly string[]): ClassDecorator
declare function Query(key?: string): ParameterDecorator
declare function Scope(options?: any): ClassDecorator
declare function Middleware(...middleware: any[]): ClassDecorator & MethodDecorator
declare function FormRequest<TSchema>(schema: TSchema): { new (...args: any[]): any; readonly schema: TSchema }
abstract class BaseMiddleware { abstract handle(): any }

class MissingService {}
export class BrokenService { constructor(dependency: MissingService) {} }
export class ContextConsumer { constructor(context: Context) {} }
export class RequestConsumer { constructor(request: HonoRequest) {} }

export abstract class AutomaticContract {}
export class AutomaticImplementation extends AutomaticContract {}
export class AutomaticConsumer { constructor(dependency: AutomaticContract) {} }

export abstract class AmbiguousContract {}
export class AmbiguousA extends AmbiguousContract {}
export class AmbiguousB extends AmbiguousContract {}
export class AmbiguousConsumer { constructor(dependency: AmbiguousContract) {} }

export abstract class SelectedContract {}
export class SelectedA extends SelectedContract {}
@Scope({ provides: SelectedContract })
export class SelectedB extends SelectedContract {}
export class SelectedConsumer { constructor(dependency: SelectedContract) {} }

export abstract class DuplicateContract {}
@Scope({ provides: DuplicateContract })
export class DuplicateA extends DuplicateContract {}
@Scope({ provides: DuplicateContract })
export class DuplicateB extends DuplicateContract {}
export class DuplicateConsumer { constructor(dependency: DuplicateContract) {} }

export abstract class MissingContract {}
export class MissingContractConsumer { constructor(dependency: MissingContract) {} }

declare const reservedSchema: { _output: { req: string } }
export class ReservedRequest extends FormRequest(reservedSchema) {}
declare const allFieldSchema: { _output: { all: boolean } }
export class AllFieldRequest extends FormRequest(allFieldSchema) {}
declare const inputFieldSchema: { _output: { input: string } }
export class InputFieldRequest extends FormRequest(inputFieldSchema) {}
declare const typedSchema: {
  _input: { age?: number; active: boolean; nested: { value: string } }
  _output: { age?: number; active: boolean; nested: { value: string } }
}
export class TypedRequest extends FormRequest(typedSchema) {}

class NotMiddleware {}
class ValidMiddleware extends BaseMiddleware { handle() {} }
@Middleware([ValidMiddleware, NotMiddleware])
class InvalidMiddlewareController extends Controller {}
@BaseUrl(['/v1/todos', '/v2/todos'])
@Middleware(ValidMiddleware)
class TestController extends Controller {
  @Get('/:id')
  show(todoId: number) {}

  @Get('/raw')
  raw(rawRequest: HonoRequest) {}

  @Get('/decorated')
  invalid(@Query() decoratedRequest: HonoRequest) {}

  @Get('/optional-request')
  optional(optionalRequest?: AllFieldRequest) {}

  @Get('/named-object')
  namedObject(@Query('custom-name') namedData?: AllFieldRequest) {}

  @Get('/named-primitive')
  namedPrimitive(@Query('custom-name') primitiveData?: string) {}

  @Get('/typed')
  typed(@Query() typedData: TypedRequest) {}

  @Get('/:unsupported')
  unsupported(unsupported: { value: string }) {}
}
`
const options = { experimentalDecorators: true, noLib: true, strictNullChecks: true, target: ts.ScriptTarget.ESNext }
const host = ts.createCompilerHost(options)
const originalGetSourceFile = host.getSourceFile.bind(host)
const originalFileExists = host.fileExists.bind(host)
const originalReadFile = host.readFile.bind(host)
const virtualFiles = new Map([
  [fileName, source],
  [honoContextFileName, honoContextSource],
  [honoRequestFileName, honoRequestSource],
])
host.fileExists = (candidate) => virtualFiles.has(candidate) || originalFileExists(candidate)
host.readFile = (candidate) => virtualFiles.get(candidate) ?? originalReadFile(candidate)
host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
  const content = virtualFiles.get(candidate)
  if (content !== undefined) {
    return ts.createSourceFile(candidate, content, languageVersion, true, ts.ScriptKind.TS)
  }
  return originalGetSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile)
}

const program = ts.createProgram(
  [fileName, honoContextFileName, honoRequestFileName],
  options,
  host,
)
const sourceFile = program.getSourceFile(fileName)
const diagnostics = collectHonovelDiagnostics(ts, program, sourceFile)

for (const code of [95001, 95006, 95007, 95008, 95009, 95010, 95011, 95012]) {
  if (!diagnostics.some((item) => item.code === code)) {
    throw new Error(`Honovel plugin did not emit expected diagnostic ${code}.`)
  }
}

const automaticDiagnostic = diagnostics.find(
  (item) => item.code >= 95007 && item.code <= 95009 && item.start === source.indexOf('dependency: AutomaticContract'),
)
if (automaticDiagnostic) throw new Error('Honovel plugin rejected an abstract contract with exactly one implementation.')
if (diagnostics.some((item) => item.code === 95008 && item.messageText.includes('SelectedContract'))) {
  throw new Error('Honovel plugin rejected an explicitly selected abstract implementation.')
}

const honoContextDiagnostic = diagnostics.find(
  (item) => item.code === 95006 && item.start === source.indexOf('context: Context'),
)
if (honoContextDiagnostic) throw new Error('Honovel plugin rejected Hono Context as a built-in dependency.')

const honoRequestDiagnostic = diagnostics.find(
  (item) => item.code === 95006 && item.start === source.indexOf('request: HonoRequest'),
)
if (honoRequestDiagnostic) throw new Error('Honovel plugin rejected HonoRequest as a built-in dependency.')

const rawRouteDiagnostic = diagnostics.find(
  (item) => item.code === 95001 && item.start === source.indexOf('rawRequest: HonoRequest'),
)
if (rawRouteDiagnostic) throw new Error('Honovel plugin rejected HonoRequest as a controller parameter.')
const queryWarning = diagnostics.find((item) => item.code === 95021 && item.messageText.includes('field "nested"'))
if (!queryWarning || queryWarning.category !== ts.DiagnosticCategory.Warning) {
  throw new Error('Honovel plugin did not warn about unsupported query input fields.')
}
if (diagnostics.some((item) => item.code === 95021 && /field "(age|active)"/.test(item.messageText))) {
  throw new Error('Honovel plugin warned about supported query input types.')
}
if (!diagnostics.some((item) => item.code === 95021 && item.start === source.indexOf('unsupported: {'))) {
  throw new Error('Honovel plugin did not warn about an unsupported route parameter type.')
}
if (diagnostics.some((item) => item.code === 95020 && item.start === source.indexOf('namedData?:'))) {
  throw new Error('Honovel plugin rejected a prefixed query FormRequest with an object output.')
}
if (diagnostics.some((item) => item.code === 95001 && item.start === source.indexOf('optionalRequest?:'))) {
  throw new Error('Honovel plugin rejected an optional FormRequest parameter.')
}

const reservedDiagnostic = diagnostics.find(
  (item) => item.code === 95011 && item.messageText.includes('"req"'),
)
if (!reservedDiagnostic) throw new Error('Honovel plugin did not reject a reserved FormRequest field.')
if (diagnostics.some((item) => item.code === 95011 && item.messageText.includes('"all"'))) {
  throw new Error('Honovel plugin still reserves the removed FormRequest method "all".')
}
if (diagnostics.some((item) => item.code === 95011 && item.messageText.includes('"input"'))) {
  throw new Error('Honovel plugin still reserves the removed FormRequest method "input".')
}

console.log('[Honovel] TypeScript language service plugin check passed.')
