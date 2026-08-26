// prebuild-clean.js — 打包前清理：杀掉残留进程 + 删除 dist-electron
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

// 0. 校验 DSH 插件依赖已安装（避免打包后运行时 MODULE_NOT_FOUND）
const dshTools = path.join(__dirname, '..', 'integrations', 'dsh', 'plugins', 'clip-capture', 'node_modules', '@deepseek-ai', 'dsh-tools');
if (!fs.existsSync(dshTools)) {
  console.error('[prebuild] 缺少 DSH 插件依赖 @deepseek-ai/dsh-tools（clip-capture）。请先执行：');
  console.error('  cd integrations/dsh/plugins/clip-capture && npm install');
  process.exit(1);
} else {
  console.log('[prebuild] DSH 插件依赖 @deepseek-ai/dsh-tools 已就绪');
}

console.log('[prebuild] 检查残留进程...');

// 1. 终止所有"剪藏"进程
if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM "剪藏.exe" /T', { stdio: 'pipe' });
    console.log('[prebuild] 已终止所有剪藏.exe 进程');
  } catch (e) {
    console.log('[prebuild] 无残留剪藏进程');
  }

  // 等待文件锁释放（杀毒软件/资源管理器可能短暂持锁）
  console.log('[prebuild] 等待 2 秒确保文件锁释放...');
  const start = Date.now();
  while (Date.now() - start < 2000) { /* 忙等 */ }
}

// 2. 带重试的删除
if (fs.existsSync(distDir)) {
  console.log('[prebuild] 清理 dist-electron...');
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.rmSync(distDir, { recursive: true, force: true });
      console.log('[prebuild] dist-electron 已清理');
      break;
    } catch (e) {
      if (i < maxRetries - 1) {
        console.log(`[prebuild] 第 ${i + 1} 次清理失败，1 秒后重试...`);
        // 同步等待 1 秒
        const start = Date.now();
        while (Date.now() - start < 1000) { /* 忙等 */ }
      } else {
        console.error('[prebuild] 清理失败:', e.message);
        console.error('[prebuild] 请手动关闭占用 dist-electron 的程序后重试');
        process.exit(1);
      }
    }
  }
} else {
  console.log('[prebuild] dist-electron 不存在，无需清理');
}

console.log('[prebuild] 完成，开始打包...\n');