import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-query-requests-'))
try {
  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(projectRoot, 'node_modules'), 'junction')
  fs.mkdirSync(path.join(projectRoot, 'src/controllers'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"module"}\n')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, experimentalDecorators: true,
      rootDir: '.', outDir: '.honovel',
    },
    include: ['index.ts', 'src/**/*.ts', 'core/**/*.ts'],
  }))
  fs.writeFileSync(path.join(projectRoot, 'index.ts'), `
import { createHonoApp } from './core'
export default createHonoApp()
`)
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/SearchController.ts'), `
import { z } from 'zod'
import { BaseUrl, Controller, FormRequest, Get, Post, Query } from '../../core'

export class SearchRequest extends FormRequest(z.object({
  name: z.string().min(1),
  limit: z.int().min(1).optional(),
})) {}

export class PageRequest extends FormRequest(z.int().min(1)) {}
export class TransformedRequest extends FormRequest(z.string().transform((value) => Number(value))) {}
export class TransformedObjectRequest extends FormRequest(z.string().transform((value) => ({ value }))) {}
export class TagsRequest extends FormRequest(z.array(z.string())) {}
export class ObjectArrayRequest extends FormRequest(z.array(z.object({ name: z.string() }))) {}
export class InheritedSearchRequest extends SearchRequest {}
export class CustomRequest extends FormRequest(z.object({
  name: z.string().min(1),
  age: z.int().min(0),
  active: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
})) {}
export class MixedRequest extends FormRequest(z.union([z.object({ name: z.string() }), z.string()])) {}
export class DefaultsRequest extends FormRequest(z.object({ age: z.int().default(30), active: z.boolean().default(false) })) {}
export class StandardRequest extends FormRequest({
  '~standard': {
    types: undefined as unknown as { input: { age: number }; output: { age: number } },
    validate(input: unknown) {
      if (typeof input !== 'object' || input === null || !('age' in input) || typeof input.age !== 'number') {
        return { issues: [{ path: ['age'], message: 'Expected number' }] }
      }
      return { value: { age: input.age } }
    },
  },
}) {}

type OptionalSearch = SearchRequest | undefined

@BaseUrl('/search')
export class SearchController extends Controller {
  @Get('/required')
  required(@Query() data: SearchRequest) {
    return data.validated()
  }

  @Get('/optional')
  optional(@Query() data?: SearchRequest) {
    return { missing: data === undefined, name: data?.name, data: data?.validated() }
  }

  @Get('/union')
  union(@Query() data: OptionalSearch) {
    return { missing: data === undefined, data: data?.validated() }
  }

  @Get('/prefixed')
  prefixed(@Query('custom') data: CustomRequest) {
    return { name: data.name, data: data.validated() }
  }

  @Get('/optional-prefixed')
  optionalPrefixed(@Query('custom') data?: CustomRequest) {
    return { missing: data === undefined, data: data?.validated() }
  }

  @Get('/inherited-prefixed')
  inheritedPrefixed(@Query('custom-name') data?: InheritedSearchRequest) {
    return { missing: data === undefined, data: data?.validated() }
  }

  @Get('/groups')
  groups(@Query('first') first: CustomRequest, @Query('second') second?: CustomRequest) {
    return { first: first.validated(), second: second?.validated() }
  }

  @Get('/page')
  page(@Query('data') data?: PageRequest) {
    return { missing: data === undefined, page: data?.validated() }
  }

  @Get('/required-page')
  requiredPage(@Query('data') data: PageRequest) {
    return { page: data.validated() }
  }

  @Get('/transformed')
  transformed(@Query('data') data: TransformedRequest) {
    return { value: data.validated() }
  }

  @Get('/transformed-object')
  transformedObject(@Query('data') data: TransformedObjectRequest) {
    return data.validated()
  }

  @Get('/defaults')
  defaults(@Query() data: DefaultsRequest) {
    return data.validated()
  }

  @Get('/standard')
  standard(@Query('my') data: StandardRequest) {
    return data.validated()
  }

  @Post('/body')
  body(data: CustomRequest) {
    return data.validated()
  }

  @Post('/transformed-body')
  transformedBody(data: TransformedObjectRequest) {
    return data.validated()
  }

  @Get('/primitive')
  primitive(@Query() age: number, @Query() active: boolean, @Query() name?: string) {
    return { age, active, name }
  }

  @Get('/param/:age/:active')
  param(age: number, active: boolean) {
    return { age, active }
  }

  @Get('/tags')
  tags(@Query('tag') data: TagsRequest) {
    return { tags: data.validated() }
  }
}
`)
  const compiled = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot, encoding: 'utf8',
  })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  assert.match(compiled.stdout + compiled.stderr, /95021/)
  assert.match(compiled.stdout + compiled.stderr, /field "tags" has unsupported input type/)
  const document = JSON.parse(fs.readFileSync(path.join(projectRoot, '.honovel/openapi.json'), 'utf8'))
  assert.deepEqual(document.paths['/search/required'].get.parameters, [
    { name: 'name', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
  ])
  for (const route of ['optional', 'union']) {
    assert.deepEqual(document.paths[`/search/${route}`].get.parameters, [
      { name: 'name', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
    ])
  }
  assert.deepEqual(document.paths['/search/page'].get.parameters, [{
    name: 'data', in: 'query', required: false,
    schema: { $ref: '#/components/schemas/PageRequest' },
  }])
  assert.equal(document.paths['/search/required-page'].get.parameters[0].required, true)
  assert.deepEqual(document.components.schemas.PageRequest, { type: 'number' })
  assert.equal(document.components.schemas.SearchRequest.properties.name.type, 'string')
  assert.equal(document.paths['/search/optional'].get.requestBody, undefined)
  assert.deepEqual(document.components.schemas.TransformedRequest, { type: 'string' })
  assert.deepEqual(document.components.schemas.TransformedObjectRequest, { type: 'string' })
  assert.equal(document.paths['/search/transformed-object'].get.parameters[0].name, 'data')
  assert.deepEqual(document.paths['/search/transformed-body'].post.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/TransformedObjectRequest' })
  const prefixedParameters = [
    { name: 'custom.name', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'custom.age', in: 'query', required: true, schema: { type: 'number' } },
    { name: 'custom.active', in: 'query', required: false, schema: { type: 'boolean' } },
    { name: 'custom.tags', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } },
  ]
  assert.deepEqual(document.paths['/search/prefixed'].get.parameters, prefixedParameters)
  assert.deepEqual(document.paths['/search/optional-prefixed'].get.parameters,
    prefixedParameters.map((parameter) => ({ ...parameter, required: false })))
  assert.deepEqual(document.paths['/search/inherited-prefixed'].get.parameters.map((parameter) => parameter.name),
    ['custom-name.name', 'custom-name.limit'])
  assert.deepEqual(document.paths['/search/groups'].get.parameters.map((parameter) => parameter.name),
    ['first.name', 'first.age', 'first.active', 'first.tags', 'second.name', 'second.age', 'second.active', 'second.tags'])

  const bundlePath = path.join(projectRoot, '.honovel/query-test.mjs')
  await build({
    entryPoints: [path.join(projectRoot, '.honovel/app.js')], outfile: bundlePath,
    bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
  })
  const { registerHonovel } = await import(pathToFileURL(bundlePath).href)
  const app = new Hono()
  registerHonovel(app)
  async function expectJson(url: string, status: number, expected?: unknown) {
    const response = await app.request(`/search/${url}`)
    assert.equal(response.status, status, url)
    if (expected !== undefined) assert.deepEqual(await response.json(), expected, url)
  }
  await expectJson('required?name=Flo&limit=3', 200, { name: 'Flo', limit: 3 })
  await expectJson('required', 422)
  for (const route of ['optional', 'union']) {
    await expectJson(route, 200, { missing: true })
    await expectJson(`${route}?limit=3`, 422)
    await expectJson(`${route}?name=`, 422)
    await expectJson(`${route}?name=Flo&limit=bad`, 422)
  }
  await expectJson('optional?name=Flo', 200, { missing: false, name: 'Flo', data: { name: 'Flo' } })
  await expectJson('union?name=Flo&limit=3', 200, { missing: false, data: { name: 'Flo', limit: 3 } })
  await expectJson('page', 200, { missing: true })
  await expectJson('page?unrelated=value', 200, { missing: true })
  await expectJson('page?data=3', 200, { missing: false, page: 3 })
  await expectJson('page?data=bad', 422)
  await expectJson('required-page', 422)
  await expectJson('required-page?data=3', 200, { page: 3 })
  await expectJson('tags?tag=a&tag=b', 200, { tags: ['a', 'b'] })
  await expectJson('prefixed?custom.name=Flo&custom.age=30', 200, {
    name: 'Flo', data: { name: 'Flo', age: 30 },
  })
  await expectJson('prefixed?custom.name=Flo&custom.age=30&custom.tags=a&custom.tags=b', 200, {
    name: 'Flo', data: { name: 'Flo', age: 30, tags: ['a', 'b'] },
  })
  await expectJson('prefixed?name=Flo&age=30', 422)
  await expectJson('prefixed?custom.name=Flo&custom.age=bad', 422)
  await expectJson('prefixed?custom.name=&custom.age=30', 422)
  await expectJson('prefixed?custom.name=Flo', 422)
  await expectJson('optional-prefixed', 200, { missing: true })
  await expectJson('optional-prefixed?name=Flo&customized.name=Other', 200, { missing: true })
  await expectJson('optional-prefixed?custom.other=Flo', 422)
  await expectJson('optional-prefixed?custom.name=Flo', 422)
  await expectJson('optional-prefixed?custom.name=Flo&custom.age=30&name=Wrong', 200, {
    missing: false, data: { name: 'Flo', age: 30 },
  })
  await expectJson('inherited-prefixed?custom-name.name=Flo', 200, { missing: false, data: { name: 'Flo' } })
  await expectJson('groups?first.name=Flo&first.age=30', 200, { first: { name: 'Flo', age: 30 } })
  await expectJson('groups?first.name=Flo&first.age=30&second.name=Sam&second.age=40', 200, {
    first: { name: 'Flo', age: 30 }, second: { name: 'Sam', age: 40 },
  })
  await expectJson('page?data.value=3', 200, { missing: true })
  await expectJson('transformed?data=42', 200, { value: 42 })
  await expectJson('transformed-object?data=Hello', 200, { value: 'Hello' })
  await expectJson('defaults', 200, { age: 30, active: false })
  await expectJson('defaults?age=40&active=true', 200, { age: 40, active: true })
  await expectJson('defaults?age=', 422)
  await expectJson('standard?my.age=42', 200, { age: 42 })
  await expectJson('standard?my.age=0x10', 422)
  for (const [age, status] of [[30, 200], ['30', 422]] as const) {
    const response = await app.request('/search/body', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Flo', age, active: false }),
    })
    assert.equal(response.status, status)
  }
  const transformedBody = await app.request('/search/transformed-body', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify('Hello'),
  })
  assert.equal(transformedBody.status, 200)
  assert.deepEqual(await transformedBody.json(), { value: 'Hello' })
  for (const [value, expected] of [['true', true], ['1', true], ['false', false], ['0', false]] as const) {
    await expectJson(`optional-prefixed?custom.name=Flo&custom.age=30&custom.active=${value}`, 200, {
      missing: false, data: { name: 'Flo', age: 30, active: expected },
    })
    await expectJson(`primitive?age=30&active=${value}`, 200, { age: 30, active: expected })
    await expectJson(`param/30/${value}`, 200, { age: 30, active: expected })
  }
  for (const value of ['', ' ', '0x10', '0b10', 'Infinity', '-Infinity', 'NaN', '1e999', '01', '+1', '1x']) {
    const encoded = encodeURIComponent(value)
    await expectJson(`optional-prefixed?custom.name=Flo&custom.age=${encoded}`, 422)
    await expectJson(`page?data=${encoded}`, 422)
    await expectJson(`primitive?age=${encoded}&active=true`, 422)
  }
  for (const value of ['', ' ', 'yes', 'no', 'TRUE', 'False', '2']) {
    const encoded = encodeURIComponent(value)
    await expectJson(`optional-prefixed?custom.name=Flo&custom.age=30&custom.active=${encoded}`, 422)
    await expectJson(`primitive?age=30&active=${encoded}`, 422)
  }
  await expectJson('prefixed?custom.name=Flo&custom.age=1.5', 422)
  await expectJson('prefixed?custom.name=Flo&custom.age=-1', 422)
  await expectJson('prefixed?custom.name=Flo&custom.age=9007199254740993', 422)
  await expectJson('prefixed?custom.name=Flo&custom.age=30&custom.age=40', 422)
  await expectJson('prefixed?custom.name=Flo&custom.name=Sam&custom.age=30', 422)
  await expectJson('primitive?age=30&age=40&active=true', 422)
  await expectJson('primitive?age=30&active=true&active=false', 422)
  await expectJson('primitive?age=30&active=true&name=a&name=b', 422)
  await expectJson('primitive?age=1.5e2&active=false&name=001', 200, { age: 150, active: false, name: '001' })
  const controllerPath = path.join(projectRoot, 'src/controllers/SearchController.ts')
  const validSource = fs.readFileSync(controllerPath, 'utf8')
  for (const parameterType of ['ObjectArrayRequest', 'MixedRequest']) {
    fs.writeFileSync(controllerPath, validSource.replace(
      'required(@Query() data: SearchRequest)',
      `required(@Query('custom-name') data: ${parameterType})`,
    ).replace('return data.validated()', 'return data?.validated()'))
    const rejected = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
      cwd: projectRoot, encoding: 'utf8',
    })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stdout + rejected.stderr, /Arrays of objects and mixed object unions are not supported/)
  }
  console.log('[Honovel] Optional query FormRequests, runtime validation, and OpenAPI check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
