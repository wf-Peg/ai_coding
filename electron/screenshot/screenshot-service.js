/**
 * screenshot-service.js — 截图小工具主进程服务
 *
 * 形态（已与用户对齐）：
 *   - 常驻全局快捷键：F1 截图 / F2 贴图（可在设置页修改，持久化到 config.json）
 *   - ToolsHub 内置工具卡片：配置/说明入口
 *   - v1 功能：截图→复制/保存、贴图、离线 OCR（RapidOCR / onnxruntime-node）
 *   - 后续预留：标注、GIF 录制、长截图（滚动拼接）—— 通过动作分发层扩展
 *
 * 安全：覆盖层/贴图窗口均为本地受控文件（nodeIntegration 仅限本项目页面），
 *      图片数据仅在主进程与本地窗口间传递。
 */
const path = require('path');
const fs = require('fs');

/** 全局实例与依赖（initScreenshotService 注入） */
let deps = null;
let shortcuts = { screenshot: 'F1', paste: 'F2' };
let screenshotWindow = null;   // 当前截图覆盖层
let pasteWindow = null;        // 当前贴图窗口
let lastCapture = null;        // 最近一次截图 nativeImage（供贴图兜底）
let pendingAction = null;      // 截图确认后的动作（copy/save/ocr/paste）
let ocrService = null;         // 延迟加载（依赖 onnxruntime-node）

function log(...args) { if (deps && deps.log) deps.log('[Screenshot]', ...args); }

/** 动态获取主窗口（兼容 getMainWindow 函数与静态属性） */
function getMainWindow() {
  if (deps && typeof deps.getMainWindow === 'function') return deps.getMainWindow();
  return deps ? getMainWindow() : null;
}

/** 读取截图配置（快捷键等） */
function loadScreenshotConfig() {
  try {
    const cfg = deps.loadConfig();
    return {
      screenshot: (cfg.screenshotShortcut || 'F1'),
      paste: (cfg.pasteShortcut || 'F2'),
      hideMain: cfg.screenshotHideMain !== false,
      saveDir: cfg.screenshotSaveDir || ''
    };
  } catch (e) { return { screenshot: 'F1', paste: 'F2', hideMain: true, saveDir: '' }; }
}

/** 注册全局快捷键（独立注册，不影响现有 Alt+X 的 unregisterAll 流程） */
function registerShortcuts() {
  const { globalShortcut } = deps;
  const cfg = loadScreenshotConfig();
  const ok1 = registerOne('screenshot', cfg.screenshot, () => startScreenshot('copy'));
  const ok2 = registerOne('paste', cfg.paste, () => pasteFromClipboard());
  log('shortcuts registered:', cfg.screenshot, ok1, '|', cfg.paste, ok2);
}

/** 注册单个快捷键并记录失败 */
function registerOne(name, accelerator, cb) {
  try {
    const ok = deps.globalShortcut.register(accelerator, cb);
    if (!ok) log('registration failed:', name, accelerator);
    return ok;
  } catch (e) { log('register error:', name, accelerator, e.message); return false; }
}

/** 注销截图相关快捷键（仅本服务注册的） */
function unregisterShortcuts() {
  const cfg = loadScreenshotConfig();
  try { deps.globalShortcut.unregister(cfg.screenshot); } catch (e) {}
  try { deps.globalShortcut.unregister(cfg.paste); } catch (e) {}
}

/** 供设置页改动后重注册 */
function refreshShortcuts() { unregisterShortcuts(); registerShortcuts(); }

// ==================== 截图流程 ====================

/** 捕获当前屏幕（主显示器）为 nativeImage */
async function captureScreen() {
  const { desktopCapturer } = deps;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 } // 0 = 原始尺寸（主进程再按 display size 取）
  });
  if (!sources || sources.length === 0) throw new Error('未找到可捕获的屏幕');
  const display = deps.screen.getPrimaryDisplay();
  const size = display.size; // {width, height}
  // 重新获取指定尺寸缩略图（desktopCapturer thumbnailSize 为 0 时返回原始）
  const full = await deps.desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: size.width, height: size.height }
  });
  const src = full && full[0] ? full[0] : sources[0];
  const img = src.thumbnail;
  lastCapture = img;
  return { image: img, display: size, scaleFactor: display.scaleFactor || 1 };
}

/** 启动截图：捕获屏幕 → 打开全屏覆盖层 */
async function startScreenshot(defaultAction) {
  if (!deps) return;
  if (screenshotWindow && !screenshotWindow.isDestroyed()) return; // 防重入
  pendingAction = defaultAction || 'copy';
  try {
    if (loadScreenshotConfig().hideMain && getMainWindow() && !getMainWindow().isDestroyed()) {
      getMainWindow().minimize(); // 截图时收起主窗口（可配置）
    }
    const shot = await captureScreen();
    const bgDataUrl = shot.image.toDataURL();
    createScreenshotWindow(bgDataUrl, shot.display);
  } catch (e) {
    log('startScreenshot failed:', e.message);
    if (deps.showMainWindow) deps.showMainWindow();
  }
}

/** 创建全屏覆盖层窗口 */
function createScreenshotWindow(bgDataUrl, display) {
  const { BrowserWindow } = deps;
  const win = new BrowserWindow({
    x: 0, y: 0,
    width: display.width,
    height: display.height,
    frame: false,
    transparent: false,
    fullscreen: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });
  screenshotWindow = win;
  win.loadFile(path.join(__dirname, 'screenshot-window.html'));
  // 确保覆盖层获得焦点（Esc/Enter/Ctrl+S 等快捷键依赖焦点）
  try { win.focus(); } catch (e) {}
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('screenshot:init', { bg: bgDataUrl, display });
  });
  win.on('closed', () => { screenshotWindow = null; });
  // 防 Esc 后残留：渲染层发送 cancel 关闭
}

// ==================== 动作分发 ====================

/**
 * 截图确认：渲染层发送选区 rect（CSS 像素），主进程裁剪并分发动作。
 * @param {object} payload { rect: {x,y,width,height}, action: 'copy'|'save'|'ocr'|'paste' }
 */
async function handleConfirm(payload) {
  const { clipboard, nativeImage } = deps;
  const win = screenshotWindow;
  const rect = payload && payload.rect;
  const action = (payload && payload.action) || pendingAction || 'copy';
  if (!rect || !lastCapture) {
    closeScreenshotWindow();
    if (deps.showMainWindow) deps.showMainWindow();
    return;
  }
  // nativeImage.crop 需要 DIP 坐标；desktopCapturer 缩略图尺寸与显示器逻辑尺寸一致
  const scale = deps.screen.getPrimaryDisplay().scaleFactor || 1;
  const cropRect = {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale))
  };
  let cropped;
  try { cropped = lastCapture.crop(cropRect); } catch (e) { cropped = lastCapture; }
  closeScreenshotWindow();
  if (deps.showMainWindow) deps.showMainWindow();

  switch (action) {
    case 'save':
      return saveImage(cropped);
    case 'ocr':
      return runOcr(cropped);
    case 'paste':
      return showPasteWindow(cropped);
    case 'copy':
    default:
      clipboard.writeImage(cropped);
      log('copied to clipboard');
      return { status: 'copied' };
  }
}

/** 保存图片到文件（弹保存对话框） */
async function saveImage(image) {
  const { dialog } = deps;
  const cfg = loadScreenshotConfig();
  const defaultPath = cfg.saveDir
    ? path.join(cfg.saveDir, 'screenshot-' + Date.now() + '.png')
    : 'screenshot-' + Date.now() + '.png';
  const result = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { status: 'canceled' };
  fs.writeFileSync(result.filePath, image.toPNG());
  log('saved:', result.filePath);
  return { status: 'saved', path: result.filePath };
}

/** 贴图：剪贴板图片优先，无则最近截图 */
function pasteFromClipboard() {
  const { clipboard } = deps;
  let img = null;
  try { img = clipboard.readImage(); } catch (e) {}
  if (!img || img.isEmpty()) {
    if (lastCapture) img = lastCapture;
    else { log('no image to paste'); return { status: 'empty' }; }
  }
  return showPasteWindow(img);
}

// ==================== 贴图窗口 ====================

let pasteWindows = [];

/** 创建置顶贴图窗口（可拖动，双击/右键关闭） */
function showPasteWindow(image) {
  const { BrowserWindow } = deps;
  const size = image.getSize();
  const win = new BrowserWindow({
    width: Math.min(size.width, 900),
    height: Math.min(size.height, 700),
    x: 100 + pasteWindows.length * 30,
    y: 100 + pasteWindows.length * 30,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  pasteWindows.push(win);
  win.loadFile(path.join(__dirname, 'paste-window.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('paste:init', { dataUrl: image.toDataURL() });
  });
  win.on('closed', () => {
    const i = pasteWindows.indexOf(win);
    if (i >= 0) pasteWindows.splice(i, 1);
  });
  return { status: 'pasted', count: pasteWindows.length };
}

// ==================== OCR ====================

/**
 * 对截图执行离线 OCR。
 * 依赖 onnxruntime-node + PP-OCRv4 onnx 模型（见 download-ocr-models.ps1）。
 * 未安装/模型缺失时返回 { status: 'unavailable', message } 供前端降级提示。
 */
async function runOcr(image) {
  try {
    if (!ocrService) {
      ocrService = require('./ocr-service'); // 延迟加载（避免缺依赖时拖垮启动）
    }
    const result = await ocrService.recognize(image.toPNG(), deps);
    if (!result) {
      const st = ocrService.status();
      return { status: 'unavailable', message: st.reason || 'OCR 组件未就绪' };
    }
    showOcrResult(result);
    return { status: 'ok', text: result.text, lines: result.lines };
  } catch (e) {
    log('OCR failed:', e.message);
    return { status: 'error', message: e.message };
  }
}

/** 展示 OCR 结果窗口（文本 + 复制 + 跳转编辑器） */
function showOcrResult(result) {
  const { BrowserWindow } = deps;
  const win = new BrowserWindow({
    width: 520,
    height: 360,
    title: 'OCR 识别结果',
    frame: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'ocr-result-window.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('ocr-result:init', {
      text: (result && result.text) || '',
      lines: (result && result.lines && result.lines.length) || 0
    });
  });
  return win;
}

/** 供渲染层查询 OCR 可用状态 */
function getOcrStatus() {
  try {
    if (!ocrService) ocrService = require('./ocr-service');
    return ocrService.status(deps);
  } catch (e) { return { available: false, reason: 'onnxruntime-node 未安装' }; }
}

// ==================== 窗口辅助 ====================

function closeScreenshotWindow() {
  // 覆盖层 closable:false，close() 无效；用 destroy() 强制关闭（兼容取消/确认/异常路径）
  if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.destroy();
  screenshotWindow = null;
}

function closeAllPasteWindows() {
  pasteWindows.forEach(w => { try { if (!w.isDestroyed()) w.close(); } catch (e) {} });
  pasteWindows = [];
}

// ==================== IPC 与初始化 ====================

function registerIpc() {
  const { ipcMain } = deps;
  ipcMain.handle('screenshot:cancel', () => { closeScreenshotWindow(); return true; });
  ipcMain.handle('screenshot:confirm', (e, payload) => handleConfirm(payload));
  ipcMain.handle('screenshot:copy-last', () => {
    if (!lastCapture) return { status: 'empty' };
    deps.clipboard.writeImage(lastCapture);
    return { status: 'copied' };
  });
  ipcMain.handle('screenshot:paste', () => pasteFromClipboard());
  ipcMain.handle('screenshot:ocr', (e, payload) => {
    // 供贴图窗口/结果弹窗对图片再识别
    if (payload && payload.dataUrl) {
      const { nativeImage } = deps;
      const img = nativeImage.createFromDataURL(payload.dataUrl);
      if (!img.isEmpty()) return runOcr(img);
    }
    return { status: 'error', message: '无图片数据' };
  });
  ipcMain.handle('screenshot:get-shortcuts', () => loadScreenshotConfig());
  ipcMain.handle('screenshot:set-shortcuts', (e, payload) => {
    const cfg = deps.loadConfig();
    if (payload && payload.screenshot) cfg.screenshotShortcut = payload.screenshot;
    if (payload && payload.paste) cfg.pasteShortcut = payload.paste;
    if (payload && typeof payload.hideMain === 'boolean') cfg.screenshotHideMain = payload.hideMain;
    if (payload && typeof payload.saveDir === 'string') cfg.screenshotSaveDir = payload.saveDir;
    deps.saveConfig(cfg);
    refreshShortcuts();
    return { status: 'ok', config: loadScreenshotConfig() };
  });
  ipcMain.handle('screenshot:ocr-status', () => getOcrStatus());
  ipcMain.handle('screenshot:open-in-editor', (e, payload) => {
    // OCR 结果跳转编辑器：复用主窗口编辑器消息（渲染层收到后 newTab 打开文本）
    if (getMainWindow() && !getMainWindow().isDestroyed()) {
      getMainWindow().webContents.send('screenshot:open-in-editor', payload || {});
      return { status: 'sent' };
    }
    return { status: 'no-main-window' };
  });
  ipcMain.on('screenshot:close-paste-windows', () => closeAllPasteWindows());

  // ── 贴图窗口交互（移动/缩放/保存） ──
  ipcMain.handle('paste:move', (e, payload) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + (payload.dx || 0)), Math.round(y + (payload.dy || 0)));
    return true;
  });
  ipcMain.handle('paste:resize', (e, payload) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (!win.__pasteBaseSize) win.__pasteBaseSize = win.getSize();
    const scale = payload.scale || 1;
    win.setSize(
      Math.max(40, Math.round(win.__pasteBaseSize[0] * scale)),
      Math.max(40, Math.round(win.__pasteBaseSize[1] * scale))
    );
    return true;
  });
  ipcMain.handle('paste:save', async (e, payload) => {
    if (!payload || !payload.dataUrl) return { status: 'error' };
    const img = deps.nativeImage.createFromDataURL(payload.dataUrl);
    if (img.isEmpty()) return { status: 'error', message: '无图片数据' };
    return saveImage(img);
  });

  // ── OCR 模型目录（工具卡片配置面板用） ──
  ipcMain.handle('screenshot:open-ocr-models-dir', () => {
    try {
      const dir = path.join(__dirname, 'ocr-models');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      deps.shell.openPath(dir);
      return { status: 'ok', dir };
    } catch (e) { return { status: 'error', message: e.message }; }
  });
}

/**
 * 初始化截图服务（main.js 在 app ready 后调用）。
 * @param {object} d { app, BrowserWindow, globalShortcut, desktopCapturer, clipboard,
 *                     nativeImage, ipcMain, screen, dialog, log, loadConfig, saveConfig,
 *                     mainWindow, showMainWindow }
 */
function initScreenshotService(d) {
  deps = d;
  registerIpc();
  registerShortcuts();
  log('initialized');
}

module.exports = {
  initScreenshotService,
  refreshShortcuts,
  unregisterShortcuts,
  startScreenshot,
  pasteFromClipboard,
  getOcrStatus,
  closeAllPasteWindows,
  _test: { setDeps: (d) => { deps = d; }, getDeps: () => deps }
};
