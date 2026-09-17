/**
 * storage-inspect.js - 只读目录规范体检（storage-inspect）
 *
 * 扫描 config.storagePath 目录树，对照「现有代码实际行为」这一基准，
 * 输出分类不统一 / 命名不规范 / 疑似重复等问题清单与建议动作。
 *
 * ⚠️ 严格只读约束：本模块只允许 readdirSync / statSync / createReadStream，
 * 任何 writeFile / mkdir / rename / unlink 一律禁止——体检只报告，不写盘。
 * 执行能力（move/rename/trash）为下一期，本期仅产出 suggestion（含 from/to/action）。
 *
 * 复用 sqlite/scanner.js 的布局解析（resolveBasePath / resolveClipStoragePath /
 * discoverMarkdownRoots / MD_EXCLUDED_DIR_NAMES / MD_EXT_RE），不重复实现双布局兼容。
 *
 * 依赖：fs / path / crypto（零第三方）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scanner = require('./sqlite/scanner');

// ── 可调常量（导出便于测试与后续调整） ──

/** md 根内允许的最大目录深度（根/主题/子主题 = 3；超过即视为层级过深）。 */
const MAX_DEPTH = 3;

/** 目录名长度上限。 */
const NAME_LENGTH_LIMIT = 40;

/** 重复判定的内容哈希上限（字节）：> 1MB 只取前 1MB 参与 sha256，控成本。 */
const DUP_HASH_MAX_BYTES = 1 * 1024 * 1024;

/** 系统保留目录名（体检白名单：识别为合法固定目录，不误报命名/空目录）。 */
const CANONICAL_DIRS = new Set([
  'clip-storage', 'clip-organized', 'weekly-report', 'weeklyReport',
  'obsidian-vault', 'tmp', '.tmp', 'vault', 'notes', 'templates'
]);

/** 合法临时目录名（编辑器默认保存目录 + 缓存，白名单放行）。 */
const LEGAL_TMP_DIRS = new Set(['tmp', '.tmp']);

/** 内容根下允许存在的自定义隐藏目录（其余 .xxx 目录走 P10 提示）。 */
const ALLOWED_HIDDEN_DIRS = new Set(['.tmp', '.index', '.obsidian']);

/** 建议动作统一枚举。 */
const ACTION = { NONE: 'none', MOVE: 'move', MERGE: 'merge', RENAME: 'rename', TRASH: 'trash' };

// ── 小工具 ──

/** 目录是否为空（无任何直接子项）。 */
function dirIsEmpty(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.length === 0;
  } catch (e) { return true; }
}

/** 目录是否为空目录树（无任何 .md 递归）。 */
function treeHasMd(dir) {
  let found = false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (scanner.MD_EXCLUDED_DIR_NAMES.has(ent.name)) continue;
        if (treeHasMd(full)) { found = true; break; }
      } else if (ent.isFile() && scanner.MD_EXT_RE.test(ent.name)) {
        found = true; break;
      }
    }
  } catch (e) { /* ignore */ }
  return found;
}

/** 递归统计目录内 .md 文件（数量 + 总字节）。 */
function countMdTree(dir) {
  let count = 0, bytes = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (scanner.MD_EXCLUDED_DIR_NAMES.has(ent.name)) continue;
        const sub = countMdTree(full);
        count += sub.count; bytes += sub.bytes;
      } else if (ent.isFile() && scanner.MD_EXT_RE.test(ent.name)) {
        count++;
        try { bytes += fs.statSync(full).size; } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
  return { count, bytes };
}

/** 计算文件 sha256（超过上限只取头部）。 */
function fileHash(filePath) {
  const h = crypto.createHash('sha256');
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      let read = 0;
      while (read < DUP_HASH_MAX_BYTES) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, DUP_HASH_MAX_BYTES - read));
        if (n <= 0) break;
        h.update(buf.subarray(0, n));
        read += n;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) { return null; }
  return h.digest('hex');
}

/** 目录名是否不合规（命名风格 P06）。返回 { bad: boolean, reason?: string, suggestion?: string }。 */
function checkNameStyle(name) {
  const reasons = [];
  if (/[\s　]/.test(name)) reasons.push('含空格/全角空格');
  if (/[^\x00-\x7F]/.test(name)) reasons.push('含全角字符');
  if (/[#%&{}]/.test(name)) reasons.push('含特殊字符 #%&{}');
  if (/^\./.test(name) || /\.$/.test(name)) reasons.push('首/尾为点');
  if (name.length > NAME_LENGTH_LIMIT) reasons.push(`长度 ${name.length} > ${NAME_LENGTH_LIMIT}`);
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) reasons.push('全大写');
  if (!reasons.length) return { bad: false };
  // kebab-case 建议名：降为小写、非字母数字转 '-'
  const suggestion = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || name;
  return { bad: true, reason: reasons.join('、'), suggestion };
}

/** 计算目录相对根的深度（相对 storagePath，根自身为 0）。 */
function dirDepth(abs, baseAbs) {
  const rel = path.relative(baseAbs, abs);
  if (!rel) return 0;
  return rel.split(path.sep).length;
}

// ── 体检入口 ──

/**
 * 扫描 storagePath 目录树，输出只读体检报告。
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录）
 * @returns {Object} 见 plan：root / canonical / stats / issues / suggestions
 */
function inspectStorage(storagePath) {
  const report = {
    root: { configured: storagePath || '', basePath: '', clipStoragePath: '', organizedPath: '', weeklyReportPath: '', legacyNested: false },
    canonical: { requiredDirs: [], indexedRootNames: [], excludedDirNames: [...scanner.MD_EXCLUDED_DIR_NAMES], maxDepth: MAX_DEPTH },
    stats: { rootCount: 0, mdFileCount: 0, totalBytes: 0, duplicateGroupCount: 0, duplicateFileCount: 0 },
    issues: [],
    suggestions: []
  };

  if (!storagePath || !fs.existsSync(storagePath)) {
    report.issues.push({
      id: 'I00', code: 'P00', severity: 'warn', title: '存储根目录不存在',
      detail: `config.storagePath 指向的目录不存在或为空：${storagePath}`, paths: [], suggestion: null
    });
    return report;
  }

  // 布局归一化（复用 scanner 双布局兼容逻辑）
  const baseAbs = scanner.resolveBasePath(storagePath);
  const clipAbs = scanner.resolveClipStoragePath(storagePath);
  const legacyNested = storagePath.endsWith('clip-storage') || storagePath.endsWith('clip-storage\\');
  report.root = {
    configured: storagePath,
    basePath: baseAbs,
    clipStoragePath: clipAbs,
    organizedPath: path.join(baseAbs, 'clip-organized'),
    weeklyReportPath: path.join(baseAbs, 'weekly-report'),
    legacyNested
  };
  report.canonical.requiredDirs = ['clip-storage', 'clip-organized', 'weekly-report', 'obsidian-vault'];

  const issues = report.issues;
  const suggestions = report.suggestions;
  const addIssue = (issue, sug) => {
    issues.push(issue);
    if (sug) suggestions.push(sug);
  };

  // P01 旧语义 storagePath（直指 clip-storage）
  if (legacyNested) {
    addIssue({
      id: `P01-1`, code: 'P01', severity: 'warn', title: '存储根目录指向旧格式（clip-storage 本身）',
      detail: `config.storagePath 以 clip-storage 结尾（旧格式）。clip-organized / weekly-report 会拼成 clip-storage/clip-organized 这类嵌套路径。建议把 storagePath 上移为父目录（Clip_Bed 父目录）。`,
      paths: [storagePath],
      suggestion: { code: 'P01', from: storagePath, to: baseAbs, action: ACTION.MOVE, reason: '旧语义 storagePath 会导致整理/周报目录嵌套进 clip-storage' }
    }, {
      code: 'P01', from: storagePath, to: baseAbs, action: ACTION.MOVE, reason: '旧语义 storagePath 上移为父目录'
    });
  }

  // P02 knowledge 与 knowledge-base 并存（各位置探测）
  const knowledgeDirs = [path.join(clipAbs, 'knowledge'), path.join(baseAbs, 'knowledge')]
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory() && !dirIsEmpty(p));
  const kbDirs = [path.join(clipAbs, 'knowledge-base'), path.join(baseAbs, 'knowledge-base')]
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory() && !dirIsEmpty(p));
  if (knowledgeDirs.length > 0 && kbDirs.length > 0) {
    addIssue({
      id: 'P02-1', code: 'P02', severity: 'warn', title: '旧目录 knowledge 与新目录 knowledge-base 并存',
      detail: '两个目录都含内容。新版已统一写入 knowledge-base，旧 knowledge/ 为历史存量（启动时由 LegacyKnowledgeMigrationRunner 自动迁移，只读保留）。如仍并存可手动合并。',
      paths: [...knowledgeDirs, ...kbDirs],
      suggestion: { code: 'P02', from: knowledgeDirs[0], to: kbDirs[0], action: ACTION.MERGE, reason: 'knowledge 与 knowledge-base 并存，统一到 knowledge-base' }
    }, {
      code: 'P02', from: knowledgeDirs[0], to: kbDirs[0], action: ACTION.MERGE, reason: '统一知识目录到 knowledge-base'
    });
  }

  // P03 weeklyReport 与 weekly-report 并存
  const weeklyA = path.join(baseAbs, 'weeklyReport');
  const weeklyB = path.join(baseAbs, 'weekly-report');
  if (fs.existsSync(weeklyA) && fs.statSync(weeklyA).isDirectory() && !dirIsEmpty(weeklyA)
      && fs.existsSync(weeklyB) && fs.statSync(weeklyB).isDirectory() && !dirIsEmpty(weeklyB)) {
    addIssue({
      id: 'P03-1', code: 'P03', severity: 'warn', title: '周报目录两种写法并存',
      detail: 'weeklyReport（历史写法）与 weekly-report（当前统一目录）同时存在。新版已统一为 weekly-report，建议将 weeklyReport 存量合并到 weekly-report。',
      paths: [weeklyA, weeklyB],
      suggestion: { code: 'P03', from: weeklyA, to: weeklyB, action: ACTION.MERGE, reason: '统一周报目录到 weekly-report' }
    }, {
      code: 'P03', from: weeklyA, to: weeklyB, action: ACTION.MERGE, reason: '统一周报目录到 weekly-report'
    });
  }

  // 顶层目录扫描（md 库发现 + 各类检查）
  const roots = scanner.discoverMarkdownRoots(storagePath); // 已被索引的一级 md 根
  const mdRoots = roots.filter((r) => treeHasMd(r));
  report.canonical.indexedRootNames = mdRoots.map((r) => path.basename(r));
  report.stats.rootCount = roots.length;

  let topEntries = [];
  try { topEntries = fs.readdirSync(storagePath, { withFileTypes: true }); } catch (e) { /* ignore */ }

  for (const ent of topEntries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(storagePath, ent.name);

    // P10 白名单外的自定义隐藏目录
    if (ent.name.startsWith('.')) {
      if (!ALLOWED_HIDDEN_DIRS.has(ent.name)) {
        addIssue({
          id: `P10-${ent.name}`, code: 'P10', severity: 'info', title: `存在自定义隐藏目录 ${ent.name}`,
          detail: `${ent.name} 不在允许列表（.tmp/.index/.obsidian）内，其中的 md 不会被索引（点开头目录被扫描器跳过）。仅提示，无需处理。`,
          paths: [full], suggestion: null
        });
      }
      continue;
    }

    // 系统/运行时目录（在 MD 排除集内）：仅当内含 .md 才提示 P04。
    // 系统固定目录（clip-storage / weekly-report 等）不可改名，跳过 P04；
    // 用户可改名的排除目录（docs/test/build 等）才提示重命名。
    if (scanner.MD_EXCLUDED_DIR_NAMES.has(ent.name)) {
      if (treeHasMd(full) && !LEGAL_TMP_DIRS.has(ent.name) && !CANONICAL_DIRS.has(ent.name)) {
        addIssue({
          id: `P04-${ent.name}`, code: 'P04', severity: 'warn', title: `目录名 ${ent.name} 在索引排除集内`,
          detail: `${ent.name} 是索引排除目录（MD_EXCLUDED_DIR_NAMES），其中递归存在 .md，但这些 md 不会被全局搜索收录。建议把该目录重命名为非排除名（如 ${ent.name}-notes）。`,
          paths: [full],
          suggestion: { code: 'P04', from: full, to: path.join(storagePath, `${ent.name}-notes`), action: ACTION.RENAME, reason: `排除目录 ${ent.name} 内的 md 不可索引` }
        }, {
          code: 'P04', from: full, to: path.join(storagePath, `${ent.name}-notes`), action: ACTION.RENAME, reason: `排除目录 ${ent.name} 内的 md 不可索引`
        });
      } else if (treeHasMd(full) && CANONICAL_DIRS.has(ent.name)) {
        // 系统固定目录内出现 md（如知识库被误拷进 clip-storage）：不可改名，提示「移出非搜索区」
        addIssue({
          id: `P04B-${ent.name}`, code: 'P04B', severity: 'info', title: `系统目录 ${ent.name} 内含 md（非搜索区）`,
          detail: `${ent.name} 是固定系统目录（不可改名），其中的 md 不会被全局搜索收录。若这是迁移进来的知识库，建议移动到根目录下的一级目录或 clip-organized/。`,
          paths: [full],
          suggestion: { code: 'P04B', from: full, to: path.join(storagePath, 'kb'), action: ACTION.MOVE, reason: `系统目录 ${ent.name} 内的 md 不可索引` }
        }, {
          code: 'P04B', from: full, to: path.join(storagePath, 'kb'), action: ACTION.MOVE, reason: `系统目录 ${ent.name} 内的 md 不可索引`
        });
      }
      continue;
    }

    // P08 空 md 根（非规范目录，内含 0 个 md）
    if (!CANONICAL_DIRS.has(ent.name) && !treeHasMd(full)) {
      addIssue({
        id: `P08-${ent.name}`, code: 'P08', severity: 'info', title: `一级目录 ${ent.name} 下没有 md 文件`,
        detail: '该目录作为 md 知识库根存在但没有任何 .md（可能只是占位或放错层级）。仅提示，可忽略或迁移。',
        paths: [full], suggestion: null
      });
    }

    // P05 / P06 深度与命名（仅检查 md 内容根内，避免把系统目录也纳入）
    if (!CANONICAL_DIRS.has(ent.name)) {
      checkDepthAndNames(full, storagePath, MAX_DEPTH, issues, suggestions);
    }
  }

  // P07 内容重复（md 根内全部 .md 按 sha256 分组）
  const hashGroups = new Map();
  const mdFiles = [];
  for (const root of mdRoots) {
    collectMdFiles(root, mdFiles);
  }
  for (const f of mdFiles) {
    const h = fileHash(f);
    if (!h) continue;
    if (!hashGroups.has(h)) hashGroups.set(h, []);
    hashGroups.get(h).push(f);
  }
  let dupGroups = 0, dupFiles = 0;
  for (const [h, group] of hashGroups) {
    if (group.length < 2) continue;
    dupGroups++; dupFiles += group.length - 1;
    // 保留 mtime 最新一份，其余建议移入 .trash
    const sorted = [...group].sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (e) { return 0; }
    });
    const keep = sorted[0];
    const dups = sorted.slice(1);
    addIssue({
      id: `P07-${h.slice(0, 8)}`, code: 'P07', severity: 'warn', title: `发现 ${group.length} 个内容重复的 md 文件`,
      detail: `内容哈希一致（sha256 前 ${DUP_HASH_MAX_BYTES / 1024}KB）。保留 ${path.basename(keep)}（更新时间最新），其余建议移入 .trash。`,
      paths: [...group],
      suggestion: { code: 'P07', from: dups.join('|'), to: path.join(storagePath, '.trash'), action: ACTION.TRASH, reason: '内容重复，保留最新一份' }
    }, {
      code: 'P07', from: dups.join('|'), to: path.join(storagePath, '.trash'), action: ACTION.TRASH, reason: '内容重复，保留最新一份'
    });
  }
  report.stats.duplicateGroupCount = dupGroups;
  report.stats.duplicateFileCount = dupFiles;

  // P09 clip-organized/clips 导出 md 镜像
  const clipsMirror = path.join(report.root.organizedPath, 'clips');
  if (fs.existsSync(clipsMirror) && fs.statSync(clipsMirror).isDirectory()) {
    const c = countMdTree(clipsMirror);
    if (c.count > 0) {
      addIssue({
        id: 'P09-1', code: 'P09', severity: 'info', title: 'clip-organized/clips 下存在导出的剪藏 md',
        detail: `该目录下 ${c.count} 个 md 与 clip JSON 同内容，会在全局搜索中造成双命中。仅提示，代码级纳入排除留下期。`,
        paths: [clipsMirror], suggestion: null
      });
    }
  }

  // 汇总 stats.mdFileCount / totalBytes
  for (const root of mdRoots) {
    const c = countMdTree(root);
    report.stats.mdFileCount += c.count;
    report.stats.totalBytes += c.bytes;
  }

  return report;
}

/**
 * 只读「搜索覆盖区」：列出 storagePath 下一级目录的分类（可搜索 / 排除），
 * 与扫描器（discoverMarkdownRoots + MD_EXCLUDED_DIR_NAMES）同源，让用户一眼知道
 * 知识库该放哪里才会被全局搜索（Ctrl+Shift+F/O）收录。
 * 轻量：仅 readdirSync 顶层，不做深扫与哈希。
 *
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录）
 * @returns {{root:string, searchable:Array<{name,path,hidden:boolean}>, excluded:Array<{name,path,reason}>}}
 */
function inspectSearchZone(storagePath) {
  const zone = { root: storagePath || '', searchable: [], excluded: [] };
  if (!storagePath || !fs.existsSync(storagePath)) return zone;
  let entries = [];
  try { entries = fs.readdirSync(storagePath, { withFileTypes: true }); } catch (e) { return zone; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(storagePath, ent.name);
    if (scanner.MD_EXCLUDED_DIR_NAMES.has(ent.name)) {
      let reason = '索引排除目录（其中的 md 不会被搜索）';
      if (ent.name.startsWith('.')) reason = '系统/隐藏目录，不参与索引';
      else if (CANONICAL_DIRS.has(ent.name)) reason = '系统固定目录（剪藏/周报等），不参与 md 搜索';
      else if (['node_modules', 'jre', 'jre-slim', 'dist', 'build', 'out', 'backend', 'frontend', 'electron', 'scripts', 'test', 'docs', 'integrations', 'browser-extension', 'TODO', 'jlink-target'].includes(ent.name)) {
        reason = '运行时/构建/依赖目录，不参与搜索';
      }
      zone.excluded.push({ name: ent.name, path: full, reason });
    } else {
      zone.searchable.push({ name: ent.name, path: full, hidden: ent.name.startsWith('.') });
    }
  }
  zone.searchable.sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0));
  return zone;
}

/** 收集目录树内全部 .md 文件路径（含排除过滤，与 scanner 语义一致）。 */
function collectMdFiles(dir, out) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (scanner.MD_EXCLUDED_DIR_NAMES.has(ent.name)) continue;
        collectMdFiles(full, out);
      } else if (ent.isFile() && scanner.MD_EXT_RE.test(ent.name)) {
        out.push(full);
      }
    }
  } catch (e) { /* ignore */ }
}

/**
 * 递归检查目录深度（P05）与命名风格（P06）。
 * depth 为目录相对根（baseAbs）的深度；根内目录深度 > MAX_DEPTH 触发 P05。
 * 目录自身命名也会被检查（顶层 md 根目录名同样纳入规范）。
 */
function checkDepthAndNames(dir, baseAbs, maxDepth, issues, suggestions) {
  const own = path.basename(dir);
  if (own && own !== path.basename(baseAbs) && !CANONICAL_DIRS.has(own)) {
    const style = checkNameStyle(own);
    if (style.bad) {
      issues.push({
        id: `P06-${dir}`, code: 'P06', severity: 'info', title: `目录名 ${own} 不合规`,
        detail: `${style.reason}。建议改用 kebab-case（如 ${style.suggestion}）。`,
        paths: [dir],
        suggestion: { code: 'P06', from: dir, to: path.join(path.dirname(dir), style.suggestion), action: ACTION.RENAME, reason: style.reason }
      });
      suggestions.push({ code: 'P06', from: dir, to: path.join(path.dirname(dir), style.suggestion), action: ACTION.RENAME, reason: style.reason });
    }
  }

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    const depth = dirDepth(full, baseAbs);

    // P05 层级过深
    if (depth > maxDepth) {
      issues.push({
        id: `P05-${full}`, code: 'P05', severity: 'info', title: `目录层级过深（深度 ${depth} > ${maxDepth}）`,
        detail: `md 根内目录深度建议 ≤ ${maxDepth}（根/主题/子主题）。当前：${full}`,
        paths: [full],
        suggestion: { code: 'P05', from: full, to: '', action: ACTION.MOVE, reason: '层级过深，建议上提' }
      });
      suggestions.push({ code: 'P05', from: full, to: '', action: ACTION.MOVE, reason: '层级过深，建议上提' });
    }

    // P06 命名风格（跳过规范目录）
    if (!CANONICAL_DIRS.has(ent.name)) {
      const style = checkNameStyle(ent.name);
      if (style.bad) {
        issues.push({
          id: `P06-${full}`, code: 'P06', severity: 'info', title: `目录名 ${ent.name} 不合规`,
          detail: `${style.reason}。建议改用 kebab-case（如 ${style.suggestion}）。`,
          paths: [full],
          suggestion: { code: 'P06', from: full, to: path.join(dir, style.suggestion), action: ACTION.RENAME, reason: style.reason }
        });
        suggestions.push({ code: 'P06', from: full, to: path.join(dir, style.suggestion), action: ACTION.RENAME, reason: style.reason });
      }
    }

    checkDepthAndNames(full, baseAbs, maxDepth, issues, suggestions);
  }
}

module.exports = { inspectStorage, inspectSearchZone, MAX_DEPTH, NAME_LENGTH_LIMIT, DUP_HASH_MAX_BYTES, CANONICAL_DIRS, LEGAL_TMP_DIRS, ALLOWED_HIDDEN_DIRS, ACTION };
