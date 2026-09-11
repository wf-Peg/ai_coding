/**
 * canvas-sync.test.js - 无限画布·后端快照 roundtrip 测试
 *
 * 覆盖：buildSnapshot 组装（节点/连线/坐标/分组）、restoreSnapshot 恢复到全新空库后
 *       数据一致、空/异常快照容错。不含网络（push/pullSnapshot 依赖 fetch，另做端到端验证）。
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

test('buildSnapshot：组装节点/连线/坐标/分组全量快照', () => {
  cn.clearAll(dbA);
  cg.clearAll(dbA);

  const a = cn.createNode(dbA, { kind: 'note', text: 'A', x: 10, y: 20 });
  const b = cn.createNode(dbA, { kind: 'note', text: 'B', x: 100, y: 200 });
  const edge = cn.createEdge(dbA, a.id, b.id);
  const l = cn.createNode(dbA, { kind: 'link', text: 'https://x', x: 5, y: 5 });
  const group = cg.createGroup(dbA, { name: 'G', memberIds: [a.id, b.id] });

  assert.ok(edge, '连线应建立');
  assert.ok(group, '分组应建立');

  const snap = buildSnapshot(dbA);
  assert.equal(snap.version, 1);
  assert.equal(snap.nodes.length, 3, '含 3 个节点');
  assert.equal(snap.edges.length, 1, '含 1 条连线');
  assert.equal(snap.groups.length, 1, '含 1 个分组');
  assert.match(String(snap.updatedAt), /T.*Z/, '快照带 ISO 时间戳');
  assert.deepEqual(snap.layout[a.id], { x: 10, y: 20 }, '坐标被扁平化为 {id:{x,y}}');
  assert.ok(snap.layout[l.id], '引用节点坐标也在快照中');
});

test('restoreSnapshot：恢复到全新空库后数据一致', () => {
  cn.clearAll(dbA);
  cg.clearAll(dbA);
  dbB = openDst();

  const a = cn.createNode(dbA, { kind: 'note', text: 'A', x: 10, y: 20 });
  const b = cn.createNode(dbA, { kind: 'note', text: 'B', x: 100, y: 200 });
  cn.createEdge(dbA, a.id, b.id);
  cg.createGroup(dbA, { name: 'G', memberIds: [a.id, b.id] });

  const snap = buildSnapshot(dbA);
  const counts = restoreSnapshot(dbB, snap);

  assert.deepEqual(counts, {
    nodes: snap.nodes.length,
    edges: snap.edges.length,
    layout: Object.keys(snap.layout).length,
    groups: snap.groups.length
  });

  const nodesB = cn.listNodes(dbB);
  const edgesB = cn.listEdges(dbB);
  const groupsB = cg.listGroups(dbB);
  const layoutB = cl.positions(dbB);

  assert.equal(nodesB.length, snap.nodes.length, '节点数量一致');
  assert.equal(edgesB.length, snap.edges.length, '连线数量一致');
  assert.equal(groupsB.length, snap.groups.length, '分组数量一致');
  assert.equal(layoutB.size, Object.keys(snap.layout).length, '坐标恢复');
  assert.equal(layoutB.get(a.id).x, 10, '坐标值恢复');
  assert.equal(layoutB.get(b.id).y, 200);
  assert.equal(edgesB[0].source, snap.edges[0].source, '连线端点一致');
  assert.deepEqual([...groupsB[0].members].sort(), [a.id, b.id].sort(), '分组成员一致');
});

test('restoreSnapshot：空快照可安全恢复（清空全库）', () => {
  dbB = openDst();
  const a = cn.createNode(dbB, { kind: 'note', text: '残留' });
  void a;

  const empty = { nodes: [], edges: [], layout: {}, groups: [], updatedAt: new Date().toISOString(), version: 1 };
  const counts = restoreSnapshot(dbB, empty);
  assert.equal(counts.nodes, 0);
  assert.equal(cn.listNodes(dbB).length, 0, '残留节点被清空');
  assert.equal(cl.positions(dbB).size, 0);
});

test('restoreSnapshot：异常快照容错不抛异常', () => {
  dbB = openDst();
  const weird = { nodes: null, edges: undefined, layout: null, groups: 'x', updatedAt: '2026-01-01T00:00:00Z' };
  assert.doesNotThrow(() => restoreSnapshot(dbB, weird));
});