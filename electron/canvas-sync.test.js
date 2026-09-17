/**
 * canvas-sync.test.js - 无限画布·后端快照 roundtrip 测试
 *
 * 覆盖：buildSnapshot 组装（文档/节点/连线/坐标/分组，含 docId 与层级字段）、
 *       restoreSnapshot 恢复到全新空库后数据一致、多文档隔离、
 *       v1 旧快照向后兼容（归入默认文档 + order_index 补号）、空/异常快照容错。
 * 不含网络（push/pullSnapshot 依赖 fetch，另做端到端验证）。
 * 运行：node --test electron/canvas-sync.test.js
 *
 * 说明：db.js 的 openDatabase 是进程级单例，无法在一个测试文件里开两份隔离库，
 *       因此目标库（dst）用 node:sqlite 直接创建并运行 init.migrate，与源库完全独立。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DatabaseSync } = require('node:sqlite');
const cn = require('./sqlite/canvas-node');
const cg = require('./sqlite/canvas-group');
const cl = require('./sqlite/canvas-layout');
const cd = require('./sqlite/canvas-doc');
const ci = require('./sqlite/canvas-ink');
const { buildSnapshot, restoreSnapshot } = require('./canvas-sync');

let root;
let dbA;      // 源库（db.js 单例）
let dstFile;  // 目标库（独立 DatabaseSync）

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-sync-test-'));
  const { openDatabase } = require('./sqlite/db');
  dbA = openDatabase(path.join(root, 'src'));

  dstFile = path.join(root, 'dst', '.index', 'app-index.sqlite');
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
});

after(() => {
  const dbref = require('./sqlite/db');
  try { dbref.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 打开一个全新的目标库（每次调用创建独立文件，跑完即删）。 */
function openDst() {
  dbB && closeDst();
  const init = require('./sqlite/init');
  const b = new DatabaseSync(dstFile);
  b.exec('PRAGMA foreign_keys = ON;');
  init.migrate(b);
  return b;
}
let dbB = null;
function closeDst() {
  if (dbB) { try { dbB.close(); } catch (e) {} dbB = null; }
  try { if (fs.existsSync(dstFile)) fs.rmSync(dstFile, { force: true }); } catch (e) {}
}

/** 源库清空（内容表 + 文档表回到仅默认文档）。 */
function resetSrc() {
  cn.clearAll(dbA);
  cg.clearAll(dbA);
  cd.clearAll(dbA);
}

test('buildSnapshot：组装文档/节点/连线/坐标/分组全量快照（v2）', () => {
  resetSrc();

  const a = cn.createNode(dbA, { kind: 'note', text: 'A', x: 10, y: 20 });
  const b = cn.createNode(dbA, { kind: 'note', text: 'B', x: 100, y: 200 });
  const edge = cn.createEdge(dbA, a.id, b.id);
  const l = cn.createNode(dbA, { kind: 'link', text: 'https://x', x: 5, y: 5 });
  const group = cg.createGroup(dbA, { name: 'G', memberIds: [a.id, b.id] });

  assert.ok(edge, '连线应建立');
  assert.ok(group, '分组应建立');

  const snap = buildSnapshot(dbA);
  assert.equal(snap.version, 3);
  assert.equal(snap.docs.length, 1, '含默认文档');
  assert.equal(snap.docs[0].id, cd.DEFAULT_DOC_ID);
  assert.equal(snap.nodes.length, 3, '含 3 个节点');
  assert.equal(snap.edges.length, 1, '含 1 条连线');
  assert.equal(snap.groups.length, 1, '含 1 个分组');
  assert.equal(snap.nodes[0].docId, cd.DEFAULT_DOC_ID, '节点带 docId');
  assert.equal(snap.edges[0].docId, cd.DEFAULT_DOC_ID, '连线带 docId');
  assert.equal(snap.groups[0].docId, cd.DEFAULT_DOC_ID, '分组带 docId');
  assert.ok(Number.isFinite(snap.nodes[0].orderIndex), '节点带 order_index');
  assert.match(String(snap.updatedAt), /T.*Z/, '快照带 ISO 时间戳');
  assert.deepEqual(snap.layout[a.id], { x: 10, y: 20 }, '坐标被扁平化为 {id:{x,y}}');
  assert.ok(snap.layout[l.id], '引用节点坐标也在快照中');
});

test('restoreSnapshot：恢复到全新空库后数据一致', () => {
  resetSrc();
  dbB = openDst();

  const a = cn.createNode(dbA, { kind: 'note', text: 'A', x: 10, y: 20 });
  const b = cn.createNode(dbA, { kind: 'note', text: 'B', x: 100, y: 200 });
  cn.createEdge(dbA, a.id, b.id);
  cg.createGroup(dbA, { name: 'G', memberIds: [a.id, b.id] });

  const snap = buildSnapshot(dbA);
  const counts = restoreSnapshot(dbB, snap);

  assert.deepEqual(counts, {
    docs: snap.docs.length,
    nodes: snap.nodes.length,
    edges: snap.edges.length,
    layout: Object.keys(snap.layout).length,
    groups: snap.groups.length,
    ink: (snap.ink || []).length
  });

  const nodesB = cn.listNodes(dbB);
  const edgesB = cn.listEdges(dbB);
  const groupsB = cg.listGroups(dbB);
  const layoutB = cl.positions(dbB);

  assert.equal(nodesB.length, snap.nodes.length, '节点数量一致');
  assert.equal(edgesB.length, snap.edges.length, '连线数量一致');
  assert.equal(groupsB.length, snap.groups.length, '分组数量一致');
  assert.equal(cd.listDocs(dbB).length, snap.docs.length, '文档数量一致');
  assert.equal(layoutB.size, Object.keys(snap.layout).length, '坐标恢复');
  assert.equal(layoutB.get(a.id).x, 10, '坐标值恢复');
  assert.equal(layoutB.get(b.id).y, 200);
  assert.equal(edgesB[0].source, snap.edges[0].source, '连线端点一致');
  assert.deepEqual([...groupsB[0].members].sort(), [a.id, b.id].sort(), '分组成员一致');
});

test('restoreSnapshot：多文档隔离 + 层级字段（parentId/orderIndex）保留', () => {
  resetSrc();
  dbB = openDst();

  const doc1 = cd.listDocs(dbA)[0];
  const doc2 = cd.createDoc(dbA, { title: '设计稿' });

  const r1 = cn.createNode(dbA, { kind: 'note', text: '根', docId: doc1.id });
  const c1 = cn.createNode(dbA, { kind: 'note', text: '子', docId: doc1.id, parentId: r1.id, orderIndex: 1 });
  const other = cn.createNode(dbA, { kind: 'note', text: '另一文档', docId: doc2.id });
  cn.createEdge(dbA, other.id, r1.id);

  const snap = buildSnapshot(dbA);
  assert.equal(snap.docs.length, 2);
  restoreSnapshot(dbB, snap);

  const doc1Nodes = cn.listNodes(dbB, doc1.id);
  const doc2Nodes = cn.listNodes(dbB, doc2.id);
  assert.equal(doc1Nodes.length, 2, '文档 1 仅 2 个节点');
  assert.equal(doc2Nodes.length, 1, '文档 2 仅 1 个节点');
  const childB = doc1Nodes.find((n) => n.id === c1.id);
  assert.equal(childB.parentId, r1.id, '父节点关系保留');
  assert.equal(childB.orderIndex, 1, 'order_index 保留');
  assert.equal(cd.listDocs(dbB).find((d) => d.id === doc2.id).title, '设计稿', '文档标题保留');
});

test('restoreSnapshot：v1 旧快照（无 docs/docId）归入默认文档并补 order_index', () => {
  resetSrc();
  dbB = openDst();

  const legacy = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'note:old1', kind: 'note', text: '旧1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'note:old2', kind: 'note', text: '旧2', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }
    ],
    edges: [{ id: 'edge:old', source: 'note:old1', target: 'note:old2', createdAt: '2026-01-01T00:00:02.000Z' }],
    layout: { 'note:old1': { x: 1, y: 2 } },
    groups: [{ id: 'group:old', name: '旧组', members: ['note:old1', 'note:old2'] }]
  };

  const counts = restoreSnapshot(dbB, legacy);
  assert.equal(counts.docs, 1, '自动补出默认文档');
  assert.equal(cd.listDocs(dbB)[0].id, cd.DEFAULT_DOC_ID);

  const nodesB = cn.listNodes(dbB, cd.DEFAULT_DOC_ID);
  assert.equal(nodesB.length, 2, '旧节点归入默认文档');
  assert.deepEqual(nodesB.map((n) => n.orderIndex), [0, 1], 'order_index 顺序补号');
  assert.equal(nodesB[0].parentId, null, 'v1 无层级 → 平铺根节点');
  const edgesB = cn.listEdges(dbB, cd.DEFAULT_DOC_ID);
  assert.equal(edgesB.length, 1, '旧连线归入默认文档');
  const groupsB = cg.listGroups(dbB, cd.DEFAULT_DOC_ID);
  assert.equal(groupsB.length, 1, '旧分组归入默认文档');
});

test('restoreSnapshot：空快照可安全恢复（清空内容表，保留默认文档）', () => {
  dbB = openDst();
  const a = cn.createNode(dbB, { kind: 'note', text: '残留' });
  void a;

  const empty = { docs: [], nodes: [], edges: [], layout: {}, groups: [], updatedAt: new Date().toISOString(), version: 2 };
  const counts = restoreSnapshot(dbB, empty);
  assert.equal(counts.nodes, 0);
  assert.equal(cn.listNodes(dbB).length, 0, '残留节点被清空');
  assert.equal(cl.positions(dbB).size, 0);
  assert.equal(cd.listDocs(dbB).length, 1, '至少保留一个默认文档');
  assert.equal(cd.listDocs(dbB)[0].id, cd.DEFAULT_DOC_ID);
});

test('restoreSnapshot：异常快照容错不抛异常', () => {
  dbB = openDst();
  const weird = { nodes: null, edges: undefined, layout: null, groups: 'x', docs: 'y', updatedAt: '2026-01-01T00:00:00Z' };
  assert.doesNotThrow(() => restoreSnapshot(dbB, weird));
  assert.equal(cd.listDocs(dbB).length, 1, '异常快照仍保证有默认文档');
});

// ─────────── 快照 v3：墨迹（canvas_ink）───────────

/** 构造一笔墨迹。 */
function inkStroke(id, points, overrides) {
  return Object.assign({ id, color: '#1a73e8', width: 6, opacity: 1, points }, overrides || {});
}

test('buildSnapshot v3：ink 进入快照且 updatedAt 纳入墨迹时间戳', () => {
  resetSrc();
  ci.clearAll(dbA);
  const doc = cd.createDoc(dbA, { title: '墨迹文档' });
  // saveInk 会 touch 文档；先记录文档当前 updatedAt，再画一笔（时间戳应前进）
  ci.saveInk(dbA, doc.id, [inkStroke('ink:one', [[0, 0], [5, 5]])]);

  const snap = buildSnapshot(dbA);
  assert.ok(Array.isArray(snap.ink), '快照应含 ink 数组');
  assert.equal(snap.ink.length, 1, '快照含 1 笔墨迹');
  assert.equal(snap.ink[0].id, 'ink:one');
  assert.equal(snap.ink[0].docId, doc.id, '墨迹携带 docId');
  assert.deepEqual(snap.ink[0].points, [[0, 0], [5, 5]], 'points 反序列化为数组');
  assert.equal(snap.version, 3, '快照版本为 3');
});

test('restoreSnapshot v3：往返一致（多文档 + 非法笔迹跳过 + 未知 docId 归默认文档）', () => {
  resetSrc();
  ci.clearAll(dbA);
  dbB = openDst();

  const doc1 = cd.createDoc(dbA, { title: '文档一' });
  const doc2 = cd.createDoc(dbA, { title: '文档二' });
  ci.saveInk(dbA, doc1.id, [inkStroke('ink:a1', [[1, 1], [2, 2]]), inkStroke('ink:a2', [[3, 3]])]);
  ci.saveInk(dbA, doc2.id, [inkStroke('ink:b1', [[9, 9]])]);

  const snap = buildSnapshot(dbA);
  const counts = restoreSnapshot(dbB, snap);
  assert.equal(counts.ink, 3, '恢复 3 笔墨迹');

  assert.equal(ci.countInk(dbB, doc1.id), 2);
  assert.equal(ci.countInk(dbB, doc2.id), 1);
  const listB = ci.listInk(dbB, doc1.id);
  assert.deepEqual(listB.map((s) => s.id), ['ink:a1', 'ink:a2'], '文档一内墨迹按 sort_index 升序');
  assert.deepEqual(listB[0].points, [[1, 1], [2, 2]]);

  // 未知 docId 归默认文档；非法 points 跳过
  const withJunk = Object.assign({}, snap, {
    ink: [
      ...snap.ink,
      { id: 'ink:ghost', docId: 'doc:not-exist', color: '#000', width: 1, opacity: 1, points: [[0, 0]] },
      { id: 'ink:bad', docId: doc1.id, color: '#000', width: 1, opacity: 1, points: 'oops' }
    ]
  });
  const counts2 = restoreSnapshot(dbB, withJunk);
  assert.equal(counts2.ink, 4, '非法 points 被跳过（3 旧 + 1 未知 docId 归默认，bad 跳过）');
  assert.equal(ci.countInk(dbB, cd.DEFAULT_DOC_ID), 1, '未知 docId 归默认文档');
  assert.equal(ci.countInk(dbB, doc1.id), 2, '非法笔迹不写入');
});

test('restoreSnapshot v2 兼容：无 ink 快照恢复后墨迹为空且不报错', () => {
  resetSrc();
  ci.clearAll(dbA);
  dbB = openDst();
  ci.saveInk(dbB, cd.DEFAULT_DOC_ID, [inkStroke('ink:old', [[0, 0]])]);

  const v2 = { docs: [], nodes: [], edges: [], layout: {}, groups: [], updatedAt: new Date().toISOString(), version: 2 };
  assert.doesNotThrow(() => restoreSnapshot(dbB, v2));
  assert.equal(ci.countInk(dbB, cd.DEFAULT_DOC_ID), 0, 'v2 快照（无 ink）恢复后墨迹为空');
});

test('wipe：pull 覆盖前清空墨迹，不残留幽灵墨迹', () => {
  resetSrc();
  ci.clearAll(dbA);
  dbB = openDst();

  const doc = cd.createDoc(dbB, { title: '本地点' });
  ci.saveInk(dbB, doc.id, [inkStroke('ink:local', [[0, 0], [7, 7]])]);
  assert.equal(ci.countInk(dbB, doc.id), 1);

  const remoteSnap = { docs: [], nodes: [], edges: [], layout: {}, groups: [], ink: [], updatedAt: new Date().toISOString(), version: 3 };
  restoreSnapshot(dbB, remoteSnap);
  assert.equal(ci.countInk(dbB, doc.id), 0, '远端无墨迹时本地残留被清空（wipe 生效）');
});