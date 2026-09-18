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
const cd = require('./canvas-doc');
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

test('saveStructure：批量缩进/反缩进一次落库（大纲结构真源）', () => {
  cn.clearAll(db);
  const doc = cd.DEFAULT_DOC_ID;
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  const c = cn.createNode(db, { kind: 'note', text: 'C' });

  // B、C 变成 A 的子节点
  const res = cn.saveStructure(db, doc, [
    { id: a.id, parentId: null, orderIndex: 0 },
    { id: b.id, parentId: a.id, orderIndex: 0 },
    { id: c.id, parentId: a.id, orderIndex: 1 }
  ]);
  assert.equal(res.success, true);
  assert.equal(res.saved, 3);

  const rows = cn.listNodes(db, doc);
  assert.equal(rows.find((n) => n.id === b.id).parentId, a.id);
  assert.equal(rows.find((n) => n.id === c.id).orderIndex, 1);
  assert.deepEqual(cn.descendantIds(db, a.id).sort(), [b.id, c.id].sort());

  // 反缩进：C 回到根级
  assert.equal(cn.saveStructure(db, doc, [{ id: c.id, parentId: null, orderIndex: 2 }]).success, true);
  assert.equal(cn.listNodes(db, doc).find((n) => n.id === c.id).parentId, null);
});

test('saveStructure：环检测 / 自父 / 跨文档父节点一律整体拒绝', () => {
  cn.clearAll(db);
  db.exec('DELETE FROM canvas_doc');
  cd.ensureDefaultDoc(db);
  const other = cd.createDoc(db, { title: '另一个文档' });
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B' });
  const foreign = cn.createNode(db, { kind: 'note', text: 'X', docId: other.id });

  assert.equal(cn.saveStructure(db, cd.DEFAULT_DOC_ID, [{ id: a.id, parentId: a.id }]).success, false, '自父拒绝');
  assert.equal(cn.saveStructure(db, cd.DEFAULT_DOC_ID, [{ id: a.id, parentId: foreign.id }]).success, false, '跨文档父拒绝');

  // 造环：B 先挂 A，再让 A 挂 B
  assert.equal(cn.saveStructure(db, cd.DEFAULT_DOC_ID, [{ id: b.id, parentId: a.id }]).success, true);
  const cyc = cn.saveStructure(db, cd.DEFAULT_DOC_ID, [{ id: a.id, parentId: b.id }]);
  assert.equal(cyc.success, false);
  assert.match(cyc.message, /环/);
  assert.equal(cn.listNodes(db, cd.DEFAULT_DOC_ID).find((n) => n.id === a.id).parentId, null, '拒绝后不产生部分写入');
});

test('deleteNode：连带删除整棵子树并清理连线与坐标', () => {
  cn.clearAll(db);
  const a = cn.createNode(db, { kind: 'note', text: 'A' });
  const b = cn.createNode(db, { kind: 'note', text: 'B', parentId: a.id });
  const c = cn.createNode(db, { kind: 'note', text: 'C', parentId: b.id });
  const keep = cn.createNode(db, { kind: 'note', text: 'K' });
  cn.createEdge(db, a.id, keep.id);

  assert.deepEqual(cn.descendantIds(db, a.id).sort(), [b.id, c.id].sort());
  assert.equal(cn.deleteNode(db, a.id), true);
  const left = cn.listNodes(db, cd.DEFAULT_DOC_ID);
  assert.deepEqual(left.map((n) => n.id), [keep.id], '子树整体删除，非子树节点保留');
  assert.equal(cn.listEdges(db).length, 0, '级联清理连线');
  assert.equal(canvasLayout.positions(db).has(b.id), false, '级联清理坐标');
  assert.equal(cn.deleteNode(db, a.id), false, '重复删除命中失败');
});

test('importTree：嵌套建树，parentId/orderIndex 连续正确', () => {
  cn.clearAll(db);
  db.exec('DELETE FROM canvas_doc');
  cd.ensureDefaultDoc(db);

  const res = cn.importTree(db, {
    tree: [
      { text: '根一', children: [
        { text: '子A', children: [ { text: '孙1' } ] },
        { text: '子B' }
      ] },
      { text: '根二' }
    ]
  });
  assert.equal(res.created.length, 5);

  const rows = cn.listNodes(db, cd.DEFAULT_DOC_ID);
  const rootOne = rows.find((n) => n.text === '根一');
  const rootTwo = rows.find((n) => n.text === '根二');
  const childA = rows.find((n) => n.text === '子A');
  const childB = rows.find((n) => n.text === '子B');
  const grand = rows.find((n) => n.text === '孙1');

  assert.equal(rootOne.parentId, null);
  assert.equal(rootTwo.parentId, null);
  assert.equal(childA.parentId, rootOne.id);
  assert.equal(childB.parentId, rootOne.id);
  assert.equal(grand.parentId, childA.id);
  assert.equal(rootOne.orderIndex, 0);
  assert.equal(rootTwo.orderIndex, 1);
  assert.equal(childA.orderIndex, 0);
  assert.equal(childB.orderIndex, 1);
  assert.equal(grand.orderIndex, 0);
  assert.equal(canvasLayout.positions(db).has(rootOne.id), true, '坐标占位写入');
});

test('importTree：追加到现有文档根节点之后', () => {
  cn.clearAll(db);
  const existing = cn.createNode(db, { kind: 'note', text: '已有' });
  const res = cn.importTree(db, { tree: [ { text: '新根', children: [ { text: '子' } ] } ] });
  assert.equal(res.created.length, 2);

  const rows = cn.listNodes(db, cd.DEFAULT_DOC_ID);
  const newRoot = rows.find((n) => n.text === '新根');
  assert.equal(newRoot.orderIndex, existing.orderIndex + 1, '新根接在现有根节点之后');
  assert.equal(rows.find((n) => n.text === '子').parentId, newRoot.id);
});

test('importTree：按 docId 隔离', () => {
  cn.clearAll(db);
  db.exec('DELETE FROM canvas_doc');
  cd.ensureDefaultDoc(db);
  const other = cd.createDoc(db, { title: '其他文档' });

  const res = cn.importTree(db, { docId: other.id, tree: [ { text: 'A' } ] });
  assert.equal(res.created.length, 1);
  assert.equal(cn.listNodes(db, other.id).length, 1);
  assert.equal(cn.listNodes(db, cd.DEFAULT_DOC_ID).length, 0, '默认文档不被污染');
});

test('importTree：空树 / 空文本 / 非法 kind 容错', () => {
  cn.clearAll(db);
  assert.equal(cn.importTree(db, { tree: [] }).created.length, 0, '空树安全');
  const res = cn.importTree(db, { tree: [ { text: '' }, { text: '   ' }, { text: '有效' } ] });
  assert.equal(res.created.length, 1, '空文本节点被跳过');
  assert.throws(() => cn.importTree(db, { tree: [ { text: 'x' } ], kind: 'bad' }),
    /invalid canvas node kind/);
});

test('importTree：limit 截断不越界', () => {
  cn.clearAll(db);
  const big = [];
  for (let i = 0; i < 80; i++) big.push({ text: 'n' + i });
  const res = cn.importTree(db, { tree: big, limit: 10 });
  assert.equal(res.created.length, 10);
  assert.equal(cn.listNodes(db, cd.DEFAULT_DOC_ID).length, 10);
});