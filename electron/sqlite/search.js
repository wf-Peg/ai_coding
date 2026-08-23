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

module.exports = { search, searchByCategory };