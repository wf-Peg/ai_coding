#!/usr/bin/env node

/**
 * afterPack hook for electron-builder
 * Deprecates the bundled JRE permissions and prunes multi-platform native binaries / locales
 * to minimize the packaged app size.
 *
 * 处理场景（mac + win 均生效）：
 * - 裁剪 Electron 多语言资源（只保留中文 + 英文）
 * - 裁剪原生依赖多平台二进制（onnxruntime-node 等）
 * - macOS .app 专属：修复 JRE 二进制权限、校验 macOS 可执行文件
 */
const fs = require('fs');
const path = require('path');

// 保留的语言：中文（默认） + 英文（兜底）。其他约 50 种皆删除以减小体积。
const KEEP_LOCALES = ['en', 'en_GB', 'en_US', 'zh_CN', 'zh_TW'];

exports.default = async function(context) {
  const platform = context.packager.platform.name; // 'mac' | 'win' | 'linux'

  // macOS 应用根目录为 <appOutDir>/xxx.app，win/linux 则为 appOutDir
  const appName = context.packager.appInfo.productFilename;
  const appPath = platform === 'mac'
    ? path.join(context.appOutDir, appName + '.app')
    : context.appOutDir;

  // 1) 裁剪 Electron 多语言资源（mac/win 均执行）
  pruneElectronLocales(appPath, platform);

  // 2) 裁剪原生依赖多平台二进制（mac/win 均执行）
  const resourcesPath = platform === 'mac'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(appPath, 'resources');
  pruneNativeNodeModules(resourcesPath, platform);

  // 3) macOS 专属：JRE 权限修复与可执行文件校验
  if (platform !== 'mac') {
    return;
  }

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

  // 裁剪原生依赖到当前平台（onnxruntime-node 等含多平台预编译二进制）
  pruneNativeNodeModules(resourcesPath, platform);
};

/**
 * 裁剪 Electron 框架内置的多语言资源，仅保留中文与英文，减小包体积。
 * - macOS：删除 Electron Framework 内除保留语言外的 *.lproj 目录
 * - win/linux：删除 resources/locales 下除保留语言外的 *.pak 文件
 */
function pruneElectronLocales(appPath, platform) {
  const keep = new Set(KEEP_LOCALES.map(l => l.toLowerCase().replace('_', '-')));

  if (platform === 'mac') {
    const resourcesDir = path.join(
      appPath, 'Contents', 'Frameworks',
      'Electron Framework.framework', 'Versions', 'A', 'Resources'
    );
    if (!fs.existsSync(resourcesDir)) return;
    let removed = 0;
    for (const entry of fs.readdirSync(resourcesDir)) {
      const m = entry.match(/^(.+)\.lproj$/);
      if (!m) continue;
      if (keep.has(m[1].toLowerCase().replace('_', '-'))) continue;
      fs.rmSync(path.join(resourcesDir, entry), { recursive: true, force: true });
      removed++;
    }
    console.log(`[afterPack] 已裁剪 Electron 语言包(mac): ${removed} 个`);
  } else {
    const localesDir = path.join(appPath, 'resources', 'locales');
    if (!fs.existsSync(localesDir)) return;
    let removed = 0;
    for (const entry of fs.readdirSync(localesDir)) {
      const m = entry.match(/^(.+)\.pak$/);
      if (!m) continue;
      const code = m[1].toLowerCase().replace('_', '-');
      if (code === 'en' || code === 'en-us' || code === 'zh-cn' || code === 'zh-tw') continue;
      fs.rmSync(path.join(localesDir, entry), { force: true });
      removed++;
    }
    console.log(`[afterPack] 已裁剪 Electron 语言包(${platform}): ${removed} 个`);
  }
}

/**
 * 裁剪 app.asar.unpacked 下原生 Node 依赖的多平台二进制，仅保留当前目标平台。
 * 主要收益：onnxruntime-node（darwin/linux/win32 合计约 250MB+，仅保留 ~76MB）。
 */
function pruneNativeNodeModules(resourcesPath, platform) {
  if (!['mac', 'win', 'linux'].includes(platform)) return;

  const keep = platform === 'mac' ? ['darwin'] : (platform === 'win' ? ['win32', 'win32-arm64'] : ['linux']);
  const unpacked = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');

  // onnxruntime-node：仅保留目标平台的 bin/napi-*/<platform> 目录
  const ortDir = path.join(unpacked, 'onnxruntime-node', 'bin');
  if (fs.existsSync(ortDir)) {
    for (const napi of fs.readdirSync(ortDir)) {
      const napiPath = path.join(ortDir, napi);
      let st;
      try { st = fs.statSync(napiPath); } catch { continue; }
      if (!st.isDirectory()) continue;
      for (const entry of fs.readdirSync(napiPath)) {
        if (!keep.includes(entry)) {
          const target = path.join(napiPath, entry);
          fs.rmSync(target, { recursive: true, force: true });
          console.log(`[afterPack] 已裁剪 onnxruntime 平台目录: ${napi}/${entry}`);
        }
      }
    }
  }
}

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
