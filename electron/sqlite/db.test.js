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

test('建库后 meta.schema_version 应为 8', () => {
  const { db } = makeDb();
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(row.value, '8');
});

test('canvas_doc 表与画布层级列已创建（画布多文档 + 大纲 v7）', () => {
  const { db } = makeDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_doc'").get();
  assert.ok(tbl, 'canvas_doc 表应存在');

  const nodeCols = db.prepare('PRAGMA table_info(canvas_node)').all().map((r) => r.name);
  for (const col of ['doc_id', 'parent_id', 'order_index']) {
    assert.ok(nodeCols.includes(col), `canvas_node 应有列 ${col}`);
  }
  const edgeCols = db.prepare('PRAGMA table_info(canvas_edge)').all().map((r) => r.name);
  assert.ok(edgeCols.includes('doc_id'), 'canvas_edge 应有列 doc_id');
  const groupCols = db.prepare('PRAGMA table_info(canvas_group)').all().map((r) => r.name);
  assert.ok(groupCols.includes('doc_id'), 'canvas_group 应有列 doc_id');

  const def = db.prepare("SELECT id, title FROM canvas_doc WHERE id='doc:default'").get();
  assert.ok(def, '默认文档 doc:default 应自动创建');
});

test('relation 表已创建（M3 v2）', () => {
  const { db } = makeDb();
  const tbl = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='relation'"
  ).all();
  assert.strictEqual(tbl.length, 1);
});

test('canvas_layout 表已创建（无限画布 v3）', () => {
  const { db } = makeDb();
  const tbl = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_layout'"
  ).all();
  assert.strictEqual(tbl.length, 1);
});

test('canvas_node / canvas_edge 表已创建（画布可写节点与手动连线 v4）', () => {
  const { db } = makeDb();
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('canvas_node','canvas_edge')"
  ).all().map((r) => r.name).sort();
  assert.deepEqual(names, ['canvas_edge', 'canvas_node']);
});

test('canvas_group / canvas_group_member 表已创建（分组 frame v5）', () => {
  const { db } = makeDb();
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('canvas_group','canvas_group_member')"
  ).all().map((r) => r.name).sort();
  assert.deepEqual(names, ['canvas_group', 'canvas_group_member']);
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

test('回归：schema_version=5 但缺画布表（真实坏库）应被 v6 补齐', () => {
  const { db } = makeDb();
  // 还原线上坏库状态：版本 5，画布四表缺失（旧实现跳级 bug 的真实产物）
  db.exec('DROP TABLE IF EXISTS canvas_node; DROP TABLE IF EXISTS canvas_edge; DROP TABLE IF EXISTS canvas_group; DROP TABLE IF EXISTS canvas_group_member;');
  db.prepare("UPDATE meta SET value='5' WHERE key='schema_version'").run();
  require('./init').migrate(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('canvas_node','canvas_edge','canvas_group','canvas_group_member')"
  ).all().map((r) => r.name).sort();
  assert.deepEqual(names, ['canvas_edge', 'canvas_group', 'canvas_group_member', 'canvas_node']);
  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(v.value, '8');
  const docTbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_doc'").get();
  assert.ok(docTbl, '坏库修复时也应补出 canvas_doc（v7）');
});

test('回归：旧库 schema_version=2 增量迁移不应跳级', () => {
  const { db } = makeDb();
  // 模拟旧库（仅到 v2）：清掉画布各层表并把版本回拨到 2
  db.exec('DROP TABLE IF EXISTS canvas_layout; DROP TABLE IF EXISTS canvas_node; DROP TABLE IF EXISTS canvas_edge; DROP TABLE IF EXISTS canvas_group; DROP TABLE IF EXISTS canvas_group_member;');
  db.prepare("UPDATE meta SET value='2' WHERE key='schema_version'").run();
  require('./init').migrate(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('canvas_layout','canvas_node','canvas_edge','canvas_group','canvas_group_member')"
  ).all().map((r) => r.name).sort();
  assert.deepEqual(names, ['canvas_edge', 'canvas_group', 'canvas_group_member', 'canvas_layout', 'canvas_node']);
  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(v.value, '8');
});

test('v7 回填：历史画布数据挂默认文档并补 order_index（幂等可重跑）', () => {
  const { db } = makeDb();
  // 模拟 v6 旧库：先写入无 doc_id / 无 order_index 的历史画布节点
  db.prepare(
    "INSERT INTO canvas_node (id, kind, text, title, created_at, updated_at) VALUES (?,?,?,?,?,?)"
  ).run('note:legacy-1', 'note', '历史便签', '历史便签', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  db.prepare(
    "INSERT INTO canvas_node (id, kind, text, title, created_at, updated_at) VALUES (?,?,?,?,?,?)"
  ).run('note:legacy-2', 'note', '历史便签2', '历史便签2', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  db.exec("DELETE FROM canvas_doc; UPDATE meta SET value='6' WHERE key='schema_version'");

  require('./init').migrate(db);

  const rows = db
    .prepare('SELECT id, doc_id AS docId, parent_id AS parentId, order_index AS orderIndex FROM canvas_node ORDER BY order_index')
    .all();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.strictEqual(r.docId, 'doc:default', '历史节点应回填默认文档');
    assert.strictEqual(r.parentId, null, '历史节点保持平铺（无父节点）');
    assert.ok(Number.isFinite(r.orderIndex), '历史节点应补 order_index');
  }
  assert.deepEqual(rows.map((r) => r.orderIndex), [0, 1], 'order_index 按创建时间递增');

  // 幂等：再次迁移不报错、不改动已有数据
  require('./init').migrate(db);
  const again = db.prepare('SELECT doc_id AS docId FROM canvas_node WHERE id = ?').get('note:legacy-1');
  assert.strictEqual(again.docId, 'doc:default');
});

test('canvas_ink 表已创建（手绘墨迹 v8：列齐全 + 文档索引）', () => {
  const { db } = makeDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_ink'").get();
  assert.ok(tbl, 'canvas_ink 表应存在');

  const cols = db.prepare('PRAGMA table_info(canvas_ink)').all().map((r) => r.name);
  for (const c of ['id', 'doc_id', 'color', 'width', 'opacity', 'points', 'sort_index', 'created_at', 'updated_at']) {
    assert.ok(cols.includes(c), `canvas_ink 应有列 ${c}`);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_canvas_ink_doc'").get();
  assert.ok(idx, 'canvas_ink 应有 doc_id+sort_index 索引');
});

test('v8 迁移：schema_version=7 旧库增量建表且连续 migrate() 两次幂等', () => {
  const { db } = makeDb();
  db.prepare("UPDATE meta SET value='7' WHERE key='schema_version'").run();
  db.exec('DROP TABLE IF EXISTS canvas_ink');

  require('./init').migrate(db);

  const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  assert.strictEqual(v.value, '8', '迁移后 schema_version 应为 8');
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_ink'").get();
  assert.ok(tbl, '迁移后 canvas_ink 表应创建');

  // 迁移幂等：同一库连续 migrate() 两次，表与索引不重复创建、不报错
  require('./init').migrate(db);
  const v2 = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='canvas_ink'").get().c;
  const indexes = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_canvas_ink_doc'").get().c;
  assert.strictEqual(v2.value, '8');
  assert.strictEqual(tables, 1, 'canvas_ink 表不得重复创建');
  assert.strictEqual(indexes, 1, 'canvas_ink 索引不得重复创建');
});