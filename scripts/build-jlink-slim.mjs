/**
 * build-jlink-slim.mjs — 用 jlink 从完整 JDK(jre/{os}) 生成精简运行时 jre-slim/{os}
 *
 * 收益：完整 JRE ≈ 240MB+ → 精简运行时 ≈ 35~50MB
 * 用法：node scripts/build-jlink-slim.mjs [osKey]   （默认取当前平台）
 * 强制重建：JRE_JLINK_FORCE=1 node scripts/build-jlink-slim.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// electron-builder ${os} 目录名映射：darwin→mac，win32→win，linux→linux
const OS_KEY = process.argv[2] || { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
if (!OS_KEY) {
  console.error(`[jlink] 不支持的平台: ${process.platform}`);
  process.exit(1);
}

const SRC = path.join(ROOT, 'jre', OS_KEY);       // 完整 JDK（含 jmods）
const OUT = path.join(ROOT, 'jre-slim', OS_KEY);  // 精简运行时输出
const HASH_FILE = path.join(OUT, '.jre-slim.hash');

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

function fingerprint() {
  const srcRelease = path.join(SRC, 'release');
  let key = '';
  if (fs.existsSync(srcRelease)) key = fs.readFileSync(srcRelease, 'utf8');
  return key.replace(/\s+/g, '') + '|' + MODULES;
}

// 1) 源校验
// Windows 下可执行文件带 .exe 后缀，Unix 下无后缀；两者都尝试，确保跨平台可用
const jlinkCandidates = [path.join(SRC, 'bin', 'jlink'), path.join(SRC, 'bin', 'jlink.exe')];
const jlinkBin = jlinkCandidates.find((p) => fs.existsSync(p));
const jmods = path.join(SRC, 'jmods');
if (!jlinkBin || !fs.existsSync(jmods)) {
  console.error(`[jlink] 未找到完整 JDK 源: ${SRC}（需要 bin/jlink 与 jmods）`);
  console.error('[jlink] 可先运行下载脚本获取完整 JDK 后重试。');
  process.exit(1);
}

// 2) 缓存判断
const force = process.env.JRE_JLINK_FORCE === '1';
if (!force && fs.existsSync(HASH_FILE)) {
  const prev = fs.readFileSync(HASH_FILE, 'utf8');
  if (prev === fingerprint() && fs.existsSync(path.join(OUT, 'bin', 'java'))) {
    console.log(`[jlink] 精简运行时未变化，跳过（如需强制重建：JRE_JLINK_FORCE=1）`);
    process.exit(0);
  }
}

// 3) 执行 jlink
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
console.log(`[jlink] 源 JDK: ${SRC}`);
console.log(`[jlink] 输出:   ${OUT}`);

const res = spawnSync(jlinkBin, [
  '--module-path', jmods,
  '--add-modules', MODULES,
  '--output', OUT,
  '--strip-debug', '--compress=2', '--no-header-files', '--no-man-pages', '--vm=server',
], { stdio: 'inherit' });

if (res.status !== 0 || !fs.existsSync(path.join(OUT, 'bin', 'java'))) {
  console.error('[jlink] jlink 执行失败');
  process.exit(1);
}

// 4) 写指纹并输出体积
fs.writeFileSync(HASH_FILE, fingerprint());
const size = duMb(OUT);
console.log(`[jlink] 精简运行时生成成功: ${size} MB`);
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