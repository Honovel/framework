import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { createOpenApiDocument } from '../compiler/openapi.mjs'

const require = createRequire(import.meta.url)
const { collectHonovelDiagnostics } = require('../tools/honovel-typescript-plugin/diagnostics.cjs')

const projectRoot = process.cwd()
const coreRoot = fileURLToPath(new URL('../', import.meta.url))
const installedPackage = path.resolve(coreRoot) !== path.join(projectRoot, 'core')
const corePackageName = installedPackage ? JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8')).name : undefined
const coreRelativePath = (file) => path.relative(coreRoot, file).split(path.sep).join('/')
const runtimeImport = (file) => installedPackage ? `${corePackageName}/internal/${file}` : `./core/${file}.js`
const configPath = path.join(projectRoot, 'tsconfig.build.json')
const noEmit = process.argv.includes('--no-emit')

function applicationTitle() {
  const metadataPath = path.join(projectRoot, 'package.json')
  if (!fs.existsSync(metadataPath)) return 'Honovel'

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    return typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name : 'Honovel'
  } catch {
    return 'Honovel'
  }
}

function applicationVersion() {
  const metadataPath = path.join(projectRoot, 'package.json')
  if (!fs.existsSync(metadataPath)) return '1.0.0'

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    return typeof metadata.version === 'string' && metadata.version.trim() ? metadata.version : '1.0.0'
  } catch {
    return '1.0.0'
  }
}

function optionValue(name) {
  const inlinePrefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix))
  if (inline) return inline.slice(inlinePrefix.length)

  const index = process.argv.indexOf(name)
  if (index === -1) return undefined

  const next = process.argv[index + 1]
  return !next || next.startsWith('--') ? true : next
}

function booleanOption(name) {
  const value = optionValue(name)
  if (value === undefined) return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error(`${name} must be true or false.`)
}

function stringOption(name, fallback) {
  const value = optionValue(name)
  if (value === undefined) return fallback
  if (value === true || !value.trim()) throw new Error(`${name} requires a non-empty value.`)
  return value
}

function routePathOption(name, fallback) {
  const value = stringOption(name, fallback).trim()
  return value.startsWith('/') ? value : `/${value}`
}

function compilerBuildOptions() {
  const explicitMode = optionValue('--mode')
  let mode

  if (explicitMode !== undefined) {
    if (explicitMode === true || !['development', 'production'].includes(explicitMode)) {
      throw new Error('--mode must be "development" or "production".')
    }
    mode = explicitMode
  } else if (process.env.WRANGLER_COMMAND === 'deploy' || process.env.WRANGLER_COMMAND === 'versions upload') {
    mode = 'production'
  } else {
    mode = 'development'
  }

  return {
    mode,
    documentation: {
      enabled: booleanOption('--swagger-enabled') ?? mode === 'development',
      swaggerPath: routePathOption('--swagger-path', '/swagger'),
      openApiPath: routePathOption('--openapi-path', '/openapi.json'),
    },
  }
}

class HonovelCompileError extends Error {
  constructor(message, node) {
    super(message)
    this.node = node
  }
}

function fail(message, node) {
  throw new HonovelCompileError(message, node)
}

const diagnosticHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => projectRoot,
  getNewLine: () => ts.sys.newLine,
}

function formatNodeLocation(node) {
  const sourceFile = node.getSourceFile()
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${path.relative(projectRoot, sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`
}

function printHonovelError(error) {
  if (error instanceof HonovelCompileError && error.node) {
    console.error(`[Honovel] ${formatNodeLocation(error.node)} - ${error.message}`)
    return
  }

  console.error(error)
}

function readTsConfig() {
  const config = ts.readConfigFile(configPath, ts.sys.readFile)

  if (config.error) {
    console.error(ts.formatDiagnosticsWithColorAndContext([config.error], diagnosticHost))
    process.exit(1)
  }

  return ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot, undefined, configPath)
}

function removeGeneratedSourceMaps(directory) {
  if (!fs.existsSync(directory)) return

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      removeGeneratedSourceMaps(entryPath)
    } else if (entry.isFile() && /\.(?:js|mjs|cjs|jsx)\.map$/.test(entry.name)) {
      fs.rmSync(entryPath)
    }
  }
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
}

function expressionName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function decoratorCalls(node) {
  return decoratorsOf(node).map((decorator) => {
    if (ts.isCallExpression(decorator.expression)) {
      return {
        name: expressionName(decorator.expression.expression),
        args: [...decorator.expression.arguments],
        node: decorator,
      }
    }

    return { name: expressionName(decorator.expression), args: [], node: decorator }
  })
}

function findDecorator(node, name) {
  return decoratorCalls(node).find((decorator) => decorator.name === name)
}

const honovelDecoratorFiles = new Set([
  'di/decorators.ts',
  'http/auth.ts',
  'http/decorators.ts',
  'schedule/decorators.ts',
])

function isHonovelDecoratorReference(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)

  return symbol?.declarations?.some((declaration) => {
    return honovelDecoratorFiles.has(coreRelativePath(declaration.getSourceFile().fileName))
  }) ?? false
}

function isHonovelDecorator(decorator, checker) {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression
  return isHonovelDecoratorReference(expression, checker)
    || !!customDecoratorDefinition(expression, checker)
}

function isCreateHonoAppReference(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)

  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'createHonoApp'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'app.ts'
  }) ?? false
}

function isSetErrorRendererReference(node, checker, seen = new Set()) {
  while (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression?.(node)
  ) {
    node = node.expression
  }
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)
  if (!symbol || seen.has(symbol)) return false
  seen.add(symbol)

  if (symbol.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'setErrorRenderer'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'http/exceptions.ts'
  })) return true

  return symbol.declarations?.some((declaration) => {
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false
    return isSetErrorRendererReference(declaration.initializer, checker, seen)
  }) ?? false
}

function applicationErrorResponseType(program, checker) {
  const entryPath = path.resolve(projectRoot, 'index.ts')
  const sourceFile = program.getSourceFiles().find((file) => path.resolve(file.fileName) === entryPath)
  if (!sourceFile) return undefined

  let errorResponseType
  const visit = (node) => {
    if (ts.isCallExpression(node) && isSetErrorRendererReference(node.expression, checker)) {
      if (node.typeArguments?.length > 1) {
        fail('setErrorRenderer() accepts at most one error response type argument.', node)
      }
      if (node.typeArguments?.length === 1) {
        if (errorResponseType) {
          fail('Root index.ts may only configure one setErrorRenderer() error response type.', node)
        }
        errorResponseType = checker.getTypeFromTypeNode(node.typeArguments[0])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return errorResponseType
}

function isDefineDatabaseReference(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)

  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'defineDatabase'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'database/Database.ts'
  }) ?? false
}

function databaseDefinitionFromExpression(expression, checker, seen = new Set()) {
  if (ts.isCallExpression(expression) && isDefineDatabaseReference(expression.expression, checker)) {
    return expression
  }

  if (!ts.isIdentifier(expression)) return undefined
  const symbol = resolveSymbol(checker.getSymbolAtLocation(expression), checker)
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration)
  if (!declaration?.initializer || seen.has(declaration)) return undefined

  seen.add(declaration)
  return databaseDefinitionFromExpression(declaration.initializer, checker, seen)
}

function isDatabaseProvider(declaration, checker, seen = new Set()) {
  if (seen.has(declaration)) return false
  seen.add(declaration)
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const base of clause.types) {
      if (databaseDefinitionFromExpression(base.expression, checker)) return true
      const parent = classDeclarationForExpression(base.expression, checker)
      if (parent && isDatabaseProvider(parent, checker, seen)) return true
    }
  }
  return false
}

function isCreateDecoratorReference(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)

  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'createDecorator'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'http/customDecorators.ts'
  }) ?? false
}

function customDecoratorDefinition(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration)
  if (!declaration || !ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined
  if (!ts.isCallExpression(declaration.initializer)) return undefined
  if (!isCreateDecoratorReference(declaration.initializer.expression, checker)) return undefined

  const statement = declaration.parent?.parent
  const exported = ts.isVariableStatement(statement)
    && hasModifier(statement, ts.SyntaxKind.ExportKeyword)

  return {
    exportName: declaration.name.text,
    sourceFile: declaration.getSourceFile(),
    declaration,
    initializer: declaration.initializer,
    exported,
  }
}

function validateRootAppEntry(program) {
  const checker = program.getTypeChecker()
  const entryPath = path.resolve(projectRoot, 'index.ts')
  const sourceFile = program.getSourceFiles().find((file) => path.resolve(file.fileName) === entryPath)

  if (!sourceFile) {
    throw new Error('[Honovel] Root index.ts must be included in the build.')
  }

  const calls = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && isCreateHonoAppReference(node.expression, checker)) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (calls.length === 0) {
    fail('Root index.ts must create the Hono application with createHonoApp<TEnv>().', sourceFile)
  }
  if (calls.length > 1) {
    fail('Root index.ts may only call createHonoApp() once.', calls[1])
  }
}

function stripHonovelDecoratorModifiers(modifiers, checker) {
  if (!modifiers) return modifiers

  const filtered = modifiers.filter(
    (modifier) => !ts.isDecorator(modifier) || !isHonovelDecorator(modifier, checker),
  )

  return filtered.length === modifiers.length ? modifiers : ts.factory.createNodeArray(filtered)
}

const rootAppConfigurationMethods = new Set([
  'all',
  'basePath',
  'delete',
  'get',
  'mount',
  'notFound',
  'on',
  'onError',
  'options',
  'patch',
  'post',
  'put',
  'route',
  'use',
])

function rootAppVariableName(program, checker, rootEntryPath) {
  const sourceFile = program.getSourceFiles().find((file) => path.resolve(file.fileName) === rootEntryPath)
  if (!sourceFile) return undefined

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue
      if (isCreateHonoAppReference(declaration.initializer.expression, checker)) return declaration.name.text
    }
  }

  return undefined
}

function isRootAppConfigurationStatement(statement, appName) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false

  const callee = statement.expression.expression
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === appName
    && rootAppConfigurationMethods.has(callee.name.text)
}

function statementReferencesIdentifier(statement, identifier) {
  let found = false
  const visit = (node) => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === identifier) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(statement)
  return found
}

function rootAppRegistrationIndex(statements, appName) {
  let appDeclarationIndex = -1

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    if (!ts.isVariableStatement(statement)) continue

    const declaresApp = statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === appName,
    )
    if (declaresApp) {
      appDeclarationIndex = index
      break
    }
  }

  if (appDeclarationIndex === -1) return statements.length

  for (let index = appDeclarationIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index]
    if (isRootAppConfigurationStatement(statement, appName)) continue
    if (statementReferencesIdentifier(statement, appName)) return index
  }

  return statements.length
}

function emittedApplicationModuleSpecifier(specifier, sourceFile, compilerOptions) {
  if (!sourceFile) return specifier
  if (!specifier.startsWith('.') && !specifier.startsWith('#src/')) return specifier

  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    compilerOptions,
    ts.sys,
  ).resolvedModule

  if (!resolved || resolved.isExternalLibraryImport) return specifier
  if (resolved.resolvedFileName.endsWith('.d.ts')) return specifier
  if (!/\.(?:[cm]?ts|tsx)$/.test(resolved.resolvedFileName)) return specifier

  let relative = path.relative(
    path.dirname(sourceFile.fileName),
    resolved.resolvedFileName,
  ).split(path.sep).join('/')

  relative = relative.replace(/\.(?:[cm]?ts|tsx)$/, '.js')
  return relative.startsWith('.') ? relative : `./${relative}`
}

function honovelEmitTransformer(program) {
  const checker = program.getTypeChecker()
  const compilerOptions = program.getCompilerOptions()
  const rootEntryPath = path.resolve(projectRoot, 'index.ts')
  const appName = rootAppVariableName(program, checker, rootEntryPath)

  return (context) => {
    const visit = (node) => {
      if (ts.isCallExpression(node) && isCreateHonoAppReference(node.expression, checker)) {
        const originalCall = ts.visitEachChild(node, visit, context)
        if (appName) return originalCall

        return ts.factory.createCallExpression(
          ts.factory.createIdentifier('__honovelRegister'),
          undefined,
          [originalCall],
        )
      }

      if (ts.isImportDeclaration(node)) {
        const importClause = node.importClause
        const namedBindings = importClause?.namedBindings

        if (importClause && namedBindings && ts.isNamedImports(namedBindings)) {
          const elements = namedBindings.elements.filter(
            (element) => !element.isTypeOnly && !isHonovelDecoratorReference(element.name, checker),
          )

          if (elements.length !== namedBindings.elements.length) {
            if (elements.length === 0 && !importClause.name) return undefined

            node = ts.factory.updateImportDeclaration(
              node,
              node.modifiers,
              ts.factory.updateImportClause(
                importClause,
                importClause.isTypeOnly,
                importClause.name,
                ts.factory.createNamedImports(elements),
              ),
              node.moduleSpecifier,
              node.attributes,
            )
          }
        }
      }

      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleSpecifier = emittedApplicationModuleSpecifier(
          node.moduleSpecifier.text,
          node.getSourceFile(),
          compilerOptions,
        )

        if (moduleSpecifier !== node.moduleSpecifier.text) {
          node = ts.factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            ts.factory.createStringLiteral(moduleSpecifier),
            node.attributes,
          )
        }
      }

      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleSpecifier = emittedApplicationModuleSpecifier(
          node.moduleSpecifier.text,
          node.getSourceFile(),
          compilerOptions,
        )

        if (moduleSpecifier !== node.moduleSpecifier.text) {
          node = ts.factory.updateExportDeclaration(
            node,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            ts.factory.createStringLiteral(moduleSpecifier),
            node.attributes,
          )
        }
      }

      const visited = ts.visitEachChild(node, visit, context)

      if (ts.isClassDeclaration(visited)) {
        return ts.factory.updateClassDeclaration(
          visited,
          stripHonovelDecoratorModifiers(visited.modifiers, checker),
          visited.name,
          visited.typeParameters,
          visited.heritageClauses,
          visited.members,
        )
      }

      if (ts.isMethodDeclaration(visited)) {
        return ts.factory.updateMethodDeclaration(
          visited,
          stripHonovelDecoratorModifiers(visited.modifiers, checker),
          visited.asteriskToken,
          visited.name,
          visited.questionToken,
          visited.typeParameters,
          visited.parameters,
          visited.type,
          visited.body,
        )
      }

      if (ts.isParameter(visited)) {
        return ts.factory.updateParameterDeclaration(
          visited,
          stripHonovelDecoratorModifiers(visited.modifiers, checker),
          visited.dotDotDotToken,
          visited.name,
          visited.questionToken,
          visited.type,
          visited.initializer,
        )
      }

      return visited
    }

    return (sourceFile) => {
      const transformed = ts.visitNode(sourceFile, visit)
      if (path.resolve(sourceFile.fileName) !== rootEntryPath) return transformed

      const registerImport = ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          false,
          ts.factory.createIdentifier('__honovelRegister'),
          undefined,
        ),
        ts.factory.createStringLiteral('./app.js'),
        undefined,
      )

      const statements = [registerImport, ...transformed.statements]
      if (appName) {
        const registration = ts.factory.createExpressionStatement(
          ts.factory.createCallExpression(
            ts.factory.createIdentifier('__honovelRegister'),
            undefined,
            [ts.factory.createIdentifier(appName)],
          ),
        )
        const registrationIndex = rootAppRegistrationIndex(statements, appName)
        statements.splice(registrationIndex, 0, registration)
      }

      return ts.factory.updateSourceFile(
        transformed,
        ts.factory.createNodeArray(statements),
      )
    }
  }
}

function stringArgument(decorator, label, defaultValue) {
  if (!decorator || decorator.args.length === 0) return defaultValue

  const argument = decorator.args[0]
  if (!ts.isStringLiteralLike(argument)) {
    fail(`${label} must use a static string literal so Honovel can compile it at build time.`, argument)
  }

  return argument.text
}

function baseUrlArguments(decorator) {
  if (!decorator) return ['']
  if (decorator.args.length !== 1) fail('@BaseUrl() requires one path or an array of paths.', decorator.node)

  const argument = decorator.args[0]
  const paths = ts.isArrayLiteralExpression(argument) ? argument.elements : [argument]
  if (paths.length === 0) fail('@BaseUrl() requires at least one path.', argument)

  return paths.map((pathNode) => {
    if (!ts.isStringLiteralLike(pathNode)) {
      fail('@BaseUrl() paths must be static string literals.', pathNode)
    }
    return pathNode.text
  })
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false
}

function requireNamedExport(classDeclaration, role) {
  if (!classDeclaration.name) fail(`${role} classes must have a name.`, classDeclaration)
  if (!hasModifier(classDeclaration, ts.SyntaxKind.ExportKeyword)) {
    fail(`${role} ${classDeclaration.name.text} must be exported so generated routes can import it.`, classDeclaration)
  }
  if (hasModifier(classDeclaration, ts.SyntaxKind.DefaultKeyword)) {
    fail(`${role} ${classDeclaration.name.text} must use a named export, not a default export.`, classDeclaration)
  }
  return classDeclaration.name.text
}

function isCoreControllerBase(classDeclaration) {
  return coreRelativePath(classDeclaration.getSourceFile().fileName) === 'http/Controller.ts'
    && ['BaseController', 'Controller'].includes(classDeclaration.name?.text)
}

function controllerClassChain(classDeclaration, checker) {
  const chain = []
  const seen = new Set()
  let current = classDeclaration

  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(current)

    const clause = current.heritageClauses?.find(
      (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
    )
    if (!clause?.types.length) return undefined

    const baseClass = classDeclarationForExpression(clause.types[0].expression, checker)
    if (!baseClass) return undefined
    if (isCoreControllerBase(baseClass)) return chain.reverse()
    if (baseClass.name?.text === 'Controller' && !baseClass.heritageClauses?.length) return chain.reverse()
    current = baseClass
  }

  return undefined
}

function extendsController(classDeclaration, checker) {
  return !!controllerClassChain(classDeclaration, checker)
}

function normalizePath(value) {
  const segments = value.split('/').filter(Boolean)
  return segments.length === 0 ? '' : `/${segments.join('/')}`
}

function joinPaths(baseUrl, routePath) {
  return `${normalizePath(baseUrl)}${normalizePath(routePath)}` || '/'
}

function controllerBaseUrls(controllerChain) {
  let paths = ['']

  for (const controllerClass of controllerChain) {
    const classPaths = baseUrlArguments(findDecorator(controllerClass, 'BaseUrl'))
    paths = paths.flatMap((parentPath) =>
      classPaths.map((classPath) => joinPaths(parentPath, classPath)),
    )
  }

  return paths
}

function routeParameters(routePath) {
  const names = []
  const expression = /:([A-Za-z_$][\w$]*)/g
  let match
  while ((match = expression.exec(routePath)) !== null) names.push(match[1])
  return names
}

function resolveSymbol(symbol, checker) {
  if (!symbol) return undefined
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

function classDeclarationForType(type, checker) {
  const symbol = resolveSymbol(type.aliasSymbol ?? type.getSymbol(), checker)
  return symbol?.declarations?.find(ts.isClassDeclaration)
}

function classDeclarationForExpression(expression, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(expression), checker)
  return symbol?.declarations?.find(ts.isClassDeclaration)
}

function isAbstractClass(classDeclaration) {
  return hasModifier(classDeclaration, ts.SyntaxKind.AbstractKeyword)
}

function classExtendsClass(classDeclaration, contractDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(heritageType.expression, checker)
    if (!baseClass) continue
    if (baseClass === contractDeclaration) return true
    if (classExtendsClass(baseClass, contractDeclaration, checker, seen)) return true
  }

  return false
}

function classExtendsBaseMiddleware(classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(heritageType.expression, checker)
    if (!baseClass) continue
    if (baseClass.name?.text === 'BaseMiddleware') return true
    if (classExtendsBaseMiddleware(baseClass, checker, seen)) return true
  }

  return false
}

const authDecoratorKinds = new Map([
  ['BasicAuth', 'basic'],
  ['BearerAuth', 'bearer'],
  ['JwtAuth', 'jwt'],
])

function isHonovelBindingReference(node, checker) {
  const symbol = resolveSymbol(checker.getSymbolAtLocation(node), checker)
  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined
    return coreRelativePath(declaration.getSourceFile().fileName) === 'http/auth.ts' && declarationName === 'Binding'
  }) ?? false
}

function compiledAuthValue(expression, checker, label) {
  if (ts.isStringLiteralLike(expression)) return { kind: 'literal', value: expression.text }
  if (ts.isNumericLiteral(expression)) return { kind: 'literal', value: Number(expression.text) }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null }

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    return { kind: 'literal', value: -Number(expression.operand.text) }
  }

  if (ts.isCallExpression(expression) && isHonovelBindingReference(expression.expression, checker)) {
    if (expression.arguments.length !== 1 || !ts.isStringLiteralLike(expression.arguments[0]) || !expression.arguments[0].text.trim()) {
      fail('Binding() requires one non-empty static binding name.', expression)
    }
    return { kind: 'binding', name: expression.arguments[0].text }
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: 'array',
      items: expression.elements.map((item) => compiledAuthValue(item, checker, label)),
    }
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const entries = []
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        fail(`${label} only supports static object properties and Binding().`, property)
      }

      let key
      if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) {
        key = property.name.text
      } else {
        fail(`${label} property names must be static.`, property.name)
      }

      entries.push([key, compiledAuthValue(property.initializer, checker, label)])
    }
    return { kind: 'object', entries }
  }

  fail(`${label} only supports static literals, arrays, objects, and Binding().`, expression)
}

function compiledParameterDecoratorValue(expression, label) {
  if (ts.isStringLiteralLike(expression)) return { kind: 'literal', value: expression.text }
  if (ts.isNumericLiteral(expression)) return { kind: 'literal', value: Number(expression.text) }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null }

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    return { kind: 'literal', value: -Number(expression.operand.text) }
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: 'array',
      items: expression.elements.map((item) => compiledParameterDecoratorValue(item, label)),
    }
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const entries = []
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        fail(`${label} only supports static object properties.`, property)
      }

      let key
      if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) {
        key = property.name.text
      } else {
        fail(`${label} property names must be static.`, property.name)
      }

      entries.push([key, compiledParameterDecoratorValue(property.initializer, label)])
    }
    return { kind: 'object', entries }
  }

  fail(`${label} only supports static literals, arrays, and objects.`, expression)
}

function customDecoratorForCall(decorator, checker) {
  const decoratorExpression = ts.isCallExpression(decorator.node.expression)
    ? decorator.node.expression.expression
    : decorator.node.expression
  const definition = customDecoratorDefinition(decoratorExpression, checker)
  if (!definition) return undefined
  if (!definition.exported) {
    fail(`Custom decorator ${definition.exportName} must be a named export.`, definition.declaration)
  }

  return {
    ...definition,
    args: decorator.args.map((argument) =>
      compiledParameterDecoratorValue(argument, `@${definition.exportName}()`),
    ),
  }
}

function customDecoratorsForNode(node, checker) {
  return decoratorCalls(node)
    .map((decorator) => customDecoratorForCall(decorator, checker))
    .filter(Boolean)
}

function analyzeDecoratorDependencies(
  definition,
  checker,
  serviceDependencies,
  analyzed,
  stack = [],
) {
  if (analyzed.has(definition.declaration)) return

  const cycleIndex = stack.findIndex((item) => item.declaration === definition.declaration)
  if (cycleIndex !== -1) {
    const cycle = [...stack.slice(cycleIndex), definition]
      .map((item) => item.exportName)
      .join(' -> ')
    fail(`Circular custom decorator dependency detected: ${cycle}.`, definition.declaration)
  }

  const nextStack = [...stack, definition]
  const factoryArgs = definition.initializer.arguments
  const dependencyArray = ts.isArrayLiteralExpression(factoryArgs[0])
    ? factoryArgs[0]
    : undefined

  if (!dependencyArray) {
    analyzed.add(definition.declaration)
    return
  }

  for (const dependencyExpression of dependencyArray.elements) {
    const nestedDecorator = customDecoratorDefinition(dependencyExpression, checker)
    if (nestedDecorator) {
      analyzeDecoratorDependencies(
        nestedDecorator,
        checker,
        serviceDependencies,
        analyzed,
        nextStack,
      )
      continue
    }

    const dependencyClass = classDeclarationForExpression(dependencyExpression, checker)
    if (!dependencyClass) {
      fail(
        `${definition.exportName} dependencies must be injectable classes or custom decorators created with createDecorator().`,
        dependencyExpression,
      )
    }

    const builtin = honovelBuiltinDependencyKind(dependencyClass)
    const abstract = !builtin && isAbstractClass(dependencyClass)
    const className = builtin
      ? dependencyClass.name?.text
      : requireNamedExport(dependencyClass, abstract ? 'DI contract' : 'DI service')

    serviceDependencies.push({
      className,
      sourceFile: dependencyClass.getSourceFile(),
      declaration: dependencyClass,
      abstract,
      builtin,
      node: dependencyExpression,
      provider: undefined,
    })
  }

  analyzed.add(definition.declaration)
}

function middlewareEntriesForNode(node, checker) {
  const middleware = []

  for (const decorator of decoratorCalls(node)) {
    if (decorator.name === 'Middleware') {
      if (decorator.args.length === 0) {
        fail('@Middleware() requires at least one middleware class.', decorator.node)
      }

      const argumentsToCheck = decorator.args.flatMap((argument) =>
        ts.isArrayLiteralExpression(argument) ? [...argument.elements] : [argument],
      )
      if (argumentsToCheck.length === 0) {
        fail('@Middleware() requires at least one middleware class.', decorator.node)
      }

      for (const argument of argumentsToCheck) {
        const middlewareClass = classDeclarationForExpression(argument, checker)
        if (!middlewareClass || isAbstractClass(middlewareClass) || !classExtendsBaseMiddleware(middlewareClass, checker)) {
          fail('@Middleware() arguments must be concrete classes extending BaseMiddleware.', argument)
        }

        middleware.push({
          kind: 'class',
          className: requireNamedExport(middlewareClass, 'Middleware'),
          sourceFile: middlewareClass.getSourceFile(),
          declaration: middlewareClass,
        })
      }
      continue
    }

    const authKind = authDecoratorKinds.get(decorator.name)
    if (!authKind) continue
    if (decorator.args.length !== 1 || !ts.isObjectLiteralExpression(decorator.args[0])) {
      fail(`@${decorator.name}() requires one static options object.`, decorator.node)
    }

    middleware.push({
      kind: 'auth',
      authKind,
      decoratorName: decorator.name,
      options: compiledAuthValue(decorator.args[0], checker, `@${decorator.name}()`),
    })
  }

  return middleware
}

function scopeOptionsForClass(classDeclaration, checker) {
  const decorator = findDecorator(classDeclaration, 'Scope')
  if (!decorator) return { scope: 'scoped', provides: undefined }
  if (decorator.args.length > 1) fail('@Scope() accepts at most one argument.', decorator.node)

  let scope = 'scoped'
  let provides
  if (decorator.args.length === 0) return { scope, provides }

  const options = decorator.args[0]
  if (ts.isStringLiteralLike(options)) {
    if (options.text !== 'scoped' && options.text !== 'transient') fail('@Scope() lifecycle must be "scoped" or "transient".', options)
    return { scope: options.text, provides }
  }
  if (!ts.isObjectLiteralExpression(options)) fail('@Scope() must use a lifecycle string or static options object.', options)

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) fail('@Scope() only supports the "lifecycle" and "provides" options.', property)
    if (property.name.text === 'lifecycle') {
      if (!ts.isStringLiteralLike(property.initializer) || !['scoped', 'transient'].includes(property.initializer.text)) fail('@Scope() lifecycle must be "scoped" or "transient".', property.initializer)
      scope = property.initializer.text
      continue
    }
    if (property.name.text === 'provides') {
      const contractDeclaration = classDeclarationForExpression(property.initializer, checker)
      if (!contractDeclaration || !isAbstractClass(contractDeclaration)) fail('@Scope() provides must reference an abstract class.', property.initializer)
      if (!classExtendsClass(classDeclaration, contractDeclaration, checker)) {
        const implementationName = classDeclaration.name?.text ?? '<anonymous>'
        const contractName = contractDeclaration.name?.text ?? '<anonymous>'
        fail(`${implementationName} declares provides: ${contractName} but does not extend ${contractName}.`, property.initializer)
      }
      provides = { className: requireNamedExport(contractDeclaration, 'DI contract'), sourceFile: contractDeclaration.getSourceFile(), declaration: contractDeclaration }
      continue
    }
    fail('@Scope() only supports the "lifecycle" and "provides" options.', property)
  }
  return { scope, provides }
}

function isHonoContextDeclaration(classDeclaration) {
  const sourcePath = classDeclaration.getSourceFile().fileName.split(path.sep).join('/')
  return classDeclaration.name?.text === 'Context' && sourcePath.includes('/node_modules/hono/')
}

function isHonoRequestDeclaration(classDeclaration) {
  const sourcePath = classDeclaration.getSourceFile().fileName.split(path.sep).join('/')
  return classDeclaration.name?.text === 'HonoRequest' && sourcePath.includes('/node_modules/hono/')
}

function honovelBuiltinDependencyKind(classDeclaration) {
  if (isHonoContextDeclaration(classDeclaration)) return 'hono-context'
  if (isHonoRequestDeclaration(classDeclaration)) return 'hono-request'

  const marker = classDeclaration.members.find((member) =>
    ts.isPropertyDeclaration(member)
      && hasModifier(member, ts.SyntaxKind.StaticKeyword)
      && ts.isIdentifier(member.name)
      && member.name.text === '__honovelBuiltin',
  )

  if (!marker?.initializer) return undefined
  const initializer = ts.isAsExpression(marker.initializer)
    ? marker.initializer.expression
    : marker.initializer
  if (!ts.isStringLiteralLike(initializer)) return undefined
  return initializer.text
}

function constructorDependenciesForClass(classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return []
  seen.add(classDeclaration)

  const constructor = classDeclaration.members.find(ts.isConstructorDeclaration)
  if (!constructor) {
    const clause = classDeclaration.heritageClauses?.find(
      (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
    )
    const baseClass = clause?.types[0]
      ? classDeclarationForExpression(clause.types[0].expression, checker)
      : undefined
    return baseClass ? constructorDependenciesForClass(baseClass, checker, seen) : []
  }

  return constructor.parameters.map((parameter) => {
    const dependencyClass = classDeclarationForType(checker.getTypeAtLocation(parameter), checker)
    const dependencyName = ts.isIdentifier(parameter.name) ? parameter.name.text : '<dependency>'

    if (!dependencyClass) {
      fail(
        `Cannot resolve constructor dependency "${dependencyName}". Honovel DI requires a class type; TypeScript interfaces do not exist at runtime.`,
        parameter,
      )
    }

    const builtin = honovelBuiltinDependencyKind(dependencyClass)
    const abstract = !builtin && isAbstractClass(dependencyClass)
    return {
      className: requireNamedExport(dependencyClass, abstract ? 'DI contract' : 'DI service'),
      sourceFile: dependencyClass.getSourceFile(),
      declaration: dependencyClass,
      abstract,
      builtin,
      node: parameter,
      provider: undefined,
    }
  })
}

function resolveProviderBindings(providers, providerByDeclaration, checker, extraDependencies = []) {
  const injectableProviders = providers.filter((provider) => provider.injectable)
  const explicitByContract = new Map()
  const bindingByContract = new Map()

  for (const provider of injectableProviders) {
    if (!provider.provides) continue
    const entries = explicitByContract.get(provider.provides.declaration) ?? []
    entries.push(provider)
    explicitByContract.set(provider.provides.declaration, entries)
  }

  for (const [contractDeclaration, entries] of explicitByContract) {
    if (entries.length <= 1) continue
    const contractName = contractDeclaration.name?.text ?? '<anonymous>'
    const implementations = entries.map((provider) => provider.className).join(', ')
    fail(
      `Multiple services provide ${contractName}: ${implementations}. Exactly one implementation may declare @Scope({ provides: ${contractName} }).`,
      entries[1].declaration,
    )
  }

  function bindAbstractDependency(dependency) {
    const candidates = injectableProviders.filter((provider) =>
      classExtendsClass(provider.declaration, dependency.declaration, checker),
    )
    const explicit = explicitByContract.get(dependency.declaration) ?? []
    const contractName = dependency.className

    if (candidates.length === 0) {
      fail(`No implementation was found for abstract dependency ${contractName}.`, dependency.node)
    }

    let selected
    if (explicit.length === 1) {
      selected = explicit[0]
    } else if (candidates.length === 1) {
      selected = candidates[0]
    } else {
      const implementations = candidates.map((provider) => provider.className).join(', ')
      fail(
        `Abstract dependency ${contractName} has multiple implementations: ${implementations}. Mark exactly one with @Scope({ provides: ${contractName} }).`,
        dependency.node,
      )
    }

    if (!bindingByContract.has(dependency.declaration)) {
      bindingByContract.set(dependency.declaration, {
        contract: {
          className: dependency.className,
          sourceFile: dependency.sourceFile,
          declaration: dependency.declaration,
        },
        provider: selected,
      })
    }

    return selected
  }

  for (const provider of providers) {
    for (const dependency of provider.dependencies) {
      if (dependency.builtin) continue
      if (dependency.abstract) {
        dependency.provider = bindAbstractDependency(dependency)
        continue
      }

      const directProvider = providerByDeclaration.get(dependency.declaration)
      if (!directProvider) fail(`Dependency ${dependency.className} could not be registered as a DI service.`, dependency.node)
      dependency.provider = directProvider
    }
  }

  for (const dependency of extraDependencies) {
    if (dependency.builtin) continue
    if (dependency.abstract) {
      dependency.provider = bindAbstractDependency(dependency)
      continue
    }

    const directProvider = providerByDeclaration.get(dependency.declaration)
    if (!directProvider) {
      fail(`Dependency ${dependency.className} could not be registered as a DI service.`, dependency.node)
    }
    dependency.provider = directProvider
  }

  for (const entries of explicitByContract.values()) {
    const provider = entries[0]
    const contract = provider.provides
    if (bindingByContract.has(contract.declaration)) continue

    bindingByContract.set(contract.declaration, { contract, provider })
  }

  return [...bindingByContract.values()]
}

function validateProviderGraph(providers) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  function visit(provider) {
    if (visited.has(provider.declaration)) return
    if (visiting.has(provider.declaration)) {
      const start = stack.findIndex((item) => item.declaration === provider.declaration)
      const cycle = [...stack.slice(start), provider].map((item) => item.className).join(' -> ')
      fail(`Circular dependency detected: ${cycle}.`, provider.declaration)
    }

    visiting.add(provider.declaration)
    stack.push(provider)

    for (const dependency of provider.dependencies) {
      if (dependency.builtin) continue
      visit(dependency.provider)
    }

    stack.pop()
    visiting.delete(provider.declaration)
    visited.add(provider.declaration)
  }

  for (const provider of providers) visit(provider)
}

function classExtendsFormRequest(classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const expression = heritageType.expression
    if (ts.isCallExpression(expression) && expressionName(expression.expression) === 'FormRequest') {
      return true
    }

    const baseClass = classDeclarationForType(checker.getTypeAtLocation(expression), checker)
    if (baseClass && classExtendsFormRequest(baseClass, checker, seen)) return true
  }

  return false
}

function formRequestClassForParameter(parameter, checker) {
  const classDeclaration = classDeclarationForType(checker.getTypeAtLocation(parameter), checker)
  if (!classDeclaration || !classExtendsFormRequest(classDeclaration, checker)) return undefined

  return {
    className: requireNamedExport(classDeclaration, 'FormRequest'),
    sourceFile: classDeclaration.getSourceFile(),
    declaration: classDeclaration,
  }
}

function isHonoRequestParameter(parameter, checker) {
  const classDeclaration = classDeclarationForType(checker.getTypeAtLocation(parameter), checker)
  return !!classDeclaration && isHonoRequestDeclaration(classDeclaration)
}

function primitiveKindForParameter(parameter, checker) {
  const type = checker.getTypeAtLocation(parameter)
  const parts = type.isUnion() ? type.types : [type]
  const meaningful = parts.filter(
    (part) => !(part.flags & ts.TypeFlags.Undefined) && !(part.flags & ts.TypeFlags.Null),
  )

  const kinds = meaningful.map((part) => {
    if (part.flags & ts.TypeFlags.StringLike) return 'string'
    if (part.flags & ts.TypeFlags.NumberLike) return 'number'
    if (part.flags & ts.TypeFlags.BooleanLike) return 'boolean'
    return undefined
  })

  const first = kinds[0]
  return first && kinds.every((kind) => kind === first) ? first : undefined
}

function parameterIsOptional(parameter, checker) {
  if (parameter.questionToken || parameter.initializer) return true

  const type = checker.getTypeAtLocation(parameter)
  const parts = type.isUnion() ? type.types : [type]
  return parts.some((part) => part.flags & ts.TypeFlags.Undefined)
}

function parameterName(parameter) {
  if (!ts.isIdentifier(parameter.name)) {
    fail('Controller parameters must use simple identifier names so Honovel can bind them at build time.', parameter.name)
  }
  return parameter.name.text
}

const cronFieldRanges = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  weekday: [0, 7],
}

function classExtendsCronJob(classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(heritageType.expression, checker)
    if (!baseClass) continue
    if (
      baseClass.name?.text === 'CronJob'
      && coreRelativePath(baseClass.getSourceFile().fileName) === 'schedule/CronJob.ts'
    ) return true
    if (classExtendsCronJob(baseClass, checker, seen)) return true
  }
  return false
}

function cronScalar(expression, field, label) {
  if (ts.isNumericLiteral(expression)) {
    const value = Number(expression.text)
    const [min, max] = cronFieldRanges[field]
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(`${label}.${field} numeric values must be integers between ${min} and ${max}.`, expression)
    }
    return String(value)
  }
  if (ts.isStringLiteralLike(expression)) {
    const value = expression.text.trim()
    if (!value || /\s/.test(value)) {
      fail(`${label}.${field} string values must be non-empty cron-field expressions without whitespace.`, expression)
    }
    return value
  }
  fail(`${label}.${field} must be a number, string, or array of numbers/strings.`, expression)
}

function cronField(expression, field, label) {
  if (!expression) return '*'
  if (ts.isArrayLiteralExpression(expression)) {
    if (expression.elements.length === 0) fail(`${label}.${field} arrays must not be empty.`, expression)
    return expression.elements.map((item) => cronScalar(item, field, label)).join(',')
  }
  return cronScalar(expression, field, label)
}

function cronExpressionForClass(classDeclaration, checker) {
  const decorator = findDecorator(classDeclaration, 'Cron')
  const extendsCronJob = classExtendsCronJob(classDeclaration, checker)
  if (!decorator) {
    if (extendsCronJob) fail(`CronJob ${classDeclaration.name?.text ?? '<anonymous>'} must declare @Cron({...}).`, classDeclaration)
    return undefined
  }
  if (!extendsCronJob) fail('@Cron() may only be used on classes extending CronJob.', decorator.node)
  if (decorator.args.length !== 1 || !ts.isObjectLiteralExpression(decorator.args[0])) {
    fail('@Cron() requires one static options object.', decorator.node)
  }

  const options = decorator.args[0]
  const fields = new Map()
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      fail('@Cron() only supports static minute, hour, day, month, and weekday properties.', property)
    }
    const field = property.name.text
    if (!(field in cronFieldRanges)) {
      fail(`@Cron() does not support property "${field}". Use minute, hour, day, month, or weekday.`, property.name)
    }
    if (fields.has(field)) fail(`@Cron() property "${field}" may only be declared once.`, property.name)
    fields.set(field, property.initializer)
  }

  return [
    cronField(fields.get('minute'), 'minute', '@Cron()'),
    cronField(fields.get('hour'), 'hour', '@Cron()'),
    cronField(fields.get('day'), 'day', '@Cron()'),
    cronField(fields.get('month'), 'month', '@Cron()'),
    cronField(fields.get('weekday'), 'weekday', '@Cron()'),
  ].join(' ')
}

function listenerDefinition(classDeclaration, checker) {
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return undefined

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(heritageType.expression, checker)
    if (!baseClass) continue
    const coreFile = coreRelativePath(baseClass.getSourceFile().fileName)
    const baseName = baseClass.name?.text
    if (coreFile !== 'dispatch/Listener.ts' || !['Listener', 'QueuedListener'].includes(baseName)) continue

    const payloadType = heritageType.typeArguments?.[0]
    if (!payloadType) {
      fail(`${baseName}<T> requires a payload class type.`, heritageType)
    }
    const payloadDeclaration = classDeclarationForType(checker.getTypeAtLocation(payloadType), checker)
    if (!payloadDeclaration || isAbstractClass(payloadDeclaration)) {
      fail(`${baseName}<T> payload must be a concrete class.`, payloadType)
    }

    return {
      queued: baseName === 'QueuedListener',
      payloadDeclaration,
      payloadClassName: requireNamedExport(payloadDeclaration, 'Listener payload'),
      payloadSourceFile: payloadDeclaration.getSourceFile(),
    }
  }

  return undefined
}

function analyzeRoutes(program) {
  const checker = program.getTypeChecker()
  const errorResponseType = applicationErrorResponseType(program, checker)
  const routes = []
  const rootDir = path.resolve(program.getCompilerOptions().rootDir ?? projectRoot)
  const methods = new Map([
    ['Get', 'get'],
    ['Post', 'post'],
    ['Put', 'put'],
    ['Patch', 'patch'],
    ['Delete', 'delete'],
  ])
  const sourceFiles = program.getSourceFiles().filter((sourceFile) => {
    const sourcePath = path.resolve(sourceFile.fileName)
    return !sourceFile.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sourceFile) && sourcePath.startsWith(`${rootDir}${path.sep}`)
  })
  const providers = []
  const providerByDeclaration = new Map()
  const parameterDecoratorServiceDependencies = []
  const analyzedParameterDecorators = new Set()
  const listeners = []
  const listenerPayloadDeclarations = new Set()
  const listenerByPayload = new Map()
  const cronJobs = []

  for (const sourceFile of sourceFiles) {
    const relativeSourcePath = path.relative(projectRoot, sourceFile.fileName).split(path.sep).join('/')
    if (relativeSourcePath.startsWith('core/')) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || isAbstractClass(statement)) continue
      const definition = listenerDefinition(statement, checker)
      if (!definition) continue

      const listenerClassName = requireNamedExport(statement, definition.queued ? 'Queued listener' : 'Listener')
      const existing = listenerByPayload.get(definition.payloadDeclaration)
      if (existing) {
        fail(
          `Multiple listeners handle ${definition.payloadClassName}: ${existing.listenerClassName} and ${listenerClassName}. Exactly one Listener<T> or QueuedListener<T> is allowed per payload type.`,
          statement,
        )
      }

      const relativePayloadPath = path.relative(rootDir, definition.payloadSourceFile.fileName)
        .replace(/\\/g, '/')
        .replace(/\.(?:tsx?|mts|cts)$/, '')
      const listener = {
        ...definition,
        listenerClassName,
        listenerSourceFile: sourceFile,
        listenerDeclaration: statement,
        type: `${relativePayloadPath}#${definition.payloadClassName}`,
      }
      listeners.push(listener)
      listenerByPayload.set(definition.payloadDeclaration, listener)
      listenerPayloadDeclarations.add(definition.payloadDeclaration)
    }
  }

  for (const sourceFile of sourceFiles) {
    const relativeSourcePath = path.relative(projectRoot, sourceFile.fileName).split(path.sep).join('/')
    if (relativeSourcePath.startsWith('core/')) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || isAbstractClass(statement)) continue
      const cron = cronExpressionForClass(statement, checker)
      if (!cron) continue
      cronJobs.push({
        cron,
        className: requireNamedExport(statement, 'CronJob'),
        sourceFile,
        declaration: statement,
      })
    }
  }

  function ensureMiddlewareProvider(middleware) {
    if (providerByDeclaration.has(middleware.declaration)) return

    const provider = {
      className: middleware.className,
      sourceFile: middleware.sourceFile,
      declaration: middleware.declaration,
      scope: 'scoped',
      provides: undefined,
      injectable: false,
      dependencies: constructorDependenciesForClass(middleware.declaration, checker),
    }
    providers.push(provider)
    providerByDeclaration.set(middleware.declaration, provider)
  }

  for (const sourceFile of sourceFiles) {
    const relativeSourcePath = path.relative(projectRoot, sourceFile.fileName).split(path.sep).join('/')
    if (relativeSourcePath.startsWith('core/')) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue
      if (isAbstractClass(statement)) continue
      if (extendsController(statement, checker)) continue
      if (classExtendsBaseMiddleware(statement, checker)) continue
      if (classExtendsFormRequest(statement, checker)) continue
      if (listenerPayloadDeclarations.has(statement)) continue
      if (!statement.name || !hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) continue

      const scope = scopeOptionsForClass(statement, checker)
      const database = isDatabaseProvider(statement, checker)
      if (database && (scope.scope !== 'scoped' || statement.members.some(ts.isConstructorDeclaration))) {
        fail('Database providers must be request-scoped and inherit their constructor from defineDatabase().', statement)
      }
      const provider = {
        className: requireNamedExport(statement, 'DI service'),
        sourceFile,
        declaration: statement,
        scope: scope.scope,
        provides: scope.provides,
        injectable: true,
        database,
        dependencies: [],
      }
      providers.push(provider)
      providerByDeclaration.set(statement, provider)
    }
  }

  for (const provider of providers) {
    provider.dependencies = provider.database ? [] : constructorDependenciesForClass(provider.declaration, checker)
  }

  for (const sourceFile of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || isAbstractClass(statement)) continue
      const controllerChain = controllerClassChain(statement, checker)
      if (!controllerChain) continue

      const controllerName = requireNamedExport(statement, 'Controller')
      if (!providerByDeclaration.has(statement)) {
        const provider = {
          className: controllerName,
          sourceFile,
          declaration: statement,
          scope: 'scoped',
          provides: undefined,
          injectable: false,
          dependencies: constructorDependenciesForClass(statement, checker),
        }
        providers.push(provider)
        providerByDeclaration.set(statement, provider)
      }
      const controllerMiddleware = controllerChain.flatMap((controllerClass) =>
        middlewareEntriesForNode(controllerClass, checker),
      )
      for (const middleware of controllerMiddleware.filter((item) => item.kind === 'class')) {
        ensureMiddlewareProvider(middleware)
      }
      const controllerCustomDecorators = controllerChain.flatMap((controllerClass) =>
        customDecoratorsForNode(controllerClass, checker),
      )
      for (const decorator of controllerCustomDecorators) {
        analyzeDecoratorDependencies(
          decorator,
          checker,
          parameterDecoratorServiceDependencies,
          analyzedParameterDecorators,
        )
      }

      const baseUrls = controllerBaseUrls(controllerChain)

      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) continue
        const routeDecorators = decoratorCalls(member).filter((decorator) => methods.has(decorator.name))
        if (routeDecorators.length === 0) continue
        if (routeDecorators.length > 1) fail('Controller methods may only declare one HTTP route decorator.', member)
        if (!member.name || !ts.isIdentifier(member.name)) {
          fail('Controller route methods must use identifier method names.', member.name ?? member)
        }

        const routeDecorator = routeDecorators[0]
        const methodMiddleware = middlewareEntriesForNode(member, checker)
        for (const middleware of methodMiddleware.filter((item) => item.kind === 'class')) {
          ensureMiddlewareProvider(middleware)
        }
        const methodCustomDecorators = customDecoratorsForNode(member, checker)
        for (const decorator of methodCustomDecorators) {
          analyzeDecoratorDependencies(
            decorator,
            checker,
            parameterDecoratorServiceDependencies,
            analyzedParameterDecorators,
          )
        }
        const routePath = stringArgument(routeDecorator, `@${routeDecorator.name}`, '/')
        const fullPaths = baseUrls.map((baseUrl) => joinPaths(baseUrl, routePath))
        if (new Set(fullPaths).size !== fullPaths.length) {
          fail('@BaseUrl() paths must produce distinct routes.', routeDecorator.node)
        }
        const fullPath = fullPaths[0]
        const placeholderNames = routeParameters(fullPath)
        for (const path of fullPaths.slice(1)) {
          const names = routeParameters(path)
          if (names.length !== placeholderNames.length || names.some((name) => !placeholderNames.includes(name))) {
            fail('All @BaseUrl() paths for a route must use the same parameter names.', routeDecorator.node)
          }
        }
        const placeholderSet = new Set(placeholderNames)
        const consumed = new Set()
        const bindings = []
        let bodyBindings = 0

        for (const parameter of member.parameters) {
          const name = parameterName(parameter)
          const queryDecorator = findDecorator(parameter, 'Query')
          const paramDecorator = findDecorator(parameter, 'Param')
          const customDecorators = customDecoratorsForNode(parameter, checker)

          if (customDecorators.length > 1) {
            fail('A controller parameter may only use one custom parameter decorator.', parameter)
          }

          const customDecorator = customDecorators[0]
          const bindingDecoratorCount = Number(!!queryDecorator) + Number(!!paramDecorator) + Number(!!customDecorator)
          if (bindingDecoratorCount > 1) {
            fail('A controller parameter may only use one binding decorator.', parameter)
          }

          if (customDecorator) {
            analyzeDecoratorDependencies(
              customDecorator,
              checker,
              parameterDecoratorServiceDependencies,
              analyzedParameterDecorators,
            )
            bindings.push({
              kind: 'custom',
              decoratorName: customDecorator.exportName,
              decoratorSourceFile: customDecorator.sourceFile,
              args: customDecorator.args,
              parameter,
            })
            continue
          }


          const requestClass = formRequestClassForParameter(parameter, checker)
          const honoRequest = isHonoRequestParameter(parameter, checker)

          if (honoRequest) {
            if (queryDecorator || paramDecorator) {
              fail('HonoRequest parameters cannot use @Query() or @Param().', parameter)
            }
            bindings.push({ kind: 'honoRequest', parameter })
            continue
          }

          if (paramDecorator) {
            const explicitParamName = stringArgument(paramDecorator, '@Param', name)

            if (explicitParamName !== name) {
              fail(
                `@Param(${JSON.stringify(explicitParamName)}) does not match variable name "${name}". Route parameter names and variable names must match exactly.`,
                paramDecorator.node,
              )
            }

            if (!placeholderSet.has(name)) {
              fail(`Route does not declare a ":${name}" placeholder for parameter "${name}".`, parameter)
            }

            if (consumed.has(name)) fail(`Route placeholder ":${name}" is bound more than once.`, parameter)

            const primitive = primitiveKindForParameter(parameter, checker)
            if (!primitive) fail(`Route parameter "${name}" must be typed as string, number, or boolean.`, parameter)

            consumed.add(name)
            bindings.push({
              source: 'param',
              kind: 'primitive',
              key: name,
              primitive,
              required: !parameterIsOptional(parameter, checker),
              parameter,
            })
            continue
          }

          if (queryDecorator) {
            const explicitQueryName = stringArgument(queryDecorator, '@Query', undefined)
            const key = explicitQueryName ?? (requestClass ? undefined : name)

            if (requestClass) {
              bindings.push({ source: 'query', kind: 'formRequest', key, requestClass, parameter })
              continue
            }

            const primitive = primitiveKindForParameter(parameter, checker)
            if (!primitive) {
              fail(`Query parameter "${name}" must be string, number, boolean, or a FormRequest.`, parameter)
            }
            bindings.push({
              source: 'query',
              kind: 'primitive',
              key,
              primitive,
              required: !parameterIsOptional(parameter, checker),
              parameter,
            })
            continue
          }

          if (requestClass) {
            bodyBindings += 1
            if (bodyBindings > 1) fail('A controller method may only have one body FormRequest parameter.', parameter)
            bindings.push({ source: 'body', kind: 'formRequest', requestClass, parameter })
            continue
          }

          if (!placeholderSet.has(name)) {
            const expected = placeholderNames.length ? ` Expected one of: ${placeholderNames.join(', ')}.` : ''
            fail(
              `Cannot infer controller parameter "${name}". Undecorated parameters must match a route placeholder by name, be a FormRequest, or be HonoRequest.${expected}`,
              parameter,
            )
          }

          if (consumed.has(name)) fail(`Route placeholder ":${name}" is bound more than once.`, parameter)

          const primitive = primitiveKindForParameter(parameter, checker)
          if (!primitive) fail(`Route parameter "${name}" must be typed as string, number, or boolean.`, parameter)

          consumed.add(name)
          bindings.push({
            source: 'param',
            kind: 'primitive',
            key: name,
            primitive,
            required: !parameterIsOptional(parameter, checker),
            parameter,
          })
        }

        for (const placeholder of placeholderNames) {
          if (!consumed.has(placeholder)) {
            fail(`Route placeholder ":${placeholder}" must have a controller parameter named "${placeholder}".`, member)
          }
        }

        for (const path of fullPaths) {
          routes.push({
            method: methods.get(routeDecorator.name),
            path,
            controllerName,
            controllerSourceFile: sourceFile,
            controllerDeclaration: statement,
            handlerName: member.name.text,
            handlerDeclaration: member,
            middleware: [...controllerMiddleware, ...methodMiddleware],
            decorators: [...controllerCustomDecorators, ...methodCustomDecorators],
            bindings,
          })
        }
      }
    }
  }

  const databaseDependencies = [
    ...providers.flatMap((provider) => provider.dependencies),
    ...parameterDecoratorServiceDependencies,
  ].filter((dependency) => dependency.builtin === 'database')

  if (databaseDependencies.length > 0) {
    fail(
      'Inject a named class extending defineDatabase(...), not the generic Database holder.',
      databaseDependencies[0].node,
    )
  }

  if (listeners.some((listener) => listener.queued)) {
    const queueProviders = providers.filter((provider) =>
      provider.provides?.className === 'Queue'
      && coreRelativePath(provider.provides.sourceFile.fileName) === 'queue/Queue.ts',
    )
    if (queueProviders.length === 0) {
      fail(
        'QueuedListener<T> requires a Queue implementation. Register one with @Scope({ provides: Queue }).',
        listeners.find((listener) => listener.queued).listenerDeclaration,
      )
    }
  }

  const providerBindings = resolveProviderBindings(
    providers,
    providerByDeclaration,
    checker,
    parameterDecoratorServiceDependencies,
  )
  validateProviderGraph(providers)
  const openApiDocument = createOpenApiDocument({
    ts,
    checker,
    routes,
    providers,
    providerBindings,
    projectRoot,
    title: applicationTitle(),
    version: applicationVersion(),
    errorResponseType,
    fail,
  })
  return { routes, listeners, cronJobs, providers, providerBindings, rootDir, openApiDocument }
}

function externalPackageName(sourceFile) {
  const fileName = sourceFile.fileName.split(path.sep).join('/')
  const marker = '/node_modules/'
  const index = fileName.lastIndexOf(marker)
  if (index === -1) return undefined

  const segments = fileName.slice(index + marker.length).split('/')
  return segments[0]?.startsWith('@')
    ? `${segments[0]}/${segments[1]}`
    : segments[0]
}

function emittedModuleSpecifier(sourceFile, rootDir) {
  const coreFile = coreRelativePath(sourceFile.fileName)
  if (installedPackage && !coreFile.startsWith('../') && !path.isAbsolute(coreFile)) {
    return runtimeImport(coreFile.replace(/\.ts$/, ''))
  }

  const externalPackage = externalPackageName(sourceFile)
  if (externalPackage) return externalPackage

  const relative = path.relative(rootDir, sourceFile.fileName)
  const jsPath = relative.replace(/\.(?:tsx?|mts|cts)$/, '.js').split(path.sep).join('/')
  return jsPath.startsWith('.') ? jsPath : `./${jsPath}`
}

function generateEntries(routes, listeners, cronJobs, providers, providerBindings, rootDir, outDir, openApiDocument, buildOptions) {
  const aliases = new Map()
  const imports = []

  function aliasFor(sourceFile) {
    const key = path.resolve(sourceFile.fileName)
    if (aliases.has(key)) return aliases.get(key)

    const alias = `M${aliases.size}`
    aliases.set(key, alias)
    imports.push(`import * as ${alias} from ${JSON.stringify(emittedModuleSpecifier(sourceFile, rootDir))}`)
    return alias
  }

  const providerRegistrations = providers.map((provider) => {
    const providerAlias = aliasFor(provider.sourceFile)
    if (provider.database) {
      return `container.register(${providerAlias}.${provider.className}, "scoped", (scope) => new ${providerAlias}.${provider.className}(scope.resolve(HonoContext)))`
    }
    const dependencies = provider.dependencies.map((dependency) => {
      if (dependency.builtin === 'hono-context') return 'scope.resolve(HonoContext)'
      if (dependency.builtin === 'hono-request') return 'scope.resolve(HonoRequestToken)'
      if (dependency.builtin === 'logger') return 'scope.resolve(Logger)'
      if (dependency.builtin === 'dispatcher') return 'scope.resolve(Dispatcher)'

      const dependencyAlias = aliasFor(dependency.sourceFile)
      return `scope.resolve(${dependencyAlias}.${dependency.className})`
    }).join(', ')

    return `container.register(${providerAlias}.${provider.className}, ${JSON.stringify(provider.scope)}, (scope) => new ${providerAlias}.${provider.className}(${dependencies}))`
  })

  const providerAliasRegistrations = providerBindings.map((binding) => {
    const contractAlias = aliasFor(binding.contract.sourceFile)
    const providerAlias = aliasFor(binding.provider.sourceFile)
    return `container.registerAlias(${contractAlias}.${binding.contract.className}, ${providerAlias}.${binding.provider.className})`
  })

  const listenerRegistrations = listeners.map((listener) => {
    const payloadAlias = aliasFor(listener.payloadSourceFile)
    const listenerAlias = aliasFor(listener.listenerSourceFile)
    return `{ type: ${JSON.stringify(listener.type)}, payload: ${payloadAlias}.${listener.payloadClassName}, listener: ${listenerAlias}.${listener.listenerClassName}, queued: ${listener.queued ? 'true' : 'false'} }`
  })

  const cronRegistrations = cronJobs.map((job) => {
    const jobAlias = aliasFor(job.sourceFile)
    return `{ cron: ${JSON.stringify(job.cron)}, job: ${jobAlias}.${job.className} }`
  })

  function bindingExpression(binding, queryVariable, bodyVariable) {
    if (binding.kind === 'honoRequest') return 'context.req'
    if (binding.kind === 'custom') {
      const decoratorAlias = aliasFor(binding.decoratorSourceFile)
      const args = binding.args.map(renderCompiledAuthValue).join(', ')
      return `await resolveCompiledDecorator(context, scope, ${decoratorAlias}.${binding.decoratorName}, [${args}])`
    }

    let rawExpression
    if (binding.source === 'param') {
      rawExpression = `context.req.param(${JSON.stringify(binding.key)})`
    } else if (binding.source === 'query') {
      rawExpression = binding.key === undefined
        ? queryVariable
        : `${queryVariable}[${JSON.stringify(binding.key)}]`
    } else {
      rawExpression = bodyVariable
    }

    if (binding.kind === 'primitive') {
      const helper = {
        boolean: 'coerceCompiledBoolean',
        number: 'coerceCompiledNumber',
        string: 'coerceCompiledString',
      }[binding.primitive]
      return `${helper}(${rawExpression}, ${binding.required ? 'true' : 'false'}, ${JSON.stringify(binding.source)}, ${JSON.stringify(binding.key)})`
    }

    const requestAlias = aliasFor(binding.requestClass.sourceFile)
    return `await createCompiledFormRequest(context, ${requestAlias}.${binding.requestClass.className}, ${rawExpression}, ${JSON.stringify(binding.source)})`
  }

  function renderCompiledAuthValue(value) {
    if (value.kind === 'literal') return JSON.stringify(value.value)
    if (value.kind === 'binding') return `context.env[${JSON.stringify(value.name)}]`
    if (value.kind === 'array') return `[${value.items.map(renderCompiledAuthValue).join(', ')}]`
    if (value.kind === 'object') {
      return `{ ${value.entries.map(([key, item]) => `${JSON.stringify(key)}: ${renderCompiledAuthValue(item)}`).join(', ')} }`
    }
    throw new Error(`Unknown compiled auth value kind: ${value.kind}`)
  }

  function routeDecoratorExpression(decorator) {
    const decoratorAlias = aliasFor(decorator.sourceFile)
    const args = decorator.args.map(renderCompiledAuthValue).join(', ')
    return `await resolveCompiledDecorator(context, scope, ${decoratorAlias}.${decorator.exportName}, [${args}])`
  }

  function classMiddlewareExpression(item) {
    const middlewareAlias = aliasFor(item.sourceFile)
    return `${middlewareAlias}.${item.className}`
  }

  function renderMiddlewareChain(middleware, terminalLines, indent = '  ') {
    if (middleware.length === 0) return terminalLines.map((line) => `${indent}${line}`)

    const [first, ...rest] = middleware
    if (first.kind === 'auth') {
      const factory = {
        basic: '__honoBasicAuth',
        bearer: '__honoBearerAuth',
        jwt: '__honoJwtAuth',
      }[first.authKind]
      return [
        `${indent}return runCompiledHonoMiddleware(context, ${factory}(${renderCompiledAuthValue(first.options)}), async () => {`,
        ...renderMiddlewareChain(rest, terminalLines, `${indent}  `),
        `${indent}})`,
      ]
    }

    const classMiddleware = [first]
    let offset = 0
    while (offset < rest.length && rest[offset].kind === 'class') {
      classMiddleware.push(rest[offset])
      offset += 1
    }
    const remaining = rest.slice(offset)
    const constructors = classMiddleware.map(classMiddlewareExpression).join(', ')
    return [
      `${indent}return runCompiledMiddlewareChain(context, scope, [${constructors}], async () => {`,
      ...renderMiddlewareChain(remaining, terminalLines, `${indent}  `),
      `${indent}})`,
    ]
  }

  const registrations = routes.map((route) => {
    const controllerAlias = aliasFor(route.controllerSourceFile)
    const needsQuery = route.bindings.some((binding) => binding.source === 'query')
    const needsBody = route.bindings.some((binding) => binding.source === 'body')
    const handlerLines = [
      ...(route.decorators ?? []).map((decorator) => routeDecoratorExpression(decorator)),
      `const controller = scope.resolve(${controllerAlias}.${route.controllerName})`,
      'bindControllerContext(controller, context)',
    ]

    if (needsQuery) handlerLines.push('const queryInput = readCompiledQuery(context)')
    if (needsBody) handlerLines.push('const bodyInput = await readCompiledBody(context)')

    route.bindings.forEach((binding, index) => {
      handlerLines.push(`const arg${index} = ${bindingExpression(binding, 'queryInput', 'bodyInput')}`)
    })

    const args = route.bindings.map((_, index) => `arg${index}`).join(', ')
    handlerLines.push(`return normalizeCompiledResult(context, await controller.${route.handlerName}(${args}))`)

    const lines = [
      `app.${route.method}(${JSON.stringify(route.path)}, async (context) => {`,
      '  const scope = createCompiledRequestScope(container, context)',
      ...renderMiddlewareChain(route.middleware, handlerLines),
      '})',
    ]
    return lines.join('\n')
  })

  const authKinds = new Set(
    routes.flatMap((route) => route.middleware)
      .filter((middleware) => middleware.kind === 'auth')
      .map((middleware) => middleware.authKind),
  )
  const authImports = [
    ...(authKinds.has('basic') ? [`import { basicAuth as __honoBasicAuth } from 'hono/basic-auth'`] : []),
    ...(authKinds.has('bearer') ? [`import { bearerAuth as __honoBearerAuth } from 'hono/bearer-auth'`] : []),
    ...(authKinds.has('jwt') ? [`import { jwt as __honoJwtAuth } from 'hono/jwt'`] : []),
  ]

  const documentationEnabled = buildOptions.documentation.enabled
  const appEntry = [
    `import { Context as HonoContext } from 'hono'`,
    `import { HonoRequest as HonoRequestToken } from 'hono/request'`,
    ...authImports,
    `import { Container } from '${runtimeImport('di/Container')}'`,
    `import { Dispatcher, createListenerRegistry } from '${runtimeImport('dispatch/Dispatcher')}'`,
    `import { Logger } from '${runtimeImport('logging/Logger')}'`,
    `import { bindControllerContext } from '${runtimeImport('http/Controller')}'`,
    `import { registerExceptionHandler } from '${runtimeImport('http/exceptions')}'`,
    `import { coerceCompiledBoolean, coerceCompiledNumber, coerceCompiledString, createCompiledFormRequest, createCompiledQueueScope, createCompiledRequestScope, normalizeCompiledResult, readCompiledBody, readCompiledQuery, resolveCompiledDecorator, runCompiledHonoMiddleware, runCompiledMiddlewareChain } from '${runtimeImport('http/routeRuntime')}'`,
    ...(documentationEnabled ? [`import { registerOpenApiRoutes } from '${runtimeImport('openapi/runtime')}'`] : []),
    ...imports,
    '',
    ...(documentationEnabled ? [`const openApiDocument = ${JSON.stringify(openApiDocument)}`, ''] : []),
    `const listenerRegistry = createListenerRegistry([${listenerRegistrations.join(', ')}])`,
    `const cronRegistry = [${cronRegistrations.join(', ')}]`,
    `export const cronSchedules = [...new Set(cronRegistry.map((entry) => entry.cron))]`,
    '',
    'function createHonovelContainer() {',
    '  const container = new Container()',
    '  container.register(Dispatcher, "scoped", (scope) => {',
    '    const env = scope.resolve(HonoContext).env',
    '    return new Dispatcher(scope, listenerRegistry, () => createCompiledQueueScope(container, env))',
    '  })',
    '  container.register(Logger, "scoped", (scope) => new Logger(scope.resolve(HonoContext)))',
    ...providerRegistrations.map((registration) => `  ${registration}`),
    ...providerAliasRegistrations.map((registration) => `  ${registration}`),
    '  return container',
    '}',
    '',
    'export async function consumeQueueMessage(message, bindings = {}, executionCtx) {',
    '  const container = createHonovelContainer()',
    '  const scope = createCompiledQueueScope(container, bindings, executionCtx)',
    '  const dispatcher = new Dispatcher(scope, listenerRegistry, () => createCompiledQueueScope(container, bindings, executionCtx))',
    '  await dispatcher.consume(message, scope)',
    '}',
    '',
    'export async function runCronJob(cron, bindings = {}, executionCtx) {',
    '  const matches = cronRegistry.filter((entry) => entry.cron === cron)',
    '  if (matches.length === 0) throw new Error(`No Honovel CronJob is registered for ${cron}.`)',
    '  const container = createHonovelContainer()',
    '  const scope = createCompiledQueueScope(container, bindings, executionCtx)',
    '  for (const entry of matches) {',
    '    const job = scope.resolve(entry.job)',
    '    await job.handle()',
    '  }',
    '}',
    '',
    'export function registerHonovel(app) {',
    '  const container = createHonovelContainer()',
    '  registerExceptionHandler(app)',
    '  app.cronSchedules = cronSchedules',
    '  app.runCronJob = runCronJob',
    `  app.honovelDocumentation = ${JSON.stringify({ enabled: documentationEnabled, swaggerPath: buildOptions.documentation.swaggerPath, openApiPath: buildOptions.documentation.openApiPath })}`,
    ...(documentationEnabled ? [
      `  registerOpenApiRoutes(app, openApiDocument, ${JSON.stringify({ swaggerPath: buildOptions.documentation.swaggerPath, openApiPath: buildOptions.documentation.openApiPath })})`,
    ] : []),
    '',
    ...registrations.map((registration) =>
      registration.split('\n').map((line) => `  ${line}`).join('\n'),
    ),
    // A configured Cloudflare consumer needs a handler even before its first
    // queued listener is added. Unknown messages retain the normal retry path.
    ...[
      '',
      '  app.queue = async (batch, env, executionCtx) => {',
      '    for (const message of batch.messages ?? []) {',
      '      try {',
      '        await consumeQueueMessage(message.body, env, executionCtx)',
      '        message.ack?.()',
      '      } catch (error) {',
      '        console.error("[Honovel] Queued listener failed.", error)',
      '        message.retry?.()',
      '      }',
      '    }',
      '  }',
    ],
    ...(cronJobs.length > 0 ? [
      '',
      '  app.scheduled = async (controller, env, executionCtx) => {',
      '    await runCronJob(controller.cron, env, executionCtx)',
      '  }',
    ] : []),
    '',
    '  return app',
    '}',
    '',
    'export default registerHonovel',
    '',
  ].join('\n')

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'app.js'), appEntry)
  fs.rmSync(path.join(outDir, 'app.d.ts'), { force: true })
  fs.writeFileSync(path.join(outDir, 'openapi.json'), `${JSON.stringify(openApiDocument, null, 2)}\n`)

  // Runtime entrypoints belong to the application. Remove artifacts emitted by older Honovel versions.
  fs.rmSync(path.join(outDir, 'entry.js'), { force: true })
  fs.rmSync(path.join(outDir, 'node-entry.js'), { force: true })
  fs.rmSync(path.join(outDir, 'honovel.config.js'), { force: true })
  fs.rmSync(path.join(outDir, 'core', 'config'), { recursive: true, force: true })
}

function writeGeneratedWranglerConfig(cronJobs, outDir) {
  const wranglerPath = path.join(projectRoot, 'wrangler.jsonc')
  if (!fs.existsSync(wranglerPath)) return

  const parsed = ts.parseConfigFileTextToJson(wranglerPath, fs.readFileSync(wranglerPath, 'utf8'))
  if (parsed.error || !parsed.config || typeof parsed.config !== 'object') {
    throw new Error('[Honovel] Unable to parse wrangler.jsonc while generating Cron Trigger configuration.')
  }

  const generated = structuredClone(parsed.config)
  delete generated.env
  generated.triggers = {
    ...(generated.triggers ?? {}),
    crons: [...new Set(cronJobs.map((job) => job.cron))],
  }

  function writeIfChanged(filePath, content) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
    fs.writeFileSync(filePath, content)
  }

  const generatedPath = path.join(projectRoot, '.honovel.wrangler.jsonc')
  writeIfChanged(generatedPath, `${JSON.stringify(generated, null, 2)}\n`)
  const redirectDirectory = path.join(projectRoot, '.wrangler', 'deploy')
  fs.mkdirSync(redirectDirectory, { recursive: true })
  const redirectPath = path.relative(redirectDirectory, generatedPath).split(path.sep).join('/')
  writeIfChanged(path.join(redirectDirectory, 'config.json'), `${JSON.stringify({ configPath: redirectPath }, null, 2)}\n`)
}

function main() {
  let buildOptions
  try {
    buildOptions = compilerBuildOptions()
  } catch (error) {
    console.error(`[Honovel] ${error.message}`)
    process.exit(1)
  }

  const parsed = readTsConfig()
  const debugSources = buildOptions.mode === 'development'
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      sourceMap: debugSources,
      inlineSources: debugSources,
    },
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)

  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost))
    process.exit(1)
  }

  const honovelDiagnostics = program.getSourceFiles().flatMap((sourceFile) =>
    collectHonovelDiagnostics(ts, program, sourceFile),
  )

  if (honovelDiagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(honovelDiagnostics, diagnosticHost),
    )
    process.exit(1)
  }

  try {
    validateRootAppEntry(program)
  } catch (error) {
    printHonovelError(error)
    process.exit(1)
  }

  let analysis
  try {
    analysis = analyzeRoutes(program)
  } catch (error) {
    printHonovelError(error)
    process.exit(1)
  }

  if (noEmit) {
    console.log(`[Honovel] ${analysis.routes.length} route(s) compiled successfully.`)
    return
  }

  const emit = program.emit(
    undefined,
    undefined,
    undefined,
    undefined,
    { before: [honovelEmitTransformer(program)] },
  )
  if (emit.emitSkipped || emit.diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(emit.diagnostics, diagnosticHost))
    process.exit(1)
  }

  const outDir = path.resolve(parsed.options.outDir ?? path.join(projectRoot, '.honovel'))
  generateEntries(analysis.routes, analysis.listeners, analysis.cronJobs, analysis.providers, analysis.providerBindings, analysis.rootDir, outDir, analysis.openApiDocument, buildOptions)
  writeGeneratedWranglerConfig(analysis.cronJobs, outDir)
  if (!debugSources) removeGeneratedSourceMaps(outDir)
  console.log(`[Honovel] Compiled ${analysis.routes.length} route(s) with static bindings.`)
}

main()
