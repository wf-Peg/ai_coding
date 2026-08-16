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
let lastCapture = null;        // 最近一次截图 nativeImage（全屏原始图，供裁剪基准）
let lastCaptureSize = null;   // 缩略图实际像素尺寸（裁剪换算基准）
let lastSnip = null;           // 最近一次截图【选区】nativeImage（Snipaste 语义：F3/Ctrl+V 贴图缓存）
let pendingAction = null;      // 截图确认后的动作（copy/save/ocr/paste）
let ocrService = null;         // 延迟加载（依赖 onnxruntime-node）
let inFlight = false;          // 捕获进行中（覆盖层已显示但图像未就绪，可中止）
let lastCaptureDisplaySize = null; // 最近一次捕获的显示器 DIP 尺寸（裁剪换算基准）

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

/** 捕获指定显示器为 nativeImage（默认光标所在显示器） */
async function captureScreen(display) {
  const { desktopCapturer } = deps;
  const disp = display || getTargetDisplay();
  const sf = disp.scaleFactor || 1;
  const size = disp.size; // DIP {width, height}
  // 真实像素缩略图（HiDPI 不失真）：thumbnailSize 传 size×scaleFactor
  const full = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(size.width * sf), height: Math.round(size.height * sf) }
  });
  if (!full || full.length === 0) throw new Error('未找到可捕获的屏幕');
  const img = full[0].thumbnail;
  lastCapture = img;
  lastCaptureDisplaySize = size; // 记录本次捕获的显示器 DIP 尺寸（裁剪换算基准）
  const actual = img.getSize(); // 实际缩略图像素（双保险）
  lastCaptureSize = actual;
  return { image: img, display: size, actualSize: actual, scaleFactor: sf };
}

/** 目标显示器：光标所在显示器（回退主显示器），符合"截哪里"直觉 */
function getTargetDisplay() {
  try {
    const pt = deps.screen.getCursorScreenPoint();
    return deps.screen.getDisplayNearestPoint(pt) || deps.screen.getPrimaryDisplay();
  } catch (e) { return deps.screen.getPrimaryDisplay(); }
}

/** 性能打点：记录某阶段相对 t0 的耗时 */
function logPerf(stage, t0) {
  log('perf:', stage, Date.now() - t0 + 'ms');
}

/** 生成覆盖层显示数据：优先 raw 位图（toBitmap 仅内存拷贝，主线程几乎零成本），
 *  超大分辨率降级 PNG 编码（raw 传渲染层过大反而慢）。
 *  注意：Windows 上 toBitmap 为 BGRA 且截图不透明（alpha=255，premultiply 无影响），
 *  渲染层负责交换 R/B 为 RGBA。最终裁剪/复制/保存仍用 lastCapture 原生图，画质不受影响。 */
function encodeForDisplay(image) {
  try {
    const size = image.getSize();
    const raw = image.toBitmap();
    const MAX_RAW = 24 * 1024 * 1024; // ≈600 万像素（4K@100% 8.3MP 会走 PNG）
    if (raw && raw.length > 0 && raw.length <= MAX_RAW) {
      return { mode: 'raw', bitmap: raw, width: size.width, height: size.height, mime: 'image/png' };
    }
  } catch (e) { log('toBitmap failed, fallback PNG:', e.message); }
  return { mode: 'png', bg: image.toPNG(), mime: 'image/png' };
}

/** 启动截图：立即显示预建覆盖层（即时反馈）→ 隐藏抓屏（避免入镜）→ 回填图像 */
async function startScreenshot(defaultAction) {
  if (!deps) return;
  if (inFlight) return; // 捕获进行中，忽略连按
  if (screenshotWindow && !screenshotWindow.isDestroyed() && screenshotWindow.isVisible()) return; // 覆盖层已显示，防重入
  pendingAction = defaultAction || 'copy';
  const t0 = Date.now();
  try {
    const cfg = loadScreenshotConfig();
    if (cfg.hideMain && getMainWindow() && !getMainWindow().isDestroyed()) {
      getMainWindow().minimize(); // 截图时收起主窗口（可配置）
    }
    const display = getTargetDisplay();
    const win = getOrCreateOverlayWindow(display);
    // 1) 立即显示：深色底 + “正在截取屏幕…”（按键即有感知反馈）
    win.show();
    try { win.focus(); } catch (e) {}
    win.webContents.send('screenshot:loading', {});
    // 2) 隐藏覆盖层抓屏（否则覆盖层会出现在截图里），抓完回填
    win.hide();
    inFlight = true;
    const shot = await captureScreen(display);
    logPerf('capture', t0);
    const disp = encodeForDisplay(shot.image);
    logPerf('encode', t0);
    if (!inFlight) return; // 捕获期间被 Esc 取消
    win.show();
    try { win.focus(); } catch (e) {}
    // 3) raw 位图直传（主线程零编码阻塞），渲染层快速转换显示
    win.webContents.send('screenshot:init', Object.assign({}, disp, { display: shot.display, t0 }));
    logPerf('send', t0);
  } catch (e) {
    log('startScreenshot failed:', e.message);
    inFlight = false;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) { try { screenshotWindow.hide(); } catch (e2) {} }
    if (deps.showMainWindow) deps.showMainWindow();
  }
}

/** 获取/预建全屏覆盖层窗口（复用，避免每次新建窗口+loadFile 的延迟） */
function getOrCreateOverlayWindow(display) {
  const { BrowserWindow } = deps;
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    // 复用：显示器可能变化，按目标显示器调整位置/尺寸
    try { screenshotWindow.setBounds(display.bounds || display.workArea); } catch (e) {}
    return screenshotWindow;
  }
  const disp = display || getTargetDisplay();
  const win = new BrowserWindow({
    x: 0, y: 0,
    width: disp.size.width,
    height: disp.size.height,
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
    show: false, // 预建隐藏，F1 时即时显示
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });
  screenshotWindow = win;
  win.loadFile(path.join(__dirname, 'screenshot-window.html'));
  // 覆盖层渲染层报错落日志（可观测性，与贴图窗口一致）
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) log('overlay console[' + level + ']:', String(message).slice(0, 200));
  });
  win.on('closed', () => { screenshotWindow = null; });
  // 确保覆盖层获得焦点（Esc/Enter/Ctrl+S 等快捷键依赖焦点）
  win.on('show', () => { try { win.focus(); } catch (e) {} });
  return win;
}

// ==================== 动作分发 ====================

/**
 * 截图确认：渲染层发送选区 rect（CSS 像素），主进程裁剪并分发动作。
 * @param {object} payload { rect: {x,y,width,height}, action: 'copy'|'save'|'ocr'|'paste' }
 */
async function handleConfirm(payload) {
  const { clipboard, nativeImage } = deps;
  const rect = payload && payload.rect;
  const action = (payload && payload.action) || pendingAction || 'copy';
  if (!rect || !lastCapture) {
    closeScreenshotWindow();
    if (deps.showMainWindow) deps.showMainWindow();
    return;
  }
  // crop 基于缩略图实际像素：CSS/DIP 坐标 × (实际像素 / DIP 尺寸)
  const actual = lastCaptureSize || lastCapture.getSize();
  const displaySize = lastCaptureDisplaySize || deps.screen.getPrimaryDisplay().size;
  const sx = actual.width / Math.max(1, displaySize.width);
  const sy = actual.height / Math.max(1, displaySize.height);
  const cropRect = {
    x: Math.round(rect.x * sx),
    y: Math.round(rect.y * sy),
    width: Math.max(1, Math.round(rect.width * sx)),
    height: Math.max(1, Math.round(rect.height * sy))
  };
  let cropped;
  if (payload.imgData) {
    // 覆盖层已合成「背景选区 + 标注」，直接解码为图，避免重复裁剪
    try { cropped = nativeImage.createFromDataURL(payload.imgData); }
    catch (err) { try { cropped = lastCapture.crop(cropRect); } catch (e) { cropped = lastCapture; } }
  } else {
    try { cropped = lastCapture.crop(cropRect); } catch (e) { cropped = lastCapture; }
  }
  // 统一把选区写入贴图缓存（Snipaste 语义）：无论本次动作是复制/保存/OCR/贴图，
  // 之后 F3 / Ctrl+V 都贴【选区】而非全屏，直到下一次截图覆盖。
  lastSnip = cropped;
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
      notifyMainWindow('✅ 已复制到剪贴板', 'info', 2500); // 确认动作有可见反馈
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
  notifyMainWindow('💾 已保存：' + path.basename(result.filePath), 'info', 3000);
  return { status: 'saved', path: result.filePath };
}

/** 贴图（Snipaste 语义）：剪贴板内容优先（图片→文本）→ 最近截图选区 → 最近全屏（极端兜底） */
function pasteFromClipboard() {
  const { clipboard } = deps;
  const fmts = clipboard.availableFormats();
  const hasImg = Array.isArray(fmts) && fmts.some(f => f.startsWith('image/'));
  const hasTxt = Array.isArray(fmts) && fmts.some(f => f === 'text/plain' || f === 'text/html' || f.startsWith('text/'));
  if (hasImg) {
    let img = null;
    try { img = clipboard.readImage(); } catch (e) {}
    if (img && !img.isEmpty()) return showPasteWindow(img);
  }
  if (hasTxt) {
    let t = '';
    try { t = clipboard.readText(); } catch (e) {}
    if (t && t.trim()) return showPasteWindow(null, t); // 文本贴图
  }
  if (lastSnip) return showPasteWindow(lastSnip);
  if (lastCapture) return showPasteWindow(lastCapture);
  log('no image to paste');
  return { status: 'empty' };
}

// ==================== 贴图窗口 ====================

let pasteWindows = [];

/** 创建置顶贴图窗口（可拖动，双击/右键关闭）。image 与 text 二选一：image 为原生图，text 为文本贴图。 */
function showPasteWindow(image, text) {
  const { BrowserWindow } = deps;
  let iw, ih, w, h;
  if (image) {
    // 注意：nativeImage.getSize() 返回 {width,height} 对象，不能数组解构（v1.2 曾因此回归导致贴图失效）
    const size = image.getSize();
    iw = size.width; ih = size.height;
    // 等比适配（Snipaste 手感）：最长边限制 900/700，只缩小不放大，保持原图比例
    const maxW = 900, maxH = 700;
    const fit = Math.min(1, maxW / Math.max(1, iw), maxH / Math.max(1, ih));
    w = Math.max(1, Math.round(iw * fit));
    h = Math.max(1, Math.round(ih * fit));
  } else {
    // 文本贴图：初始占位尺寸，渲染层排版后经 paste:text-ready 精确 resize
    w = 480; h = 320;
  }
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: 100 + pasteWindows.length * 30,
    y: 100 + pasteWindows.length * 30,
    frame: false,
    transparent: false,          // 默认不透明（规避 Windows 透明窗口渲染不可靠）；透明度经 setOpacity 独立控制
    backgroundColor: image ? '#000000' : '#ffffff',
    resizable: false,            // 尺寸由程序控制（滚轮缩放/双击），避免用户拖边变形
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,          // 关 DWM 阴影：快速拖动时阴影重绘是 Windows 卡顿源；贴图自带 #frame 描边
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.__isText = !image;
  win.__pasteBaseSize = [w, h]; // 缩放基准（等比适配后的初始尺寸）
  win.__lockedSize = [w, h];    // 当前锁定尺寸：move-to 每次按此钉住，杜绝系统微调累积
  // 诊断：捕捉一切非 zoom-at 引起的窗口尺寸变化（DPI 切换/系统干预），
  // 若日志出现 "external resize" 即为 OS 层缩放，需另行处理。
  win.__lastSize = [w, h];
  win.on('resize', () => {
    try {
      const [cw, ch] = win.getSize();
      const [pw, ph] = win.__lastSize || [0, 0];
      if (cw !== pw || ch !== ph) {
        win.__lastSize = [cw, ch];
        const sinceZoom = win.__lastZoomAt ? Date.now() - win.__lastZoomAt : -1;
        const sinceTextReady = win.__lastTextReadyAt ? Date.now() - win.__lastTextReadyAt : -1;
        if ((sinceZoom < 0 || sinceZoom > 300) && (sinceTextReady < 0 || sinceTextReady > 300)) {
          log('paste external resize:', pw + 'x' + ph, '->', cw + 'x' + ch,
            '(zoomAt=' + (sinceZoom < 0 ? 'never' : sinceZoom + 'ms ago') +
            ', textAt=' + (sinceTextReady < 0 ? 'never' : sinceTextReady + 'ms ago') + ')');
        }
      }
    } catch (err) {}
  });
  // 文本模式：渲染层排版完成后回传应占尺寸（CSS/DIP），主进程按此 resize
  win.webContents.on('paste:text-ready', (e, { cssW, cssH }) => {
    const cw = Math.max(40, Math.round(cssW));
    const chh = Math.max(40, Math.round(cssH));
    win.__pasteBaseSize = [cw, chh];
    win.__lockedSize = [cw, chh];
    win.__lastSize = [cw, chh];
    win.__lastTextReadyAt = Date.now();
    try { win.setSize(cw, chh); } catch (err) {}
    log('paste text resized to', cw + 'x' + chh);
  });
  // 不设 setAspectRatio：resizable:false 的窗口尺寸完全由 paste:zoom-at 的 setBounds 控制，
  // 比例锁会与 setBounds 冲突导致宽高被系统微调、渲染层 scale 与实际尺寸漂移。
  pasteWindows.push(win);
  win.loadFile(path.join(__dirname, 'paste-window.html'));
  win.webContents.on('did-finish-load', () => {
    if (text) {
      win.webContents.send('paste:init', { text: text });
      log('paste:init sent (text), chars=' + text.length);
    } else {
      // PNG Buffer 直传（不再 base64 dataURL）
      win.webContents.send('paste:init', { buf: image.toPNG(), mime: 'image/png', w: iw, h: ih });
      log('paste:init sent', iw + 'x' + ih, '->', w + 'x' + h);
    }
  });
  // 渲染层报错不再静默：console error / 图片解码失败都会落日志
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) log('paste-window console[' + level + ']:', String(message).slice(0, 200));
  });
  win.on('closed', () => {
    const i = pasteWindows.indexOf(win);
    if (i >= 0) pasteWindows.splice(i, 1);
  });
  log('paste window created:', w + 'x' + h, 'src', iw + 'x' + ih, 'total', pasteWindows.length);
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
      notifyMainWindow('🔤 OCR 未就绪：' + (st.reason || '组件未就绪') + '（可前往 工具→截图工具 一键安装）', 'warn', 6000);
      return { status: 'unavailable', message: st.reason || 'OCR 组件未就绪' };
    }
    showOcrResult(result);
    return { status: 'ok', text: result.text, lines: result.lines };
  } catch (e) {
    log('OCR failed:', e.message);
    notifyMainWindow('🔤 OCR 识别失败：' + e.message, 'error', 6000);
    return { status: 'error', message: e.message };
  }
}

/** 向主窗口发送用户可见提示（OCR 等后台动作反馈） */
function notifyMainWindow(message, type, ms) {
  try {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('screenshot:notify', { message, type: type || 'info', ms: ms || 4000 });
    }
  } catch (e) {}
}

/** 展示 OCR 结果窗口（文本 + 复制 + 跳转编辑器）——无系统标题栏，自定义外观见 ocr-result-window.html */
function showOcrResult(result) {
  const { BrowserWindow } = deps;
  const win = new BrowserWindow({
    width: 580,
    height: 440,
    title: 'OCR 识别结果',
    frame: false,            // 去系统标题栏：由页面内自定义标题栏（可拖拽）接管
    resizable: true,
    minimizable: false,
    maximizable: false,
    hasShadow: true,
    backgroundColor: '#17181c',
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
  inFlight = false;
  // 覆盖层复用：隐藏而非销毁；异常损坏时销毁由下次 F1 重建
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    try { screenshotWindow.hide(); } catch (e) { try { screenshotWindow.destroy(); } catch (e2) {} }
  }
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
    const src = lastSnip || lastCapture; // 与贴图语义一致：复制最近选区（无选区才全屏）
    if (!src) return { status: 'empty' };
    deps.clipboard.writeImage(src);
    return { status: 'copied' };
  });
  ipcMain.handle('screenshot:paste', () => pasteFromClipboard());
  ipcMain.handle('screenshot:ocr', (e, payload) => {
    // 供贴图窗口/结果弹窗对图片再识别（兼容 Buffer 与 dataURL）
    if (payload) {
      const { nativeImage } = deps;
      let img = null;
      if (payload.buf) {
        img = nativeImage.createFromBuffer(Buffer.isBuffer(payload.buf) ? payload.buf : Buffer.from(payload.buf));
      } else if (payload.dataUrl) {
        img = nativeImage.createFromDataURL(payload.dataUrl);
      }
      if (img && !img.isEmpty()) return runOcr(img);
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

  // ── 渲染反馈（性能/错误可观测，贴图"失效"不再静默） ──
  ipcMain.on('screenshot:painted', (e, payload) => {
    if (payload && payload.delta != null) log('perf: painted', payload.delta + 'ms');
  });
  ipcMain.on('paste:rendered', (e, payload) => {
    log('paste:rendered ok', (payload && payload.delta != null) ? payload.delta + 'ms' : '');
  });
  ipcMain.on('paste:render-error', (e, payload) => {
    log('paste:render-error:', (payload && payload.message) || 'unknown');
  });

  // ── 贴图窗口交互（移动/缩放/保存） ──
  // 绝对坐标拖动：渲染层用 window.screenX/Y 同步取起点，按绝对目标 setBounds（同时钉住尺寸），
  // 无 IPC 竞态（增量式 getPosition+setPosition 在 60fps 下会丢步抖动）。
  ipcMain.handle('paste:move-to', (e, payload) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
      // 不用 setPosition：Windows 上对 frameless + resizable:false 窗口，纯移动调用会让
      // 系统反复微调窗口尺寸（实测拖动中每帧 +1~2px 累积变大，external resize 日志已实锤）。
      // 改为 setBounds 每次显式钉住宽高：任何来源的尺寸漂移都在下一帧被纠正，
      // 从机制上杜绝「拖动渐渐变大」。
      if (!win.__lockedSize) win.__lockedSize = win.getSize();
      win.setBounds({ x: payload.x, y: payload.y, width: win.__lockedSize[0], height: win.__lockedSize[1] });
      win.__lastMoveAt = Date.now(); // 供 paste:zoom-at 判断"是否正在拖动"
      return true;
    }
    return false;
  });
  // 窗口级真实透明度（Ctrl+滚轮，Snipaste 手感）。用 BrowserWindow.setOpacity 而非
  // 渲染层 element.opacity——后者只是把内容变淡并透出黑色底（看起来像"变亮度"），
  // setOpacity 让整个窗口半透明，能真正透出底下内容。
  ipcMain.handle('paste:set-opacity', (e, value) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    try {
      win.setOpacity(Math.max(0.15, Math.min(1, Number(value) || 1)));
    } catch (err) { return false; }
    return true;
  });
  // 贴图置顶开关（右键菜单切换）：alwaysOnTop false 时贴图落入普通层级，可被其他窗口覆盖
  ipcMain.handle('paste:set-top', (e, pinned) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    try { win.setAlwaysOnTop(Boolean(pinned), 'screen-saver'); } catch (err) { return false; }
    return true;
  });
  // 光标锚定缩放：同时调整大小与位置，保持光标下的图像点不动（Snipaste 手感）
  ipcMain.handle('paste:zoom-at', (e, payload) => {
    const win = deps.BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    // 主进程兜底：若 500ms 内刚发生过 move-to（正在拖动或松手惯性期），忽略此次缩放，
    // 防止渲染层 moving 状态异常时拖动中误触发缩放导致图片"渐渐变大"。
    if (win.__lastMoveAt && Date.now() - win.__lastMoveAt < 500) {
      log('paste zoom blocked: within 500ms of move-to');
      return false;
    }
    if (!win.__pasteBaseSize) win.__pasteBaseSize = win.getSize();
    const next = Math.max(0.1, Math.min(4, payload.scale || 1));
    const prev = Math.max(0.01, payload.prevScale || 1);
    const r = next / prev;
    const [wx, wy] = win.getPosition();
    const base = win.__pasteBaseSize;
    win.__lastZoomAt = Date.now(); // 供 resize 诊断区分「zoom 引起」与「外部引起」
    // 新位置 = 原位置 + 锚点位移 × (1 - 缩放比)，使光标下的图像点保持不动
    const nx = Math.round(wx + (payload.anchorX || 0) * (1 - r));
    const ny = Math.round(wy + (payload.anchorY || 0) * (1 - r));
    const nw = Math.max(40, Math.round(base[0] * next));
    const nh = Math.max(40, Math.round(base[1] * next));
    win.__lockedSize = [nw, nh]; // 缩放后的新尺寸成为锁定值，后续 move-to 按此钉住
    win.setBounds({ x: nx, y: ny, width: nw, height: nh });
    return true;
  });
  ipcMain.handle('paste:save', async (e, payload) => {
    if (!payload) return { status: 'error' };
    let img = null;
    if (payload.buf) {
      img = deps.nativeImage.createFromBuffer(Buffer.isBuffer(payload.buf) ? payload.buf : Buffer.from(payload.buf));
    } else if (payload.dataUrl) {
      img = deps.nativeImage.createFromDataURL(payload.dataUrl);
    }
    if (!img || img.isEmpty()) return { status: 'error', message: '无图片数据' };
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
  // 预建截图覆盖层（隐藏），F1 按下即时显示，省去每次新建窗口+加载页面的延迟
  try { getOrCreateOverlayWindow(getTargetDisplay()); } catch (e) { log('overlay prewarm failed:', e.message); }
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
