import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'honovel-database-'))

try {
  fs.cpSync(path.resolve('core'), path.join(projectRoot, 'core'), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(projectRoot, 'node_modules'), 'junction')
  fs.mkdirSync(path.join(projectRoot, 'src', 'controllers'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'services'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'src', 'database'), { recursive: true })
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
import type { AppEnv } from './src/database'

const app = createHonoApp<AppEnv>()
export default app
`)

  fs.writeFileSync(path.join(projectRoot, 'src/database/index.ts'), `
import type { Context } from 'hono'
import { defineDatabase } from '../../core'

export type AppEnv = { Bindings: { VALUE: string } }
let creations = 0

export class MainDatabase extends defineDatabase((context: Context<AppEnv>) => {
  creations += 1
  return { value: context.env.VALUE, creation: creations }
}) {}

export class OtherDatabase extends defineDatabase((context: Context<AppEnv>) => {
  creations += 1
  return { value: 'other:' + context.env.VALUE, creation: creations }
}) {}

export class UnusedDatabase extends defineDatabase(() => {
  throw new Error('Unused connection must stay lazy')
}) {}
`)

  fs.writeFileSync(path.join(projectRoot, 'src/services/DatabaseService.ts'), `
import { MainDatabase, OtherDatabase, UnusedDatabase } from '../database'

export class SharedRepository {
  constructor(readonly database: MainDatabase) {}
}

export class DatabaseService {
  constructor(
    private readonly database: MainDatabase,
    private readonly other: OtherDatabase,
    private readonly unused: UnusedDatabase,
    private readonly repository: SharedRepository,
  ) {}

  inspect() {
    const first = this.database.client
    const second = this.database.client
    return {
      value: first.value,
      creation: first.creation,
      sameClient: first === second,
      shared: this.repository.database === this.database,
      other: this.other.client.value,
    }
  }
}
`)

  fs.writeFileSync(path.join(projectRoot, 'src/controllers/DatabaseController.ts'), `
import { BaseUrl, Controller, Get, createDecorator } from '../../core'
import { DatabaseService } from '../services/DatabaseService'
import { MainDatabase } from '../database'

export const DatabaseValue = createDecorator([MainDatabase], (_context, db) => db.client.value)

@BaseUrl('/database')
export class DatabaseController extends Controller {
  constructor(private readonly database: DatabaseService) {
    super()
  }

  @Get('/')
  index() {
    return this.database.inspect()
  }

  @Get('/value')
  value(@DatabaseValue() value: string) {
    return { value }
  }
}
`)

  execFileSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
  })

  const generated = fs.readFileSync(path.join(projectRoot, '.honovel/app.js'), 'utf8')
  assert.match(generated, /DatabaseService/)
  assert.match(generated, /container\.register\(M\d+\.MainDatabase, "scoped"/)
  assert.match(generated, /new M\d+\.MainDatabase\(scope\.resolve\(HonoContext\)\)/)
  assert.match(generated, /scope\.resolve\(M\d+\.OtherDatabase\)/)
  assert.doesNotMatch(generated, /databaseForContext|app\.use\([^\n]*database/)

  const compiledEntry = path.join(projectRoot, '.honovel/index.js')
  const bundlePath = path.join(projectRoot, '.honovel/database-test.mjs')
  await build({
    entryPoints: [compiledEntry],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })

  const { default: app } = await import(pathToFileURL(bundlePath).href)

  const first = await app.request('/database', undefined, { VALUE: 'first' })
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), {
    value: 'first',
    creation: 1,
    sameClient: true,
    shared: true,
    other: 'other:first',
  })

  const second = await app.request('/database', undefined, { VALUE: 'second' })
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), {
    value: 'second',
    creation: 3,
    sameClient: true,
    shared: true,
    other: 'other:second',
  })
  const decorated = await app.request('/database/value', undefined, { VALUE: 'decorated' })
  assert.equal(decorated.status, 200)
  assert.deepEqual(await decorated.json(), { value: 'decorated' })

  fs.writeFileSync(path.join(projectRoot, 'src/InvalidService.ts'), `
import { Database } from '../core'
export class InvalidService {
  constructor(readonly db: Database<unknown>) {}
}
`)
  const failedCompile = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.notEqual(failedCompile.status, 0)
  assert.match(`${failedCompile.stdout}\n${failedCompile.stderr}`, /Inject a named class extending defineDatabase/)

  for (const [source, message] of [
    [`import { defineDatabase, Scope } from '../core'
@Scope('transient')
export class InvalidDatabase extends defineDatabase(() => ({})) {}`, /must be request-scoped/],
    [`import { defineDatabase } from '../core'
export class InvalidDatabase extends defineDatabase(() => ({})) {
  constructor() { super({} as any) }
}`, /inherit their constructor/],
    [`import { MainDatabase } from './database'
export class InvalidService {
  constructor(readonly db: MainDatabase) {}
  query() { return this.db.client.nonexistentTable }
}`, /nonexistentTable/],
  ]) {
    fs.writeFileSync(path.join(projectRoot, 'src/InvalidService.ts'), source)
    const result = spawnSync(process.execPath, ['core/compiler/honovel-build.mjs'], {
      cwd: projectRoot, encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, message)
  }

  console.log('[Honovel] defineDatabase DI and request-scoped client check passed.')
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true })
}
