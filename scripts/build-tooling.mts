import { fileURLToPath } from 'node:url'
import { buildTooling } from '../core/scripts/build-tooling.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
await buildTooling(root, ['core/cli', 'core/compiler', 'core/scripts', 'core/tools', 'core/typescript-plugin', 'scripts', 'packages', 'test', 'docs/scripts'])
