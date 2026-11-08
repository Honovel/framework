import type ts from 'typescript'

export interface ClassReference {
  className: string
  sourceFile: ts.SourceFile
  declaration: ts.ClassDeclaration
}

export interface Dependency extends ClassReference {
  abstract?: boolean
  builtin?: string
  node: ts.Node
  provider?: Provider
}

export interface Provider extends ClassReference {
  scope: string
  injectable: boolean
  database?: boolean
  provides?: ClassReference
  dependencies: Dependency[]
}

export type CompiledValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'binding'; name: string }
  | { kind: 'array'; items: CompiledValue[] }
  | { kind: 'object'; entries: [string, CompiledValue][] }

export interface DecoratorDefinition {
  declaration: ts.VariableDeclaration
  initializer: ts.CallExpression
  sourceFile: ts.SourceFile
  exportName: string
}

export interface CompiledDecorator extends DecoratorDefinition {
  args: CompiledValue[]
}

export type Middleware =
  | (ClassReference & { kind: 'class' })
  | { kind: 'auth'; authKind: string; decoratorName: string; options: CompiledValue }

export interface ParameterBinding {
  kind: string
  source?: string
  key?: string
  primitive?: string
  required?: boolean
  parameter: ts.ParameterDeclaration
  requestClass?: ClassReference
  decoratorName?: string
  decoratorSourceFile?: ts.SourceFile
  args?: CompiledValue[]
}

export interface Route {
  method: string
  path: string
  controllerName: string
  controllerSourceFile: ts.SourceFile
  controllerDeclaration: ts.ClassDeclaration
  handlerName: string
  handlerDeclaration: ts.MethodDeclaration
  middleware: Middleware[]
  decorators: CompiledDecorator[]
  bindings: ParameterBinding[]
}

export interface CompiledListener {
  listenerClassName: string
  listenerSourceFile: ts.SourceFile
  listenerDeclaration: ts.ClassDeclaration
  type: string
  queued: boolean
  payloadDeclaration: ts.ClassDeclaration
  payloadClassName: string
  payloadSourceFile: ts.SourceFile
}

export interface CronJob extends ClassReference {
  cron: string
}
