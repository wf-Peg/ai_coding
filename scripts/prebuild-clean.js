// prebuild-clean.js — 打包前清理：杀掉残留进程 + 删除 dist-electron
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

console.log('[prebuild] 检查残留进程...');

// 1. 终止所有"剪藏"进程
if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM "剪藏.exe" /T', { stdio: 'pipe' });
    console.log('[prebuild] 已终止所有剪藏.exe 进程');
  } catch (e) {
    // 没有进程运行时 taskkill 返回非零，忽略
    console.log('[prebuild] 无残留剪藏进程');
  }
}

// 2. 删除 dist-electron 目录
if (fs.existsSync(distDir)) {
  console.log('[prebuild] 清理 dist-electron...');
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('[prebuild] dist-electron 已清理');
  } catch (e) {
    console.error('[prebuild] 清理失败:', e.message);
    process.exit(1);
  }
} else {
  console.log('[prebuild] dist-electron 不存在，无需清理');
}

console.log('[prebuild] 完成，开始打包...\n');