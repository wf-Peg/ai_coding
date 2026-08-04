'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const SUPPORTED_INVOKES = new Set([
  'workspace:get',
  'file:openDialog',
  'file:openPath',
  'file:save',
  'file:saveAsDialog',
  'file:reopen',
  'ai:getConfig',
  'ai:saveConfig',
  'launch:full',
  'launch:resetFullPath',
  'window:hide',
  'window:show'
]);

function invoke(channel, ...args) {
  if (!SUPPORTED_INVOKES.has(channel)) {
    return Promise.reject(new Error(`Channel ${channel} not allowed`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('liteAPI', {
  workspace: {
    get: () => invoke('workspace:get')
  },
  file: {
    openDialog: () => invoke('file:openDialog'),
    openPath: (filePath) => invoke('file:openPath', filePath),
    save: (fileToken, payload) => invoke('file:save', fileToken, payload),
    saveAsDialog: (payload) => invoke('file:saveAsDialog', payload),
    reopen: (fileToken, encoding) => invoke('file:reopen', fileToken, encoding)
  },
  ai: {
    getConfig: () => invoke('ai:getConfig'),
    saveConfig: (next) => invoke('ai:saveConfig', next)
  },
  launch: {
    full: () => invoke('launch:full'),
    resetFullPath: () => invoke('launch:resetFullPath')
  },
  window: {
    hide: () => invoke('window:hide'),
    show: () => invoke('window:show')
  },
  onToast: (handler) => {
    const listener = (_event, data) => {
      try { handler(data); } catch (_) {}
    };
    ipcRenderer.on('lite:toast', listener);
    return () => ipcRenderer.removeListener('lite:toast', listener);
  }
});
