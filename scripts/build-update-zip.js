/**
 * 构建更新 ZIP 包。
 * 
 * 将 electron-builder 输出的 win-unpacked/resources/ 目录打包为 clip-update-v{version}.zip，
 * 作为 GitHub Release 的更新包 asset 上传。
 * 
 * 运行时：electron-builder --win --x64 完成后由 build:win 脚本自动调用。
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const pkg = require('../package.json');
const version = pkg.version;
const resourcesDir = path.join(__dirname, '..', 'dist-electron', 'win-unpacked', 'resources');
const outZip = path.join(__dirname, '..', 'dist-electron', `clip-update-v${version}.zip`);

if (!fs.existsSync(resourcesDir)) {
  console.error('[update-zip] win-unpacked/resources not found, skipping');
  process.exit(0);
}

console.log(`[update-zip] Creating update package: ${path.basename(outZip)}`);
execSync(`powershell -Command "Compress-Archive -Path '${resourcesDir}\\*' -DestinationPath '${outZip}' -Force"`, { stdio: 'inherit' });

const sizeMB = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
console.log(`[update-zip] Done: ${path.basename(outZip)} (${sizeMB} MB)`);