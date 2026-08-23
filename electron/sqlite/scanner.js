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

module.exports = { scanClips, parseClipFile, extractBodyPlain, isExcludedPath, resolveClipStoragePath };