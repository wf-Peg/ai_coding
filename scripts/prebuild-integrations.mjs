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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const modules = [
  path.join(root, 'integrations', 'dsh', 'mcp-server'),
  path.join(root, 'integrations', 'dsh', 'plugins', 'clip-capture'),
];

// 指纹 = package.json + package-lock.json 内容（锁文件为准，变则重装）
function fingerprint(dir) {
  const h = createHash('sha256');
  const inputs = ['package.json'];
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) inputs.push('package-lock.json');
  for (const f of inputs) {
    try { h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f))); } catch { /* ignore */ }
  }
  return h.digest('hex');
}

// 校验 node_modules 里是否已包含声明的一级依赖（dependencies 必查，optionalDependencies 见则查）
function depsInstalled(dir) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return false; }
  const names = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ]);
  const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
  for (const name of names) {
    if (!fs.existsSync(path.join(dir, 'node_modules', name))) {
      if (optional.has(name)) continue;
      return false;
    }
  }
  return true;
}

const force = process.env.INTEGRATIONS_FORCE === '1';

for (const dir of modules) {
  const rel = path.relative(root, dir);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    console.log(`[integrations] 跳过（无 package.json）: ${rel}`);
    continue;
  }

  const marker = path.join(dir, 'node_modules', '.deps.hash');
  const fp = fingerprint(dir);
  // 缓存命中：指纹一致 且 依赖都在 → 跳过联网安装（Windows 下 npm 明显更慢，收益最大）
  if (!force && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === fp && depsInstalled(dir)) {
    console.log(`[integrations] 依赖未变化，跳过: ${rel}（如需强制重装：INTEGRATIONS_FORCE=1）`);
    continue;
  }

  console.log(`[integrations] 安装依赖: ${rel}`);
  try {
    // 优先 npm ci（以 package-lock.json 为准、更快更稳）；无 lockfile 时回退 npm install
    const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'));
    const cmd = hasLock ? 'npm ci --omit=dev --no-audit --no-fund' : 'npm install --omit=dev --no-audit --no-fund';
    execSync(cmd, { cwd: dir, stdio: 'inherit' });
    if (depsInstalled(dir)) {
      fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      fs.writeFileSync(marker, fp);
    }
  } catch (e) {
    console.error(`[integrations] 依赖安装失败: ${rel} -> ${e.message}`);
    process.exit(1);
  }
}

console.log('[integrations] DSH 集成依赖安装完成');