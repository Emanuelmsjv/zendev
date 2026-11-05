'use strict'

const { contextBridge, ipcRenderer } = require('electron')

require('@smartspectra/node-sdk/preload')

contextBridge.exposeInMainWorld('zendevHost', {
  info: () => ipcRenderer.invoke('zendev:host-info'),
  phoneInfo: () => ipcRenderer.invoke('zendev:phone-info'),
  onPhoneFrame: (callback) => {
    const listener = (_event, data) => callback(new Uint8Array(data))
    ipcRenderer.on('zendev:phone-frame', listener)
    return () => ipcRenderer.removeListener('zendev:phone-frame', listener)
  },
  onPhoneClients: (callback) => {
    const listener = (_event, count) => callback(count)
    ipcRenderer.on('zendev:phone-clients', listener)
    return () => ipcRenderer.removeListener('zendev:phone-clients', listener)
  },
  saveExport: (payload) => ipcRenderer.invoke('zendev:save-export', payload),
  writeGuardState: (state) => ipcRenderer.invoke('zendev:write-guard-state', state),
})
