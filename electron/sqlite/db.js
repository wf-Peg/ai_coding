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

/** 关闭连接（主要用于测试清理）。 */
function closeDatabase() {
  if (dbInstance) {
    try { dbInstance.close(); } catch (e) { /* ignore */ }
    dbInstance = null;
  }
}

/** 返回当前单例（未打开时为 null）。 */
function getDatabase() {
  return dbInstance;
}

module.exports = { openDatabase, closeDatabase, getDatabase };