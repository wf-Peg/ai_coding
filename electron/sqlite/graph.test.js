/**
 * graph.test.js - M3 图谱/关系层单元测试
 *
 * 覆盖：M3.3 关系构建（derived_from/linked_to/plan_links、自环排除）、
 *       M3.4 图谱组装（节点分类、关系计数、includeTypes 过滤、悬空边剔除）、
 *       M3.6 遗留 relation-index.json 迁移（持久化、幂等、派生优先）。
 * 运行：node --test electron/sqlite/graph.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const svc = require('./index-service');
const graph = require('./graph');
const relationBuilder = require('./relation-builder');

let root;
let base;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-test-'));
  base = path.join(root, 'Clip_Bed');
  fs.mkdirSync(path.join(base, 'clip-storage', 'inbox', 'screen'), { recursive: true });
  fs.mkdirSync(path.join(base, 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(base, 'learning-plan'), { recursive: true });
});

after(() => {
  const db = require('./db');
  try { db.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

function seed(knowledge, plan) {
  fs.writeFileSync(
    path.join(base, 'clip-storage', 'inbox', 'screen', '260823.json'),
    JSON.stringify([
      { id: 1, title: 'c1', content: 'node' },
      { id: 2, title: 'c2' },
      { id: 9, title: 'c9' }
    ])
  );
  fs.writeFileSync(path.join(base, 'knowledge', '260823.json'), JSON.stringify(knowledge));
  fs.writeFileSync(path.join(base, 'learning-plan', '260823.json'), JSON.stringify(plan));
}

test('M3.3 关系构建：三类关系 + 自环排除', () => {
  seed(
    [
      { id: 1, title: 'k1', sourceClipIds: [1, 2], linkedKnowledgeIds: [5] },
      { id: 5, title: 'k5', linkedKnowledgeIds: [1] }
    ],
    [{ id: 3, goal: 'plan', phases: [{ title: 'p1', linkedKnowledgeIds: [1], sourceClipIds: [9] }] }]
  );
  const r = svc.initLocalIndex(base);
  const db = require('./db').getDatabase();

  const rels = relationBuilder.findFor(db, 'knowledge:1');
  const pair = (x) => x.fromId + '->' + x.toId + '[' + x.relationType + ']';
  assert.ok(rels.some((x) => pair(x) === 'clip:1->knowledge:1[derived_from]'));
  assert.ok(rels.some((x) => pair(x) === 'clip:2->knowledge:1[derived_from]'));
  assert.ok(rels.some((x) => pair(x) === 'knowledge:1->knowledge:5[linked_to]'));
  assert.ok(rels.some((x) => pair(x) === 'knowledge:5->knowledge:1[linked_to]'));
  assert.ok(rels.some((x) => pair(x) === 'learning-plan:3->knowledge:1[plan_links]'));
  // plan→clip 边不经 knowledge:1，单独查 learning-plan:3
  const planRels = relationBuilder.findFor(db, 'learning-plan:3');
  assert.ok(planRels.some((x) => pair(x) === 'learning-plan:3->clip:9[plan_links]'));
  // 自环排除
  const selfLoop = db.prepare('SELECT COUNT(*) c FROM relation WHERE from_id = to_id').get().c;
  assert.equal(selfLoop, 0);
});

test('M3.4 图谱组装：节点分类 + 关系计数 + 悬空边剔除', () => {
  seed([{ id: 1, title: 'k1', sourceClipIds: [1] }], []);
  svc.initLocalIndex(base);
  const db = require('./db').getDatabase();
  const g = graph.getGraph(db, null);

  // 节点 3 clip + 1 knowledge
  const types = g.nodes.map((n) => n.type).sort();
  assert.deepEqual(types, ['clip', 'clip', 'clip', 'knowledge']);
  // 计数：clip:1 linkedCount=1（出边 clip:1→k1）；knowledge:1 sourceCount=1（入边）
  const c1 = g.nodes.find((n) => n.id === 'clip:1');
  const k1 = g.nodes.find((n) => n.id === 'knowledge:1');
  assert.equal(c1.linkedCount, 1);
  assert.equal(k1.sourceCount, 1);

  // 悬空边：新增一条仅一端存在的边应被剔除
  db.prepare(
    'INSERT INTO relation (from_id, to_id, relation_type, source, confidence, created_at) VALUES (?,?,?,?,?,?)'
  ).run('clip:999', 'knowledge:1', 'derived_from', 'x', 1.0, new Date().toISOString());
  const g2 = graph.getGraph(db, null);
  assert.ok(!g2.links.some((l) => l.source === 'clip:999'));

  // includeTypes 过滤
  const onlyKnowledge = graph.getGraph(db, new Set(['knowledge']));
  assert.ok(onlyKnowledge.nodes.every((n) => n.type === 'knowledge'));
});

test('M3.3 兼容旧模型标量 sourceClipId 派生 derived_from', () => {
  seed(
    [
      // 旧模型：标量 sourceClipId（非 List），无 linkedKnowledgeIds
      { id: 1, title: 'k1', sourceClipId: 9 },
      // 新模型：List 形态
      { id: 2, title: 'k2', sourceClipIds: [9, 10] }
    ],
    []
  );
  svc.initLocalIndex(base);
  const db = require('./db').getDatabase();
  const rels = relationBuilder.findFor(db, 'knowledge:1');
  assert.ok(rels.some((x) => x.fromId === 'clip:9' && x.toId === 'knowledge:1' && x.relationType === 'derived_from'),
    '标量 sourceClipId 应派生 derived_from');
  const rels2 = relationBuilder.findFor(db, 'knowledge:2');
  assert.equal(rels2.filter((x) => x.relationType === 'derived_from').length, 2,
    'List sourceClipIds=[9,10] 派生 2 条');
});

test('M3.6 遗留文件迁移：持久化 + 幂等 + 派生优先', () => {
  const idxDir = path.join(base, 'index');
  fs.mkdirSync(idxDir, { recursive: true });
  fs.writeFileSync(path.join(idxDir, 'relation-index.json'), JSON.stringify([
    { fromId: 'clip:9', toId: 'knowledge:1', relationType: 'derived_from', source: 'clip_to_knowledge', confidence: 1, createdAt: '2026-08-22T10:00:00' },
    { fromId: 'knowledge:1', toId: 'knowledge:5', relationType: 'linked_to', source: 'legacy', confidence: 0.9 }
  ]));
  seed([{ id: 1, title: 'k1', sourceClipIds: [] }, { id: 5, title: 'k5' }], []);

  svc.initLocalIndex(base);
  const db = require('./db').getDatabase();
  assert.equal(relationBuilder.count(db), 2, '首次迁移 2 条入表');

  // 持久化：re-init + rescan 后仍保留
  svc.initLocalIndex(base);
  svc.rescan(base);
  assert.equal(relationBuilder.count(db), 2, '重建后遗留关系不丢失');

  // 派生优先：给 k1 加 sourceClipIds=[1]，派生关系应覆盖同名遗留（同 key 冲突时 DO NOTHING 保留派生但行数不变）
  seed([{ id: 1, title: 'k1', sourceClipIds: [1] }, { id: 5, title: 'k5' }], []);
  svc.rescan(base);
  const derived = relationBuilder.findFor(db, 'knowledge:1')
    .find((x) => x.relationType === 'derived_from' && x.fromId === 'clip:1');
  assert.ok(derived, '派生关系存在');
  assert.equal(relationBuilder.count(db), 3, 'clip:1->k1 派生加入，总共 3 条');
});