/**
 * build-jlink-slim.mjs — 用 jlink 从完整 JDK 生成精简运行时 jre-slim/{os}
 *
 * 收益：完整 JRE ≈ 240MB+ → 精简运行时 ≈ 35~50MB
 * 用法：
 *   node scripts/build-jlink-slim.mjs [osKey]        （默认取当前平台，osKey 放在 --restore 之前）
 * 强制重建：JRE_JLINK_FORCE=1 node scripts/build-jlink-slim.mjs
 * 从备份恢复：node scripts/build-jlink-slim.mjs --restore [osKey]
 *
 * 完整 JDK 源查找优先级（都需包含 bin/jlink 与 jmods）：
 *   1. jre/{os}
 *   2. $JRE_JDK_HOME
 *   3. $JAVA_HOME
 * 说明：download-jre 下载的是纯 JRE 运行版（不含 jmods），无法直接作为 jlink 源，
 *       脚本会自动回退到本机完整 JDK（JAVA_HOME 等）。
 *
 * 备份：构建成功/复用时自动把 jre-slim/{os} 压缩到 jre-slim-backup/{os}.tar.gz，
 *       用于在切换分支、清空构建目录后快速恢复，无需重找完整 JDK。
 *   关闭备份：JRE_SLIM_BACKUP=0 node scripts/build-jlink-slim.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// electron-builder ${os} 目录名映射：darwin→mac，win32→win，linux→linux
const args = process.argv.slice(2);
const RESTORE = args.includes('--restore');
const OS_KEY = args.find((a) => !a.startsWith('--')) || { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
if (!OS_KEY) {
  console.error(`[jlink] 不支持的平台: ${process.platform}`);
  process.exit(1);
}

const OUT = path.join(ROOT, 'jre-slim', OS_KEY);       // 精简运行时输出
const HASH_FILE = path.join(OUT, '.jre-slim.hash');
const BACKUP_DIR = path.join(ROOT, 'jre-slim-backup'); // 备份目录（独立于构建产物，避免被重建/切分支清掉）
const BACKUP_FILE = path.join(BACKUP_DIR, `${OS_KEY}.tar.gz`);
const SHOULD_BACKUP = process.env.JRE_SLIM_BACKUP !== '0';

// Spring Boot Web + Spring AI + PDFBox + POI 所需模块（含 java.desktop 属性绑定依赖）
const MODULES_BASE = [
  'java.base', 'java.logging', 'java.xml', 'java.sql', 'java.naming', 'java.management',
  'java.instrument', 'jdk.unsupported', 'jdk.zipfs', 'jdk.charsets', 'jdk.crypto.ec',
  'java.net.http', 'java.security.jgss', 'java.security.sasl', 'jdk.security.auth',
  'jdk.naming.dns', 'jdk.management', 'jdk.management.agent', 'jdk.random',
  'jdk.crypto.cryptoki', 'java.prefs', 'java.compiler',
  'java.scripting', 'jdk.localedata', 'java.rmi', 'jdk.naming.rmi', 'java.transaction.xa',
  'jdk.security.jgss', 'jdk.jfr', 'java.desktop',
];
// 仅 Windows 存在的模块（CryptoAPI）
// 注意：Temurin 使用 jdk.crypto.mscapi；jdk.crypto.cng 并不存在（脚本曾因引用它导致 jlink 失败），已移除
const MODULES_WIN_ONLY = ['jdk.crypto.mscapi'];
const MODULES = [...MODULES_BASE, ...(OS_KEY === 'win' ? MODULES_WIN_ONLY : [])].join(',');

// 判断某目录是否为可做 jlink 源头的完整 JDK（需要 bin/jlink 与 jmods）
function isFullJdk(p) {
  if (!p) return false;
  try {
    if (!fs.existsSync(path.join(p, 'jmods'))) return false;
    const bins = [path.join(p, 'bin', 'jlink'), path.join(p, 'bin', 'jlink.exe')];
    return bins.some((b) => fs.existsSync(b));
  } catch { return false; }
}

// 完整 JDK 源查找：jre/{os} → $JRE_JDK_HOME → $JAVA_HOME
function resolveJdk() {
  const cands = [path.join(ROOT, 'jre', OS_KEY), process.env.JRE_JDK_HOME, process.env.JAVA_HOME].filter(Boolean);
  for (const c of cands) if (isFullJdk(c)) return c;
  return null;
}

function fingerprint(srcRelease) {
  let key = '';
  if (fs.existsSync(srcRelease)) key = fs.readFileSync(srcRelease, 'utf8');
  return key.replace(/\s+/g, '') + '|' + MODULES;
}

function validSlim() {
  return fs.existsSync(path.join(OUT, 'bin', 'java' + (OS_KEY === 'win' ? '.exe' : '')));
}

// 从备份包恢复精简运行时到 jre-slim/{os}
function restoreBackup() {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`[jlink] 无备份可恢复: ${BACKUP_FILE}`);
    process.exit(1);
  }
  const parent = path.dirname(OUT);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(parent, { recursive: true });
  const r = spawnSync('tar', ['-xzf', BACKUP_FILE, '-C', parent], { stdio: 'inherit' });
  if (r.status !== 0 || !validSlim()) {
    console.error('[jlink] 从备份恢复失败');
    process.exit(1);
  }
  console.log(`[jlink] 已从备份恢复精简运行时: ${OUT}`);
}

// 将当前精简运行时压缩为备份包（成功后自动调用）
function ensureBackup() {
  if (!SHOULD_BACKUP) return;
  if (!validSlim()) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = BACKUP_FILE + '.tmp';
  fs.rmSync(tmp, { force: true });
  const r = spawnSync('tar', ['-czf', tmp, '-C', path.join(ROOT, 'jre-slim'), OS_KEY], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('[jlink] 备份失败（请确认系统已安装 tar，Windows10+ 自带）');
    return;
  }
  fs.rmSync(BACKUP_FILE, { force: true });
  fs.renameSync(tmp, BACKUP_FILE);
  const size = (fs.statSync(BACKUP_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`[jlink] 精简运行时已备份: ${BACKUP_FILE} (${size} MB)`);
}

// 0) 显式恢复模式
if (RESTORE) {
  restoreBackup();
  process.exit(0);
}

// 1) 解析完整 JDK 源
const SRC = resolveJdk();
const force = process.env.JRE_JLINK_FORCE === '1';

// 2-a) 没有完整 JDK 源 → 优先复用已有精简运行时或从备份恢复
if (!SRC) {
  if (validSlim()) {
    console.log(`[jlink] 未找到完整 JDK 源，复用已有精简运行时: ${OUT}`);
    ensureBackup();
    process.exit(0);
  }
  if (fs.existsSync(BACKUP_FILE)) {
    console.log(`[jlink] 未找到完整 JDK 源，从备份恢复...`);
    restoreBackup();
    process.exit(0);
  }
  console.error(`[jlink] 未找到完整 JDK 源（查找顺序: jre/${OS_KEY}、$JRE_JDK_HOME、$JAVA_HOME），需要 bin/jlink 与 jmods`);
  console.error('[jlink] 可设置 JRE_JDK_HOME 指向完整 JDK，或先运行下载脚本获取完整 JDK 后重试；');
  console.error('[jlink] 也可使用 --restore 从 jre-slim-backup 恢复上一次精简运行时。');
  process.exit(1);
}

// 2-b) 缓存判断（源与模块未变化且已有产物 → 跳过重建）
if (!force && fs.existsSync(HASH_FILE)) {
  if (fs.readFileSync(HASH_FILE, 'utf8') === fingerprint(path.join(SRC, 'release')) && validSlim()) {
    console.log(`[jlink] 精简运行时未变化，跳过（如需强制重建：JRE_JLINK_FORCE=1；源 JDK: ${SRC}）`);
    ensureBackup();
    process.exit(0);
  }
}

// 3) 执行 jlink
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const jlinkBin = [path.join(SRC, 'bin', 'jlink'), path.join(SRC, 'bin', 'jlink.exe')].find((p) => fs.existsSync(p));
const jmods = path.join(SRC, 'jmods');
console.log(`[jlink] 源 JDK: ${SRC}`);
console.log(`[jlink] 输出:   ${OUT}`);

const res = spawnSync(jlinkBin, [
  '--module-path', jmods,
  '--add-modules', MODULES,
  '--output', OUT,
  '--strip-debug', '--compress=2', '--no-header-files', '--no-man-pages', '--vm=server',
], { stdio: 'inherit' });

if (res.status !== 0 || !validSlim()) {
  // jlink 失败时若已有备份，提示可恢复，避免整套构建中断
  if (fs.existsSync(BACKUP_FILE)) {
    console.error('[jlink] jlink 执行失败，可运行 node scripts/build-jlink-slim.mjs --restore 从备份恢复');
  } else {
    console.error('[jlink] jlink 执行失败');
  }
  process.exit(1);
}

// 4) 写指纹、输出体积并备份
fs.writeFileSync(HASH_FILE, fingerprint(path.join(SRC, 'release')));
const size = duMb(OUT);
console.log(`[jlink] 精简运行时生成成功: ${size} MB`);
ensureBackup();
console.log(`[jlink] 完成。electron-builder extraResources 使用 jre-slim/${OS_KEY}`);

function duMb(dir) {
  let total = 0;
  const seen = new Set();
  (function walk(p) {
    let real = p;
    try { real = fs.realpathSync(p); } catch { /* ignore */ }
    if (seen.has(real)) return;
    seen.add(real);
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const child = path.join(p, e.name);
      if (e.isDirectory()) walk(child);
      else if (e.isSymbolicLink()) { try { total += fs.statSync(child).size; } catch { /* ignore */ } }
      else { try { total += fs.statSync(child).size; } catch { /* ignore */ } }
    }
  })(dir);
  return (total / 1024 / 1024).toFixed(1);
}