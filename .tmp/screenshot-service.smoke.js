/**
 * screenshot-service 冒烟测试（纯 mock，不启动真实应用/不注册全局快捷键）
 * 验证：快捷键注册 → 覆盖层预建 → F1 即时反馈+抓屏回填(Buffer) → 裁剪 → 贴图(不透明+Buffer) → 取消
 */
const path = require('path');
const service = require(path.join(__dirname, '..', 'electron', 'screenshot', 'screenshot-service.js'));

// ── 记录器 ──
const events = { windows: [], sends: [], handlers: {}, ons: {}, shortcuts: [], writes: [], logLines: [] };
const push = (arr, x) => arr.push(x);

// ── 假 nativeImage ──
function makeImage(w, h) {
  return {
    getSize: () => ({ width: w, height: h }),
    toPNG: () => Buffer.from(`PNG-${w}x${h}`),
    toDataURL: () => `data:image/png;base64,FAKE${w}x${h}`,
    toBitmap: () => Buffer.alloc(w * h * 4, 128), // 模拟 Windows BGRA raw（不透明）
    crop: () => makeImage(Math.round(w / 2), Math.round(h / 2)),
    isEmpty: () => false
  };
}
const EMPTY_IMAGE = { isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) };

// ── 假 BrowserWindow ──
class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.destroyed = false;
    this.visible = opts.show === true;
    this.listeners = {};
    FakeBrowserWindow._last = this;
    this.webContents = {
      on: (ev, cb) => { this.wcOn = this.wcOn || {}; this.wcOn[ev] = cb; },
      send: (channel, payload) => push(events.sends, { channel, payload, win: this })
    };
    events.windows.push(this);
  }
  loadFile(url) { this.loadedUrl = url; }
  show() { this.visible = true; if (this.listeners['show']) this.listeners['show'](); }
  hide() { this.visible = false; }
  focus() {}
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
  close() { this.destroyed = true; this.visible = false; }
  setBounds(b) { this.pos = [b.x, b.y]; this.size = [b.width, b.height]; this.lastBounds = b; }
  setPosition(x, y) { this.pos = [x, y]; }
  getPosition() { return this.pos || [this.opts.x || 0, this.opts.y || 0]; }
  setSize(w, h) { this.size = [w, h]; }
  getSize() { return this.size || [this.opts.width, this.opts.height]; }
  setAspectRatio() {}
  on(ev, cb) { this.listeners[ev] = cb; }
  static fromWebContents() { return FakeBrowserWindow._last || null; }
}
FakeBrowserWindow._last = null;

// ── 假 deps ──
const deps = {
  app: { getPath: () => 'userData' },
  BrowserWindow: FakeBrowserWindow,
  globalShortcut: {
    register: (acc, cb) => { push(events.shortcuts, acc); return true; },
    unregister: () => {},
    unregisterAll: () => {}
  },
  desktopCapturer: {
    getSources: async (opts) => {
      events.captureOpts = opts;
      return [{ thumbnail: makeImage(2880, 1620) }]; // 1920×1080 @1.5x
    }
  },
  clipboard: {
    readImage: () => makeImage(800, 500),
    writeImage: (img) => push(events.writes, img),
    writeText: () => {}
  },
  nativeImage: {
    createFromBuffer: (buf) => makeImage(100, 100),
    createFromDataURL: () => makeImage(100, 100)
  },
  ipcMain: {
    handle: (ch, fn) => { events.handlers[ch] = fn; },
    on: (ch, fn) => { events.ons[ch] = fn; }
  },
  mainSends: [],
  screen: {
    getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 }, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getDisplayNearestPoint: () => ({ size: { width: 1920, height: 1080 }, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
  },
  dialog: { showSaveDialog: async () => ({ canceled: true }) },
  shell: { openPath: async () => '' },
  loadConfig: () => ({ screenshotShortcut: 'F1', pasteShortcut: 'F3', screenshotHideMain: true, screenshotSaveDir: '' }),
  saveConfig: () => {},
  getMainWindow: () => ({ isDestroyed: () => false, minimize: () => {}, webContents: { send: (ch, payload) => push(deps.mainSends, { ch, payload }) } }),
  showMainWindow: () => {},
  log: { info: (...a) => push(events.logLines, a.join(' ')), warn: (...a) => push(events.logLines, '[warn] ' + a.join(' ')), error: (...a) => push(events.logLines, '[error] ' + a.join(' ')) }
};

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✅', name); }
  else { failed++; console.log('  ❌', name, detail || ''); }
}

(async () => {
  console.log('== 1. 初始化（快捷键注册 + 覆盖层预建）==');
  service._test.setDeps(deps);
  service.initScreenshotService(deps);
  check('F1/F3 已注册', JSON.stringify(events.shortcuts) === JSON.stringify(['F1', 'F3']), events.shortcuts);
  const overlay = events.windows.find(w => w.loadedUrl && w.loadedUrl.includes('screenshot-window'));
  check('覆盖层已预建', !!overlay, 'windows=' + events.windows.length);
  check('覆盖层初始隐藏(show:false)', overlay && overlay.opts.show === false);
  check('覆盖层不透明', overlay && overlay.opts.transparent === false);

  console.log('== 2. F1 截图：即时反馈 → 抓屏回填(raw 位图) ==');
  const sendsBefore = events.sends.length;
  await service.startScreenshot('copy');
  const sends = events.sends.slice(sendsBefore);
  const loading = sends.find(s => s.channel === 'screenshot:loading');
  const init = sends.find(s => s.channel === 'screenshot:init');
  check('先发 loading（即时反馈）', !!loading, sends.map(s => s.channel).join(','));
  check('后发 init（回填）', !!init);
  check('init 走 raw 模式（无主线程编码阻塞）', init && init.payload.mode === 'raw', JSON.stringify(init && init.payload && { mode: init.payload.mode }));
  check('raw 位图带物理尺寸(×1.5)', init && init.payload.width === 2880 && init.payload.height === 1620, JSON.stringify(init && { w: init.payload.width, h: init.payload.height }));
  check('init 带捕获显示器尺寸', init && init.payload.display && init.payload.display.width === 1920, JSON.stringify(init && init.payload.display));
  check('抓屏 thumbnailSize 为真实像素(×1.5)', events.captureOpts && events.captureOpts.thumbnailSize.width === 2880, JSON.stringify(events.captureOpts && events.captureOpts.thumbnailSize));

  console.log('== 3. 确认选区 → 贴图（不透明窗口 + Buffer） ==');
  const winCountBefore = events.windows.length;
  await events.handlers['screenshot:confirm']({}, { rect: { x: 10, y: 10, width: 800, height: 500 }, action: 'paste' });
  const pasteWins = events.windows.slice(winCountBefore);
  check('贴图窗口已创建', pasteWins.length === 1, 'created=' + pasteWins.length);
  const pw = pasteWins[0];
  check('贴图窗口不透明(transparent:false)', pw && pw.opts.transparent === false);
  check('贴图窗口无 DWM 阴影(hasShadow:false)', pw && pw.opts.hasShadow === false);
  check('贴图窗口置顶+跳过任务栏', pw && pw.opts.alwaysOnTop === true && pw.opts.skipTaskbar === true);
  check('贴图窗口等比适配(最长边≤900)', pw && pw.opts.width <= 900 && pw.opts.height <= 700, JSON.stringify(pw && { w: pw.opts.width, h: pw.opts.height }));
  const pasteInit = events.sends.find(s => s.channel === 'paste:init');
  if (!pasteInit && pw && pw.wcOn && pw.wcOn['did-finish-load']) {
    pw.wcOn['did-finish-load'](); // 模拟真实 Electron 的页面加载完成事件
  }
  const pasteInit2 = events.sends.find(s => s.channel === 'paste:init');
  check('paste:init 传 Buffer', pasteInit2 && Buffer.isBuffer(pasteInit2.payload.buf), typeof (pasteInit2 && pasteInit2.payload.buf));
  check('paste:init 带原图尺寸', pasteInit2 && pasteInit2.payload.w && pasteInit2.payload.h, JSON.stringify(pasteInit2 && pasteInit2.payload));

  console.log('== 3.5 确认复制 → 用户可见反馈通知 ==');
  const sendBefore = deps.mainSends.length;
  await events.handlers['screenshot:confirm']({}, { rect: { x: 10, y: 10, width: 100, height: 100 }, action: 'copy' });
  const notify = deps.mainSends.slice(sendBefore).find(s => s.ch === 'screenshot:notify');
  check('复制后向主窗口发送通知反馈', !!notify && /已复制/.test(notify.payload.message), JSON.stringify(deps.mainSends.slice(sendBefore)));
  check('复制动作写入剪贴板', events.writes.length >= 1);

  console.log('== 4. F3 贴图（剪贴板有图）==');
  const wc2 = events.windows.length;
  await events.handlers['screenshot:paste']();
  check('剪贴板图片贴图成功', events.windows.length === wc2 + 1, 'windows=' + events.windows.length);

  console.log('== 5. 取消（Esc）==');
  const overlay2 = events.windows.find(w => w.loadedUrl && w.loadedUrl.includes('screenshot-window'));
  await events.handlers['screenshot:cancel']();
  check('取消后覆盖层隐藏(可复用)', overlay2 && overlay2.visible === false && overlay2.destroyed === false);

  console.log('== 6. 渲染反馈通道已注册 ==');
  check('screenshot:painted 监听', typeof events.ons['screenshot:painted'] === 'function');
  check('paste:rendered 监听', typeof events.ons['paste:rendered'] === 'function');
  check('paste:render-error 监听', typeof events.ons['paste:render-error'] === 'function');

  console.log('== 6.5 贴图拖动/缩放（绝对坐标 IPC）==');
  const lastPw = events.windows[events.windows.length - 1];
  const moved = await events.handlers['paste:move-to']({}, { x: 500, y: 300 });
  check('paste:move-to 设置绝对位置', moved === true && lastPw.pos && lastPw.pos[0] === 500 && lastPw.pos[1] === 300, JSON.stringify(lastPw.pos));
  const movedBad = await events.handlers['paste:move-to']({}, {});
  check('paste:move-to 非法参数拒绝', movedBad === false);
  // 光标锚定缩放：baseSize=[400,300]，scale 1→2，锚点 (200,100)，
  // 期望 newPos = oldPos + anchor×(1-2) = (500-200, 300-100)，尺寸翻倍
  lastPw.__pasteBaseSize = [400, 300];
  lastPw.pos = [500, 300];
  const zoomed = await events.handlers['paste:zoom-at']({}, { scale: 2, prevScale: 1, anchorX: 200, anchorY: 100 });
  check('paste:zoom-at 返回成功', zoomed === true);
  check('paste:zoom-at 尺寸按比例放大', lastPw.size && lastPw.size[0] === 800 && lastPw.size[1] === 600, JSON.stringify(lastPw.size));
  check('paste:zoom-at 光标锚定(锚点图像点不动)', lastPw.pos && lastPw.pos[0] === 300 && lastPw.pos[1] === 200, JSON.stringify(lastPw.pos));
  const zoomBad = await events.handlers['paste:zoom-at']({}, {});
  check('paste:zoom-at 空参数安全(默认 scale=1)', zoomBad === true && lastPw.size[0] === 400, JSON.stringify(lastPw.size));

  console.log('== 7. 服务日志（关键行）==');
  events.logLines.forEach(l => console.log('   ', l));

  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
