/**
 * canvas-ink.test.js - 无限画布·手绘墨迹层单元测试
 *
 * 覆盖：saveInk 整文档全量替换语义、按 doc 隔离、points 非法跳过、
 *       超上限截断（INK_MAX_PER_DOC）、clearDoc / clearAll / countInk、
 *       newInkId 格式、deleteDoc 级联清墨迹（无幽灵墨迹）。
 *
 * 说明：db.js 的 openDatabase 是进程级单例，无法并行隔离；本文件每个用例
 *       用 node:sqlite 独立建库（init.migrate），互不干扰（数据写入型测试）。
 * 运行：node --test electron/sqlite/canvas-ink.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DatabaseSync } = require('node:sqlite');
const ink = require('./canvas-ink');
const cd = require('./canvas-doc');

let root;
let seq = 0;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-ink-test-'));
});

after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 每个用例独立建库（含 v8 迁移）；用后由用例自行 close。 */
function makeDb() {
  seq += 1;
  const file = path.join(root, 'db-' + seq + '.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  require('./init').migrate(db);
  return db;
}

const closeDb = (db) => { try { db.close(); } catch (e) {} };

/** 生成一笔合法墨迹（id/颜色/粗细/透明度/世界坐标点）。 */
function stroke(overrides) {
  return Object.assign({
    id: ink.newInkId(),
    color: '#1a73e8',
    width: 6,
    opacity: 1,
    points: [[0, 0], [12, 44], [60, 90]]
  }, overrides || {});
}

test('saveInk 整文档全量替换：再次保存仅保留最新一批', () => {
  const db = makeDb();
  const docId = cd.createDoc(db).id;
  const s1 = stroke({ id: 'ink:a1' });
  const s2 = stroke({ id: 'ink:a2' });
  const r1 = ink.saveInk(db, docId, [s1, s2]);
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.saved, 2);
  assert.strictEqual(r1.truncated, false);
  assert.strictEqual(ink.countInk(db, docId), 2);

  const s3 = stroke({ id: 'ink:a3' });
  const r2 = ink.saveInk(db, docId, [s3]);
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.saved, 1);
  // 全量替换：旧笔被删除，只剩 s3
  const ids = ink.listInk(db, docId).map((s) => s.id);
  assert.deepStrictEqual(ids, ['ink:a3']);
  closeDb(db);
});

test('按文档隔离：各文档墨迹互不影响', () => {
  const db = makeDb();
  const docA = cd.createDoc(db).id;
  const docB = cd.createDoc(db).id;
  ink.saveInk(db, docA, [stroke()]);
  ink.saveInk(db, docB, [stroke(), stroke()]);
  assert.strictEqual(ink.countInk(db, docA), 1);
  assert.strictEqual(ink.countInk(db, docB), 2);
  assert.strictEqual(ink.countInk(db, 'doc:other'), 0);
  closeDb(db);
});

test('points 非法笔迹被跳过（不影响合法笔）', () => {
  const db = makeDb();
  const docId = cd.createDoc(db).id;
  const r = ink.saveInk(db, docId, [
    stroke({ id: 'ink:ok1' }),
    stroke({ id: 'ink:bad1', points: 'not-array' }),
    stroke({ id: 'ink:bad2', points: [[1]] }),
    stroke({ id: 'ink:bad3', points: [[NaN, 2]] }),
    stroke({ id: 'ink:ok2', points: [[0, 0]] })
  ]);
  assert.strictEqual(r.saved, 2);
  const ids = ink.listInk(db, docId).map((s) => s.id);
  assert.deepStrictEqual(ids, ['ink:ok1', 'ink:ok2']);
  closeDb(db);
});

test('超上限截断：截断最旧笔迹并返回 truncated 标记', () => {
  const db = makeDb();
  const docId = cd.createDoc(db).id;
  const many = [];
  for (let i = 0; i < ink.INK_MAX_PER_DOC + 2; i++) {
    many.push(stroke({ id: 'ink:seq-' + i }));
  }
  const r = ink.saveInk(db, docId, many);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.saved, ink.INK_MAX_PER_DOC);
  assert.strictEqual(ink.countInk(db, docId), ink.INK_MAX_PER_DOC);
  // 最旧两笔被截断，最新 INK_MAX 笔保留
  const ids = ink.listInk(db, docId).map((s) => s.id);
  assert.strictEqual(ids[0], 'ink:seq-2');
  assert.strictEqual(ids[ids.length - 1], 'ink:seq-' + (ink.INK_MAX_PER_DOC + 1));
  closeDb(db);
});

test('points 序列化往返：库中反序列化为数组', () => {
  const db = makeDb();
  const docId = cd.createDoc(db).id;
  const s = stroke({ id: 'ink:rt', points: [[3, 4], [9, 16]] });
  ink.saveInk(db, docId, [s]);
  const loaded = ink.listInk(db, docId)[0];
  assert.deepStrictEqual(loaded.points, [[3, 4], [9, 16]]);
  assert.strictEqual(loaded.id, 'ink:rt');
  assert.strictEqual(loaded.color, s.color);
  assert.strictEqual(loaded.width, s.width);
  assert.strictEqual(loaded.opacity, s.opacity);
  closeDb(db);
});

test('clearDoc 只清指定文档；clearAll 全清', () => {
  const db = makeDb();
  const docA = cd.createDoc(db).id;
  const docB = cd.createDoc(db).id;
  ink.saveInk(db, docA, [stroke()]);
  ink.saveInk(db, docB, [stroke(), stroke()]);

  assert.strictEqual(ink.clearDoc(db, docA), true);
  assert.strictEqual(ink.countInk(db, docA), 0);
  assert.strictEqual(ink.countInk(db, docB), 2);

  const cleared = ink.clearAll(db);
  assert.strictEqual(cleared, 2);
  assert.strictEqual(ink.countInk(db, docB), 0);
  closeDb(db);
});

test('newInkId 格式稳定且唯一', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const id = ink.newInkId();
    assert.match(id, /^ink:[0-9a-z]+:[0-9a-z]{6}$/, `id 格式非法: ${id}`);
    seen.add(id);
  }
  assert.strictEqual(seen.size, 50, 'id 应保持唯一');
});

test('deleteDoc 级联清理该文档墨迹（无幽灵墨迹）', () => {
  const db = makeDb();
  const docA = cd.createDoc(db).id;
  const docB = cd.createDoc(db).id;
  cd.createDoc(db); // 保证 ≥2 文档，deleteDoc 不被「至少保留一个」拦截
  ink.saveInk(db, docA, [stroke(), stroke()]);
  ink.saveInk(db, docB, [stroke()]);

  const r = cd.deleteDoc(db, docA);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.removed.ink, 2);
  assert.strictEqual(ink.countInk(db, docA), 0);
  assert.strictEqual(ink.countInk(db, docB), 1, '其他文档墨迹不受影响');
  closeDb(db);
});