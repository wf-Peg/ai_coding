/**
 * 收集 @deepseek-ai/dsh 的生产依赖闭包 → dist-dsh-offline/node_modules
 * 供 electron-builder extraResources 内置，实现打包应用的 DSH 离线可用
 * （resolveDshBin 会优先探测 resources/node_modules/@deepseek-ai/dsh/lib/bin.js）。
 *
 * 运行：node scripts/build-dsh-offline.mjs
 * 输出：dist-dsh-offline/node_modules/<闭包包>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCK = path.join(ROOT, 'package-lock.json');
const OUT = path.join(ROOT, 'dist-dsh-offline', 'node_modules');
const OUT_ROOT = path.dirname(OUT);
const HASH_FILE = path.join(OUT_ROOT, '.dsh-offline.hash');

// 目标平台标识（用于原生二进制裁剪与缓存判断）
const PLATFORM = process.platform; // win32 | darwin | linux
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';

/** 需要保留的原生平台目录前缀（node-pty 等 prebuilds/ 或 node-gyp build/Release） */
const KEEP_PLATFORM_PREFIX = getKeepPlatformPrefix();

function getKeepPlatformPrefix() {
  if (PLATFORM === 'darwin') return `darwin-${ARCH}`;
  if (PLATFORM === 'win32') return 'win32-';
  if (PLATFORM === 'linux') return `linux-${ARCH}`;
  return 'clendar';
}

/** 计算离线包构建指纹：packages 闭包 + 平台/架构（用于缓存跳过） */
function buildFingerprint(packages) {
  const h = createHash('sha256');
  h.update(JSON.stringify(packages));
  h.update(`|${PLATFORM}|${ARCH}`);
  return h.digest('hex');
}

// 1) 解析 lockfile
const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
const packages = lock.packages || {};

// 1-b) 缓存判断：lockfile 闭包 + 平台未变且产物完整则跳过（除非强制重建）
const force = process.env.DSH_OFFLINE_FORCE === '1';
if (!force && fs.existsSync(HASH_FILE)) {
  const prev = fs.readFileSync(HASH_FILE, 'utf8').trim();
  const cur = buildFingerprint(packages);
  if (prev === cur && fs.existsSync(OUT)) {
    console.log('[dsh-offline] 依赖与平台未变化，跳过构建（如需强制重建：DSH_OFFLINE_FORCE=1）');
    process.exit(0);
  }
}

// 2) 从 @deepseek-ai/dsh 出发做 BFS（仅生产依赖：dependencies / optionalDependencies）
const root = 'node_modules/@deepseek-ai/dsh';
if (!packages[root]) {
  console.error(`package-lock 中未找到 ${root}，请先 npm install @deepseek-ai/dsh`);
  process.exit(1);
}
const needed = new Set();
const queue = [root];
while (queue.length) {
  const spec = queue.shift();
  if (needed.has(spec)) continue;
  needed.add(spec);
  const pkg = packages[spec];
  if (!pkg) continue;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
  const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
  for (const name of Object.keys(deps)) {
    // npm 的解析：先查精确路径，再查提升的根路径
    const exact = `${spec}/node_modules/${name}`;
    const hoisted = `node_modules/${name}`;
    if (packages[exact]) queue.push(exact);
    else if (packages[hoisted]) queue.push(hoisted);
    else if (!optional.has(name)) console.warn(`  (dep not found in lock: ${name} <- ${spec})`);
  }
}

// 3) 复制闭包目录（清空旧输出；自研递归复制规避 cpSync 在 Windows junction 上的原生崩溃）
fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const PROGRESS_LOG = path.join(OUT_ROOT, '.progress.log');
const progress = (msg) => { fs.appendFileSync(PROGRESS_LOG, msg + '\n'); };

/** 递归复制（逐文件，容忍单个失败；符号链接按目标 stat 复制为普通文件/目录）
 *  原生二进制裁剪：删除非目标平台的预编译目录与调试文件 */
function copyTree(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) {
    let target;
    try { target = fs.statSync(src); } catch { return; }
    if (target.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyTree(fs.realpathSync(src), dst);
    } else {
      try { fs.copyFileSync(fs.realpathSync(src), dst); } catch { /* ignore */ }
    }
    return;
  }
  if (st.isDirectory()) {
    // 跨平台原生预编译目录裁剪（node-pty prebuilds/、node-gyp build/Release 等）
    const base = path.basename(src);
    if ((base === 'prebuilds' || base === 'Release' || base === 'prebuild-release') &&
        src.includes('node_modules')) {
      const kept = fs.readdirSync(src)
        .filter(e => keepNativeEntry(e));
      fs.mkdirSync(dst, { recursive: true });
      for (const e of kept) {
        copyTree(path.join(src, e), path.join(dst, e));
      }
      return;
    }
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) {
      copyTree(path.join(src, e), path.join(dst, e));
    }
  } else if (st.isFile()) {
    // 剔除 Windows 调试符号与部分缓存
    if (/\.pdb$/.test(src)) return;
    try { fs.copyFileSync(src, dst); } catch { /* ignore */ }
  }
}

/** 原生预编译目录下：是否保留该条目（只留目标平台前缀，剔除 .pdb） */
function keepNativeEntry(name) {
  if (/\.pdb$/.test(name)) return false;
  if (name.includes(':') || name === 'config.gypi') return true; // config.gypi 等通用配置保留
  if (name.includes('-')) {
    // 形如 darwin-arm64 / win32-x64 / linux-arm64 / linux-x64
    if (name.startsWith('darwin')) return name.startsWith(`darwin-${ARCH}`);
    if (name.startsWith('win32')) return PLATFORM === 'win32';
    if (name.startsWith('linux')) return PLATFORM === 'linux';
    if (name.startsWith('freebsd')) return false;
    return true; // 非平台名（如 generic）保留
  }
  return true;
}

let copied = 0;
let failed = 0;
let bytes = 0;
for (const spec of needed) {
  const src = path.join(ROOT, spec);
  if (!fs.existsSync(src)) { progress(`MISS ${spec}`); continue; }
  // OUT 本身即 node_modules 目录，spec 的 "node_modules/" 前缀需去掉，避免双重嵌套
  const rel = spec.startsWith('node_modules/') ? spec.slice('node_modules/'.length) : spec;
  const dst = path.join(OUT, rel);
  try {
    copyTree(src, dst);
    copied++;
    bytes += dirSize(dst);
  } catch (e) {
    failed++;
    progress(`FAIL ${spec}: ${e.message}`);
  }
  progress(`OK   ${spec}`);
}
console.log(`闭包包数: ${copied} / 需要 ${needed.size}（失败 ${failed}）`);
console.log(`输出: ${OUT}`);
console.log(`体积: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`进度日志: ${PROGRESS_LOG}`);

// 复制成功后写入指纹，供下次缓存跳过
if (failed === 0) {
  fs.writeFileSync(HASH_FILE, buildFingerprint(packages));
  console.log(`缓存指纹: ${HASH_FILE}`);
}

function dirSize(dir) {
  const seen = new Set();
  return (function walk(p) {
    let total = 0;
    let real = p;
    try { real = fs.realpathSync(p); } catch { /* ignore */ }
    if (seen.has(real)) return 0;
    seen.add(real);
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const child = path.join(p, e.name);
      if (e.isDirectory()) total += walk(child);
      else if (e.isSymbolicLink()) {
        try { total += fs.statSync(child).size; } catch { /* ignore */ }
      } else {
        try { total += fs.statSync(child).size; } catch { /* ignore */ }
      }
    }
    return total;
  })(dir);
}
