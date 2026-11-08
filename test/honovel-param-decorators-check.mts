import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Hono } from 'hono'
import { sign } from 'hono/jwt'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-decorators-'))

try {
  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'node_modules'), { recursive: true })
  for (const entry of fs.readdirSync(path.resolve('node_modules'))) {
    const source = path.resolve('node_modules', entry)
    const target = path.join(projectRoot, 'node_modules', entry)
    if (entry.startsWith('@') && fs.statSync(source).isDirectory()) {
      fs.mkdirSync(target, { recursive: true })
      for (const scopedEntry of fs.readdirSync(source)) {
        fs.symlinkSync(
          path.resolve(source, scopedEntry),
          path.join(target, scopedEntry),
          'junction',
        )
      }
    } else {
      fs.symlinkSync(source, target, 'junction')
    }
  }
  fs.mkdirSync(path.join(projectRoot, 'src', 'controllers'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'http'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'repositories'), { recursive: true })
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
  const externalPackage = path.join(projectRoot, 'node_modules', '@fixture', 'decorators')
  fs.mkdirSync(externalPackage, { recursive: true })
  fs.writeFileSync(path.join(externalPackage, 'package.json'), JSON.stringify({
    name: '@fixture/decorators',
    type: 'module',
    exports: { '.': { types: './index.ts', import: './index.js' } },
  }))
  fs.writeFileSync(path.join(externalPackage, 'index.ts'), `
import { createDecorator } from '@honovel/core'

export const ExternalHeader = createDecorator((context) =>
  context.req.header('x-external') ?? 'missing'
)
`)
  fs.writeFileSync(path.join(externalPackage, 'index.js'), `
import { createDecorator } from '@honovel/core'

export const ExternalHeader = createDecorator((context) =>
  context.req.header('x-external') ?? 'missing'
)
`)
  fs.writeFileSync(path.join(projectRoot, 'src/repositories/UserRepository.ts'), `
export type User = { id: number; name: string }

export abstract class UserRepository {
  abstract findOrFail(id: number): Promise<User>
}

export class InMemoryUserRepository extends UserRepository {
  async findOrFail(id: number): Promise<User> {
    return { id, name: 'User ' + id }
  }
}
`)
  fs.writeFileSync(path.join(projectRoot, 'src/http/decorators.ts'), `
import { createDecorator, ForbiddenException, JwtPayload } from '../../core'
import { UserRepository, type User } from '../repositories/UserRepository'

let currentUserCalls = 0
let canCalls = 0
let uncachedCalls = 0

export const Ip = createDecorator((context) =>
  context.req.header('x-client-ip') ?? 'unknown'
)

export const Header = createDecorator((context, name: string) =>
  context.req.header(name)
)

export const AsyncValue = createDecorator(async (_context, prefix: string) =>
  Promise.resolve(prefix + '-async')
)

export const CurrentUser = createDecorator(
  [UserRepository, JwtPayload],
  async (_context, users, jwt): Promise<User & { resolution: number }> => {
    currentUserCalls += 1
    return {
      ...await users.findOrFail(Number(jwt.sub)),
      resolution: currentUserCalls,
    }
  },
)

export const Can = createDecorator(
  [CurrentUser],
  async (_context, user, permission: string) => {
    canCalls += 1
    if (permission === 'forbidden') throw new ForbiddenException()
    return { permission, user, invocation: canCalls }
  },
)

export const Uncached = createDecorator(
  async (_context, label: string) => ({ label, invocation: ++uncachedCalls }),
  { cache: false },
)
`)
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/ParameterController.ts'), String.raw`
import {
  BaseUrl,
  Binding,
  Controller,
  Get,
  JwtAuth,
  JwtPayload,
} from '../../core'
import { ExternalHeader } from '@fixture/decorators'
import { AsyncValue, Can, CurrentUser, Header, Ip, Uncached } from '../http/decorators'
import type { User } from '../repositories/UserRepository'

@BaseUrl('/params')
export class ParameterController extends Controller {
  @Get('/')
  index(
    @Ip() ip: string,
    @Header('x-request-id') requestId: string | undefined,
    @AsyncValue('honovel') asyncValue: string,
    @ExternalHeader() external: string,
  ) {
    return { ip, requestId, asyncValue, external }
  }
}

@BaseUrl('/jwt-payload')
@JwtAuth({ se\u0063ret: Binding('JWT_VALUE'), alg: 'HS256' })
@Can('read')
export class JwtPayloadController extends Controller {
  @Get('/')
  @Can('read')
  show(
    @JwtPayload() payload: JwtPayload,
    @CurrentUser() user: User & { resolution: number },
    @Can('read') permission: { permission: string; invocation: number },
    @Uncached('same') firstUncached: { invocation: number },
    @Uncached('same') secondUncached: { invocation: number },
  ) {
    return {
      sub: payload.sub,
      role: payload.role,
      user,
      permission,
      uncached: [firstUncached.invocation, secondUncached.invocation],
    }
  }

  @Get('/forbidden')
  @Can('forbidden')
  forbidden() {
    return { ok: true }
  }
}
`)

  execFileSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
  })

  const appEntryPath = path.join(projectRoot, '.honovel/app.js')
  const generated = fs.readFileSync(appEntryPath, 'utf8')
  assert.match(generated, /resolveCompiledDecorator/)
  assert.match(generated, /\.Ip, \[\]/)
  assert.match(generated, /\.Header, \["x-request-id"\]/)
  assert.match(generated, /\.AsyncValue, \["honovel"\]/)
  assert.match(generated, /\.JwtPayload, \[\]/)
  assert.match(generated, /\.CurrentUser, \[\]/)
  assert.match(generated, /\.Can, \["read"\]/)
  assert.match(generated, /container\.registerAlias\([^\n]*UserRepository[^\n]*InMemoryUserRepository/)
  assert.match(generated, /import \* as \w+ from "@fixture\/decorators"/)

  const emittedController = fs.readFileSync(
    path.join(projectRoot, '.honovel/src/controllers/ParameterController.js'),
    'utf8',
  )
  assert.doesNotMatch(emittedController, /__decorate|@JwtPayload|@Ip|@Header|@AsyncValue|@Can/)

  const openApi = JSON.parse(fs.readFileSync(path.join(projectRoot, '.honovel/openapi.json'), 'utf8'))
  assert.deepEqual(openApi.paths['/params'].get.parameters ?? [], [])
  assert.equal(openApi.paths['/params'].get.responses['422'], undefined)
  assert.deepEqual(openApi.paths['/jwt-payload'].get.security, [{ jwtAuth: [] }])
  assert.ok(openApi.paths['/jwt-payload'].get.responses['403'])

  const bundlePath = path.join(projectRoot, '.honovel/decorators-test.mjs')
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

  const paramsResponse = await app.request('/params', {
    headers: {
      'x-client-ip': '203.0.113.9',
      'x-request-id': 'request-123',
      'x-external': 'external-package',
    },
  })
  assert.equal(paramsResponse.status, 200)
  assert.deepEqual(await paramsResponse.json(), {
    ip: '203.0.113.9',
    requestId: 'request-123',
    asyncValue: 'honovel-async',
    external: 'external-package',
  })

  const runtimeValue = String.fromCharCode(118, 97, 108, 117, 101)
  const jwtValue = await sign(
    { sub: '42', role: 'admin', exp: Math.floor(Date.now() / 1000) + 60 },
    runtimeValue,
    'HS256',
  )
  const headers = { Authorization: `Bearer ${jwtValue}` }
  const jwtResponse = await app.request('/jwt-payload', { headers }, { JWT_VALUE: runtimeValue })
  assert.equal(jwtResponse.status, 200)
  assert.deepEqual(await jwtResponse.json(), {
    sub: '42',
    role: 'admin',
    user: { id: 42, name: 'User 42', resolution: 1 },
    permission: {
      permission: 'read',
      user: { id: 42, name: 'User 42', resolution: 1 },
      invocation: 1,
    },
    uncached: [1, 2],
  })

  const forbiddenResponse = await app.request('/jwt-payload/forbidden', { headers }, { JWT_VALUE: runtimeValue })
  assert.equal(forbiddenResponse.status, 403)

  fs.writeFileSync(path.join(projectRoot, 'src/controllers/DynamicDecoratorController.ts'), `
import { BaseUrl, Controller, Get } from '../../core'
import { Can, Header } from '../http/decorators'

const dynamicValue = 'dynamic'

@BaseUrl('/dynamic')
@Can(dynamicValue)
export class DynamicDecoratorController extends Controller {
  @Get('/')
  show(@Header(dynamicValue) value: string | undefined) {
    return { value }
  }
}
`)
  const dynamicCompile = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs', '--no-emit'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.notEqual(dynamicCompile.status, 0)
  assert.match(`${dynamicCompile.stdout}\n${dynamicCompile.stderr}`, /only supports static literal, array, and object arguments/)

  fs.rmSync(path.join(projectRoot, 'src/controllers/DynamicDecoratorController.ts'), { force: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'cycles'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'src/cycles/A.ts'), `
import { createDecorator, type HonovelDecorator } from '../../core'
import { DecoratorB } from './B'
export const DecoratorA: HonovelDecorator<[], unknown> = createDecorator(
  [DecoratorB],
  (_context, value) => value,
)
`)
  fs.writeFileSync(path.join(projectRoot, 'src/cycles/B.ts'), `
import { createDecorator, type HonovelDecorator } from '../../core'
import { DecoratorA } from './A'
export const DecoratorB: HonovelDecorator<[], unknown> = createDecorator(
  [DecoratorA],
  (_context, value) => value,
)
`)
  fs.writeFileSync(path.join(projectRoot, 'src/controllers/CycleController.ts'), `
import { BaseUrl, Controller, Get } from '../../core'
import { DecoratorA } from '../cycles/A'

@BaseUrl('/cycle')
@DecoratorA()
export class CycleController extends Controller {
  @Get('/')
  show() { return { ok: true } }
}
`)
  const cycleCompile = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs', '--no-emit'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.notEqual(cycleCompile.status, 0)
  assert.match(
    `${cycleCompile.stdout}\n${cycleCompile.stderr}`,
    /Circular custom decorator dependency detected: DecoratorA -> DecoratorB -> DecoratorA/,
  )

  console.log('[Honovel] Unified custom decorator, caching, DI, and JwtPayload check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
