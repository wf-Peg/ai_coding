/**
 * 图标生成脚本
 * 将 frontend/assets/ 下的 SVG 图标转换为高清晰度 PNG
 * 用于 Electron 应用图标、托盘图标和浏览器扩展图标
 * 
 * 依赖: cairosvg (pip install cairosvg)
 * 使用方式: node scripts/generate-icons.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(PROJECT_ROOT, 'electron');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend', 'assets');
const EXT_ICONS_DIR = path.join(PROJECT_ROOT, 'browser-extension', 'icons');

function svgToPng(svgPath, pngPath, width, height) {
  const cmd = `cairosvg -f png -o "${pngPath}" --output-width ${width} --output-height ${height} "${svgPath}" 2>&1`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    const size = fs.statSync(pngPath).size;
    console.log(`[OK] ${path.basename(pngPath)} (${width}x${height}, ${(size / 1024).toFixed(1)}KB)`);
  } catch (err) {
    console.error(`[FAIL] ${path.basename(pngPath)}: ${err.message}`);
  }
}

function generateIcons() {
  console.log('=== 生成图标 ===\n');

  // 确保目录存在
  [ELECTRON_DIR, EXT_ICONS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const appSvg = path.join(ASSETS_DIR, 'app-icon.svg');
  const traySvg = path.join(ASSETS_DIR, 'tray-icon.svg');

  // 1. Electron 应用图标 (1024x1024)
  console.log('--- Electron 图标 ---');
  svgToPng(appSvg, path.join(ELECTRON_DIR, 'app-icon.png'), 1024, 1024);
  // macOS/通用图标
  svgToPng(appSvg, path.join(ELECTRON_DIR, 'icon.png'), 1024, 1024);
  // 托盘图标
  svgToPng(traySvg, path.join(ELECTRON_DIR, 'tray-icon.png'), 64, 64);

  // 2. 浏览器扩展图标
  console.log('\n--- 浏览器扩展图标 ---');
  const extSizes = [
    { size: 16, name: 'icon-16.png' },
    { size: 32, name: 'icon-32.png' },
    { size: 48, name: 'icon-48.png' },
    { size: 128, name: 'icon-128.png' },
  ];
  extSizes.forEach(({ size, name }) => {
    svgToPng(appSvg, path.join(EXT_ICONS_DIR, name), size, size);
  });

  console.log('\n=== 图标生成完成 ===');
}

generateIcons();