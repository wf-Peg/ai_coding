/**
 * indexer.js - SQLite 本地索引层：增量 upsert / delete clip 到 content + content_fts
 *
 * 仅主进程写库（避免锁竞争）。一致性「文件为真、库为缓存」：
 * 以 file_path + mtime 判定，mtime 未变则跳过写入（幂等）。
 */

const { extractBodyPlain, extractEntityBodyPlain } = require('./scanner');

/** 全局唯一 id：'clip:' + source_id。 */
function clipId(clip) {
  return 'clip:' + clip.id;
}

/** 实体全局唯一 id：'{type}:{entity.id}'（knowledge/learning-plan）。 */
function entityId(entity, type) {
  return type + ':' + entity.id;
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
 * upsert 一条实体（knowledge / learning-plan）到 content，作为图谱/搜索节点。
 * 与 upsertClip 同语义：同 id 且 mtime 一致则跳过。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} entity
 * @param {string} type content.type（'knowledge' / 'learning-plan'）
 * @param {string} filePath
 * @param {string} mtime
 * @returns {boolean} true=已写入，false=命中缓存跳过
 */
function upsertEntity(db, entity, type, filePath, mtime) {
  if (!entity || entity.id === null || entity.id === undefined) return false;
  const id = entityId(entity, type);

  const existing = db.prepare('SELECT mtime FROM content WHERE id = ?').get(id);
  if (existing && existing.mtime === mtime) return false;

  const now = new Date().toISOString();
  const tagsStr = Array.isArray(entity.tags)
    ? JSON.stringify(entity.tags)
    : (entity.tags ? String(entity.tags) : null);
  const p = {
    id,
    type,
    source_id: entity.id,
    title: entity.title || (type === 'learning-plan' ? entity.goal : null),
    summary: entity.summary || (type === 'learning-plan' ? entity.goal : null),
    category: entity.category || null,
    tags: tagsStr,
    body_plain: extractEntityBodyPlain(entity, type),
    content_ref: JSON.stringify(entity),
    mtime,
    file_path: filePath,
    created_at: now,
    updated_at: now
  };
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
  return true;
}

/** vault 源文件全局唯一 id：'vault:' + relativePath（如 vault:sources/示例.md）。 */
function vaultId(relativePath) {
  return 'vault:' + relativePath;
}

/**
 * upsert 一条 vault 源文件到 content（type='vault'），作为搜索节点。
 * 与 upsertClip 同语义：同 id 且 mtime 一致则跳过。
 * source_id 置空（源文件无整数 id）；body_plain 存全文供 FTS；content_ref 保留
 * fileName/relativePath/filePath/content，供命中后打开文件与展示摘要。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} source   scanner.scanVaultSources 产出的 source 对象
 * @param {string} filePath 源文件绝对路径
 * @param {string} mtime    源文件 mtime
 * @returns {boolean} true=已写入，false=命中缓存跳过
 */
function upsertVaultSource(db, source, filePath, mtime) {
  if (!source || !source.relativePath) return false;
  const id = vaultId(source.relativePath);

  const existing = db.prepare('SELECT mtime FROM content WHERE id = ?').get(id);
  if (existing && existing.mtime === mtime) return false;

  const now = new Date().toISOString();
  const p = {
    id,
    type: 'vault',
    source_id: null,
    title: source.title || source.fileName || null,
    summary: null,
    category: null,
    tags: null,
    body_plain: source.content || '',
    content_ref: JSON.stringify({
      type: 'vault',
      fileName: source.fileName,
      relativePath: source.relativePath,
      filePath: filePath,
      title: source.title,
      content: source.content || ''
    }),
    mtime,
    file_path: filePath,
    created_at: now,
    updated_at: now
  };
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
  // 注意：仅删 content，不手动删 content_fts（external content 表行级删除会触发
  // SQLITE_CORRUPT）。调用方若需要 FTS 同步，应在批量操作后统一 rebuildFts。
  db.prepare('DELETE FROM content WHERE id = ?').run(id);
}

/**
 * 删除本次扫描集合里已不存在的指定类型记录（增量删除）。
 * 以「实体 id 集合」判定而非 file_path：一个 JSON 文件可能含多条记录，
 * 同文件内某条被移除时也应删除索引；反之同一 id 若在别处仍存在则保留（id 为实体）。
 * 只删 content 主表行，FTS 交由调用方在末尾统一 rebuild 同步。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Set<string>} scannedIds 本次扫描留下的主键 id 集合
 * @param {string} type 目标 type（'clip' / 'knowledge' / 'learning-plan'），默认 'clip'
 * @returns {number} 删除条数
 */
function pruneMissing(db, scannedIds, type) {
  const t = type || 'clip';
  const rows = db.prepare('SELECT id FROM content WHERE type = ?').all(t);
  let removed = 0;
  for (const r of rows) {
    if (!scannedIds.has(r.id)) {
      db.prepare('DELETE FROM content WHERE id = ?').run(r.id);
      removed++;
    }
  }
  return removed;
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

module.exports = { upsertClip, upsertEntity, upsertVaultSource, deleteClip, clearAll, count, clipId, entityId, vaultId, rebuildFts, pruneMissing };