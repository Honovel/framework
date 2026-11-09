import type ts from 'typescript'

const path = require('node:path')
const coreRoot = path.resolve(__dirname, '../..')
const coreRelativePath = (file) => path.relative(coreRoot, file).replace(/\\/g, '/')

function decoratorsOf(ts, node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
}

function expressionName(ts, expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function decoratorCalls(ts, node) {
  return decoratorsOf(ts, node).map((decorator) => {
    if (ts.isCallExpression(decorator.expression)) {
      return {
        name: expressionName(ts, decorator.expression.expression),
        args: [...decorator.expression.arguments],
        node: decorator,
      }
    }

    return {
      name: expressionName(ts, decorator.expression),
      args: [],
      node: decorator,
    }
  })
}

function findDecorator(ts, node, name) {
  return decoratorCalls(ts, node).find((decorator) => decorator.name === name)
}

function staticStringArgument(ts, decorator, defaultValue) {
  if (!decorator || decorator.args.length === 0) return defaultValue
  const argument = decorator.args[0]
  return ts.isStringLiteralLike(argument) ? argument.text : undefined
}

function staticBaseUrls(ts, decorator) {
  if (!decorator) return ['']
  if (decorator.args.length !== 1) return undefined

  const argument = decorator.args[0]
  const paths = ts.isArrayLiteralExpression(argument) ? argument.elements : [argument]
  if (paths.length === 0 || paths.some((path) => !ts.isStringLiteralLike(path))) return undefined
  return paths.map((path) => path.text)
}

function isCoreControllerBase(classDeclaration) {
  return coreRelativePath(classDeclaration.getSourceFile().fileName) === 'http/Controller.ts'
    && ['BaseController', 'Controller'].includes(classDeclaration.name?.text)
}

function controllerClassChain(ts, classDeclaration, checker) {
  const chain: ts.ClassDeclaration[] = []
  const seen = new Set()
  let current = classDeclaration

  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(current)

    const clause = current.heritageClauses?.find(
      (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
    )
    if (!clause?.types.length) return undefined

    const baseClass = classDeclarationForExpression(ts, clause.types[0].expression, checker)
    if (!baseClass) return undefined
    if (isCoreControllerBase(baseClass)) return chain.reverse()
    if (baseClass.name?.text === 'Controller' && !baseClass.heritageClauses?.length) return chain.reverse()
    current = baseClass
  }

  return undefined
}

function extendsController(ts, classDeclaration, checker) {
  return !!controllerClassChain(ts, classDeclaration, checker)
}

function normalizePath(value) {
  const segments = value.split('/').filter(Boolean)
  return segments.length === 0 ? '' : `/${segments.join('/')}`
}

function joinPaths(baseUrl, routePath) {
  return `${normalizePath(baseUrl)}${normalizePath(routePath)}` || '/'
}

function staticControllerBaseUrls(ts, controllerChain) {
  let paths = ['']

  for (const controllerClass of controllerChain) {
    const classPaths = staticBaseUrls(ts, findDecorator(ts, controllerClass, 'BaseUrl'))
    if (classPaths === undefined) return undefined
    paths = paths.flatMap((parentPath) =>
      classPaths.map((classPath) => joinPaths(parentPath, classPath)),
    )
  }

  return paths
}

function routeParameters(routePath) {
  const names: string[] = []
  const expression = /:([A-Za-z_$][\w$]*)/g
  let match

  while ((match = expression.exec(routePath)) !== null) {
    names.push(match[1])
  }

  return names
}

function resolveSymbol(ts, symbol, checker) {
  if (!symbol) return undefined
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

function classDeclarationForType(ts, type, checker) {
  const symbol = resolveSymbol(ts, type.aliasSymbol ?? type.getSymbol(), checker)
  return symbol?.declarations?.find(ts.isClassDeclaration)
}

function classDeclarationForExpression(ts, expression, checker) {
  const symbol = resolveSymbol(ts, checker.getSymbolAtLocation(expression), checker)
  return symbol?.declarations?.find(ts.isClassDeclaration)
}

function isCreateDecoratorReference(ts, node, checker) {
  const symbol = resolveSymbol(ts, checker.getSymbolAtLocation(node), checker)
  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'createDecorator'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'http/customDecorators.ts'
  }) ?? false
}

function isDefineDatabaseReference(ts, node, checker) {
  const symbol = resolveSymbol(ts, checker.getSymbolAtLocation(node), checker)
  return symbol?.declarations?.some((declaration) => {
    const declarationName = declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined

    return declarationName === 'defineDatabase'
      && coreRelativePath(declaration.getSourceFile().fileName) === 'database/Database.ts'
  }) ?? false
}

function databaseDefinitionFromExpression(ts, expression, checker, seen = new Set()) {
  if (ts.isCallExpression(expression) && isDefineDatabaseReference(ts, expression.expression, checker)) {
    return expression
  }

  if (!ts.isIdentifier(expression)) return undefined
  const symbol = resolveSymbol(ts, checker.getSymbolAtLocation(expression), checker)
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration)
  if (!declaration?.initializer || seen.has(declaration)) return undefined

  seen.add(declaration)
  return databaseDefinitionFromExpression(ts, declaration.initializer, checker, seen)
}

function isDatabaseProvider(ts, declaration, checker, seen = new Set()) {
  if (seen.has(declaration)) return false
  seen.add(declaration)
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const base of clause.types) {
      if (databaseDefinitionFromExpression(ts, base.expression, checker)) return true
      const parent = classDeclarationForExpression(ts, base.expression, checker)
      if (parent && isDatabaseProvider(ts, parent, checker, seen)) return true
    }
  }
  return false
}

function customParameterDecoratorDefinition(ts, node, checker) {
  const symbol = resolveSymbol(ts, checker.getSymbolAtLocation(node), checker)
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration)
  if (!declaration || !ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined
  if (!ts.isCallExpression(declaration.initializer)) return undefined
  if (!isCreateDecoratorReference(ts, declaration.initializer.expression, checker)) return undefined

  return declaration
}

function parameterDecoratorDefinitionInfo(ts, node, checker) {
  const declaration = customParameterDecoratorDefinition(ts, node, checker)
  if (!declaration || !ts.isIdentifier(declaration.name) || !ts.isCallExpression(declaration.initializer)) {
    return undefined
  }

  return {
    name: declaration.name.text,
    declaration,
    initializer: declaration.initializer,
  }
}

function staticParameterDecoratorValue(ts, expression) {
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return true
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
    || expression.kind === ts.SyntaxKind.NullKeyword
  ) return true

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) return true

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.every((item) => staticParameterDecoratorValue(ts, item))
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every((property) =>
      ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name))
      && staticParameterDecoratorValue(ts, property.initializer),
    )
  }

  return false
}

function customDecoratorDiagnosticsForNode(ts, node, checker, sourceFile) {
  const diagnostics: ts.Diagnostic[] = []

  for (const decorator of decoratorCalls(ts, node)) {
    const expression = ts.isCallExpression(decorator.node.expression)
      ? decorator.node.expression.expression
      : decorator.node.expression
    if (!customParameterDecoratorDefinition(ts, expression, checker)) continue
    if (decorator.args.every((argument) => staticParameterDecoratorValue(ts, argument))) continue

    diagnostics.push(
      diagnostic(
        ts,
        sourceFile,
        decorator.node,
        95014,
        `@${decorator.name}() only supports static literal, array, and object arguments.`,
      ),
    )
  }

  return diagnostics
}

function hasModifier(ts, node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false
}

function isAbstractClass(ts, classDeclaration) {
  return hasModifier(ts, classDeclaration, ts.SyntaxKind.AbstractKeyword)
}

function classExtendsClass(ts, classDeclaration, contractDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(ts, heritageType.expression, checker)
    if (!baseClass) continue
    if (baseClass === contractDeclaration) return true
    if (classExtendsClass(ts, baseClass, contractDeclaration, checker, seen)) return true
  }

  return false
}

function classExtendsBaseMiddleware(ts, classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(ts, heritageType.expression, checker)
    if (!baseClass) continue
    if (baseClass.name?.text === 'BaseMiddleware') return true
    if (classExtendsBaseMiddleware(ts, baseClass, checker, seen)) return true
  }

  return false
}

function isHonoContextDeclaration(classDeclaration) {
  const sourcePath = classDeclaration.getSourceFile().fileName.replace(/\\/g, '/')
  return classDeclaration.name?.text === 'Context' && sourcePath.includes('/node_modules/hono/')
}

function isHonoRequestDeclaration(classDeclaration) {
  const sourcePath = classDeclaration.getSourceFile().fileName.replace(/\\/g, '/')
  return classDeclaration.name?.text === 'HonoRequest' && sourcePath.includes('/node_modules/hono/')
}

function honovelBuiltinDependencyKind(ts, classDeclaration) {
  if (isHonoContextDeclaration(classDeclaration)) return 'hono-context'
  if (isHonoRequestDeclaration(classDeclaration)) return 'hono-request'

  const marker = classDeclaration.members.find((member) =>
    ts.isPropertyDeclaration(member)
      && hasModifier(ts, member, ts.SyntaxKind.StaticKeyword)
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

function scopedProvidedContract(ts, classDeclaration, checker) {
  const decorator = findDecorator(ts, classDeclaration, 'Scope')
  if (!decorator || decorator.args.length !== 1) return undefined

  const options = decorator.args[0]
  if (!ts.isObjectLiteralExpression(options)) return undefined

  const provides = options.properties.find(
    (property) => ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === 'provides',
  )
  if (!provides || !ts.isPropertyAssignment(provides)) return undefined

  return classDeclarationForExpression(ts, provides.initializer, checker)
}

const cronFieldRanges = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  weekday: [0, 7],
}

function classExtendsCronJob(ts, classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return false
  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(ts, heritageType.expression, checker)
    if (!baseClass) continue
    if (
      baseClass.name?.text === 'CronJob'
      && coreRelativePath(baseClass.getSourceFile().fileName) === 'schedule/CronJob.ts'
    ) return true
    if (classExtendsCronJob(ts, baseClass, checker, seen)) return true
  }
  return false
}

function validCronScalar(ts, expression, field) {
  if (ts.isNumericLiteral(expression)) {
    const value = Number(expression.text)
    const [min, max] = cronFieldRanges[field]
    return Number.isInteger(value) && value >= min && value <= max
  }
  return ts.isStringLiteralLike(expression)
    && !!expression.text.trim()
    && !/\s/.test(expression.text.trim())
}

function validCronField(ts, expression, field) {
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.length > 0
      && expression.elements.every((item) => validCronScalar(ts, item, field))
  }
  return validCronScalar(ts, expression, field)
}

function cronDiagnosticsForClass(ts, classDeclaration, checker, sourceFile) {
  const diagnostics: ts.Diagnostic[] = []
  const decorator = findDecorator(ts, classDeclaration, 'Cron')
  const extendsCronJob = classExtendsCronJob(ts, classDeclaration, checker)
  if (!decorator) {
    if (extendsCronJob && !isAbstractClass(ts, classDeclaration)) {
      diagnostics.push(diagnostic(ts, sourceFile, classDeclaration.name ?? classDeclaration, 95019,
        `CronJob ${classDeclaration.name?.text ?? '<anonymous>'} must declare @Cron({...}).`))
    }
    return diagnostics
  }
  if (!extendsCronJob) {
    diagnostics.push(diagnostic(ts, sourceFile, decorator.node, 95019,
      '@Cron() may only be used on classes extending CronJob.'))
    return diagnostics
  }
  if (decorator.args.length !== 1 || !ts.isObjectLiteralExpression(decorator.args[0])) {
    diagnostics.push(diagnostic(ts, sourceFile, decorator.node, 95019,
      '@Cron() requires one static options object.'))
    return diagnostics
  }

  const seen = new Set()
  for (const property of decorator.args[0].properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      diagnostics.push(diagnostic(ts, sourceFile, property, 95019,
        '@Cron() only supports static minute, hour, day, month, and weekday properties.'))
      continue
    }
    const field = property.name.text
    if (!(field in cronFieldRanges)) {
      diagnostics.push(diagnostic(ts, sourceFile, property.name, 95019,
        `@Cron() does not support property "${field}". Use minute, hour, day, month, or weekday.`))
      continue
    }
    if (seen.has(field) || !validCronField(ts, property.initializer, field)) {
      diagnostics.push(diagnostic(ts, sourceFile, property, 95019,
        `@Cron().${field} must be a valid static cron-field number, string, or non-empty array.`))
    }
    seen.add(field)
  }
  return diagnostics
}

function listenerDefinition(ts, classDeclaration, checker) {
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return undefined

  for (const heritageType of clause.types) {
    const baseClass = classDeclarationForExpression(ts, heritageType.expression, checker)
    if (!baseClass) continue
    const coreFile = coreRelativePath(baseClass.getSourceFile().fileName)
    const baseName = baseClass.name?.text
    if (coreFile !== 'dispatch/Listener.ts' || !['Listener', 'QueuedListener'].includes(baseName)) continue

    const payloadType = heritageType.typeArguments?.[0]
    if (!payloadType) return { invalid: true, node: heritageType }
    const payloadDeclaration = classDeclarationForType(ts, checker.getTypeAtLocation(payloadType), checker)
    if (!payloadDeclaration) return { invalid: true, node: payloadType }

    return {
      queued: baseName === 'QueuedListener',
      payloadDeclaration,
      node: heritageType,
    }
  }

  return undefined
}

function listenerDefinitions(ts, program) {
  const checker = program.getTypeChecker()
  const listeners: Array<{ declaration: ts.ClassDeclaration; invalid?: boolean; queued?: boolean; payloadDeclaration?: ts.ClassDeclaration; node: ts.Node }> = []
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile) || /[\\/]core[\\/]/.test(sourceFile.fileName)) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || isAbstractClass(ts, statement)) continue
      const definition = listenerDefinition(ts, statement, checker)
      if (definition) listeners.push({ declaration: statement, ...definition })
    }
  }
  return listeners
}

function injectableClasses(ts, program) {
  const classes: ts.ClassDeclaration[] = []
  const listenerPayloads = new Set(
    listenerDefinitions(ts, program)
      .filter((listener) => listener.payloadDeclaration)
      .map((listener) => listener.payloadDeclaration),
  )
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile) || /[\\/]core[\\/]/.test(sourceFile.fileName)) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || isAbstractClass(ts, statement)) continue
      if (!statement.name || !hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword) || hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)) continue
      if (extendsController(ts, statement, program.getTypeChecker())) continue
      if (classExtendsBaseMiddleware(ts, statement, program.getTypeChecker())) continue
      if (classExtendsFormRequest(ts, statement, program.getTypeChecker())) continue
      if (listenerPayloads.has(statement)) continue
      classes.push(statement)
    }
  }
  return classes
}

function classExtendsFormRequest(ts, classDeclaration, checker, seen = new Set()) {
  if (seen.has(classDeclaration)) return false
  seen.add(classDeclaration)

  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )

  if (!clause) return false

  for (const heritageType of clause.types) {
    const expression = heritageType.expression

    if (
      ts.isCallExpression(expression)
      && expressionName(ts, expression.expression) === 'FormRequest'
    ) {
      return true
    }

    const baseClass = classDeclarationForType(
      ts,
      checker.getTypeAtLocation(expression),
      checker,
    )

    if (baseClass && classExtendsFormRequest(ts, baseClass, checker, seen)) {
      return true
    }
  }

  return false
}

function isFormRequestParameter(ts, parameter, checker) {
  const classDeclaration = classDeclarationForType(
    ts,
    checker.getNonNullableType(checker.getTypeAtLocation(parameter)),
    checker,
  )

  return !!classDeclaration
    && classExtendsFormRequest(ts, classDeclaration, checker)
}

function formRequestParameterOutputTypes(ts, parameter, checker) {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(parameter))
  const outputs = propertyTypes(checker, type, 'validated', parameter).flatMap((methodType) =>
    methodType.getCallSignatures().map((signature) => checker.getReturnTypeOfSignature(signature)),
  )
  if (outputs.length) return outputs
  const declaration = classDeclarationForType(ts, type, checker)
  return declaration ? schemaOutputTypes(checker, formRequestSchemaExpression(ts, declaration)) : []
}

function formRequestUsesQueryPrefix(ts, parameter, checker) {
  const { decoder } = formRequestQueryDecoding(ts, parameter, checker)
  if (decoder !== 'raw') return typeof decoder === 'object'
  return formRequestParameterOutputTypes(ts, parameter, checker).some((output) => {
    const type = checker.getNonNullableType(output)
    return !!(type.flags & ts.TypeFlags.Object)
      && !checker.isArrayType(type)
      && !checker.isTupleType(type)
  })
}

function queryPrimitiveDecoder(ts, type) {
  const parts = (type.isUnion?.() ? type.types : [type])
    .filter((part) => !(part.flags & ts.TypeFlags.Undefined))
  const kinds = parts.map((part) => {
    if (part.flags & ts.TypeFlags.StringLike) return 'string'
    if (part.flags & ts.TypeFlags.NumberLike) return 'number'
    if (part.flags & ts.TypeFlags.BooleanLike) return 'boolean'
    return 'raw'
  })
  return kinds.length && kinds.every((kind) => kind === kinds[0]) ? kinds[0] : 'raw'
}

function formRequestQueryDecoding(ts, parameter, checker) {
  const requestType = checker.getNonNullableType(checker.getTypeAtLocation(parameter))
  const declaration = classDeclarationForType(ts, requestType, checker)
  const symbol = declaration?.name && checker.getSymbolAtLocation(declaration.name)
  const constructorType = symbol && checker.getTypeOfSymbolAtLocation(symbol, declaration.name)
  const schemas = constructorType ? propertyTypes(checker, constructorType, 'schema', parameter) : []
  const inputs = schemas.flatMap((schema) => {
    const zodInputs = propertyTypes(checker, schema, '_input', parameter)
    if (zodInputs.length) return zodInputs
    return propertyTypes(checker, schema, '~standard', parameter).flatMap((standard) =>
      propertyTypes(checker, standard, 'types', parameter).flatMap((types) =>
        propertyTypes(checker, types, 'input', parameter),
      ),
    )
  })
  const warnings: string[] = []
  if (inputs.length !== 1) {
    warnings.push('schema input type cannot be inferred')
    return { decoder: 'raw', warnings }
  }
  const input = inputs[0]
  const primitive = queryPrimitiveDecoder(ts, input)
  const inputType = input.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ? undefined : input
  if (primitive !== 'raw') return { decoder: primitive, warnings, inputType }

  // Only the root query object is assembled. Arrays and nested objects stay raw.
  const type = checker.getNonNullableType(input)
  const fromStandardLibrary = type.getSymbol()?.declarations?.some((node) => node.getSourceFile().hasNoDefaultLib)
  if (
    type.flags & ts.TypeFlags.Object
    && !checker.isArrayType(type) && !checker.isTupleType(type)
    && !fromStandardLibrary
    && !type.getCallSignatures().length
  ) {
    if (type.getStringIndexType()) warnings.push('dynamic object fields have no supported scalar decoding plan')
    if (input.isUnion?.() && input.types.some((part) => part.flags & ts.TypeFlags.Null)) {
      warnings.push('null input has no automatic query representation')
    }
    const fields = type.getProperties().map((property) => {
      const location = property.valueDeclaration ?? property.declarations?.[0] ?? parameter
      const fieldType = checker.getTypeOfSymbolAtLocation(property, location)
      const decoder = queryPrimitiveDecoder(ts, fieldType)
      if (decoder === 'raw') warnings.push(`field "${property.name}" has unsupported input type ${checker.typeToString(fieldType)}`)
      return [property.name, decoder]
    })
    return { decoder: { fields }, warnings, inputType }
  }
  warnings.push(`unsupported input type ${checker.typeToString(input)}`)
  return { decoder: 'raw', warnings, inputType }
}

function queryTypeWarnings(ts, sourceFile, parameter, checker, formRequest) {
  const warnings = formRequest
    ? formRequestQueryDecoding(ts, parameter, checker).warnings
    : queryPrimitiveDecoder(ts, checker.getTypeAtLocation(parameter)) === 'raw'
      ? [`unsupported input type ${checker.typeToString(checker.getTypeAtLocation(parameter))}`]
      : []
  return warnings.map((reason) => ({
    ...diagnostic(ts, sourceFile, parameter.name, 95021,
      `Query/Param "${parameter.name.getText(sourceFile)}": ${reason}. Honovel only automatically decodes string, number and boolean. Other values remain raw; accept strings and parse them explicitly.`),
    category: ts.DiagnosticCategory.Warning,
  }))
}

function typeContainsQueryObject(ts, type, checker, seen = new Set()) {
  if (!type || seen.has(type)) return false
  seen.add(type)
  if (type.isUnion?.() || type.isIntersection?.()) {
    return type.types.some((part) => typeContainsQueryObject(ts, part, checker, seen))
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker.getTypeArguments(type).some((part) => typeContainsQueryObject(ts, part, checker, seen))
  }
  return !!(type.flags & ts.TypeFlags.Object)
}

const formRequestReservedFields = new Set(['req', 'validated'])

function isHonoRequestParameter(ts, parameter, checker) {
  const classDeclaration = classDeclarationForType(
    ts,
    checker.getTypeAtLocation(parameter),
    checker,
  )

  return !!classDeclaration && isHonoRequestDeclaration(classDeclaration)
}

function formRequestSchemaExpression(ts, classDeclaration) {
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  if (!clause) return undefined

  for (const heritageType of clause.types) {
    const expression = heritageType.expression
    if (
      ts.isCallExpression(expression)
      && expressionName(ts, expression.expression) === 'FormRequest'
    ) {
      return expression.arguments[0]
    }
  }

  return undefined
}

function propertyTypes(checker, type, name, fallbackNode, seen = new Set()) {
  if (!type || seen.has(type)) return []
  seen.add(type)

  if (type.isUnion?.() || type.isIntersection?.()) {
    return type.types.flatMap((part) => propertyTypes(checker, part, name, fallbackNode, seen))
  }

  const property = type.getProperty?.(name)
  if (!property) return []
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? fallbackNode
  return [checker.getTypeOfSymbolAtLocation(property, declaration)]
}

function schemaOutputTypes(checker, schemaExpression) {
  if (!schemaExpression) return []
  const schemaType = checker.getTypeAtLocation(schemaExpression)
  const outputs = [...propertyTypes(checker, schemaType, '_output', schemaExpression)]

  for (const standardType of propertyTypes(checker, schemaType, '~standard', schemaExpression)) {
    for (const typesType of propertyTypes(checker, standardType, 'types', schemaExpression)) {
      outputs.push(...propertyTypes(checker, typesType, 'output', schemaExpression))
    }
  }

  for (const safeParseType of propertyTypes(checker, schemaType, 'safeParse', schemaExpression)) {
    for (const signature of safeParseType.getCallSignatures()) {
      const returnType = checker.getReturnTypeOfSignature(signature)
      outputs.push(...propertyTypes(checker, returnType, 'data', schemaExpression))
    }
  }

  return [...new Set(outputs)]
}

function reservedFormRequestFields(checker, schemaExpression) {
  const fields = new Set()
  const seen = new Set()

  function visit(type) {
    if (!type || seen.has(type)) return
    seen.add(type)

    if (type.isUnion?.() || type.isIntersection?.()) {
      for (const part of type.types) visit(part)
      return
    }

    for (const field of formRequestReservedFields) {
      if (type.getProperty?.(field)) fields.add(field)
    }
  }

  for (const type of schemaOutputTypes(checker, schemaExpression)) visit(type)
  return [...fields]
}

function diagnostic(ts, file, node, code, messageText) {
  return {
    file,
    start: node.getStart(file),
    length: node.getWidth(file),
    category: ts.DiagnosticCategory.Error,
    code,
    source: 'honovel',
    messageText,
  }
}

const authDecoratorNames = new Set(['BasicAuth', 'BearerAuth', 'JwtAuth'])

function staticAuthValue(ts, expression) {
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return true
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
    || expression.kind === ts.SyntaxKind.NullKeyword
  ) return true

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) return true

  if (
    ts.isCallExpression(expression)
    && expressionName(ts, expression.expression) === 'Binding'
  ) {
    return expression.arguments.length === 1
      && ts.isStringLiteralLike(expression.arguments[0])
      && !!expression.arguments[0].text.trim()
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.every((item) => staticAuthValue(ts, item))
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every((property) =>
      ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name))
      && staticAuthValue(ts, property.initializer),
    )
  }

  return false
}

function authDiagnosticsForNode(ts, node, sourceFile) {
  const diagnostics: ts.Diagnostic[] = []
  for (const decorator of decoratorCalls(ts, node).filter((item) => authDecoratorNames.has(item.name))) {
    if (
      decorator.args.length === 1
      && ts.isObjectLiteralExpression(decorator.args[0])
      && staticAuthValue(ts, decorator.args[0])
    ) continue

    diagnostics.push(
      diagnostic(
        ts,
        sourceFile,
        decorator.node,
        95013,
        `@${decorator.name}() requires one static options object containing only literals, arrays, objects, and Binding().`,
      ),
    )
  }
  return diagnostics
}

function middlewareDiagnosticsForNode(ts, node, checker, sourceFile) {
  const diagnostics: ts.Diagnostic[] = []

  for (const decorator of decoratorCalls(ts, node).filter((item) => item.name === 'Middleware')) {
    if (decorator.args.length === 0) {
      diagnostics.push(
        diagnostic(
          ts,
          sourceFile,
          decorator.node,
          95010,
          '@Middleware() requires at least one middleware class.',
        ),
      )
      continue
    }

    const argumentsToCheck = decorator.args.flatMap((argument) =>
      ts.isArrayLiteralExpression(argument) ? [...argument.elements] : [argument],
    )
    if (argumentsToCheck.length === 0) {
      diagnostics.push(
        diagnostic(ts, sourceFile, decorator.node, 95010, '@Middleware() requires at least one middleware class.'),
      )
    }

    for (const argument of argumentsToCheck) {
      const middlewareClass = classDeclarationForExpression(ts, argument, checker)
      if (
        middlewareClass
        && !isAbstractClass(ts, middlewareClass)
        && classExtendsBaseMiddleware(ts, middlewareClass, checker)
      ) {
        continue
      }

      diagnostics.push(
        diagnostic(
          ts,
          sourceFile,
          argument,
          95010,
          '@Middleware() arguments must be concrete classes extending BaseMiddleware.',
        ),
      )
    }
  }

  return diagnostics
}

function parameterDecoratorDependencyDiagnostics(
  ts,
  sourceFile,
  checker,
  injectables,
  explicitByContract,
) {
  const diagnostics: ts.Diagnostic[] = []

  function visit(definition, stack: Array<{ declaration: ts.Declaration; name: string }> = []) {
    const cycleIndex = stack.findIndex((item) => item.declaration === definition.declaration)
    if (cycleIndex !== -1) {
      const cycle = [...stack.slice(cycleIndex), definition]
        .map((item) => item.name)
        .join(' -> ')
      diagnostics.push(
        diagnostic(
          ts,
          sourceFile,
          definition.declaration.name ?? definition.declaration,
          95015,
          `Circular custom decorator dependency detected: ${cycle}.`,
        ),
      )
      return
    }

    const factoryArgs = definition.initializer.arguments
    const dependencyArray = ts.isArrayLiteralExpression(factoryArgs[0])
      ? factoryArgs[0]
      : undefined
    if (!dependencyArray) return

    const nextStack = [...stack, definition]
    for (const dependencyExpression of dependencyArray.elements) {
      const nestedDecorator = parameterDecoratorDefinitionInfo(ts, dependencyExpression, checker)
      if (nestedDecorator) {
        visit(nestedDecorator, nextStack)
        continue
      }

      if (dependencyExpression.getSourceFile() !== sourceFile) continue

      const dependencyClass = classDeclarationForExpression(ts, dependencyExpression, checker)
      if (!dependencyClass) continue
      const builtin = honovelBuiltinDependencyKind(ts, dependencyClass)
      if (builtin === 'database') {
        diagnostics.push(diagnostic(
          ts,
          sourceFile,
          dependencyExpression,
          95016,
          'Inject a named class extending defineDatabase(...), not the generic Database holder.',
        ))
        continue
      }
      if (builtin) continue

      const dependencyName = dependencyClass.name?.text ?? '<dependency>'
      if (isAbstractClass(ts, dependencyClass)) {
        const candidates = injectables.filter((candidate) =>
          classExtendsClass(ts, candidate, dependencyClass, checker),
        )
        const explicit = explicitByContract.get(dependencyClass) ?? []

        if (candidates.length === 0) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              dependencyExpression,
              95007,
              `No implementation was found for abstract dependency ${dependencyName}.`,
            ),
          )
        } else if (explicit.length > 1) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              dependencyExpression,
              95009,
              `Multiple services provide ${dependencyName}. Exactly one implementation may declare @Scope({ provides: ${dependencyName} }).`,
            ),
          )
        } else if (candidates.length > 1 && explicit.length === 0) {
          const implementationNames = candidates
            .map((candidate) => candidate.name?.text ?? '<anonymous>')
            .join(', ')
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              dependencyExpression,
              95008,
              `Abstract dependency ${dependencyName} has multiple implementations: ${implementationNames}. Mark exactly one with @Scope({ provides: ${dependencyName} }).`,
            ),
          )
        }
        continue
      }

      if (!injectables.includes(dependencyClass)) {
        diagnostics.push(
          diagnostic(
            ts,
            sourceFile,
            dependencyExpression,
            95006,
            `Dependency ${dependencyName} could not be registered as a DI service.`,
          ),
        )
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const definition = parameterDecoratorDefinitionInfo(ts, declaration.name, checker)
      if (definition) visit(definition)
    }
  }

  return diagnostics
}

function collectHonovelDiagnostics(ts, program, sourceFile) {
  if (!sourceFile || sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile)) return []

  const checker = program.getTypeChecker()
  const diagnostics: ts.Diagnostic[] = []
  const methods = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete'])
  const injectables = injectableClasses(ts, program)
  const explicitByContract = new Map()
  const listeners = listenerDefinitions(ts, program)
  const listenersByPayload = new Map()
  for (const listener of listeners) {
    if (!listener.payloadDeclaration) continue
    const entries = listenersByPayload.get(listener.payloadDeclaration) ?? []
    entries.push(listener)
    listenersByPayload.set(listener.payloadDeclaration, entries)
  }

  for (const [payload, entries] of listenersByPayload) {
    if (entries.length <= 1) continue
    const payloadName = payload.name?.text ?? '<anonymous>'
    const names = entries.map((entry) => entry.declaration.name?.text ?? '<anonymous>').join(', ')
    for (const entry of entries.slice(1)) {
      if (entry.declaration.getSourceFile() !== sourceFile) continue
      diagnostics.push(diagnostic(
        ts,
        sourceFile,
        entry.declaration.name ?? entry.declaration,
        95018,
        `Multiple listeners handle ${payloadName}: ${names}. Exactly one Listener<T> or QueuedListener<T> is allowed per payload type.`,
      ))
    }
  }

  for (const injectable of injectables) {
    const contract = scopedProvidedContract(ts, injectable, checker)
    if (!contract) continue
    const providers = explicitByContract.get(contract) ?? []
    providers.push(injectable)
    explicitByContract.set(contract, providers)
  }

  diagnostics.push(
    ...parameterDecoratorDependencyDiagnostics(
      ts,
      sourceFile,
      checker,
      injectables,
      explicitByContract,
    ),
  )

  for (const [contract, providers] of explicitByContract) {
    if (providers.length <= 1) continue
    const contractName = contract.name?.text ?? '<anonymous>'
    const implementationNames = providers.map((provider) => provider.name?.text ?? '<anonymous>').join(', ')

    for (const provider of providers.slice(1)) {
      if (provider.getSourceFile() !== sourceFile) continue
      diagnostics.push(
        diagnostic(
          ts,
          sourceFile,
          provider.name ?? provider,
          95009,
          `Multiple services provide ${contractName}: ${implementationNames}. Exactly one implementation may declare @Scope({ provides: ${contractName} }).`,
        ),
      )
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue

    const schemaExpression = formRequestSchemaExpression(ts, statement)
    if (schemaExpression) {
      for (const field of reservedFormRequestFields(checker, schemaExpression)) {
        diagnostics.push(
          diagnostic(
            ts,
            sourceFile,
            statement.name ?? statement,
            95011,
            `FormRequest field "${field}" is reserved by Honovel.`,
          ),
        )
      }
    }

    diagnostics.push(...middlewareDiagnosticsForNode(ts, statement, checker, sourceFile))
    diagnostics.push(...authDiagnosticsForNode(ts, statement, sourceFile))
    diagnostics.push(...customDecoratorDiagnosticsForNode(ts, statement, checker, sourceFile))
    diagnostics.push(...cronDiagnosticsForClass(ts, statement, checker, sourceFile))
    for (const member of statement.members) {
      if (ts.isMethodDeclaration(member)) {
        diagnostics.push(...middlewareDiagnosticsForNode(ts, member, checker, sourceFile))
        diagnostics.push(...authDiagnosticsForNode(ts, member, sourceFile))
        diagnostics.push(...customDecoratorDiagnosticsForNode(ts, member, checker, sourceFile))
      }
    }

    const isController = extendsController(ts, statement, checker)
    const isService = injectables.includes(statement)
    const isMiddleware = classExtendsBaseMiddleware(ts, statement, checker)
    if (!isController && !isService && !isMiddleware) continue

    if (isDatabaseProvider(ts, statement, checker)) {
      const scope = findDecorator(ts, statement, 'Scope')?.args[0]
      const lifecycle = scope && ts.isObjectLiteralExpression(scope)
        ? scope.properties.find((property) => ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name) && property.name.text === 'lifecycle')?.initializer
        : scope
      if ((lifecycle && ts.isStringLiteral(lifecycle) && lifecycle.text !== 'scoped')
        || statement.members.some(ts.isConstructorDeclaration)) {
        diagnostics.push(diagnostic(ts, sourceFile, statement.name, 95017,
          'Database providers must be request-scoped and inherit their constructor from defineDatabase().'))
      }
      continue
    }

    const constructor = statement.members.find(ts.isConstructorDeclaration)
    if (constructor) {
      for (const parameter of constructor.parameters) {
        const dependencyClass = classDeclarationForType(
          ts,
          checker.getTypeAtLocation(parameter),
          checker,
        )
        const parameterNode = ts.isIdentifier(parameter.name) ? parameter.name : parameter
        const parameterName = ts.isIdentifier(parameter.name) ? parameter.name.text : '<dependency>'

        if (!dependencyClass) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              parameterNode,
              95005,
              `Cannot resolve constructor dependency "${parameterName}". Honovel DI requires a class type; TypeScript interfaces do not exist at runtime.`,
            ),
          )
          continue
        }

        const builtin = honovelBuiltinDependencyKind(ts, dependencyClass)
        if (builtin === 'database') {
          diagnostics.push(diagnostic(
            ts,
            sourceFile,
            parameterNode,
            95016,
            'Inject a named class extending defineDatabase(...), not the generic Database holder.',
          ))
          continue
        }
        if (builtin) continue

        if (isAbstractClass(ts, dependencyClass)) {
          const dependencyName = dependencyClass.name?.text ?? parameterName
          const candidates = injectables.filter((candidate) =>
            classExtendsClass(ts, candidate, dependencyClass, checker),
          )
          const explicit = candidates.filter(
            (candidate) => scopedProvidedContract(ts, candidate, checker) === dependencyClass,
          )

          if (candidates.length === 0) {
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                parameterNode,
                95007,
                `No implementation was found for abstract dependency ${dependencyName}.`,
              ),
            )
          } else if (explicit.length > 1) {
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                parameterNode,
                95009,
                `Multiple services provide ${dependencyName}. Exactly one implementation may declare @Scope({ provides: ${dependencyName} }).`,
              ),
            )
          } else if (candidates.length > 1 && explicit.length === 0) {
            const implementationNames = candidates
              .map((candidate) => candidate.name?.text ?? '<anonymous>')
              .join(', ')
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                parameterNode,
                95008,
                `Abstract dependency ${dependencyName} has multiple implementations: ${implementationNames}. Mark exactly one with @Scope({ provides: ${dependencyName} }).`,
              ),
            )
          }

          continue
        }

        if (!injectables.includes(dependencyClass)) {
          const dependencyName = dependencyClass.name?.text ?? parameterName
          diagnostics.push(diagnostic(ts, sourceFile, parameterNode, 95006, `Dependency ${dependencyName} could not be registered as a DI service.`))
        }
      }
    }

    if (!isController) continue

    const controllerChain = controllerClassChain(ts, statement, checker)
    const baseUrls = controllerChain ? staticControllerBaseUrls(ts, controllerChain) : undefined
    if (baseUrls === undefined) continue

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue

      const routeDecorator = decoratorCalls(ts, member).find(
        (decorator) => methods.has(decorator.name),
      )

      if (!routeDecorator) continue

      const routePath = staticStringArgument(ts, routeDecorator, '/')
      if (routePath === undefined) continue

      const fullPaths = baseUrls.map((baseUrl) => joinPaths(baseUrl, routePath))
      const placeholders = routeParameters(fullPaths[0])
      const placeholderSet = new Set(placeholders)
      const consumed = new Set()

      for (const parameter of member.parameters) {
        if (!ts.isIdentifier(parameter.name)) continue

        const name = parameter.name.text
        const queryDecorator = findDecorator(ts, parameter, 'Query')
        const paramDecorator = findDecorator(ts, parameter, 'Param')
        const customDecorators = decoratorCalls(ts, parameter).filter((decorator) => {
          const expression = ts.isCallExpression(decorator.node.expression)
            ? decorator.node.expression.expression
            : decorator.node.expression
          return !!customParameterDecoratorDefinition(ts, expression, checker)
        })

        if (customDecorators.length > 1) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              parameter.name,
              95014,
              'A controller parameter may only use one custom parameter decorator.',
            ),
          )
          continue
        }

        const customDecorator = customDecorators[0]
        const bindingDecoratorCount = Number(!!queryDecorator) + Number(!!paramDecorator) + Number(!!customDecorator)
        if (bindingDecoratorCount > 1) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              parameter.name,
              95014,
              'A controller parameter may only use one binding decorator.',
            ),
          )
          continue
        }

        if (customDecorator) {
          if (!customDecorator.args.every((argument) => staticParameterDecoratorValue(ts, argument))) {
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                customDecorator.node,
                95014,
                `@${customDecorator.name}() only supports static literal, array, and object arguments.`,
              ),
            )
          }
          continue
        }

        if (queryDecorator && paramDecorator) {
          diagnostics.push(
            diagnostic(
              ts,
              sourceFile,
              parameter.name,
              95004,
              'A controller parameter cannot use both @Query() and @Param().',
            ),
          )
          continue
        }

        const honoRequest = isHonoRequestParameter(ts, parameter, checker)
        if (honoRequest) {
          if (queryDecorator || paramDecorator) {
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                parameter.name,
                95012,
                'HonoRequest parameters cannot use @Query() or @Param().',
              ),
            )
          }
          continue
        }

        if (queryDecorator) {
          diagnostics.push(...queryTypeWarnings(ts, sourceFile, parameter, checker, isFormRequestParameter(ts, parameter, checker)))
          const key = staticStringArgument(ts, queryDecorator, undefined)
          if (
            key !== undefined
            && isFormRequestParameter(ts, parameter, checker)
            && formRequestQueryDecoding(ts, parameter, checker).decoder === 'raw'
            && !formRequestUsesQueryPrefix(ts, parameter, checker)
            && formRequestParameterOutputTypes(ts, parameter, checker).some((type) =>
              typeContainsQueryObject(ts, type, checker),
            )
          ) {
            diagnostics.push(diagnostic(
              ts, sourceFile, parameter.name, 95020,
              `Named query parameter "${key}" must have an object output for prefixed fields, a primitive output, or an array of primitives. Arrays of objects and mixed object unions are not supported.`,
            ))
          }
          continue
        }

        if (paramDecorator) {
          diagnostics.push(...queryTypeWarnings(ts, sourceFile, parameter, checker, false))
          const explicitName = staticStringArgument(ts, paramDecorator, name)

          if (explicitName !== undefined && explicitName !== name) {
            diagnostics.push(
              diagnostic(
                ts,
                sourceFile,
                parameter.name,
                95002,
                `@Param(${JSON.stringify(explicitName)}) does not match variable name "${name}". Route parameter names and variable names must match exactly.`,
              ),
            )
            continue
          }
        }

        if (isFormRequestParameter(ts, parameter, checker)) continue

        if (placeholderSet.has(name)) {
          if (!paramDecorator) diagnostics.push(...queryTypeWarnings(ts, sourceFile, parameter, checker, false))
          consumed.add(name)
          continue
        }

        const expected = placeholders.length > 0
          ? ` Expected one of: ${placeholders.join(', ')}.`
          : ''

        diagnostics.push(
          diagnostic(
            ts,
            sourceFile,
            parameter.name,
            95001,
            `Cannot infer controller parameter "${name}". Undecorated parameters must match a route placeholder by name, be a FormRequest, or be HonoRequest.${expected}`,
          ),
        )
      }

      for (const placeholder of placeholders) {
        if (consumed.has(placeholder)) continue

        diagnostics.push(
          diagnostic(
            ts,
            sourceFile,
            member.name ?? member,
            95003,
            `Route placeholder ":${placeholder}" must have a controller parameter named "${placeholder}".`,
          ),
        )
      }
    }
  }

  return diagnostics
}

export = {
  collectHonovelDiagnostics,
  formRequestUsesQueryPrefix,
  formRequestQueryDecoding,
}
