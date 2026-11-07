import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-decorators-'))

try {
  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(projectRoot, 'node_modules'), 'junction')
  fs.mkdirSync(path.join(projectRoot, 'src', 'controllers'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"module"}\n')
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      experimentalDecorators: true,
      rootDir: '.',
      outDir: '.honovel',
    },
    include: ['index.ts', 'src/**/*.ts', 'core/**/*.ts'],
  }))
  fs.writeFileSync(path.join(projectRoot, 'index.ts'), `
import { createHonoApp } from './core'
export default createHonoApp()
`)
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/VersionedController.ts'), `
import { BaseMiddleware, BaseUrl, Controller, Get, Middleware, type MiddlewareNext } from '../../core'
import type { Context } from 'hono'

export class FirstMiddleware extends BaseMiddleware {
  async handle(_context: Context, next: MiddlewareNext): Promise<Response> {
    const response = await next()
    response.headers.append('x-order', 'first')
    return response
  }
}

export class SecondMiddleware extends BaseMiddleware {
  async handle(_context: Context, next: MiddlewareNext): Promise<Response> {
    const response = await next()
    response.headers.append('x-order', 'second')
    return response
  }
}

export class ThirdMiddleware extends BaseMiddleware {
  async handle(_context: Context, next: MiddlewareNext): Promise<Response> {
    const response = await next()
    response.headers.append('x-order', 'third')
    return response
  }
}

@BaseUrl(['/v1/todos', '/v2/todos'])
@Middleware([FirstMiddleware, SecondMiddleware])
export class VersionedController extends Controller {
  @Get('/')
  @Middleware(ThirdMiddleware)
  index() { return { ok: true } }
}

@BaseUrl('/api')
export abstract class ApiController extends Controller {}

@BaseUrl('/health')
export class InheritedBaseUrlController extends ApiController {
  @Get('/')
  index() { return { inherited: true } }
}

@BaseUrl('/single')
@Middleware(FirstMiddleware)
export class SingleController extends Controller {
  @Get('/')
  index() { return { single: true } }
}
`)

  const compile = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs', '--mode', 'development'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`)

  const document = JSON.parse(fs.readFileSync(path.join(projectRoot, '.honovel/openapi.json'), 'utf8'))
  assert.ok(document.paths['/v1/todos']?.get)
  assert.ok(document.paths['/v2/todos']?.get)
  assert.ok(document.paths['/single']?.get)
  assert.ok(document.paths['/api/health']?.get)
  assert.notEqual(
    document.paths['/v1/todos'].get.operationId,
    document.paths['/v2/todos'].get.operationId,
  )

  const bundlePath = path.join(projectRoot, '.honovel/test-bundle.mjs')
  await build({
    entryPoints: [path.join(projectRoot, '.honovel/app.js')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  })
  const { registerHonovel } = await import(pathToFileURL(bundlePath).href)
  const app = registerHonovel(new Hono())

  for (const route of ['/v1/todos', '/v2/todos']) {
    const response = await app.request(route)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(response.headers.get('x-order'), 'third, second, first')
  }

  const inheritedResponse = await app.request('/api/health')
  assert.equal(inheritedResponse.status, 200)
  assert.deepEqual(await inheritedResponse.json(), { inherited: true })

  const singleResponse = await app.request('/single')
  assert.equal(singleResponse.status, 200)
  assert.deepEqual(await singleResponse.json(), { single: true })
  assert.equal(singleResponse.headers.get('x-order'), 'first')

  console.log('[Honovel] Decorator arrays and single values check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
