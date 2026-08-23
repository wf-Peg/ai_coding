/**
 * screenshot-preload.js — 截图族窗口（覆盖层 / 贴图窗 / OCR 结果窗）共用预加载脚本
 *
 * 目的：让这些窗口以 contextIsolation: true 运行，通过 contextBridge 仅暴露必要的
 * IPC 能力，避免向本地页面开放完整 Node 权限。
 *
 * 设计：所有可调用的 IPC 通道都以白名单收口——不在白名单中的通道一律拒绝，
 * 防止页面内脚本越权调用未授权的主进程功能。
 */
const { contextBridge, ipcRenderer, clipboard } = require('electron');

// 只允许发送（单向）的通道
const ALLOWED_SEND = new Set([
  'screenshot:painted',
  'screenshot:init-error',
  'paste:text-ready',
  'paste:rendered',
  'paste:render-error',
  'screenshot:close-paste-windows'
]);

// 允许 invoke（双向、等待返回）的通道
const ALLOWED_INVOKE = new Set([
  'screenshot:confirm',
  'screenshot:cancel',
  'paste:move-to',
  'paste:set-opacity',
  'paste:zoom-at',
  'paste:set-top',
  'paste:save',
  'paste:rearrange',
  'screenshot:copy-last',
  'screenshot:ocr',
  'screenshot:open-in-editor'
]);

// 允许监听主进程事件的通道
const ALLOWED_ON = new Set([
  'screenshot:loading',
  'screenshot:init',
  'paste:init',
  'ocr-result:init'
]);

/** 订阅主进程事件；回调仅收到 payload（不带 Event 对象，安全穿越 contextBridge）。 */
function on(channel, cb) {
  if (!ALLOWED_ON.has(channel)) {
    throw new Error(`[screenshot-preload] 未授权的监听通道: ${channel}`);
  }
  const listener = (event, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('screenshotApi', {
  /** 单向发送（白名单内）。 */
  send: (channel, ...args) => {
    if (!ALLOWED_SEND.has(channel)) throw new Error(`[screenshot-preload] 未授权的发送通道: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  /** 双向调用（白名单内），返回 Promise。 */
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.has(channel)) throw new Error(`[screenshot-preload] 未授权的调用通道: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  /** 订阅主进程事件（白名单内），返回取消订阅函数。 */
  on,
  /** 将文本写入系统剪贴板（覆盖层取色复制用）。 */
  copyText: (text) => clipboard.writeText(text)
});