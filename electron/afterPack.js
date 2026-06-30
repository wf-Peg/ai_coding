#!/usr/bin/env node

/**
 * afterPack hook for electron-builder
 * Validates the bundled JRE and fixes binary permissions inside the packaged macOS app.
 * 
 * 处理场景：
 * - macOS .app 包（dmg/zip）：修复 JRE 二进制权限，验证 macOS 可执行文件
 * - Windows 便携版：无需额外处理
 * - Linux AppImage：无需额外处理
 */
const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  if (context.packager.platform.name !== 'mac') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, appName + '.app');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const jreBin = path.join(resourcesPath, 'jre', 'bin');

  if (!fs.existsSync(jreBin)) {
    console.log('[afterPack] No bundled JRE found in:', jreBin);
    console.log('[afterPack] Checking for JRE in Resources root...');

    // 检查 JRE 是否直接在 Resources 下（扁平结构）
    const altJreBin = path.join(resourcesPath, 'jre');
    if (fs.existsSync(altJreBin)) {
      console.log('[afterPack] Found JRE at flat path');
    } else {
      console.log('[afterPack] No JRE found, skipping permission fix');
      console.log('[afterPack] App will use system Java at runtime');
    }
    return;
  }

  const javaBinary = path.join(jreBin, 'java');
  if (!fs.existsSync(javaBinary)) {
    console.log('[afterPack] java binary not found at:', javaBinary);
    return;
  }

  if (!isMacExecutable(javaBinary)) {
    console.error('[afterPack] ERROR: Bundled JRE is not a macOS executable!');
    console.error('[afterPack] Path:', javaBinary);
    console.error('[afterPack] This usually means a Windows/Linux JRE was bundled.');
    console.error('[afterPack] Please run: npm run download-jre (to download the correct macOS JRE)');
    console.error('[afterPack] Then rebuild with: npm run build:mac');
    throw new Error(
      `Bundled JRE is not a macOS executable: ${javaBinary}\n` +
      'Use a macOS JRE/JDK for mac builds. Run: npm run download-jre'
    );
  }

  console.log('[afterPack] Valid macOS JRE detected, fixing permissions in:', jreBin);
  fixPermissionsRecursive(jreBin);
  console.log('[afterPack] JRE permissions fixed');
};

function isMacExecutable(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, header.length, 0);
    const magic = header.readUInt32BE(0);
    return [
      0xfeedface,
      0xfeedfacf,
      0xcefaedfe,
      0xcffaedfe,
      0xcafebabe,
      0xbebafeca
    ].includes(magic);
  } finally {
    fs.closeSync(fd);
  }
}

function fixPermissionsRecursive(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fixPermissionsRecursive(fullPath);
      } else if (entry.isFile() && !entry.name.endsWith('.jar')) {
        fs.chmodSync(fullPath, 0o755);
      }
    }
  } catch (e) {
    console.error('[afterPack] Failed to fix permissions in', dir, ':', e.message);
  }
}
