import { releaseFromCli } from './release.mjs'

Promise.resolve().then(() => releaseFromCli()).catch((error) => {
  console.error(`[Honovel release] ${error.message}`)
  process.exitCode = 1
})
