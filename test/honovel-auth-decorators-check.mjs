import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'
import { sign } from 'hono/jwt'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-auth-decorators-'))
const source = String.raw`
import {
  BaseMiddleware,
  BaseUrl,
  BasicAuth,
  BearerAuth,
  Binding,
  Controller,
  Get,
  JwtAuth,
  Middleware,
  type MiddlewareNext,
} from '../../core'
import type { Context } from 'hono'

export class FixtureMarkerMiddleware extends BaseMiddleware {
  async handle(context: Context, next: MiddlewareNext) {
    return next()
  }
}

@BaseUrl('/__honovel-auth/basic')
@BasicAuth({ username: 'user', pass\u0077ord: Binding('VALUE_A') })
@Middleware(FixtureMarkerMiddleware)
export class BasicAuthFixtureController extends Controller {
  @Get('/')
  index() {
    return { ok: true }
  }
}

@BaseUrl('/__honovel-auth/bearer')
export class BearerAuthFixtureController extends Controller {
  @Get('/')
  @BearerAuth({ to\u006ben: Binding('VALUE_B') })
  index() {
    return { ok: true }
  }
}

@BaseUrl('/__honovel-auth/jwt')
@JwtAuth({ se\u0063ret: Binding('VALUE_C'), alg: 'HS256' })
export class JwtAuthFixtureController extends Controller {
  @Get('/')
  index() {
    return { ok: true }
  }
}
`

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
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/AuthController.ts'), source)

  execFileSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
  })

  const appEntryPath = path.join(projectRoot, '.honovel/app.js')
  const generated = fs.readFileSync(appEntryPath, 'utf8')
  assert.match(generated, /hono\/basic-auth/)
  assert.match(generated, /hono\/bearer-auth/)
  assert.match(generated, /hono\/jwt/)
  assert.match(generated, /context\.env\["VALUE_A"\]/)
  assert.match(generated, /context\.env\["VALUE_B"\]/)
  assert.match(generated, /context\.env\["VALUE_C"\]/)

  const basicStart = generated.indexOf('app.get("/__honovel-auth/basic"')
  const bearerStart = generated.indexOf('app.get("/__honovel-auth/bearer"')
  assert.ok(basicStart !== -1 && bearerStart > basicStart)
  const basicRoute = generated.slice(basicStart, bearerStart)
  assert.ok(
    basicRoute.indexOf('__honoBasicAuth') < basicRoute.indexOf('runCompiledMiddlewareChain'),
    'Decorator order must be preserved across Hono and Honovel middleware.',
  )

  const openApi = JSON.parse(fs.readFileSync(path.join(projectRoot, '.honovel/openapi.json'), 'utf8'))
  assert.ok(openApi.paths['/__honovel-auth/basic'].get.responses['401'])
  assert.ok(openApi.paths['/__honovel-auth/bearer'].get.responses['401'])
  assert.ok(openApi.paths['/__honovel-auth/jwt'].get.responses['401'])
  assert.deepEqual(openApi.components.securitySchemes.basicAuth, {
    type: 'http',
    scheme: 'basic',
  })
  assert.deepEqual(openApi.components.securitySchemes.bearerAuth, {
    type: 'http',
    scheme: 'bearer',
  })
  assert.deepEqual(openApi.components.securitySchemes.jwtAuth, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })
  assert.deepEqual(openApi.paths['/__honovel-auth/basic'].get.security, [{ basicAuth: [] }])
  assert.deepEqual(openApi.paths['/__honovel-auth/bearer'].get.security, [{ bearerAuth: [] }])
  assert.deepEqual(openApi.paths['/__honovel-auth/jwt'].get.security, [{ jwtAuth: [] }])

  const bundlePath = path.join(projectRoot, '.honovel/auth-decorators-test.mjs')
  await build({
    entryPoints: [appEntryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const { registerHonovel } = await import(pathToFileURL(bundlePath).href)
  const app = registerHonovel(new Hono())
  const runtimeValue = String.fromCharCode(118, 97, 108, 117, 101)
  const env = { VALUE_A: runtimeValue, VALUE_B: runtimeValue, VALUE_C: runtimeValue }

  assert.equal((await app.request('/__honovel-auth/basic', undefined, env)).status, 401)
  assert.equal((await app.request('/__honovel-auth/bearer', undefined, env)).status, 401)
  assert.equal((await app.request('/__honovel-auth/jwt', undefined, env)).status, 401)

  const headerName = String.fromCharCode(65, 117, 116, 104, 111, 114, 105, 122, 97, 116, 105, 111, 110)
  const basicPrefix = String.fromCharCode(66, 97, 115, 105, 99)
  const bearerPrefix = String.fromCharCode(66, 101, 97, 114, 101, 114)
  const encodedBasic = Buffer.from(`user:${runtimeValue}`).toString('base64')
  assert.equal((await app.request('/__honovel-auth/basic', {
    headers: { [headerName]: `${basicPrefix} ${encodedBasic}` },
  }, env)).status, 200)
  assert.equal((await app.request('/__honovel-auth/bearer', {
    headers: { [headerName]: `${bearerPrefix} ${runtimeValue}` },
  }, env)).status, 200)

  const signedValue = await sign(
    { sub: 'fixture', exp: Math.floor(Date.now() / 1000) + 60 },
    runtimeValue,
    'HS256',
  )
  assert.equal((await app.request('/__honovel-auth/jwt', {
    headers: { [headerName]: `${bearerPrefix} ${signedValue}` },
  }, env)).status, 200)

  console.log('[Honovel] Hono auth decorator compiler and runtime check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
