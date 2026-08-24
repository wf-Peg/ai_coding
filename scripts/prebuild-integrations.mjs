// prebuild-integrations.mjs — 打包前安装 DSH 集成微模块依赖
//
// 背景：integrations/dsh 下每个子模块（mcp-server、plugins/clip-capture）都是自包含
// 的 npm 包，DSH 通过 --patch 按其绝对路径加载这些 ESM 插件时，会从插件所在目录向上
// 解析 node_modules。若未安装依赖（@modelcontextprotocol/sdk、@deepseek-ai/dsh-tools
// 等），打包/开发环境下都会抛 ERR_MODULE_NOT_FOUND 导致 DSH 启动失败。
//
// 本脚本在 prebuild 阶段对每个子模块执行 `npm ci --omit=dev`，产出 node_modules 后被
// package.json 的 extraResources `**/*` 一并收进资源目录，从而让打包版也能正常加载。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const modules = [
  path.join(root, 'integrations', 'dsh', 'mcp-server'),
  path.join(root, 'integrations', 'dsh', 'plugins', 'clip-capture'),
];

for (const dir of modules) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    console.log(`[integrations] 跳过（无 package.json）: ${path.relative(root, dir)}`);
    continue;
  }
  console.log(`[integrations] 安装依赖: ${path.relative(root, dir)}`);
  try {
    // 优先 npm ci（以 package-lock.json 为准、更快更稳）；无 lockfile 时回退 npm install
    const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
    const cmd = hasLock ? 'npm ci --omit=dev --no-audit --no-fund' : 'npm install --omit=dev --no-audit --no-fund';
    execSync(cmd, { cwd: dir, stdio: 'inherit' });
  } catch (e) {
    console.error(`[integrations] 依赖安装失败: ${path.relative(root, dir)} -> ${e.message}`);
    process.exit(1);
  }
}

console.log('[integrations] DSH 集成依赖安装完成');