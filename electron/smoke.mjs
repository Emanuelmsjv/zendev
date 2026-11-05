import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { registerIpc } from './ipc.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '..', 'docs')
fs.mkdirSync(docs, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

registerIpc({ isDev: false })

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#080c11',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  const errors = []
  win.webContents.on('console-message', (...args) => {
    const details = args.find((a) => a && typeof a === 'object' && 'message' in a)
    const level = details?.level ?? args[1]
    const message = details?.message ?? args[2]
    if (String(level) === 'error' || String(level) === '3') errors.push(String(message))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`render-process-gone: ${JSON.stringify(details)}`)
  })

  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(docs, name), image.toPNG())
  }

  const readApp = () =>
    win.webContents.executeJavaScript(`({
      phase: document.querySelector('.app')?.dataset.phase ?? null,
      index: document.querySelector('.meter-value .big')?.textContent ?? null,
      clock: (document.querySelector('.statusbar')?.textContent ?? '').match(/session [0-9:]+/)?.[0] ?? null,
      contributions: document.querySelectorAll('.explain-list li').length,
      logLines: document.querySelectorAll('.log').length,
      layout: (() => {
        const bar = document.querySelector('.topbar')
        const dock = document.querySelector('.console')
        return {
          topbarOverflow: bar ? bar.scrollWidth - bar.clientWidth : null,
          pageOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dockHeight: dock ? Math.round(dock.getBoundingClientRect().height) : null,
        }
      })()
    })`)

  await win.loadFile(path.join(here, '..', 'dist', 'index.html'))
  await sleep(400)
  const gatePresent = await win.webContents.executeJavaScript(
    `Boolean(document.querySelector('.gate-card'))`,
  )

  await win.webContents.executeJavaScript(`
    localStorage.setItem('zendev.v1.consent', JSON.stringify({ acceptedAt: new Date().toISOString() }));
    localStorage.setItem('zendev.v1.settings', JSON.stringify({
      source: 'simulated', apiKey: '', guardrailEnabled: true, scenario: 'auto', breathSeconds: 20
    }));
    true;
  `)
  await win.webContents.reload()

  const trace = []
  let flowShot = false
  let strainShot = false
  for (let step = 1; step <= 32; step += 1) {
    await sleep(2000)
    const snapshot = { wall: step * 2, ...(await readApp()) }
    trace.push(snapshot)
    if (!flowShot && snapshot.phase === 'flow') {
      await shot('screenshot-flow.png')
      flowShot = true
    }
    if (!strainShot && (snapshot.phase === 'strain' || snapshot.phase === 'guardrail')) {
      await shot('screenshot-strain.png')
      strainShot = true
    }
    if (snapshot.phase === 'guardrail') break
  }
  const calm = trace.find((entry) => entry.phase === 'flow') ?? null
  const strained = trace[trace.length - 1]

  await win.webContents.executeJavaScript("document.querySelector('#tab-terminal')?.click(); true")
  await sleep(300)
  await win.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('.terminal-input input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'git push --force origin main');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()
  `)
  await sleep(1200)

  const readBreaker = () =>
    win.webContents.executeJavaScript(`({
      open: Boolean(document.querySelector('.breaker-backdrop')),
      title: document.querySelector('.breaker h2')?.textContent ?? null,
      command: document.querySelector('.breaker-command code')?.textContent ?? null,
      phase: document.querySelector('.breathe-phase')?.textContent ?? null,
      note: document.querySelector('.breaker-note')?.textContent ?? null,
      proceedLabel: document.querySelector('.breaker-actions .secondary')?.textContent ?? null,
      proceedDisabled: document.querySelector('.breaker-actions .secondary')?.disabled ?? null
    })`)

  const locked = await readBreaker()
  await shot('screenshot-guardrail.png')

  await sleep(8500)
  const unlocked = await readBreaker()

  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true;
  `)
  await sleep(400)
  const afterEscape = await readBreaker()
  const finalApp = await readApp()

  console.log(
    JSON.stringify(
      { gatePresent, trace, calm, strained, locked, unlocked, afterEscape, finalApp, errors },
      null,
      2,
    ),
  )
  app.quit()
})
