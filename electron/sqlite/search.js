/**
 * search.js - SQLite 本地索引层：全文检索查询封装
 *
 * 对齐 backend SearchService 的「contains」匹配语义，返回 ClipContent 数组
 * （content_ref 反序列化，字段与 Java 侧一致）。
 *
 * 策略一级别：
 *   1. FTS5 = content_fts MATCH（倒排，英文/标点生效）
 *   2. LIKE 子串兜底（中文/任意子串，规避 unicode61 对中文整句分词的短板）
 *   若 FTS 已命中则不再走 LIKE；两者结果结构一致。
 */

const db = require('./db');

/**
 * @param {string} query 搜索关键词
 * @param {number} topK 最大返回数量
 * @returns {Array<Object>} ClipContent 数组
 */
function search(query, topK = 50) {
  const dbConn = db.getDatabase();
  if (!dbConn || !query || !String(query).trim()) return [];
  const q = String(query).trim();
  const limit = Math.max(1, Math.min(500, Number(topK) || 50));

  let rows = searchFts(dbConn, q, limit);
  if (rows.length === 0) {
    rows = searchLike(dbConn, q, limit);
  }

  return rows
    .map((r) => {
      try { return JSON.parse(r.content_ref); } catch (e) { return null; }
    })
    .filter((x) => x != null);
}

/** 按分类搜索（对齐 /api/clip/search/category）。 */
function searchByCategory(query, category, topK = 50) {
  const dbConn = db.getDatabase();
  if (!dbConn || !String(query).trim()) return [];
  const q = String(query).trim();
  const limit = Math.max(1, Math.min(500, Number(topK) || 50));

  let rows = searchFts(dbConn, q, limit, category);
  if (rows.length === 0) {
    rows = searchLike(dbConn, q, limit, category);
  }
  return rows
    .map((r) => {
      try { return JSON.parse(r.content_ref); } catch (e) { return null; }
    })
    .filter((x) => x != null);
}

function searchFts(dbConn, q, limit, category) {
  try {
    if (category) {
      return dbConn
        .prepare('SELECT c.content_ref FROM content_fts f JOIN content c ON c.rowid = f.rowid WHERE c.category = ? AND content_fts MATCH ? LIMIT ?')
        .all(category, ftsMatchExpr(q), limit);
    }
    return dbConn
      .prepare('SELECT c.content_ref FROM content_fts f JOIN content c ON c.rowid = f.rowid WHERE content_fts MATCH ? LIMIT ?')
      .all(ftsMatchExpr(q), limit);
  } catch (e) {
    return [];
  }
}

function searchLike(dbConn, q, limit, category) {
  const like = `%${q}%`;
  if (category) {
    return dbConn
      .prepare('SELECT content_ref FROM content WHERE category = ? AND (title LIKE ? OR body_plain LIKE ? OR tags LIKE ?) LIMIT ?')
      .all(category, like, like, like, limit);
  }
  return dbConn
    .prepare('SELECT content_ref FROM content WHERE title LIKE ? OR body_plain LIKE ? OR tags LIKE ? LIMIT ?')
    .all(like, like, like, limit);
}

/** 把用户输入转成 FTS5 MATCH 表达式（去特殊字符，防止语法错误）。 */
function ftsMatchExpr(q) {
  const escaped = q.replace(/["'*():^+-]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  return escaped ? `"${escaped}"` : `${escaped}`;
}

// ── 全库统一搜索（M4）：跨 clip / knowledge / learning-plan 全部实体 ──

/** 允许参与全库检索的实体类型。 */
const SEARCHABLE_TYPES = ['clip', 'knowledge', 'learning-plan'];

/**
 * 全库统一搜索：跨全部实体类型命中，返回统一类型化命中结构。
 * @param {string} query 搜索关键词
 * @param {{topK?:number, type?:string|null}} [opts]
 *        type 为 'all'/'*'/null/undefined → 不限类型；否则按 content.type 等值过滤
 * @returns {Array<{type:string, id:string, title:string, snippet:string}>}
 */
function searchAll(query, opts) {
  const dbConn = db.getDatabase();
  if (!dbConn || !query || !String(query).trim()) return [];
  const q = String(query).trim();
  const limit = Math.max(1, Math.min(500, Number((opts && opts.topK) || 50)));
  const type = normalizeType(opts && opts.type);

  let rows = searchAllFts(dbConn, q, limit, type);
  if (rows.length === 0) rows = searchAllLike(dbConn, q, limit, type);

  return rows
    .map((r) => {
      try {
        const entity = JSON.parse(r.content_ref);
        return toHit(r, entity);
      } catch (e) { return null; }
    })
    .filter((x) => x != null);
}

/** 把 type 入参归一化为可用的 content.type 或 null（不限）。 */
function normalizeType(type) {
  if (!type || type === 'all' || type === '*') return null;
  return String(type).trim();
}

function searchAllFts(dbConn, q, limit, type) {
  try {
    const sql = type
      ? 'SELECT c.type, c.id, c.content_ref FROM content_fts f JOIN content c ON c.rowid = f.rowid WHERE c.type = ? AND content_fts MATCH ? LIMIT ?'
      : 'SELECT c.type, c.id, c.content_ref FROM content_fts f JOIN content c ON c.rowid = f.rowid WHERE content_fts MATCH ? LIMIT ?';
    return type
      ? dbConn.prepare(sql).all(type, ftsMatchExpr(q), limit)
      : dbConn.prepare(sql).all(ftsMatchExpr(q), limit);
  } catch (e) {
    return [];
  }
}

function searchAllLike(dbConn, q, limit, type) {
  const like = `%${q}%`;
  const sql = type
    ? 'SELECT type, id, content_ref FROM content WHERE type = ? AND (title LIKE ? OR body_plain LIKE ? OR tags LIKE ?) LIMIT ?'
    : 'SELECT type, id, content_ref FROM content WHERE title LIKE ? OR body_plain LIKE ? OR tags LIKE ? LIMIT ?';
  return type
    ? dbConn.prepare(sql).all(type, like, like, like, limit)
    : dbConn.prepare(sql).all(like, like, like, limit);
}

/** 把 content 行 + 反序列化实体归一为统一命中结构。 */
function toHit(row, entity) {
  const type = row.type || 'clip';
  let title = entity.title;
  let snippet = entity.bodyContent || entity.content || entity.summary || entity.analysis || '';
  // knowledge：title；learning-plan：无 title，用 goal/阶段标题
  if (!title && type === 'learning-plan') {
    title = entity.goal;
    if (!snippet && Array.isArray(entity.phases)) {
      snippet = entity.phases.map((p) => p.title).filter(Boolean).join(', ');
    }
  }
  return {
    type,
    id: row.id || (type + ':' + entity.id),
    title: String(title || bodyFallback(entity) || '未命名').slice(0, 120),
    snippet: String(snippet || '').slice(0, 200)
  };
}

function bodyFallback(entity) {
  if (entity.content) return String(entity.content).slice(0, 120);
  return '';
}

module.exports = { search, searchByCategory, searchAll, SEARCHABLE_TYPES };