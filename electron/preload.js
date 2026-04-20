const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  checkBackend: (port) => ipcRenderer.invoke('check-backend', port),
  restartBackend: (config) => ipcRenderer.invoke('restart-backend', config),
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (event, config) => callback(config)),
  onFirstRun: (callback) => ipcRenderer.on('first-run', (event) => callback()),
  onStartupProgress: (callback) => ipcRenderer.on('startup-progress', (event, msg) => callback(msg)),
  onStartupError: (callback) => ipcRenderer.on('startup-error', (event, msg) => callback(msg)),
  configDone: (config) => ipcRenderer.send('config-done', config),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
