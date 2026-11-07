import net from 'node:net'
import { spawn } from 'node:child_process'

const debug = process.argv.includes('--debug')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function chooseBackendPort() {
  try {
    return await probePort(8788)
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error
    return probePort(0)
  }
}

const backendPort = await chooseBackendPort()
const backendUrl = `http://127.0.0.1:${backendPort}`
const env = {
  ...process.env,
  HONOVEL_BACKEND_PORT: String(backendPort),
  HONOVEL_BACKEND_DEV_URL: backendUrl,
}

console.log(`[Honovel] App: http://localhost:5173`)
console.log(`[Honovel] Backend: ${backendUrl} (proxied by Nuxt)`)

const backendScript = debug ? 'dev:backend:debug' : 'dev:backend'
const backend = spawn(npm, ['run', backendScript], { stdio: 'inherit', env })
const frontend = spawn(npm, ['run', 'dev:frontend'], { stdio: 'inherit', env })
const children = [backend, frontend]
let shuttingDown = false

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal))
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    shutdown()
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
}
