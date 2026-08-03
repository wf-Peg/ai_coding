/**
 * 图标生成脚本
 * 将 frontend/assets/ 下的 SVG 图标转换为高清晰度 PNG
 * 用于 Electron 应用图标和托盘图标
 * 
 * 使用方式: node scripts/generate-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(PROJECT_ROOT, 'electron');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend', 'assets');

async function generateIcons() {
  console.log('=== 生成 Electron 图标 ===\n');

  // 确保 electron 目录存在
  if (!fs.existsSync(ELECTRON_DIR)) {
    fs.mkdirSync(ELECTRON_DIR, { recursive: true });
  }

  // 1. 生成应用图标 (1024x1024)
  const appSvgPath = path.join(ASSETS_DIR, 'app-icon.svg');
  const appPngPath = path.join(ELECTRON_DIR, 'app-icon.png');
  if (fs.existsSync(appSvgPath)) {
    await sharp(appSvgPath)
      .resize(1024, 1024)
      .png()
      .toFile(appPngPath);
    console.log(`[OK] 应用图标: ${appPngPath} (1024x1024)`);
  } else {
    console.warn(`[SKIP] 找不到 ${appSvgPath}`);
  }

  // 2. 生成托盘图标 (64x64)
  // macOS 托盘图标标准: 22pt @3x = 66px，64px 足够清晰
  // Windows 托盘图标: 16x16，sharp 缩放到 64x64 保证 Retina 清晰度
  const traySvgPath = path.join(ASSETS_DIR, 'tray-icon.svg');
  const trayPngPath = path.join(ELECTRON_DIR, 'tray-icon.png');
  if (fs.existsSync(traySvgPath)) {
    await sharp(traySvgPath)
      .resize(64, 64)
      .png()
      .toFile(trayPngPath);
    console.log(`[OK] 托盘图标: ${trayPngPath} (64x64)`);
  } else {
    console.warn(`[SKIP] 找不到 ${traySvgPath}`);
  }

  // 3. 生成 macOS 应用图标 (icns) 的源 PNG
  // electron-builder 可以从 PNG 自动生成 .icns，但需要足够大的尺寸
  const macIconPath = path.join(ELECTRON_DIR, 'icon.png');
  if (fs.existsSync(appSvgPath)) {
    await sharp(appSvgPath)
      .resize(1024, 1024)
      .png()
      .toFile(macIconPath);
    console.log(`[OK] macOS/通用图标: ${macIconPath} (1024x1024)`);
  }

  console.log('\n=== 图标生成完成 ===');
}

generateIcons().catch(err => {
  console.error('图标生成失败:', err);
  process.exit(1);
});