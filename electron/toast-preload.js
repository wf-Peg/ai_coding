/**
 * toast-preload.js — 待办提醒 toast 专用预加载脚本
 *
 * 该 toast 以 data: URL 内嵌 HTML 在隔离渲染上下文运行（contextIsolation: true）。
 * 仅暴露关闭所需的极简 IPC 通道；退场淡出由主进程用窗口级 setOpacity 完成，
 * 避免透明窗口内 CSS opacity 动画在 macOS 合成器上留下黑色残影。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastAPI', {
  /** 通知主进程收起本 toast（原生窗口淡出后关闭）。 */
  dismiss: () => ipcRenderer.send('toast-dismiss')
});
