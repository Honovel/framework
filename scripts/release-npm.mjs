import { releaseFromCli } from './release-github.mjs'
import { registry } from './pack-packages.mjs'

Promise.resolve().then(() => releaseFromCli(registry)).catch((error) => {
  console.error(`[Honovel release] ${error.message}`)
  process.exitCode = 1
})
