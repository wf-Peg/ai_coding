/**
 * scanner.js - SQLite 本地索引层：扫描 clip-storage → 提取可索引 clip 记录
 *
 * 对齐 backend FileStorageService.getAllClips() 的目录/文件排除语义，
 * 只采集「剪藏 clip」，排除 learning-plan/todoList/knowledge/topic/vault 等
 * 非 clip 数据目录。
 */

const fs = require('fs');
const path = require('path');

// 非剪藏数据目录名（段级匹配，对齐 Java EXCLUDED_DIR_NAMES）
const EXCLUDED_DIR_NAMES = new Set([
  'todoList', 'knowledge', 'knowledge-base', 'topic', 'vault', 'learning-plan',
  'tmp', 'editor', 'weekly-report', 'weeklyReport', 'clip-organized',
  '.tmp', '.trash', '.git', '.obsidian'
]);

// 非剪藏配置文件（根级文件名匹配，对齐 Java EXCLUDED_FILE_NAMES）
const EXCLUDED_FILE_NAMES = new Set([
  'model-config.json', 'app-config.json', 'vaults.json', 'vault-meta.json'
]);

/** 判断某文件路径是否属于非剪藏数据目录/文件（逐段匹配，防误伤分类名）。 */
function isExcludedPath(filePath) {
  const fileName = path.basename(filePath);
  if (EXCLUDED_FILE_NAMES.has(fileName)) return true;
  const segments = filePath.split(path.sep);
  for (const seg of segments) {
    if (EXCLUDED_DIR_NAMES.has(seg) || seg.startsWith('todoList')) return true;
  }
  return false;
}

/**
 * clip-storage 根目录归一化：config.storagePath 可能已是指向 clip-storage 或 Clip_Bed 父目录。
 * 对齐 main.js generateApplicationYml 的逻辑。
 *
 * @param {string} storagePath config.storagePath
 * @returns {string} clip-storage 根目录路径
 */
function resolveClipStoragePath(storagePath) {
  if (!storagePath) throw new Error('resolveClipStoragePath: storagePath is required');
  const base = storagePath.endsWith('clip-storage') || storagePath.endsWith('clip-storage\\')
    ? storagePath
    : path.join(storagePath, 'clip-storage');
  return base;
}

/**
 * 数据根目录归一化：knowledge / learning-plan 与 clip-storage 同级。
 * storagePath 指向 Clip_Bed 父目录时即为 base；已指向 clip-storage 时取其父目录。
 *
 * @param {string} storagePath config.storagePath
 * @returns {string} 数据根目录路径
 */
function resolveBasePath(storagePath) {
  if (!storagePath) throw new Error('resolveBasePath: storagePath is required');
  if (storagePath.endsWith('clip-storage') || storagePath.endsWith('clip-storage\\')) {
    return path.dirname(storagePath);
  }
  return storagePath;
}

/**
 * 递归扫描 clip-storage 下所有 .json 文件（排除非 clip 目录），
 * 提取可索引 clip 记录数组。
 *
 * @param {string} clipStoragePath clip-storage 根目录
 * @returns {Array<{filePath, mtime, clip}>} 每条含来源文件信息与 clip 对象
 */
function scanClips(clipStoragePath) {
  const results = [];
  if (!fs.existsSync(clipStoragePath)) return results;

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(ent.name) || ent.name.startsWith('todoList')) continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.json') && !isExcludedPath(full)) {
        const clips = parseClipFile(full);
        let mtime = '';
        try { mtime = fs.statSync(full).mtimeMs.toString(); } catch (e) { /* ignore */ }
        for (const clip of clips) {
          results.push({ filePath: full, mtime, clip });
        }
      }
    }
  };
  walk(clipStoragePath);
  return results;
}

/**
 * 解析单个 clip JSON 文件为 clip 记录数组（对齐 readClipArrayFromFile 三种形态）。
 * @returns {Array<Object>}
 */
function parseClipFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    if (!text || !text.trim()) return [];
    const root = JSON.parse(text);
    if (Array.isArray(root)) return root;
    if (root && typeof root === 'object') {
      const clips = root.clips;
      if (Array.isArray(clips)) return clips;
    }
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * 从 clip 对象抽取用于 FTS 的纯文本。对齐 SearchService 的字段拼接
 * （content/type/source/category/summary/analysis/tags）。
 *
 * @param {Object} clip
 * @returns {string}
 */
function extractBodyPlain(clip) {
  if (!clip || typeof clip !== 'object') return '';
  const parts = [
    clip.content,
    clip.summary,
    clip.analysis,
    clip.title,
    clip.category,
    clip.type,
    clip.source
  ];
  if (Array.isArray(clip.tags)) parts.push(...clip.tags);
  else if (clip.tags) parts.push(clip.tags);
  return parts.filter((p) => p != null && String(p).trim() !== '').join('\n');
}

// 实体目录 → content.type 映射（M3 图谱关系层端点）：knowledge / learning-plan
const ENTITY_DIRS = [
  { dir: 'knowledge',     type: 'knowledge' },
  { dir: 'learning-plan', type: 'learning-plan' }
];

/**
 * 解析实体 JSON 文件为实体对象数组。
 * knowledge / learning-plan 文件均为 JSON 数组；兼容 { items: [...] } 形态。
 * 解析失败返回空数组（文件为真，库为缓存，坏文件跳过不中断）。
 *
 * @param {string} filePath
 * @returns {Array<Object>}
 */
function parseEntityFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    if (!text || !text.trim()) return [];
    const root = JSON.parse(text);
    if (Array.isArray(root)) return root;
    if (root && typeof root === 'object') {
      const items = root.items || root.entities || root.list;
      if (Array.isArray(items)) return items;
    }
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * 候选数据根目录（去重）：兼容两种真实布局——
 *  a) knowledge/learning-plan 与 clip-storage 同级（{base}/{dir}）
 *  b) knowledge/learning-plan 位于 clip-storage 内部（{clipRoot}/{dir}）
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录或 clip-storage）
 * @returns {string[]} 唯一的候选根目录列表
 */
function candidateRoots(storagePath) {
  const roots = [resolveBasePath(storagePath), resolveClipStoragePath(storagePath)];
  return [...new Set(roots.filter((p) => p != null && p !== ''))];
}

/**
 * 扫描 knowledge / learning-plan 实体目录，提取可索引实体记录。
 * 实体目录可能在 clip-storage 同级，也可能内嵌于 clip-storage 之下，两种皆尝试。
 *
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录或 clip-storage）
 * @returns {Array<{filePath:string, mtime:string, type:string, entity:Object}>}
 */
function scanEntities(storagePath) {
  const results = [];
  const seen = new Set();
  for (const root of candidateRoots(storagePath)) {
    for (const { dir, type } of ENTITY_DIRS) {
      const dirPath = path.join(root, dir);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;
      let entries;
      try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
      catch (e) { continue; }
      for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
        const full = path.join(dirPath, ent.name);
        if (seen.has(full)) continue; // 两候选根指向同一实文件时去重
        seen.add(full);
        // 注意：不在此处走 isExcludedPath —— knowledge/learning-plan 本就在 clip 排除集内，
        // 但这里显式以它们为扫描目标。
        const entities = parseEntityFile(full);
        if (!entities.length) continue;
        let mtime = '';
        try { mtime = fs.statSync(full).mtimeMs.toString(); } catch (e) { /* ignore */ }
        for (const entity of entities) {
          if (entity && entity.id !== null && entity.id !== undefined) {
            results.push({ filePath: full, mtime, type, entity });
          }
        }
      }
    }
  }
  return results;
}

/**
 * 从实体对象抽取用于 FTS 的纯文本（knowledge / learning-plan）。
 *
 * @param {Object} entity
 * @param {string} type content.type
 * @returns {string}
 */
function extractEntityBodyPlain(entity, type) {
  if (!entity || typeof entity !== 'object') return '';
  const parts = [];
  if (type === 'learning-plan') {
    parts.push(entity.title, entity.goal, entity.level, entity.category,
      entity.mermaidDiagram, entity.mastery);
    if (Array.isArray(entity.phases)) {
      for (const phase of entity.phases) {
        parts.push(phase.title, phase.goal, phase.detailMarkdown, phase.estimatedWeeks);
      }
    }
  } else {
    parts.push(entity.title, entity.content, entity.summary, entity.myThoughts, entity.category);
  }
  if (Array.isArray(entity.tags)) parts.push(...entity.tags);
  else if (entity.tags) parts.push(entity.tags);
  return parts.filter((p) => p != null && String(p).trim() !== '').join('\n');
}

module.exports = {
  scanClips, parseClipFile, extractBodyPlain, isExcludedPath,
  resolveClipStoragePath, resolveBasePath, candidateRoots,
  scanEntities, parseEntityFile, extractEntityBodyPlain, ENTITY_DIRS
};