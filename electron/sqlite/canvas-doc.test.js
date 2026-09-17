/**
 * canvas-doc.test.js - 无限画布·文档层（多画布）单元测试
 *
 * 覆盖：默认文档确保存在、建/列/改/删文档、删除级联（节点+坐标+连线+分组）、
 *       至少保留一个文档、节点按文档隔离。
 * 运行：node --test electron/sqlite/canvas-doc.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cd = require('./canvas-doc');
const cn = require('./canvas-node');
const canvasLayout = require('./canvas-layout');

let root;
let db;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-doc-test-'));
  const { openDatabase } = require('./db');
  db = openDatabase(root);
});

after(() => {
  const dbref = require('./db');
  try { dbref.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 清空画布各表（保留默认文档）。 */
function reset() {
  cn.clearAll(db);
  db.exec('DELETE FROM canvas_group_member; DELETE FROM canvas_group');
  cd.clearAll(db);
}

test('默认文档：ensureDefaultDoc 幂等且 listDocs 至少含 doc:default', () => {
  reset();
  assert.equal(cd.ensureDefaultDoc(db), false, '默认文档已存在时不重复创建');
  const docs = cd.listDocs(db);
  assert.ok(docs.some((d) => d.id === cd.DEFAULT_DOC_ID));
  assert.equal(cd.getDoc(db, cd.DEFAULT_DOC_ID).title, cd.DEFAULT_DOC_TITLE);
});

test('createDoc / renameDoc / listDocs：新建追加末尾、可改名、带节点数', () => {
  reset();
  const a = cd.createDoc(db, { title: '研究笔记' });
  const b = cd.createDoc(db, { title: '' });
  assert.match(a.id, /^doc:/);
  assert.equal(b.title, '未命名画布', '空标题回落默认名');

  const docs = cd.listDocs(db);
  assert.equal(docs.length, 3, '默认文档 + 2 个新建');
  assert.deepEqual(docs.map((d) => d.sortIndex), [0, 1, 2], 'sort_index 追加到末尾');

  assert.equal(cd.renameDoc(db, a.id, '研究笔记 V2'), true);
  assert.equal(cd.getDoc(db, a.id).title, '研究笔记 V2');
  assert.equal(cd.renameDoc(db, 'doc:missing', 'x'), false);

  cn.createNode(db, { kind: 'note', text: '1', docId: a.id });
  assert.equal(cd.listDocs(db).find((d) => d.id === a.id).nodeCount, 1, '列表带节点数');
});

test('deleteDoc：级联清理节点/坐标/连线/分组；最后一个文档不可删', () => {
  reset();
  const doc = cd.createDoc(db, { title: '待删' });
  const n1 = cn.createNode(db, { kind: 'note', text: 'A', docId: doc.id, x: 1, y: 2 });
  const n2 = cn.createNode(db, { kind: 'note', text: 'B', docId: doc.id, x: 3, y: 4 });
  cn.createEdge(db, n1.id, n2.id);
  const g = db.prepare('INSERT INTO canvas_group (id,name,doc_id,created_at,updated_at) VALUES (?,?,?,?,?)');
  g.run('group:t1', '组', doc.id, 't', 't');
  db.prepare('INSERT OR IGNORE INTO canvas_group_member (group_id,node_id) VALUES (?,?)').run('group:t1', n1.id);

  const res = cd.deleteDoc(db, doc.id);
  assert.equal(res.success, true);
  assert.equal(res.removed.nodes, 2);
  assert.equal(res.removed.edges, 1);
  assert.equal(res.removed.groups, 1);
  assert.equal(res.removed.layout, 2, '坐标随节点清理');
  assert.equal(cn.listNodes(db, doc.id).length, 0);
  assert.equal(canvasLayout.positions(db).has(n1.id), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM canvas_group_member WHERE group_id=?').get('group:t1').c, 0);
  assert.equal(cd.getDoc(db, doc.id), null);

  // 至少保留一个文档：把其它文档删光后，只剩默认文档时拒绝删除
  const all = cd.listDocs(db);
  for (const d of all) {
    if (d.id === cd.DEFAULT_DOC_ID) continue;
    cd.deleteDoc(db, d.id);
  }
  const last = cd.deleteDoc(db, cd.DEFAULT_DOC_ID);
  assert.equal(last.success, false);
  assert.match(last.message, /至少保留一个/);
});

test('多文档隔离：listNodes(docId) 只返回该文档节点，层级字段透出', () => {
  reset();
  const docA = cd.createDoc(db, { title: 'A 文档' });
  const root1 = cn.createNode(db, { kind: 'note', text: '根', docId: docA.id, x: 0, y: 0 });
  const child = cn.createNode(db, { kind: 'note', text: '子', docId: docA.id, parentId: root1.id, x: 10, y: 10 });
  const other = cn.createNode(db, { kind: 'note', text: '默认文档节点' });

  const nodesA = cn.listNodes(db, docA.id);
  assert.equal(nodesA.length, 2, '只返回 A 文档节点');
  assert.equal(nodesA.find((n) => n.id === child.id).parentId, root1.id, '父子层级透出');
  assert.ok(Number.isFinite(nodesA.find((n) => n.id === child.id).orderIndex), 'order_index 透出');

  assert.ok(cn.listNodes(db, cd.DEFAULT_DOC_ID).some((n) => n.id === other.id));
  assert.ok(!cn.listNodes(db, docA.id).some((n) => n.id === other.id), '跨文档不串数据');
  assert.equal(cn.listNodes(db).length, 3, '不传 docId 返回全部（图谱等全局场景）');
});
