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
const { execFileSync } = require('child_process');

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

  // 3) 全平台 JRE 存在性校验：缺 JRE → 直接构建失败，避免产出"双击无反应"的坏包
  validateBundledJre(resourcesPath, platform);

  // 4) macOS 专属：JRE 权限修复与可执行文件校验
  if (platform !== 'mac') {
    return;
  }

  if (context.packager.platformSpecificBuildOptions.identity === null) {
    resignAdHoc(appPath);
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
 * 校验打包产物内是否包含目标平台的 JRE。
 * mac 走原有权限修复与可执行校验流程；win/linux 在缺 JRE 时直接抛错，
 * 让"缺 jre-slim/${os} 仍成功出包、运行时双击无反应"这类问题在构建期暴露。
 */
function validateBundledJre(resourcesPath, platform) {
  if (platform === 'mac') return; // mac 走下方专属权限修复 + 可执行校验
  if (platform !== 'win' && platform !== 'linux') return;
  const javaExe = path.join(resourcesPath, 'jre', 'bin', platform === 'win' ? 'java.exe' : 'java');
  if (fs.existsSync(javaExe)) {
    console.log(`[afterPack] 校验通过，${platform} JRE 存在:`, javaExe);
    return;
  }
  const osKey = platform === 'win' ? 'win' : 'linux';
  console.error(`[afterPack] ERROR: ${platform} 产物缺少 JRE: ${javaExe}`);
  console.error('[afterPack] extraResources 将 jre-slim/' + osKey + ' 拷贝到 resources/jre。');
  console.error('[afterPack] 请先运行: node scripts/build-jlink-slim.mjs （生成 jre-slim/' + osKey + '）');
  throw new Error(
    `Bundled JRE missing for ${platform}: ${javaExe}\n` +
    `Run "node scripts/build-jlink-slim.mjs" to generate jre-slim/${osKey} first.`
  );
}

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

/**
 * Apple Silicon (macOS 11+/Sequoia+) 要求原生 arm64 可执行文件必须带一个有效的
 * adhoc 签名才能被 launchd 拉起，且已签名的进程不得加载未签名库（否则 dyld 报
 * "Trying to load an unsigned library"）。因此【移除签名】会让 arm64 包彻底无法启动。
 *
 * 正确做法是对整包做【一致的 adhoc 重签名】：主程序、Electron Framework、嵌套
 * Helper、libffmpeg.dylib 等动态库，以及 extraResources 里的 JRE，全部补上新鲜
 * adhoc 签名。这样：
 *  - launchd 能正常拉起（不会出现 "Launchd job spawn failed" / 无法打开）；
 *  - 签名仍是非 Apple 的 adhoc（TeamIdentifier=not set），用户走「右键打开 /
 *    隐私与安全性允许」即可运行，与 x64 无签名产物行为一致。
 */
function resignAdHoc(appPath) {
  let signed = 0;
  walkMacExecutables(appPath, filePath => {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', filePath], { stdio: 'pipe' });
    signed++;
  });

  // 统一签名 Electron Framework 目录与整个 .app，确保嵌套库签名与主程序一致
  const electronFramework = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework');
  if (fs.existsSync(electronFramework)) {
    codesignFile(electronFramework);
  }
  // 仅当路径确实是 Mac 应用包（含 Info.plist）时才对 .app 本体签名
  if (fs.existsSync(path.join(appPath, 'Contents', 'Info.plist'))) {
    codesignFile(appPath);
  }

  console.log(`[afterPack] adhoc 重签名完成：已签名 ${signed} 个 Mach-O + 外层 .app`);
}

function codesignFile(filePath) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', filePath], { stdio: 'pipe' });
}

function walkMacExecutables(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMacExecutables(fullPath, callback);
    } else if (entry.isFile() && isMacExecutable(fullPath)) {
      callback(fullPath);
    }
  }
}

exports.resignAdHoc = resignAdHoc;
exports.walkMacExecutables = walkMacExecutables;
