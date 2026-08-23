/**
 * close-dialog-preload.js — 「关闭确认弹窗」专用预加载脚本
 *
 * 该弹窗以 data: URL 内嵌 HTML 在隔离渲染上下文运行（contextIsolation: true）。
 * 这里仅暴露关闭对话框所需的极简 IPC 通道，避免向隔离页面暴露完整 Node 权限。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dialogApi', {
  /** 通知主进程用户选择（tray / quit），并带上「记住选择」标记。 */
  choose: (action, remember) => ipcRenderer.send('close-dialog-result', { action, remember })
});