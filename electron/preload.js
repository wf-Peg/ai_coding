const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 保存配置
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  // 获取当前配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  // 选择目录
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  // 检查后端状态
  checkBackend: (port) => ipcRenderer.invoke('check-backend', port),
  // 重启后端
  restartBackend: (config) => ipcRenderer.invoke('restart-backend', config),
  // 监听加载配置
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (event, config) => callback(config)),
  // 监听首次运行
  onFirstRun: (callback) => ipcRenderer.on('first-run', (event) => callback()),
  // 配置完成通知
  configDone: (config) => ipcRenderer.send('config-done', config),
  // 移除监听器
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
