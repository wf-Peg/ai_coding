/**
 * 覆盖层渲染冒烟：在真实 Electron 渲染器里验证 screenshot-window.html 的 raw 分支。
 * 用法：electron smoke-overlay.js --user-data-dir=<可写目录>
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const HTML = path.join(__dirname, '..', 'electron', 'screenshot', 'screenshot-window.html');
const W = 320, H = 180;

app.whenReady().then(async () => {
  // 构造 BGRA raw：左半红、右半蓝（交换后应变为左红右蓝的 RGBA）
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (x < W / 2) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 255; buf[i + 3] = 255; }   // BGRA 蓝色（物理上 B=255）
      else           { buf[i] = 255; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255; }   // BGRA 红色
    }
  }

  ipcMain.on('screenshot:painted', (e, payload) => {
    console.log('SMOKE painted delta =', payload.delta, 'ms');
  });

  const win = new BrowserWindow({
    width: 640, height: 360, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) { console.log('SMOKE RENDERER ERROR[' + level + ']:', message); process.exitCode = 1; }
  });
  win.webContents.on('did-fail-load', (e, code, desc) => { console.log('SMOKE LOAD FAIL:', code, desc); process.exitCode = 1; });

  await win.loadFile(HTML);
  console.log('SMOKE page loaded');

  // 模拟 F1 流程：loading → raw init
  win.webContents.send('screenshot:loading', {});
  await new Promise(r => setTimeout(r, 200));
  win.webContents.send('screenshot:init', {
    mode: 'raw', bitmap: buf, width: W, height: H,
    display: { width: 640, height: 360, scaleFactor: 1 },
    t0: Date.now()
  });
  await new Promise(r => setTimeout(r, 1500));

  // 验证 bgCanvas 已填充（通过 executeJavaScript 检查像素）
  const result = await win.webContents.executeJavaScript(`(function () {
    const c = document.getElementById('bgCanvas');
    if (c.style.display === 'none') return { ok: false, reason: 'bgCanvas hidden' };
    const ctx = c.getContext('2d');
    const p1 = ctx.getImageData(80, 90, 1, 1).data; // 左半（物理 B=255 → RGBA 应为 R=255）
    const p2 = ctx.getImageData(240, 90, 1, 1).data; // 右半（物理 R=255 → RGBA 应为 B=255）
    return {
      ok: true,
      leftIsRed: p1[0] > 200 && p1[2] < 50,
      rightIsBlue: p2[2] > 200 && p2[0] < 50,
      hint: document.getElementById('hint').textContent
    };
  })()`);
  console.log('SMOKE pixel check:', JSON.stringify(result));
  if (!result || !result.ok || !result.leftIsRed || !result.rightIsBlue) {
    console.log('SMOKE FAIL: BGRA→RGBA 通道转换错误', JSON.stringify(result));
    process.exitCode = 1;
  } else {
    console.log('SMOKE PASS: raw 分支渲染 + BGRA→RGBA 转换正确');
  }

  app.quit();
});
