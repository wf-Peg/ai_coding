// clean-artifacts.js — 打包完成后清理中间产物，为 dist-electron 瘦身
// 删除 .app / linux-unpacked 等中间目录，只保留最终产物(dmg/zip/exe/blockmap/yaml) 与 win-unpacked（本机测试用）
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

// 需删除的中间目录（electron-builder 打包到最终镜像前的展开输出）
// 注意：win-unpacked 刻意保留，用于本机免安装直接测试
const INTERMEDIATE_DIRS = [
  'mac',            // macOS x64 .app 展开目录
  'mac-arm64',      // macOS arm64 .app 展开目录
  'linux',          // Linux 展开目录
  'linux-unpacked', // Linux unpacked 目录
];

if (!fs.existsSync(distDir)) {
  console.log('[clean-artifacts] dist-electron 不存在，无需清理');
  process.exit(0);
}

let removed = 0;
let removedBytes = 0;

for (const name of INTERMEDIATE_DIRS) {
  const target = path.join(distDir, name);
  if (!fs.existsSync(target)) continue;

  // 计算占用（用于展示清理量）
  let size = 0;
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      stack.push(...fs.readdirSync(cur).map(f => path.join(cur, f)));
    } else if (st.isFile()) {
      size += st.size;
    }
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    removed++;
    removedBytes += size;
    console.log(`[clean-artifacts] 已删除中间目录: ${name} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (e) {
    console.warn(`[clean-artifacts] 删除 ${name} 失败: ${e.message}`);
  }
}

if (removed === 0) {
  console.log('[clean-artifacts] 无中间目录残留，未清理');
} else {
  console.log(`[clean-artifacts] 清理完成：共删除 ${removed} 个目录，释放 ${(removedBytes / 1024 / 1024 / 1024).toFixed(2)}GB`);
}