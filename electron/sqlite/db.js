/**
 * db.js - SQLite 本地索引层：驱动门面（node:sqlite）
 *
 * 使用 Node 内置 node:sqlite（DatabaseSync），零第三方依赖。
 * 运行于 Electron 主进程 Node 侧，不依赖 Java 后端。
 *
 * 说明：
 *   - node:sqlite 在 Node 22 为实验性模块，require 时会向 stderr 输出
 *     ExperimentalWarning，功能可用，本模块不刻意抑制。
 *   - API 差异：无 db.transaction()，事务需手写 BEGIN/COMMIT/ROLLBACK。
 */

const path = require('path');

// 单例连接（同进程共享，避免多连接锁竞争；仅主进程写库）
let dbInstance = null;

/**
 * 打开（或复用）本地索引库连接。
 * 索引库文件位于 {storagePath}/.index/app-index.sqlite。
 *
 * @param {string} storagePath Clip_Bed 父目录（config.storagePath）
 * @returns {import('node:sqlite').DatabaseSync} SQLite 连接（已建表、已迁移）
 */
function openDatabase(storagePath) {
  if (!storagePath) throw new Error('openDatabase: storagePath is required');

  if (dbInstance) return dbInstance;

  const indexDir = path.join(storagePath, '.index');
  const fs = require('fs');
  if (!fs.existsSync(indexDir)) fs.mkdirSync(indexDir, { recursive: true });

  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(indexDir, 'app-index.sqlite');
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL;');   // 读写并发，降低主进程卡顿
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  require('./init').migrate(db);
  dbInstance = db;
  return db;
}

/** 对当前连接做轻量维护：analyze 缺失索引 + 重建内部统计，成本低可周期性执行。 */
function optimize() {
  if (!dbInstance) return false;
  try { dbInstance.exec('PRAGMA optimize;'); return true; } catch (e) { return false; }
}

/**
 * 真空回收空闲页（文件裁剪）。比 PRAGMA optimize 重，周期/低峰执行即可；
 * 需无活动事务，失败静默（如文件忙/权限），不阻塞业务。
 * @returns {boolean}
 */
function vacuum() {
  if (!dbInstance) return false;
  // WAL 下先 checkpoint 落盘，VACUUM 才真正裁剪主库文件
  try { dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) {}
  try { dbInstance.exec('VACUUM;'); return true; } catch (e) { return false; }
}

/** 关闭连接（主要用于应用退出与测试清理）：先优化再落盘，最后关闭。 */
function closeDatabase() {
  if (dbInstance) {
    try {
      optimize();
      dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);'); // WAL 收尾落盘，避免 shm/wal 残留
    } catch (e) { /* ignore */ }
    try { dbInstance.close(); } catch (e) { /* ignore */ }
    dbInstance = null;
  }
}

/**
 * 快速关闭连接（用于应用退出，避免阻塞进程退出）。
 * 与 closeDatabase 的区别：
 *   - 不做全库 optimize（避免退出时扫描全库耗时）；
 *   - 仅做 PRAGMA wal_checkpoint(PASSIVE)（只刷已提交页，通常毫秒级）。
 * node:sqlite 每条语句本就同步提交至 WAL，退出时残留 -wal/-shm 会在下次打开时由
 * SQLite 自动恢复，不会损坏数据；PASSIVE checkpoint 足以把已提交数据刷入主库。
 */
function closeFast() {
  if (dbInstance) {
    try { dbInstance.exec('PRAGMA wal_checkpoint(PASSIVE);'); } catch (e) { /* ignore */ }
    try { dbInstance.close(); } catch (e) { /* ignore */ }
    dbInstance = null;
  }
}

/** 返回当前单例（未打开时为 null）。 */
function getDatabase() {
  return dbInstance;
}

module.exports = { openDatabase, closeDatabase, closeFast, getDatabase, optimize, vacuum };