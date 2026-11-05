import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { startPhoneBridge } from './phone-bridge.mjs'

let phoneBridge = null
let phonePending = null

async function ensurePhoneBridge() {
  if (phoneBridge) return phoneBridge
  if (!phonePending) {
    phonePending = startPhoneBridge({
      userData: app.getPath('userData'),
      onFrame: (bytes) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('zendev:phone-frame', bytes)
        }
      },
      onClients: (count) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('zendev:phone-clients', count)
        }
      },
    })
      .then((bridge) => {
        phoneBridge = bridge
        console.log(`ZenDev: phone camera bridge on port ${bridge.port} (pairing on ${bridge.httpPort})`)
        for (const url of bridge.pairUrls) console.log(`  pair ${url}`)
        for (const url of bridge.urls) console.log(`  camera ${url}`)
        console.log(`  CA SHA-256 ${bridge.fingerprint}`)
        return bridge
      })
      .catch((error) => {
        phonePending = null
        throw error
      })
  }
  return phonePending
}

export function registerIpc({ isDev }) {
  ipcMain.handle('zendev:host-info', () => ({
    apiKey: process.env.SMARTSPECTRA_API_KEY ?? '',
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    isDev,
    userData: app.getPath('userData'),
  }))

  ipcMain.handle('zendev:phone-info', async () => {
    try {
      const bridge = await ensurePhoneBridge()
      return {
        available: true,
        url: bridge.url,
        urls: bridge.urls,
        pairUrl: bridge.pairUrl,
        pairUrls: bridge.pairUrls,
        port: bridge.port,
        httpPort: bridge.httpPort,
        fingerprint: bridge.fingerprint,
        clients: bridge.clients(),
        reason: null,
      }
    } catch (error) {
      return {
        available: false,
        url: null,
        urls: [],
        pairUrl: null,
        pairUrls: [],
        port: null,
        httpPort: null,
        fingerprint: null,
        clients: 0,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('zendev:save-export', async (event, payload) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const { defaultName, contents, filters } = payload ?? {}
    const result = await dialog.showSaveDialog(window, {
      title: 'Export session',
      defaultPath: defaultName ?? 'zendev-session.json',
      filters: filters ?? [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await fs.writeFile(result.filePath, contents, 'utf8')
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle('zendev:write-guard-state', async (_event, state) => {
    const dir = path.join(app.getPath('userData'), 'guard')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, 'state.json')
    const text = JSON.stringify(state, null, 2)
    await fs.writeFile(file, text, 'utf8')

    const sharedDir = path.join(os.homedir(), '.zendev')
    await fs.mkdir(sharedDir, { recursive: true })
    await fs.writeFile(path.join(sharedDir, 'guard.json'), text, 'utf8')

    return { file }
  })
}
