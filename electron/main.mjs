import { app, BrowserWindow, session } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc.mjs'

const require = createRequire(import.meta.url)
const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main')

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const isDev = Boolean(devServerUrl)

app.setAppUserModelId('com.zendev.app')

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('ZenDev: another window is already open; focusing it and exiting.')
  app.quit()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b0f14',
    show: false,
    autoHideMenuBar: true,
    title: 'ZenDev',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  win.webContents.on('console-message', (...args) => {
    const details = args.find((a) => a && typeof a === 'object' && 'message' in a)
    console.log('[renderer]', details?.level ?? '', details?.message ?? args[2])
  })

  win.once('ready-to-show', () => win.show())
  bindSmartSpectraIpc(win)

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(here, '..', 'dist', 'index.html'))
  }

  return win
}

function lockDownPermissions() {
  const allowedOrigins = new Set(
    isDev ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [],
  )

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details?.requestingUrl ?? contents?.getURL() ?? ''
    const isLocalPage = url.startsWith('file://') || [...allowedOrigins].some((o) => url.startsWith(o))
    callback(permission === 'media' && isLocalPage)
  })

  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const isLocalOrigin =
      requestingOrigin.startsWith('file://') ||
      [...allowedOrigins].some((o) => requestingOrigin.startsWith(o))
    return permission === 'media' && isLocalOrigin
  })
}

registerIpc({ isDev })

app.whenReady().then(() => {
  lockDownPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})
