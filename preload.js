// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Host/Join
  startHost: () => ipcRenderer.invoke('start-host'),
  onHostStarted: (callback) => ipcRenderer.on('host-started', (_e, data) => callback(data)),
  onHostFailed: (callback) => ipcRenderer.on('host-failed', (_e, err) => callback(err)),

  // Screen share
  onShowScreenPicker: (callback) => ipcRenderer.on('show-screen-picker', (_e, sources) => callback(sources)),
  sendScreenPickerResult: (sourceId) => ipcRenderer.send('screen-picker-result', sourceId),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPlatform: () => process.platform,

  // File system (restricted)
  saveMap: (dataUrl) => ipcRenderer.invoke('save-map', dataUrl),
  loadMap: () => ipcRenderer.invoke('load-map'),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});