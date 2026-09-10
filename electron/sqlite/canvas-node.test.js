/**
 * canvas-node.test.js - 无限画布·可写节点与手动连线层单元测试
 *
 * 覆盖：节点 CRUD（kind 校验 / 坐标写入 / 更新 / 删除级联）、
 *       手动连线（端点校验 / 自环排除 / 幂等 / 删除）、
 *       graph 合并画布节点与手动连线、语义联系统计不受画布层污染。
 * 运行：node --test electron/sqlite/canvas-node.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cn = require('./canvas-node');
const canvasLayout = require('./canvas-layout');
const graph = require('./graph');

let root;
let db;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-test-'));
  const { openDatabase } = require('./db');
  db = openDatabase(root);
});

after(() => {
  const dbref = require('./db');
  try { dbref.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 打一条语义内容节点（用于画布手工连线到内容节点）。 */
function seedContent(id) {
  db.prepare(
    "INSERT OR REPLACE INTO content (id,type,source_id,title,category,tags,body_plain,content_ref,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(id, 'clip', 1, id + ' title', 'study', '[]', id + ' body', '{}', '2026-08-22', '2026-08-22');
}

test('createNode：写入画布节点 + 初始坐标', () => {
  cn.clearAll(db);
  const n = cn.createNode(db, { kind: 'note', text: '第一条想法', x: 12, y: -34 });
  assert.match(n.id, /^note:/);
  assert.equal(n.text, '第一条想法');
  assert.equal(n.x, 12);
  assert.equal(n.y, -34);
  assert.deepEqual(canvasLayout.positions(db).get(n.id), { x: 12, y: -34 });
});

test('createNode：非法 kind 抛错；坐标缺省取 0', () => {
  cn.clearAll(db);
  assert.throws(() => cn.createNode(db, { kind: 'bad' }), /invalid canvas node kind: bad/);
  const n = cn.createNode(db, { kind: 'image' });
  assert.equal(n.x, 0);
  assert.equal(n.y, 0);
});

test('updateNode / deleteNode：内容更新与级联清理', () => {
  cn.clearAll(db);
  const a = cn.createNode(db, { kind: 'note', text: '旧' });
  const b = cn.createNode(db, { kind: 'note', text: '目标' });
  cn.createEdge(db, a.id, b.id);

  assert.equal(cn.updateNode(db, a.id, { text: '新' }), true);
  assert.equal(cn.updateNode(db, 'note:missing', { text: 'x' }), false);
  assert.equal(cn.listNodes(db).find((x) => x.id === a.id).text, '新');

  assert.equal(cn.deleteNode(db, a.id), true);
  assert.equal(cn.listNodes(db).some((x) => x.id === a.id), false);
  assert.equal(cn.listEdges(db).length, 0, '级联删除关联连线');
  assert.equal(cn.listNodes(db).some((x) => x.id === b.id), true, '另一端节点保留');
});

test('createEdge：端点校验 / 自环排除 / 幂等', () => {
  cn.clearAll(db);
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });

  assert.equal(cn.createEdge(db, a.id, a.id), null, '自环拒绝');
  assert.equal(cn.createEdge(db, 'missing:1', b.id), null, '端点不存在拒绝');

  const e1 = cn.createEdge(db, a.id, b.id);
  assert.ok(e1 && e1.source === a.id && e1.target === b.id);
  const e2 = cn.createEdge(db, a.id, b.id);
  assert.equal(e2.id, e1.id, '同向重复创建返回已有边');

  const e3 = cn.createEdge(db, b.id, a.id);
  assert.notEqual(e3.id, e1.id, '反向可各自记录');
  assert.equal(cn.listEdges(db).length, 2);

  assert.equal(cn.deleteEdge(db, e1.id), true);
  assert.equal(cn.deleteEdge(db, e1.id), false, '重复删除命中失败');
  assert.equal(cn.listEdges(db).length, 1);
});

test('createEdge：两端可为语义内容节点（content 表）', () => {
  cn.clearAll(db);
  seedContent('clip:1');
  const n = cn.createNode(db, { kind: 'note', text: '笔记' });
  const e = cn.createEdge(db, 'clip:1', n.id);
  assert.ok(e, '画布节点 → 语义节点 手动连线应创建成功');
});

test('graph 合并：画布节点/手动连线入图，type=manual，与语义关系并存', () => {
  cn.clearAll(db);
  seedContent('clip:1');
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  cn.createEdge(db, a.id, b.id);
  cn.createEdge(db, 'clip:1', a.id);

  const g = graph.getGraph(db, null);
  assert.ok(g.nodes.some((n) => n.id === a.id), '画布节点入图');
  assert.ok(g.nodes.some((n) => n.id === b.id), '画布节点入图');

  const manualLinks = g.links.filter((l) => l.type === 'manual');
  assert.equal(manualLinks.length, 2, '两条手动连线 type=manual');
  assert.ok(g.links.some((l) => l.source === 'clip:1' && l.target === a.id));
  assert.ok(g.links.some((l) => l.source === a.id && l.target === b.id));

  // 语义关系不受画布层影响：content 节点必在图中
  assert.ok(g.nodes.some((n) => n.id === 'clip:1'), '语义节点仍在图中');
});

test('clearAll：清空画布节点/边/坐标', () => {
  cn.clearAll(db);
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  cn.createEdge(db, a.id, b.id);

  cn.clearAll(db);
  assert.equal(cn.listNodes(db).length, 0);
  assert.equal(cn.listEdges(db).length, 0);
  assert.equal(canvasLayout.positions(db).size, 0);
});