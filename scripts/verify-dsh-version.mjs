// 一次性验证脚本：验证「DSH 版本对齐与宿主机升级机制」收敛版实现。
// 从 electron/main.js 抽取真实函数（compareVersions / detectDshVersion / resolveNpxRoots /
// resolveNpmCacheDir / resolveDshBin），在 vm 沙箱内用模拟 npx 缓存目录做运行时测试，
// 并对源码做静态断言（锁死函数已删、新 IPC 已注册）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const MAIN = new URL('../electron/main.js', import.meta.url);
const src = readFileSync(MAIN, 'utf-8');

// ---- 工具：按起始标记抽取到配平的大括号 ----
function extract(startPat) {
  const i = src.indexOf(startPat);
  if (i < 0) throw new Error('extract not found: ' + startPat);
  const open = src.indexOf('{', i);
  if (open < 0) throw new Error('no opening brace: ' + startPat);
  let depth = 0;
  let j = open;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const out = src.slice(i, j + 1);
  if (!/}\s*$/.test(out)) throw new Error('extract unbalanced: ' + startPat);
  return out;
}

const unit = [
  extract('function compareVersions(a, b)'),
  extract('function isNpxResidue(p)'),
  extract('function detectDshVersion(bin, config)'),
  extract('function resolveNpmCacheDir()'),
  extract('async function resolveNpxRoots()'),
  extract('async function resolveDshBin(config)'),
].join('\n');

// ---- 构造隔离沙箱 ----
const fakeLog = { info: () => {}, warn: () => {}, error: () => {}, fail: () => {} };
const sandboxProcess = new Proxy(process, {
  get(t, k) {
    if (k === 'resourcesPath') return 'C:/__dummy_resources__';
    if (k === 'env') return process.env;
    return Reflect.get(t, k);
  },
});
const sandbox = {
  path, os, fs, process: sandboxProcess, log: fakeLog,
  APP_DIR: 'C:/__dummy_app__',
  findNodeExe: () => 'node',
  findNodeDir: () => { throw new Error('should not run'); },
  execAsync: () => { throw new Error('should not run'); },
};
vm.createContext(sandbox);
vm.runInContext('let npmCacheDirPromise = null;\n' + unit +
  '\nthis.__ = { compareVersions, detectDshVersion, resolveNpxRoots, resolveDshBin };', sandbox);
const { compareVersions, detectDshVersion, resolveDshBin } = sandbox.__;

// ---- 断言辅助 ----
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

console.log('== 1) compareVersions 排序 ==');
assert(compareVersions('0.1.0-rc.6', '0.1.0-rc.7') < 0, 'rc.6 < rc.7');
assert(compareVersions('0.1.0-rc.7', '0.1.0-rc.6') > 0, 'rc.7 > rc.6');
assert(compareVersions('0.1.0', '0.1.0-rc.7') > 0, '正式版 > 预发布 rc');
assert(compareVersions('0.2.0-rc.1', '0.1.9') > 0, '0.2.0-rc > 0.1.9（主版本优先）');
assert(compareVersions('0.1.0-rc.7', '0.1.0-rc.7') === 0, '相等返回 0');

console.log('== 2) detectDshVersion 读取 package.json ==');
// 真实落盘一个 package.json 供读取
const pkgDir = path.join(os.tmpdir(), 'dsh-verify-' + process.pid, 'pkgs', '@deepseek-ai', 'dsh');
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
const fakeBin = { mode: 'npx', node: 'node', script: path.join(pkgDir, 'lib', 'bin.js') };
let det = detectDshVersion(fakeBin, { dshBinPath: '' });
assert(det.version === '9.9.9' && det.source === 'npx', 'npx 来源读出 9.9.9');
det = detectDshVersion({ mode: 'node', node: 'node', script: 'C:/mock/pkgs/@deepseek-ai/dsh/lib/bin.js' }, { dshBinPath: '' });
assert(det.source === 'builtin', '无 dshBinPath 且非 npx → builtin');
det = detectDshVersion({ mode: 'node', node: 'node', script: 'C:/mock/x/lib/bin.js' }, { dshBinPath: 'C:/usr' });
assert(det.source === 'config', '设置 dshBinPath（非残留）→ config');
det = detectDshVersion({ mode: 'node', node: 'node', script: path.join(pkgDir, 'lib', 'bin.js') }, { dshBinPath: 'C:/mock/_npx/resi/.../bin.js' });
assert(det.source === 'builtin' && det.version === '9.9.9', 'bin 内置但 config 是 _npx 残留 → 来源 builtin（不再误判 config）');
det = detectDshVersion({ mode: 'missing', file: 'npx' }, {});
assert(det.version === null, 'missing → version null');

console.log('== 3) resolveDshBin 在 npx 缓存多版本时选最高 ==');
// 构造模拟缓存目录：npm_config_cache → mockcache，其 _npx 下两个缓存目录不同版本
const MOCKROOT = path.join(os.tmpdir(), 'dsh-verify-' + process.pid);
const cacheRoot = path.join(MOCKROOT, 'npm-cache');
const mk = (p, v) => {
  const pkg = path.join(p, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  fs.mkdirSync(path.join(p, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(p, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '// bin');
  fs.writeFileSync(pkg, JSON.stringify({ name: '@deepseek-ai/dsh', version: v }));
};
const oldPath = path.join(cacheRoot, '_npx', 'old', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
mk(path.join(cacheRoot, '_npx', 'old'), '0.1.0-rc.6');
mk(path.join(cacheRoot, '_npx', 'new'), '9.9.9');
process.env.npm_config_cache = cacheRoot;
delete process.env.DSH_BIN;

const bin = await resolveDshBin({ dshBinPath: '' });
assert(bin.mode === 'npx', '命中 npx 缓存');
assert(/node_modules[/\\]@deepseek-ai[/\\]dsh/.test(bin.script), 'script 指向 dsh 包');
const det2 = detectDshVersion(bin, { dshBinPath: '' });
assert(det2.version === '9.9.9', '选中高版本 9.9.9（实际读到 ' + det2.version + '）');

console.log('== 3b) 历史残留 config.dshBinPath（指向 _npx 旧路径）应被跳过 ==');
// 模拟 persistDshBinIfNpx 遗留：config.dshBinPath 指向存在但旧版本的 _npx 缓存
const binSkip = await resolveDshBin({ dshBinPath: oldPath });
assert(binSkip.mode === 'npx', '残留 _npx 路径被跳过，仍命中 npx 扫描');
const det3 = detectDshVersion(binSkip, { dshBinPath: oldPath });
assert(det3.version === '9.9.9', '绕过旧路径选到更高版本（不会锁旧版）');

console.log('== 4) 静态断言 electron/main.js 源码 ==');
assert(!/function persistDshBinIfNpx/.test(src) && !/persistDshBinIfNpx\(/.test(src),
  'persistDshBinIfNpx 函数定义与调用均已删除（不再锁死路径）');
for (const id of ['function detectDshVersion', 'function fetchRuntimeDshVersion', 'let dshVersionState',
  "'dsh-agent:detect-version'", "'dsh-agent:latest-version'", 'dshVersion: det.version']) {
  assert(src.includes(id), '源码包含 ' + id);
}
// preload
const pl = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf-8');
assert(pl.includes('detectDshVersionState') && pl.includes('checkDshLatest'), 'preload 暴露 detectDshVersionState/checkDshLatest');

// 清理
fs.rmSync(MOCKROOT, { recursive: true, force: true });

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);