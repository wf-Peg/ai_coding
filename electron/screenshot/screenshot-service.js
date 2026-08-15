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
const { spawn } = require('child_process');

/** 全局实例与依赖（initScreenshotService 注入） */
let deps = null;
let shortcuts = { screenshot: 'F1', paste: 'F2' };
let screenshotWindow = null;   // 当前截图覆盖层
let pasteWindow = null;        // 当前贴图窗口
let lastCapture = null;        // 最近一次截图 nativeImage（供贴图兜底）
let lastCaptureSize = null;   // 缩略图实际像素尺寸（裁剪换算基准）
let pendingAction = null;      // 截图确认后的动作（copy/save/ocr/paste）
let ocrService = null;         // 延迟加载（依赖 onnxruntime-node）

function log(...args) {
  if (!deps || !deps.log) return;
  try {
    if (typeof deps.log.info === 'function') deps.log.info('[Screenshot]', ...args);
    else if (typeof deps.log === 'function') deps.log('[Screenshot]', ...args);
  } catch (e) {}
}

/** 动态获取主窗口（兼容 getMainWindow 函数与静态属性） */
function getMainWindow() {
  if (deps && typeof deps.getMainWindow === 'function') return deps.getMainWindow();
  return deps ? deps.mainWindow : null;
}

/** OCR 模型目录（优先级：打包内置 resources/ocr-models → userData 下载 → 源码 __dirname/ocr-models）
 *  开箱即用：模型随应用分发（electron-builder extraResources），用户零安装。
 */
function getModelsDir() {
  try {
    if (typeof process.resourcesPath === 'string') {
      const builtin = path.join(process.resourcesPath, 'ocr-models');
      if (fs.existsSync(builtin)) return builtin;
    }
  } catch (e) {}
  try {
    if (deps && deps.app && typeof deps.app.getPath === 'function') {
      const ud = deps.app.getPath('userData');
      if (ud) return path.join(ud, 'ocr-models');
    }
  } catch (e) {}
  return path.join(__dirname, 'ocr-models');
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
  const display = deps.screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const size = display.size; // DIP {width, height}
  // 真实像素缩略图（HiDPI 不失真）：thumbnailSize 传 size×scaleFactor
  const full = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(size.width * sf), height: Math.round(size.height * sf) }
  });
  if (!full || full.length === 0) throw new Error('未找到可捕获的屏幕');
  const img = full[0].thumbnail;
  lastCapture = img;
  const actual = img.getSize(); // 实际缩略图像素（双保险）
  lastCaptureSize = actual;
  return { image: img, display: size, actualSize: actual, scaleFactor: sf };
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
  // crop 基于缩略图实际像素：CSS/DIP 坐标 × (实际像素 / DIP 尺寸)
  const actual = lastCaptureSize || lastCapture.getSize();
  const displaySize = deps.screen.getPrimaryDisplay().size;
  const sx = actual.width / Math.max(1, displaySize.width);
  const sy = actual.height / Math.max(1, displaySize.height);
  const cropRect = {
    x: Math.round(rect.x * sx),
    y: Math.round(rect.y * sy),
    width: Math.max(1, Math.round(rect.width * sx)),
    height: Math.max(1, Math.round(rect.height * sy))
  };
  let cropped;
  try { cropped = lastCapture.crop(cropRect); } catch (e) { cropped = lastCapture; }
  closeScreenshotWindow();

  switch (action) {
    case 'save':
      if (deps.showMainWindow) deps.showMainWindow();
      return saveImage(cropped);
    case 'ocr':
      if (deps.showMainWindow) deps.showMainWindow();
      return runOcr(cropped);
    case 'paste':
      // 贴图：直接贴出，不恢复主窗口（与 Snipaste 一致，避免"弹出软件窗口"）
      return showPasteWindow(cropped);
    case 'copy':
    default:
      if (deps.showMainWindow) deps.showMainWindow();
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
  const [iw, ih] = image.getSize();
  // 等比适配（Snipaste 手感）：最长边限制 900/700，只缩小不放大，保持原图比例
  const maxW = 900, maxH = 700;
  const fit = Math.min(1, maxW / Math.max(1, iw), maxH / Math.max(1, ih));
  const w = Math.max(1, Math.round(iw * fit));
  const h = Math.max(1, Math.round(ih * fit));
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: 100 + pasteWindows.length * 30,
    y: 100 + pasteWindows.length * 30,
    frame: false,
    transparent: true,
    resizable: false,          // 尺寸由程序控制（滚轮缩放/双击），避免用户拖边变形
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.__pasteBaseSize = [w, h]; // 缩放基准（等比适配后的初始尺寸）
  try { win.setAspectRatio(iw / ih); } catch (e) {}
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
      try { ocrService.setModelsDir(getModelsDir()); } catch (e) {}
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
    if (!ocrService) { ocrService = require('./ocr-service'); }
    try { ocrService.setModelsDir(getModelsDir()); } catch (e) {}
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

/** 执行外部命令并等待退出；失败时携带输出摘要便于诊断 */
function spawnAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', errOut = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { errOut += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else {
        const detail = (errOut || out || '').replace(/\s+/g, ' ').slice(-300);
        reject(new Error(cmd + ' 退出码 ' + code + (detail ? '：' + detail : '')));
      }
    });
  });
}

/** 内联 PowerShell 下载模型（EncodedCommand，避免打包 asar 内脚本路径不可执行） */
function downloadModelsInline(modelsDir) {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$dir = '" + modelsDir + "'",
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    "$jobs = @(",
    "  @{ n = 'ch_PP-OCRv4_det_infer.onnx'; urls = @('https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0/det.onnx', 'https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main/models/text_det/ch_PP-OCRv4_det_infer.onnx', 'https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/main/models/text_det/ch_PP-OCRv4_det_infer.onnx') },",
    "  @{ n = 'ch_PP-OCRv4_rec_infer.onnx'; urls = @('https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0/rec.onnx', 'https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main/models/text_rec/ch_PP-OCRv4_rec_infer.onnx', 'https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/main/models/text_rec/ch_PP-OCRv4_rec_infer.onnx') },",
    "  @{ n = 'ch_PP-OCRv4_cls_infer.onnx'; urls = @('https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0/cls.onnx', 'https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main/models/text_cls/ch_PP-OCRv4_cls_infer.onnx', 'https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/main/models/text_cls/ch_PP-OCRv4_cls_infer.onnx') },",
    "  @{ n = 'ppocr_keys_v1.txt'; urls = @('https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0/ppocr_keys_v1.txt', 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt', 'https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main/models/ppocr_keys_v1.txt') }",
    ")",
    "foreach ($job in $jobs) {",
    "  $t = Join-Path $dir $job.n",
    "  if (Test-Path $t) { Write-Output ('[OK] 已存在 ' + $job.n); continue }",
    "  $ok = $false",
    "  foreach ($u in $job.urls) {",
    "    try { Invoke-WebRequest -Uri $u -OutFile $t -UseBasicParsing -TimeoutSec 60; $ok = $true; Write-Output ('[OK] ' + $job.n); break }",
    "    catch { Write-Output ('  [skip] ' + $job.n + ' <- ' + $_.Exception.Message) }",
    "  }",
    "  if (-not $ok) { Write-Output ('[FAIL] ' + $job.n + ' 所有下载源均失败') }",
    "}",
    "Write-Output ('DONE: ' + $dir)"
  ].join('\n');
  // EncodedCommand: UTF-16LE Base64，规避引号/编码/路径问题
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  return spawnAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
}

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

  // ── OCR 一键安装 / 复制文本（工具卡片配置面板用） ──
  ipcMain.handle('screenshot:copy-text', (e, payload) => {
    deps.clipboard.writeText((payload && payload.text) || '');
    return { status: 'ok' };
  });
  ipcMain.handle('screenshot:install-ocr', async () => {
    // 1) onnxruntime-node 检测
    let ortInstalled = false;
    try { require.resolve('onnxruntime-node'); ortInstalled = true; } catch (e) {}
    // 2) 模型文件检测（userData/ocr-models，打包兼容）
    const modelsDir = getModelsDir();
    const required = ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ch_PP-OCRv4_cls_infer.onnx', 'ppocr_keys_v1.txt'];
    const needModel = !required.every(f => fs.existsSync(path.join(modelsDir, f)));
    // 3) 下载模型：内联 PowerShell（EncodedCommand，避免打包后 asar 内脚本不可执行）
    if (needModel) {
      try {
        await downloadModelsInline(modelsDir);
      } catch (e) {
        return { status: 'error', message: '模型下载失败: ' + e.message };
      }
    }
    const modelOk = required.every(f => fs.existsSync(path.join(modelsDir, f)));
    if (!ortInstalled) {
      return {
        status: 'need-npm',
        message: 'OCR 模型已就绪，但需要安装推理引擎：在项目目录执行 npm i onnxruntime-node && npx electron-builder install-app-deps，然后重启应用'
      };
    }
    return { status: 'done', message: modelOk ? '✅ OCR 组件已就绪，重启应用生效' : '模型下载未完成，请检查网络后重试' };
  });

  // ── OCR 模型目录（工具卡片配置面板用） ──
  ipcMain.handle('screenshot:open-ocr-models-dir', async () => {
    try {
      const dir = getModelsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const err = await deps.shell.openPath(dir); // 返回空字符串=成功，否则为错误信息
      if (err) return { status: 'error', message: err };
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
  // 首次启动引导：延迟检测 OCR 组件（模型/onnxruntime 缺失时通知主窗口一次）
  try {
    setTimeout(checkOcrSetupNotice, 6000);
  } catch (e) {}
  log('initialized');
}

/** 检测 OCR 组件状态，模型/引擎缺失时向主窗口发送引导通知（每次启动一次） */
function checkOcrSetupNotice() {
  try {
    const st = getOcrStatus();
    if (st.available) return;
    const mw = getMainWindow();
    if (!mw || mw.isDestroyed()) return;
    mw.webContents.send('screenshot:ocr-needs-setup', {
      reason: st.reason || 'OCR 组件未就绪',
      modelsDir: getModelsDir()
    });
  } catch (e) { log('ocr setup check failed:', e.message); }
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
