/**
 * indexer.js - SQLite 本地索引层：增量 upsert / delete clip 到 content + content_fts
 *
 * 仅主进程写库（避免锁竞争）。一致性「文件为真、库为缓存」：
 * 以 file_path + mtime 判定，mtime 未变则跳过写入（幂等）。
 */

const { extractBodyPlain } = require('./scanner');

/** 全局唯一 id：'clip:' + source_id。 */
function clipId(clip) {
  return 'clip:' + clip.id;
}

/** 把 clip 对象 → content 表参数（不含事务控制）。 */
function recordParams(clip, filePath, mtime) {
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(clip.tags)
    ? JSON.stringify(clip.tags)
    : (clip.tags ? String(clip.tags) : null);
  return {
    id: clipId(clip),
    type: 'clip',
    source_id: clip.id,
    title: clip.title || null,
    summary: clip.summary || null,
    category: clip.category || null,
    tags: tagsStr,
    body_plain: extractBodyPlain(clip),
    content_ref: JSON.stringify(clip),
    mtime,
    file_path: filePath,
    created_at: now,
    updated_at: now
  };
}

/**
 * upsert 一条 clip 到 content（并同步 FTS 关联）。
 * 若该 file_path 的 mtime 与库中一致则跳过。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} clip
 * @param {string} filePath
 * @param {string} mtime
 * @returns {boolean} true=已写入，false=命中缓存跳过
 */
function upsertClip(db, clip, filePath, mtime) {
  const id = clipId(clip);
  if (!clip || clip.id === null || clip.id === undefined) return false;
  if (clip.id === null) return false;
  if (clip.id === undefined) return false;

  // 增量跳过：同 file_path 且 mtime 一致
  const existing = db.prepare('SELECT mtime FROM content WHERE id = ?').get(id);
  if (existing && existing.mtime === mtime) return false;

  const p = recordParams(clip, filePath, mtime);
  const stmt = db.prepare(`
    INSERT INTO content (id, type, source_id, title, summary, category, tags, body_plain, content_ref, mtime, file_path, created_at, updated_at)
    VALUES (@id, @type, @source_id, @title, @summary, @category, @tags, @body_plain, @content_ref, @mtime, @file_path, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, source_id=excluded.source_id, title=excluded.title,
      summary=excluded.summary, category=excluded.category, tags=excluded.tags,
      body_plain=excluded.body_plain, content_ref=excluded.content_ref,
      mtime=excluded.mtime, file_path=excluded.file_path, updated_at=excluded.updated_at
  `);
  stmt.run(p);

  // 注意：FTS 关联不在每条 upsert 内同步。
  // external content 表在 WAL + 逐行 DELETE(rowid) 下会触发 SQLITE_CORRUPT(267)。
  // 改用 FTS5 'rebuild' 指令一次性重建（见 rebuildFts），在全量流程末尾统一调用。

  return true;
}

/**
 * 用 FTS5 'rebuild' 指令从 content 主表重建 content_fts。
 * 适用于全量重建/批量写入后。规避 external content 表逐行 DELETE 的 CORRUPT 问题。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function rebuildFts(db) {
  db.exec("INSERT INTO content_fts(content_fts) VALUES('rebuild')");
}

/** 删除一条 clip（content + FTS）。 */
function deleteClip(db, id) {
  db.prepare('DELETE FROM content_fts WHERE rowid = (SELECT rowid FROM content WHERE id = ?)').run(id);
  db.prepare('DELETE FROM content WHERE id = ?').run(id);
}

/**
 * 清空全部内容（全量重建前调用）。
 * 只清 content 主表 + 用 FTS 'rebuild' 同步外置索引。
 * 不要手动 DELETE content_fts：external content 表在 WAL 下手动删
 * FTS shadow 表会触发 SQLITE_CORRUPT(267)，重建指令是其安全替代。
 */
function clearAll(db) {
  db.exec('DELETE FROM content');
  rebuildFts(db);
}

/** 当前索引条目统计。 */
function count(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM content').get();
  return row ? row.c : 0;
}

module.exports = { upsertClip, deleteClip, clearAll, count, clipId };