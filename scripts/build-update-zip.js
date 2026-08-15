/**
 * 构建更新 ZIP 包。
 *
 * 将 electron-builder 输出的 win-unpacked/resources/ 目录打包为 clip-update-{version}.zip，
 * 作为 Release 的更新包 asset 上传（GitHub Releases 等）。
 *
 * 打包规则：
 * - ZIP 内含顶层 resources/ 目录（结构：resources/app.asar、resources/backend/...、
 *   resources/frontend/...、resources/TODO/...），与 update-manager.applyUpdate 的
 *   解压预期一致（此前无顶层目录的包会导致 applyUpdate 找不到 resources 而静默跳过）。
 * - 默认排除 jre/（版本间不变，随安装包分发；如需强制更新 JRE 加 --with-jre）。
 * - 排除 frontend/clip-backend.jar（与 backend 目录下重复的 88MB 冗余 JAR，无代码引用）。
 * - 保留 TODO/（工作台导入的产品概览 JSON，随版本更新）。
 * - 同时输出 clip-update-{version}.zip.sha256 校验文件，客户端下载后校验。
 *
 * 运行时：electron-builder --win --x64 完成后由 build:win / release 脚本调用。
 * 用法：
 *   node scripts/build-update-zip.js            # 常规更新包（不含 jre）
 *   node scripts/build-update-zip.js --with-jre # 全量更新包（含 jre）
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const pkg = require('../package.json');
const version = pkg.version;
const distDir = path.join(__dirname, '..', 'dist-electron');
const resourcesDir = path.join(distDir, 'win-unpacked', 'resources');
const stagingRoot = path.join(distDir, '.update-staging');
const stagingResources = path.join(stagingRoot, 'resources');
const outZip = path.join(distDir, `clip-update-${version}.zip`);
const outSha = `${outZip}.sha256`;
const withJre = process.argv.includes('--with-jre');

if (!fs.existsSync(resourcesDir)) {
  console.error('[update-zip] win-unpacked/resources not found, skipping');
  process.exit(0);
}

console.log(`[update-zip] Creating update package: ${path.basename(outZip)} (withJre=${withJre})`);

// 1. 组装暂存目录（仅包含需要进入更新包的条目）
fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(stagingResources, { recursive: true });

let skipped = 0;
let copiedBytes = 0;

function copyEntry(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src, { withFileTypes: true })) {
      copyEntry(path.join(src, child.name), path.join(dest, child.name));
    }
  } else {
    fs.copyFileSync(src, dest);
    copiedBytes += fs.statSync(src).size;
  }
}

const topEntries = fs.readdirSync(resourcesDir, { withFileTypes: true });
for (const e of topEntries) {
  if (!withJre && e.name === 'jre') {
    console.log(`[update-zip] skip jre/ (unchanged between versions; use --with-jre to include)`);
    skipped += 1;
    continue;
  }
  copyEntry(path.join(resourcesDir, e.name), path.join(stagingResources, e.name));
}

// 剔除 frontend 下的重复 JAR（若有残留）
const dupJar = path.join(stagingResources, 'frontend', 'clip-backend.jar');
if (fs.existsSync(dupJar)) {
  fs.rmSync(dupJar, { force: true });
  console.log('[update-zip] removed duplicate frontend/clip-backend.jar from update package');
}

// 2. 压缩（顶层包含 resources/ 目录）
if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stagingResources}' -DestinationPath '${outZip}' -Force"`, { stdio: 'inherit' });
} else {
  execSync(`cd "${stagingRoot}" && zip -rq "${outZip}" resources`, { stdio: 'inherit' });
}

// 3. 生成 SHA-256 校验文件（格式同 sha256sum）
const hash = crypto.createHash('sha256').update(fs.readFileSync(outZip)).digest('hex');
fs.writeFileSync(outSha, `${hash}  ${path.basename(outZip)}\n`);

// 4. 清理暂存目录
fs.rmSync(stagingRoot, { recursive: true, force: true });

const sizeMB = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
const skippedMB = (copiedBytes / 1024 / 1024).toFixed(1);
console.log(`[update-zip] Done: ${path.basename(outZip)} (${sizeMB} MB), sha256=${hash.slice(0, 16)}...`);
console.log(`[update-zip] Checksum file: ${path.basename(outSha)}`);
if (skipped > 0) {
  console.log(`[update-zip] Skipped ${skipped} top-level entr${skipped > 1 ? 'ies' : 'y'} (not part of incremental update)`);
}
