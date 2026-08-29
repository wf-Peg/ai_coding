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
// 周期维护定时器（optimize 频繁、VACUUM 低峰），应用退出时 stopMaintenance 清理
let maintenanceTimer = null;
let vacuumTimer = null;
const OPTIMIZE_INTERVAL = 6 * 3600 * 1000;   // 6 小时做一次轻量 optimize
const VACUUM_INTERVAL = 24 * 3600 * 1000;    // 24 小时做一次真空回收

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
  // 关系表重建（含遗留 relation-index.json 合并，唯一迁移承载）
  return relationBuilder.buildRelations(dbConn, records, storagePath);
}

/**
 * 扫描并索引 obsidian-vault/sources 源文件（type='vault'），收集 id 集合用于增量 prune。
 * 不参与关系表构建；仅供全局搜索（searchAll）命中与打开。
 *
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} storagePath config.storagePath
 * @returns {number} 本次新写入条数
 */
function indexVaultSources(dbConn, storagePath) {
  const records = scanner.scanVaultSources(storagePath);
  const scannedIds = new Set();
  let added = 0;
  for (const { filePath, mtime, source } of records) {
    const id = indexer.vaultId(source.relativePath);
    scannedIds.add(id);
    if (indexer.upsertVaultSource(dbConn, source, filePath, mtime)) added++;
  }
  indexer.pruneMissing(dbConn, scannedIds, 'vault');
  return added;
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
    // 实体（knowledge/learning-plan）索引 + 关系表重建（内含遗留 index 合并）
    indexEntities(dbConn, storagePath);
    // vault 源文件（obsidian-vault/sources，type='vault'）索引（不参与关系）
    indexVaultSources(dbConn, storagePath);
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
    // 实体（knowledge/learning-plan）增量索引 + 关系表重建（含遗留 index 合并）
    indexEntities(dbConn, storagePath);
    // vault 源文件增量索引（obsidian-vault/sources）
    indexVaultSources(dbConn, storagePath);
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

/**
 * 启动索引库周期维护：6h 轻量 optimize，24h 一次 VACUUM（低峰回收空闲页）。
 * 返回 stop 用于退出时清理。空闲连接时静默跳过。
 * @returns {{started:boolean, stop:Function}}
 */
function startMaintenance() {
  if (maintenanceTimer) return { started: true, stop: stopMaintenance };
  const fire = () => {
    try { if (db.optimize()) {} } catch (e) {}
  };
  const fireVacuum = () => {
    try { db.vacuum(); } catch (e) {}
  };
  maintenanceTimer = setInterval(() => {
    fire();
    // 简单的整点对齐：仅在到达 VACUUM 间隔时才执行真空（由调用方控制首次即可先 optimize）
  }, OPTIMIZE_INTERVAL);
  // 单独低频定时器做真空，避免与 optimize 互相干扰
  vacuumTimer = setInterval(fireVacuum, VACUUM_INTERVAL);
  // 兜底：两个定时器都 unref，不阻止应用退出
  if (maintenanceTimer.unref) maintenanceTimer.unref();
  if (vacuumTimer.unref) vacuumTimer.unref();
  return { started: true, stop: stopMaintenance };
}

/** 停止周期维护并清空定时器。 */
function stopMaintenance() {
  if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
  if (vacuumTimer) { clearInterval(vacuumTimer); vacuumTimer = null; }
}

/** 关闭索引库：停维护 → closeDatabase（内含 optimize + WAL checkpoint 落盘）。 */
function close() {
  stopMaintenance();
  try { state.ready = false; } catch (e) {}
  db.closeDatabase();
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

module.exports = { initLocalIndex, rebuild, status, listByType, rescan, startWatcher, startMaintenance, stopMaintenance, close };