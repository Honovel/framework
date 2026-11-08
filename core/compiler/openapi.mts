import path from 'node:path'
import type ts from 'typescript'

interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  oneOf?: JsonSchema[]
  [keyword: string]: unknown
}

interface Provider {
  declaration: ts.ClassDeclaration
}

interface OpenApiDocument extends Record<string, unknown> {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, Record<string, {
    responses: Record<string, { description: string; content: Record<string, { schema: JsonSchema }> }>
    [key: string]: unknown
  }>>
  components?: { schemas?: Record<string, JsonSchema>; securitySchemes?: Record<string, JsonSchema> }
}

const builtinExceptionStatuses = new Map([
  ['BadRequestException', 400],
  ['UnauthorizedException', 401],
  ['ForbiddenException', 403],
  ['NotFoundException', 404],
  ['ConflictException', 409],
])

const responseDescriptions = new Map([
  [200, 'Successful response'],
  [201, 'Created'],
  [202, 'Accepted'],
  [204, 'No Content'],
  [400, 'Bad Request'],
  [401, 'Unauthorized'],
  [403, 'Forbidden'],
  [404, 'Not Found'],
  [409, 'Conflict'],
  [422, 'Validation Error'],
  [429, 'Too Many Requests'],
  [500, 'Internal Server Error'],
])

const authSecuritySchemes = new Map<string, [string, JsonSchema]>([
  ['basic', ['basicAuth', { type: 'http', scheme: 'basic' }]],
  ['bearer', ['bearerAuth', { type: 'http', scheme: 'bearer' }]],
  ['jwt', ['jwtAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }]],
])

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

function baseClassOf(ts, classDeclaration, checker) {
  const clause = classDeclaration.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  const type = clause?.types[0]
  return type ? classDeclarationForExpression(ts, type.expression, checker) : undefined
}

function findMethod(ts, classDeclaration, methodName, checker, seen = new Set()) {
  if (!classDeclaration || seen.has(classDeclaration)) return undefined
  seen.add(classDeclaration)

  const own = classDeclaration.members.find((member) =>
    ts.isMethodDeclaration(member)
      && ts.isIdentifier(member.name)
      && member.name.text === methodName,
  )
  if (own?.body) return own

  return findMethod(ts, baseClassOf(ts, classDeclaration, checker), methodName, checker, seen)
}

function unwrapExpression(ts, expression) {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isAwaitExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function numericLiteral(ts, expression) {
  if (!expression) return undefined
  const value = unwrapExpression(ts, expression)
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (value.kind === ts.SyntaxKind.MinusToken) return undefined
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) {
    return -Number(value.operand.text)
  }
  return undefined
}

function isUndefinedType(ts, type) {
  return !!(type.flags & ts.TypeFlags.Undefined)
}

function isNullType(ts, type) {
  return !!(type.flags & ts.TypeFlags.Null)
}

function stableSchema(schema) {
  return JSON.stringify(schema)
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema | undefined {
  const filtered = schemas.filter(Boolean)
  if (!filtered.length) return undefined
  const unique = [...new Map(filtered.map((schema) => [stableSchema(schema), schema])).values()]
  if (unique.length === 1) return unique[0]
  return { oneOf: unique }
}

function createSchemaBuilder({ ts, checker, projectRoot }) {
  const components = {}
  const building = new Set()

  function sourceIsApplication(declaration) {
    if (!declaration) return false
    const relative = path.relative(projectRoot, declaration.getSourceFile().fileName).split(path.sep).join('/')
    return relative.startsWith('src/')
  }

  function componentNameFor(type) {
    const symbol = resolveSymbol(ts, type.aliasSymbol ?? type.getSymbol(), checker)
    const name = symbol?.getName()
    if (!name || name.startsWith('__') || ['Array', 'Promise', 'Response', 'Date'].includes(name)) return undefined
    const declaration = symbol?.declarations?.[0]
    if (!sourceIsApplication(declaration)) return undefined
    return name
  }

  function promisedType(type) {
    if (typeof checker.getPromisedTypeOfPromise === 'function') {
      return checker.getPromisedTypeOfPromise(type) ?? type
    }
    if (type.symbol?.name === 'Promise' && type.typeArguments?.length === 1) return type.typeArguments[0]
    return type
  }

  function schemaForType(type, options: { inline?: boolean } = {}): JsonSchema {
    if (!type) return {}
    const awaited = promisedType(type)
    if (awaited !== type) return schemaForType(awaited, options)

    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
    if (type.flags & ts.TypeFlags.Never) return {}
    if (type.flags & ts.TypeFlags.StringLike) {
      if (type.flags & ts.TypeFlags.StringLiteral) return { type: 'string', const: type.value }
      return { type: 'string' }
    }
    if (type.flags & ts.TypeFlags.NumberLike) {
      if (type.flags & ts.TypeFlags.NumberLiteral) return { type: 'number', const: type.value }
      return { type: 'number' }
    }
    if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' }
    if (type.flags & ts.TypeFlags.BigIntLike) return { type: 'integer' }
    if (isNullType(ts, type)) return { type: 'null' }

    if (type.isUnion?.()) {
      const withoutUndefined = type.types.filter((part) => !isUndefinedType(ts, part))
      const nullable = withoutUndefined.some((part) => isNullType(ts, part))
      const meaningful = withoutUndefined.filter((part) => !isNullType(ts, part))
      const variants = meaningful.map((part) => schemaForType(part, options))
      const schema = mergeSchemas(variants) ?? {}
      if (!nullable) return schema
      if (schema.oneOf) return { oneOf: [...schema.oneOf, { type: 'null' }] }
      return { anyOf: [schema, { type: 'null' }] }
    }

    if (type.isIntersection?.()) {
      return { allOf: type.types.map((part) => schemaForType(part, { ...options, inline: true })) }
    }

    if (checker.isArrayType?.(type)) {
      const elementType = checker.getTypeArguments(type)[0]
      return { type: 'array', items: schemaForType(elementType, options) }
    }

    if (checker.isTupleType?.(type)) {
      const elements = checker.getTypeArguments(type)
      return {
        type: 'array',
        prefixItems: elements.map((element) => schemaForType(element, options)),
        minItems: elements.length,
        maxItems: elements.length,
      }
    }

    const symbol = resolveSymbol(ts, type.aliasSymbol ?? type.getSymbol(), checker)
    const symbolName = symbol?.getName()
    if (symbolName === 'Date') return { type: 'string', format: 'date-time' }
    if (symbolName === 'Response') return {}

    const componentName = options.inline ? undefined : componentNameFor(type)
    if (componentName) {
      if (!components[componentName]) {
        components[componentName] = {}
        if (!building.has(componentName)) {
          building.add(componentName)
          components[componentName] = objectSchema(type, { ...options, inline: true })
          building.delete(componentName)
        }
      }
      return { $ref: `#/components/schemas/${componentName}` }
    }

    return objectSchema(type, options)
  }

  function objectSchema(type, options: { inline?: boolean } = {}): JsonSchema {
    const properties = {}
    const required: string[] = []

    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName()
      if (name.startsWith('__')) continue
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (!declaration) continue

      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
      if (propertyType.getCallSignatures().length > 0) continue

      properties[name] = schemaForType(propertyType, options)
      const optional = !!(property.flags & ts.SymbolFlags.Optional)
        || (propertyType.isUnion?.() && propertyType.types.some((part) => isUndefinedType(ts, part)))
      if (!optional) required.push(name)
    }

    const schema: JsonSchema = { type: 'object', properties }
    if (required.length) schema.required = required
    return schema
  }

  return { components, schemaForType }
}

function openApiPath(routePath) {
  return routePath.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}')
}

function responseSchema(errorResponseSchema) {
  if (errorResponseSchema) return errorResponseSchema

  return {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  }
}

function validationSchema(errorResponseSchema) {
  if (errorResponseSchema) return errorResponseSchema

  return {
    type: 'object',
    properties: {
      message: { type: 'string' },
      errors: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    required: ['message', 'errors'],
  }
}

function addResponse(responses, status, schema, description?: string) {
  const key = String(status)
  const existing = responses.get(key)
  if (!existing) {
    responses.set(key, {
      description: description ?? responseDescriptions.get(Number(status)) ?? 'Response',
      schemas: schema ? [schema] : [],
    })
    return
  }
  if (schema) existing.schemas.push(schema)
}

function finalizeResponses(responses) {
  const result = {}
  for (const [status, response] of [...responses.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    const schema = mergeSchemas(response.schemas)
    result[status] = {
      description: response.description,
      ...(schema && Object.keys(schema).length
        ? { content: { 'application/json': { schema } } }
        : {}),
    }
  }
  return result
}

function collectReturnExpressions(ts, method) {
  const returns: ts.Expression[] = []
  const root = method.body
  if (!root) return returns

  function visit(node) {
    if (node !== root && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node)) {
      returns.push(node.expression)
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(root)
  return returns
}

function responseFromExpression({ ts, checker, schemaBuilder }, expression) {
  if (!expression) return { status: 204, schema: undefined }
  const value = unwrapExpression(ts, expression)

  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    const methodName = value.expression.name.text
    if (methodName === 'noContent') return { status: 204, schema: undefined }
    if (methodName === 'json') {
      const body = value.arguments[0]
      const status = numericLiteral(ts, value.arguments[1]) ?? 200
      const schema = body ? schemaBuilder.schemaForType(checker.getTypeAtLocation(body)) : undefined
      return { status, schema }
    }
    if (methodName === 'body') {
      const status = numericLiteral(ts, value.arguments[1]) ?? 200
      return { status, schema: undefined }
    }
  }

  if (ts.isNewExpression(value) && value.expression.getText() === 'Response') {
    const options = value.arguments?.[1]
    let status = 200
    if (options && ts.isObjectLiteralExpression(options)) {
      const statusProperty = options.properties.find((property) =>
        ts.isPropertyAssignment(property)
          && ((ts.isIdentifier(property.name) && property.name.text === 'status')
            || (ts.isStringLiteralLike(property.name) && property.name.text === 'status')),
      )
      if (statusProperty && ts.isPropertyAssignment(statusProperty)) {
        status = numericLiteral(ts, statusProperty.initializer) ?? 200
      }
    }
    return { status, schema: undefined }
  }

  const type = checker.getTypeAtLocation(value)
  return { status: 200, schema: schemaBuilder.schemaForType(type) }
}

function inferredMethodResponses(context, method) {
  const returns = collectReturnExpressions(context.ts, method)
  if (returns.length) return returns.map((expression) => responseFromExpression(context, expression))

  const signature = context.checker.getSignatureFromDeclaration(method)
  const returnType = signature ? context.checker.getReturnTypeOfSignature(signature) : undefined
  if (!returnType) return [{ status: 204, schema: undefined }]

  const rendered = context.checker.typeToString(returnType)
  if (returnType.flags & context.ts.TypeFlags.Never || rendered === 'never' || rendered === 'Promise<never>') {
    return []
  }
  if (rendered === 'void' || rendered === 'undefined' || rendered === 'Promise<void>') {
    return [{ status: 204, schema: undefined }]
  }

  const schema = context.schemaBuilder.schemaForType(returnType)
  return [{ status: 200, schema }]
}

function constructorPropertyProviders(ts, classDeclaration, providerByDeclaration) {
  const provider = providerByDeclaration.get(classDeclaration)
  const constructor = classDeclaration.members.find(ts.isConstructorDeclaration)
  if (!provider || !constructor) return new Map()

  const result = new Map()
  constructor.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return
    const dependency = provider.dependencies[index]
    if (dependency?.provider?.declaration) result.set(parameter.name.text, dependency.provider.declaration)
  })
  return result
}

function exceptionAnalyzer({ ts, checker, providers, providerBindings, fail, errorResponseSchema }) {
  const providerByDeclaration = new Map<ts.ClassDeclaration, Provider>(providers.map((provider) => [provider.declaration, provider]))
  const providerByContract = new Map<ts.ClassDeclaration, Provider>(providerBindings.map((binding) => [binding.contract.declaration, binding.provider]))
  const memo = new Map()
  const visiting = new Set()

  function implementationFor(classDeclaration) {
    return providerByContract.get(classDeclaration)?.declaration
      ?? providerByDeclaration.get(classDeclaration)?.declaration
      ?? classDeclaration
  }

  function resolveCallTarget(call, currentClass) {
    if (ts.isPropertyAccessExpression(call.expression)) {
      const methodName = call.expression.name.text
      const receiver = call.expression.expression

      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        const own = findMethod(ts, currentClass, methodName, checker)
        if (own) return own
      }

      if (ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const dependencies = constructorPropertyProviders(ts, currentClass, providerByDeclaration)
        const dependencyClass = dependencies.get(receiver.name.text)
        const method = findMethod(ts, dependencyClass, methodName, checker)
        if (method) return method
      }

      const receiverType = checker.getTypeAtLocation(receiver)
      const receiverClass = classDeclarationForType(ts, receiverType, checker)
      const method = findMethod(ts, implementationFor(receiverClass), methodName, checker)
      if (method) return method
    }

    const signature = checker.getResolvedSignature(call)
    const declaration = signature?.declaration
    if ((ts.isMethodDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) && declaration.body) {
      return declaration
    }
    return undefined
  }

  function httpExceptionStatus(classDeclaration, newExpression) {
    const directName = classDeclaration?.name?.text
    if (builtinExceptionStatuses.has(directName)) return builtinExceptionStatuses.get(directName)
    if (directName === 'HttpException') return numericLiteral(ts, newExpression.arguments?.[0])

    let current = classDeclaration
    const seen = new Set()
    while (current && !seen.has(current)) {
      seen.add(current)
      const name = current.name?.text
      if (builtinExceptionStatuses.has(name)) return builtinExceptionStatuses.get(name)

      const constructor = current.members.find(ts.isConstructorDeclaration)
      if (constructor?.body) {
        let superCall
        constructor.body.forEachChild((statement) => {
          if (
            ts.isExpressionStatement(statement)
            && ts.isCallExpression(statement.expression)
            && statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword
          ) superCall = statement.expression
        })
        const status = numericLiteral(ts, superCall?.arguments?.[0])
        if (status !== undefined) return status
      }

      const base = baseClassOf(ts, current, checker)
      if (base?.name?.text === 'HttpException') return undefined
      current = base
    }
    return undefined
  }

  function isHttpExceptionClass(classDeclaration) {
    let current = classDeclaration
    const seen = new Set()
    while (current && !seen.has(current)) {
      seen.add(current)
      if (current.name?.text === 'HttpException') return true
      current = baseClassOf(ts, current, checker)
    }
    return false
  }

  function exceptionFromThrow(node) {
    const expression = unwrapExpression(ts, node.expression)
    if (!ts.isNewExpression(expression)) return undefined
    const classDeclaration = classDeclarationForExpression(ts, expression.expression, checker)
    if (!classDeclaration || !isHttpExceptionClass(classDeclaration)) return undefined

    const status = httpExceptionStatus(classDeclaration, expression)
    if (status === undefined) {
      fail(
        `Cannot infer the HTTP status for ${classDeclaration.name?.text ?? 'HttpException'}. Reachable HttpException classes must use a statically inferable status.`,
        expression,
      )
    }

    return {
      status,
      schema: responseSchema(errorResponseSchema),
      name: classDeclaration.name?.text ?? 'HttpException',
    }
  }

  function analyze(declaration) {
    if (!declaration?.body) return []
    if (memo.has(declaration)) return memo.get(declaration)
    if (visiting.has(declaration)) return []
    visiting.add(declaration)

    const currentClass = ts.isMethodDeclaration(declaration) && ts.isClassDeclaration(declaration.parent)
      ? declaration.parent
      : undefined
    const effects: Array<{ status?: number; schema: JsonSchema; name: string }> = []
    const root = declaration.body

    function visit(node, handled = false) {
      if (node !== root && ts.isFunctionLike(node)) return

      if (ts.isTryStatement(node)) {
        visit(node.tryBlock, handled || !!node.catchClause)
        if (node.catchClause) visit(node.catchClause.block, handled)
        if (node.finallyBlock) visit(node.finallyBlock, handled)
        return
      }

      if (ts.isThrowStatement(node) && !handled) {
        const effect = exceptionFromThrow(node)
        if (effect) effects.push(effect)
      }

      if (ts.isCallExpression(node) && !handled && currentClass) {
        const target = resolveCallTarget(node, currentClass)
        if (target) effects.push(...analyze(target))
      }

      ts.forEachChild(node, (child) => visit(child, handled))
    }

    visit(root)
    visiting.delete(declaration)
    const unique = [...new Map(effects.map((effect) => [`${effect.status}:${effect.name}`, effect])).values()]
    memo.set(declaration, unique)
    return unique
  }

  return { analyze }
}

function formRequestOutputType(checker, parameter) {
  const requestType = checker.getTypeAtLocation(parameter)
  const validated = requestType.getProperty?.('validated')
  if (!validated) return undefined

  const declaration = validated.valueDeclaration ?? validated.declarations?.[0] ?? parameter
  const methodType = checker.getTypeOfSymbolAtLocation(validated, declaration)
  const signature = methodType.getCallSignatures()[0]
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined
}

function queryParametersFromSchema(schema, requiredNames: string[] = []) {
  if (!schema || schema.type !== 'object' || !schema.properties) return []
  const required = new Set(schema.required ?? requiredNames)
  return Object.entries(schema.properties).map(([name, propertySchema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: propertySchema,
  }))
}

function customDecoratorResolver(ts, decorator) {
  const factoryArgs = decorator?.initializer?.arguments
  if (!factoryArgs?.length) return undefined
  const resolver = ts.isArrayLiteralExpression(factoryArgs[0])
    ? factoryArgs[1]
    : factoryArgs[0]
  return resolver && ts.isFunctionLike(resolver) ? resolver : undefined
}

export function createOpenApiDocument({
  ts,
  checker,
  routes,
  providers,
  providerBindings,
  projectRoot,
  title = 'Honovel',
  version = '1.0.0',
  errorResponseType,
  fail,
}) {
  const schemaBuilder = createSchemaBuilder({ ts, checker, projectRoot })
  const errorResponseSchema = errorResponseType
    ? schemaBuilder.schemaForType(errorResponseType)
    : undefined
  const exceptions = exceptionAnalyzer({
    ts,
    checker,
    providers,
    providerBindings,
    fail,
    errorResponseSchema,
  })
  const paths = {}
  const usedOperationIds = new Set()
  const securitySchemes = {}

  for (const route of routes) {
    const parameters: Array<{ name: string; in: string; required: boolean; schema: unknown }> = []
    let requestBody

    for (const binding of route.bindings) {
      if (binding.kind === 'honoRequest' || binding.kind === 'custom') continue
      if (binding.kind === 'primitive') {
        parameters.push({
          name: binding.key,
          in: binding.source === 'param' ? 'path' : 'query',
          required: binding.source === 'param' ? true : binding.required,
          schema: { type: binding.primitive === 'number' ? 'number' : binding.primitive },
        })
        continue
      }

      const parameterType = checker.getTypeAtLocation(binding.parameter)
      let schema
      if (binding.kind === 'formRequest') {
        const outputType = formRequestOutputType(checker, binding.parameter) ?? parameterType
        const componentName = binding.requestClass.className
        schemaBuilder.components[componentName] ??= schemaBuilder.schemaForType(outputType, { inline: true })
        schema = { $ref: `#/components/schemas/${componentName}` }
      } else {
        schema = schemaBuilder.schemaForType(parameterType)
      }

      if (binding.source === 'body') {
        requestBody = {
          required: true,
          content: { 'application/json': { schema } },
        }
      } else if (binding.source === 'query') {
        if (binding.key) {
          parameters.push({ name: binding.key, in: 'query', required: true, schema })
        } else {
          parameters.push(...queryParametersFromSchema(schema))
        }
      }
    }

    const responses = new Map()
    const responseContext = { ts, checker, schemaBuilder }
    for (const response of inferredMethodResponses(responseContext, route.handlerDeclaration)) {
      addResponse(responses, response.status, response.schema)
    }

    const exceptionSources = [
      route.handlerDeclaration,
      ...route.middleware
        .filter((middleware) => middleware.kind !== 'auth')
        .map((middleware) => findMethod(ts, middleware.declaration, 'handle', checker))
        .filter(Boolean),
      ...(route.decorators ?? [])
        .map((decorator) => customDecoratorResolver(ts, decorator))
        .filter(Boolean),
    ]
    for (const source of exceptionSources) {
      for (const effect of exceptions.analyze(source)) {
        addResponse(responses, effect.status, effect.schema, effect.name)
      }
    }

    if (route.middleware.some((middleware) => middleware.kind === 'auth')) {
      addResponse(responses, 401, responseSchema(errorResponseSchema))
    }
    if (route.bindings.some((binding) => binding.kind === 'primitive' || binding.kind === 'formRequest')) {
      addResponse(responses, 422, validationSchema(errorResponseSchema))
    }
    addResponse(responses, 500, responseSchema(errorResponseSchema))

    const baseOperationId = `${route.controllerName}_${route.handlerName}`
    let operationId = baseOperationId
    let suffix = 2
    while (usedOperationIds.has(operationId)) {
      operationId = `${baseOperationId}_${suffix++}`
    }
    usedOperationIds.add(operationId)

    const security = {}
    for (const authKind of new Set<string>(
      route.middleware
        .filter((middleware) => middleware.kind === 'auth')
        .map((middleware) => middleware.authKind),
    )) {
      const definition = authSecuritySchemes.get(authKind)
      if (!definition) continue
      const [name, scheme] = definition
      securitySchemes[name] ??= scheme
      security[name] = []
    }

    const operation = {
      operationId,
      tags: [route.controllerName.replace(/Controller$/, '') || route.controllerName],
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      ...(Object.keys(security).length ? { security: [security] } : {}),
      responses: finalizeResponses(responses),
    }

    const pathKey = openApiPath(route.path)
    paths[pathKey] ??= {}
    paths[pathKey][route.method] = operation
  }

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title,
      version,
    },
    paths,
  }

  const components: NonNullable<OpenApiDocument['components']> = {}
  if (Object.keys(schemaBuilder.components).length) components.schemas = schemaBuilder.components
  if (Object.keys(securitySchemes).length) components.securitySchemes = securitySchemes
  if (Object.keys(components).length) document.components = components

  return document
}
