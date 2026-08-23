/**
 * index-service.js - SQLite 本地索引层：对外编排入口
 *
 * 供 Electron 主进程初始化与 IPC handler 调用：
 *   - initLocalIndex(storagePath)：建库建表 + 全量扫描建索引
 *   - rebuild(storagePath)：清空后全量重建
 *   - status()：索引就绪状态 / 世代号 / 条目数
 *   - listByType(type)：按类型快速列表
 *
 * 依赖：db.js / init.js / scanner.js / indexer.js
 */

const db = require('./db');
const indexer = require('./indexer');
const scanner = require('./scanner');
const relationBuilder = require('./relation-builder');
const watcher = require('./watcher');
const { getMeta, upsertMeta } = require('./init');

// 运行时状态
const state = { ready: false, generation: 0 };

/**
 * 扫描并索引 knowledge / learning-plan 实体，收集各类型 id 集合用于增量 prune，
 * 并构建关系表。供 initLocalIndex / rescan 复用。
 *
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} storagePath config.storagePath
 * @returns {{knowledgeIds:Set<string>, planIds:Set<string>, addedCount:number}}
 */
function indexEntities(dbConn, storagePath) {
  const records = scanner.scanEntities(storagePath);
  const byType = { 'knowledge': new Set(), 'learning-plan': new Set() };
  let added = 0;
  for (const { filePath, mtime, type, entity } of records) {
    const id = indexer.entityId(entity, type);
    byType[type].add(id);
    if (indexer.upsertEntity(dbConn, entity, type, filePath, mtime)) added++;
  }
  // 增量删除：清理本次扫描已消失的 knowledge/plan
  indexer.pruneMissing(dbConn, byType['knowledge'], 'knowledge');
  indexer.pruneMissing(dbConn, byType['learning-plan'], 'learning-plan');
  // 关系表全量重建（依赖 knowledge/plan 权威字段）
  relationBuilder.buildRelations(dbConn, records);
  return { knowledgeIds: byType['knowledge'], planIds: byType['learning-plan'], addedCount: added };
}

/**
 * 初始化本地索引：建库建表 + 全量扫描 clip-storage 建索引。
 * 幂等，可安全重复调用；不阻塞，由调用方决定时机。
 *
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录）
 * @returns {{ready, generation, count}}
 */
function initLocalIndex(storagePath) {
  const dbConn = db.openDatabase(storagePath);
  const clipRoot = scanner.resolveClipStoragePath(storagePath);

  // 清空后全量重建（索引是缓存，从权威 JSON 重建）
  const tx = (fn) => {
    dbConn.exec('BEGIN');
    try { const r = fn(); dbConn.exec('COMMIT'); return r; }
    catch (e) { dbConn.exec('ROLLBACK'); throw e; }
  };

  let count = 0;
  tx(() => {
    indexer.clearAll(dbConn);
    const records = scanner.scanClips(clipRoot);
    for (const { filePath, mtime, clip } of records) {
      if (indexer.upsertClip(dbConn, clip, filePath, mtime)) count++;
    }
    // 实体（knowledge/learning-plan）索引 + 关系表构建
    indexEntities(dbConn, storagePath);
  });

  const generation = (parseInt(getMeta(dbConn, 'data_generation') || '0', 10) || 0) + 1;
  upsertMeta(dbConn, 'data_generation', String(generation));

  state.ready = true;
  state.generation = generation;
  return { ready: true, generation, count: indexer.count(dbConn), relationCount: relationBuilder.count(dbConn) };
}

/** 全量重建（等价 /api/relations/sync 语义）。 */
function rebuild(storagePath) {
  return initLocalIndex(storagePath);
}

/**
 * 增量重扫：重扫 clip-storage，按 file_path+mtime 幂等 upsert 新增/修改，
 * prune 删除本次扫描已消失的 clip，末尾统一 rebuild FTS。
 * 供文件 watcher 与手动「增量刷新」调用。
 *
 * @param {string} storagePath
 * @returns {{added:number, updated:number, removed:number, skipped:number, count:number}}
 */
function rescan(storagePath) {
  const dbConn = db.openDatabase(storagePath);
  const clipRoot = scanner.resolveClipStoragePath(storagePath);
  const tx = (fn) => {
    dbConn.exec('BEGIN');
    try { const r = fn(); dbConn.exec('COMMIT'); return r; }
    catch (e) { dbConn.exec('ROLLBACK'); throw e; }
  };

  let added = 0, updated = 0, removed = 0, skipped = 0;
  tx(() => {
    const records = scanner.scanClips(clipRoot);
    const scannedIds = new Set();
    for (const { filePath, mtime, clip } of records) {
      const id = indexer.clipId(clip);
      scannedIds.add(id);
      const exists = !!dbConn.prepare('SELECT 1 FROM content WHERE id = ?').get(id);
      if (indexer.upsertClip(dbConn, clip, filePath, mtime)) {
        exists ? updated++ : added++;
      } else {
        skipped++;
      }
    }
    removed = indexer.pruneMissing(dbConn, scannedIds);
    // 实体（knowledge/learning-plan）增量索引 + 关系表重建
    const e = indexEntities(dbConn, storagePath);
    added += e.addedCount;
  });

  // FTS 统一重建，规避 external content 表在 WAL 下行级删除/写入的 CORRUPT
  indexer.rebuildFts(dbConn);
  return { added, updated, removed, skipped, count: indexer.count(dbConn), relationCount: relationBuilder.count(dbConn) };
}

/**
 * 启动 clip-storage 实时监听：文件变化防抖后触发一次 rescan。
 * @param {string} storagePath
 * @param {(delta:{added:number,updated:number,removed:number,count:number})=>void} [onDelta] 每次重扫结果的回调
 * @returns {{started:boolean, stop?:Function, reason?:string}} watcher 句柄
 */
function startWatcher(storagePath, onDelta) {
  const handle = () => {
    try {
      const delta = rescan(storagePath);
      if (onDelta) onDelta(delta);
    } catch (e) {
      console.error('[local-index watcher] rescan error:', e && e.message);
    }
  };
  return watcher.startWatching(storagePath, handle);
}

/** 索引状态。 */
function status() {
  const dbConn = db.getDatabase();
  const count = dbConn ? indexer.count(dbConn) : 0;
  const generation = state.ready && dbConn
    ? (parseInt(getMeta(dbConn, 'data_generation') || '0', 10) || 0)
    : 0;
  const relationCount = dbConn ? relationBuilder.count(dbConn) : 0;
  return { ready: state.ready, generation, count, relationCount };
}

/**
 * 按类型列出 clip（content_ref 反序列化）。一期内容均为 'clip'，
 * 预留 type 参数便于二期扩展。
 * @param {string} [type='clip']
 * @param {number} [limit]
 * @returns {Array<Object>}
 */
function listByType(type = 'clip', limit = 200) {
  const dbConn = db.getDatabase();
  if (!dbConn) return [];
  const rows = dbConn
    .prepare('SELECT content_ref FROM content WHERE type = ? ORDER BY updated_at DESC LIMIT ?')
    .all(type, limit || 200);
  return rows.map((r) => {
    try { return JSON.parse(r.content_ref); } catch (e) { return null; }
  }).filter((x) => x != null);
}

module.exports = { initLocalIndex, rebuild, status, listByType, rescan, startWatcher };