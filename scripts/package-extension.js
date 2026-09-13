// ============================================================
// 打包浏览器插件（Web Clipper）为 zip，供官网下载 + GitHub Release 发布
// 用法：node scripts/package-extension.js
// 产物：dist-electron/CutShelter-webclipper-{version}.zip
//   （输出到 dist-electron 以便 scripts/release.sh 现有 *.zip 上传循环自动附带）
// ============================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'browser-extension');
const DIST_DIR = path.join(ROOT, 'dist-electron');

function fail(msg) {
  console.error('[package-extension] ✗ ' + msg);
  process.exit(1);
}

try {
  const version = require(path.join(ROOT, 'package.json')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`package.json 版本号格式非法: ${version}`);
  }

  if (!fs.existsSync(EXT_DIR)) {
    fail(`插件目录不存在: ${EXT_DIR}`);
  }
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const outZip = path.join(DIST_DIR, `CutShelter-webclipper-${version}.zip`);
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

  const isWindows = process.platform === 'win32';

  // 无论平台统一采用「过滤拷贝到临时目录 → 再压缩」的方式，
  // 避免 macOS zip 的 --exclude 通配符在匹配不到时报 "nothing to select from"。
  const exclude = /node_modules|\.DS_Store|\.zip$/;
  function copyTree(src, dst) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (exclude.test(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copyTree(s, d);
      } else {
        fs.copyFileSync(s, d);
      }
    }
  }

  const tmpDir = path.join(DIST_DIR, `.wc-stage-${Date.now()}`);
  const op = path.join(DIST_DIR, `.wc-out-${Date.now()}.zip`);
  fs.mkdirSync(tmpDir, { recursive: true });
  copyTree(EXT_DIR, tmpDir);

  if (isWindows) {
    // Windows 用 PowerShell Compress-Archive
    execSync(`powershell -NoProfile -Command "Compress-Archive -Force -Path '${tmpDir}\\*' -DestinationPath '${op}'"`, { stdio: 'inherit' });
  } else {
    // macOS / Linux 用系统 zip（临时目录内已被过滤，无需 exclude）
    execSync(`zip -r --quiet "${op}" .`, { cwd: tmpDir, stdio: 'inherit' });
  }

  fs.renameSync(op, outZip);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (!fs.existsSync(outZip)) {
    fail(`产物未生成: ${outZip}`);
  }

  const sizeMB = (fs.statSync(outZip).size / 1024 / 1024).toFixed(2);
  console.log(`[package-extension] ✓ 插件打包完成: ${path.relative(ROOT, outZip)} (${sizeMB} MB)`);
} catch (e) {
  fail(e.message || String(e));
}