/**
 * db.test.js - M0 基建单测
 * 验证 node:sqlite 建库/建表/FTS5 可用性，并实测 trigram tokenizer 是否启用。
 * 运行：node --test electron/sqlite/db.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 每个用例用独立临时目录，避免单例连接残留
function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-test-'));
  const { openDatabase } = require('./db');
  const db = openDatabase(dir);
  return { db, dir };
}

test('node:sqlite 可用（Electron 36 / Node 22 内置）', () => {
  const { db } = makeDb();
  const row = db.prepare('SELECT sqlite_version() AS v').get();
  assert.ok(row && row.v, `sqlite_version 应为非空，实际=${row && row.v}`);
});

test('建库后 meta.schema_version 应为 1', () => {
  const { db } = makeDb();
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(row.value, '1');
});

test('content / content_fts 表已创建，可写入 FTS 关联', () => {
  const { db } = makeDb();
  db.prepare(
    "INSERT INTO content (id,type,source_id,title,category,tags,body_plain,content_ref,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(
    'clip:1', 'clip', 1, 'React 入门', 'study', '["前端"]', 'React 入门 组件 状态', '{"id":1,"title":"React 入门"}', '2026-08-22', '2026-08-22'
  );
  // 手动回填 FTS（与内容一致）
  db.prepare(
    "INSERT INTO content_fts(rowid, title, body_plain, category, tags) SELECT rowid, title, body_plain, category, tags FROM content WHERE id=?"
  ).run('clip:1');

  const hit = db.prepare("SELECT * FROM content_fts WHERE content_fts MATCH ?").all('React');
  assert.ok(hit.length >= 1, 'FTS MATCH 应命中 React');
});

test('trigram tokenizer 实测（记录是否启用，不影响一期功能）', () => {
  // node:sqlite 捆绑的 SQLite 若编译启用 FTS5 trigram 则可建表
  const { db } = makeDb();
  let trigramSupported = false;
  let err = null;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS t_trigram_test USING fts5(x, tokenize='trigram');");
    trigramSupported = true;
  } catch (e) {
    err = e.message;
  }
  // 记录结论供决定是否切换；不因不支持而失败
  console.log(`[trigram] supported=${trigramSupported} ${err ? '| ' + err : ''}`);
});

test('WAL 模式已启用', () => {
  const { db } = makeDb();
  const row = db.prepare('PRAGMA journal_mode').get();
  assert.strictEqual(row.journal_mode, 'wal');
});