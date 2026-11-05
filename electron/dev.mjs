import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const port = Number(process.env.PORT ?? 5173)
const server = await createServer({
  server: { port, strictPort: true },
})

try {
  await server.listen()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/already in use|EADDRINUSE/i.test(message)) {
    console.error(
      `\nZenDev: port ${port} is already in use.\n` +
        'Close the other dev server, or pick another port:\n' +
        `  $env:PORT=5174; npm run app\n`,
    )
  } else {
    console.error('\nZenDev: the Vite server failed to start.\n' + message)
  }
  process.exit(1)
}

server.printUrls()

const url = `http://localhost:${port}`
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})

console.log(`ZenDev: launching Electron against ${url}`)

const shutdown = async (code = 0) => {
  try {
    await server.close()
  } finally {
    process.exit(code)
  }
}

child.on('error', (error) => {
  console.error('ZenDev: could not launch Electron.', error.message)
  void shutdown(1)
})

child.on('close', (code) => {
  console.log(`ZenDev: Electron exited (${code ?? 0}).`)
  void shutdown(code ?? 0)
})

process.on('SIGINT', () => {
  child.kill()
  void shutdown(0)
})
