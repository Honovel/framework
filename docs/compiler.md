# Development & Compiler

Honovel compiles framework conventions into static Hono application wiring. As an application developer, you normally use the scripts created by `create-honovel`.

## Development

```bash
npm run dev
```

Nuxt projects start Nuxt and Wrangler together. API-only projects start only Wrangler at `http://localhost:8788`. Both compile the Cloudflare backend as source changes.

## Type checking

```bash
npm run typecheck
```

This runs TypeScript plus Honovel-specific diagnostics.

Examples of errors caught before deployment include route-parameter mismatches, unresolved injected classes, ambiguous abstract bindings, duplicate defaults and circular dependencies.

Invalid:

```ts
@Get('/:id')
show(userId: number) {
  return { userId }
}
```

Valid by matching the placeholder:

```ts
@Get('/:id')
show(id: number) {
  return { id }
}
```

or explicitly binding it:

```ts
@Get('/:id')
show(@Param('id') userId: number) {
  return { userId }
}
```

## Production build

```bash
npm run build
```

## Direct compiler usage

```bash
npm run compile
npm run compile -- --mode production
```

## Generated output

Generated artifacts live under `.honovel/`, including the compiled app and OpenAPI document. Do not edit them manually.

## Application-owned entrypoint

Your root `index.ts` remains yours:

```ts
const app = createHonoApp<AppEnv>()

app.use('*', async (context, next) => {
  context.header('X-App', 'My Honovel App')
  await next()
})

export default app
```

Honovel preserves normal Hono setup and inserts generated registration during compilation.

## Named exports

Framework-discovered application classes should use named exports:

```ts
export class UserController extends Controller {}
export class UserService {}
```

Honovel does not require `emitDecoratorMetadata`.

## Backend and frontend checks

In generated projects, `npm run typecheck:backend` generates binding types and runs backend TypeScript/Honovel diagnostics. Nuxt projects additionally provide `npm run typecheck:frontend` and run it as part of `npm run typecheck`. API-only projects have no frontend checks or dependencies. `honovel typecheck` checks the backend without emitting application files.

## Editor diagnostics

The Core package includes the TypeScript language-service plugin at `honovel/typescript-plugin`, configured by the starter's `tsconfig.json`. Use the project's installed TypeScript version in your editor and restart its TypeScript service after installing/updating dependencies. Editor diagnostics complement the compiler; CI should still run the build/typecheck commands.

## Framework repository versus applications

In a generated application, compilation writes `.honovel/` in that project. The framework repository instead runs its Todo fixture from `test/fixtures/application/` in a temporary workspace for `npm test` and the root compile/build/typecheck commands. Its `core/` and `packages/` directories contain the publishable implementation; tests are not application or runtime exports.
