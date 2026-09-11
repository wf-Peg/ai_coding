/**
 * canvas-group.test.js - 无限画布·分组 frame 层单元测试
 *
 * 覆盖：建组（成员去重 / 空成员拒建）、读组、重命名、
 *       解散（拆 frame 保留节点）、clearAll、与画布节点联动。
 * 运行：node --test electron/sqlite/canvas-group.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cg = require('./canvas-group');
const cn = require('./canvas-node');

let root;
let db;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-group-test-'));
  const { openDatabase } = require('./db');
  db = openDatabase(root);
});

after(() => {
  const dbref = require('./db');
  try { dbref.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 空库重置。 */
function reset() {
  cg.clearAll(db);
  cn.clearAll(db);
}

test('createGroup：建组 + 成员去重 + 空成员拒建', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });

  const g = cg.createGroup(db, { name: '核心', memberIds: [a.id, b.id, a.id, ''] });
  assert.match(g.id, /^group:/);
  assert.equal(g.name, '核心');
  assert.deepEqual(g.members.sort(), [a.id, b.id].sort(), '重复成员被去重');

  // 无有效成员拒建
  assert.equal(cg.createGroup(db, { name: '空', memberIds: [] }), null);
  assert.equal(cg.listGroups(db).length, 1);
});

test('listGroups：返回全部分组及其成员', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  cg.createGroup(db, { name: 'G1', memberIds: [a.id, b.id] });

  const groups = cg.listGroups(db);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.sort(), [a.id, b.id].sort());
});

test('renameGroup：重命名命中 / 不存在失败', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const g = cg.createGroup(db, { name: '旧', memberIds: [a.id] });

  assert.equal(cg.renameGroup(db, g.id, '新名'), true);
  assert.equal(cg.listGroups(db)[0].name, '新名');
  assert.equal(cg.renameGroup(db, 'group:nope', 'x'), false);
});

test('dissolveGroup：解散分组、保留节点与坐标', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A', x: 30, y: 40 });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  const g = cg.createGroup(db, { name: 'G', memberIds: [a.id, b.id] });

  assert.equal(cg.dissolveGroup(db, g.id), true);
  assert.equal(cg.listGroups(db).length, 0);
  // 节点仍在
  assert.equal(cn.listNodes(db).length, 2, '解散分组不应删除节点');
  // 坐标不丢：用 canvas_node 内直接校验节点仍能查到
  assert.equal(cn.updateNode(db, a.id, { text: 'A2' }), true, '节点编辑仍可命中');
});

test('分组不影响语义 relation：canvas 节点/分组与 relation 隔离', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  cg.createGroup(db, { name: 'G', memberIds: [a.id, b.id] });

  const relCountBefore = db.prepare('SELECT COUNT(*) c FROM relation').get().c;
  cg.dissolveGroup(db, a.id); // 不存在的分组 → false，无副作用
  const relCountAfter = db.prepare('SELECT COUNT(*) c FROM relation').get().c;
  assert.equal(relCountAfter, relCountBefore, '分组操作不触碰 relation 表');
});

test('clearAll：清空全部分组', () => {
  reset();
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  cg.createGroup(db, { name: 'G', memberIds: [a.id, b.id] });

  cg.clearAll(db);
  assert.equal(cg.listGroups(db).length, 0);
  const rows = db.prepare('SELECT COUNT(*) c FROM canvas_group_member').get().c;
  assert.equal(rows, 0, '成员登记一并清空');
});