import net from 'node:net'
import { spawn } from 'node:child_process'
import { forwardBackendOutput, forwardFrontendOutput } from './dev-output.mjs'

const debug = process.argv.includes('--debug')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Cannot determine the backend port.'))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

async function chooseBackendPort() {
  try {
    return await probePort(8788)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error
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

const appUrl = 'http://localhost:5173'
console.log(`[Honovel] Open app: ${appUrl}`)
console.log(`[Honovel] Backend: internal port ${backendPort} (proxied by Nuxt)`)

const backendScript = debug ? 'dev:backend:debug' : 'dev:backend'
// Both tools share this terminal. Give neither child an interactive terminal
// that could clear or redraw the other tool's output.
const backend = spawn(npm, ['--silent', 'run', backendScript], { stdio: ['ignore', 'pipe', 'pipe'], env })
forwardBackendOutput(backend.stdout, process.stdout, { appUrl, backendPort })
forwardBackendOutput(backend.stderr, process.stderr, { appUrl, backendPort })
const frontend = spawn(npm, ['--silent', 'run', 'dev:frontend'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...env, NUXT_TUI: 'plain' },
})
forwardFrontendOutput(frontend.stdout, process.stdout)
forwardFrontendOutput(frontend.stderr, process.stderr)
const children = [backend, frontend]
let shuttingDown = false

function shutdown(signal: NodeJS.Signals = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(signal))
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    shutdown()
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
}
