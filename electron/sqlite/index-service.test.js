/**
 * index-service.test.js - 增量索引（rescan）单元测试
 *
 * 覆盖：初始化、新增/修改/删除 clip、以及「同文件内某条 clip 被移除」的
 * 删除边界（pruneMissing 以 clip id 判定，而非 file_path）。
 * 运行：node --test electron/sqlite/index-service.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const svc = require('./index-service');
const search = require('./search');

let root;
let file;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'isvc-test-'));
  const dir = path.join(root, 'clip-storage', '分类A');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, '260823.json');
});

after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

function write(list) {
  fs.writeFileSync(file, JSON.stringify({ clips: list }), 'utf-8');
}

test('initLocalIndex 首次建索引', () => {
  write([{ id: 1, title: '第一条', content: '初始内容' }]);
  const r = svc.initLocalIndex(root);
  assert.equal(r.readies || r.ready, true);
  assert.equal(r.count, 1);
  assert.equal(svc.status().count, 1);
});

test('rescan 未变则幂等跳过', () => {
  const r = svc.rescan(root);
  assert.equal(r.skipped, 1);
  assert.equal(r.added, 0);
  assert.equal(r.removed, 0);
  assert.equal(r.count, 1);
});

test('rescan 新增 clip 并即时可搜', () => {
  write([
    { id: 1, title: '第一条', content: '初始内容' },
    { id: 2, title: '西湖游记', content: '西湖很美' }
  ]);
  const r = svc.rescan(root);
  assert.equal(r.added, 1);
  assert.equal(r.count, 2);
  assert.equal(search.search('西湖', 5).length, 1);
});

test('rescan 同文件内移除某条 clip 也正确删除', () => {
  write([{ id: 1, title: '第一条', content: '初始内容' }]);
  const r = svc.rescan(root);
  assert.equal(r.removed, 1); // id=2 从同一文件移除，仅剩 id=1
  assert.equal(r.count, 1);
  assert.equal(search.search('西湖', 5).length, 0);
});

test('rescan 删除整个文件后清除索引', () => {
  // 前面用例结束时文件仅含 id1
  const before = svc.status().count;
  assert.equal(before, 1);
  fs.rmSync(file);
  const r = svc.rescan(root);
  assert.equal(r.removed, 1); // 清掉 id1
  assert.equal(r.count, 0);
});

// 顺序放最后：新建 md 内容目录会改变根签名并持久化，避免影响前面的精确计数断言。
test('md 库 → vault 索引 → searchAll 命中', () => {
  // 用真实内容库目录名（clip-organized / obsidian-vault），验证它们不被 clip 排除语义误杀
  const contentDir = path.join(root, 'clip-organized', 'notes');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, '西湖.md'), '# 西湖\n杭州西湖美如画。', 'utf-8');
  fs.writeFileSync(
    path.join(contentDir, 'study.md'),
    '---\ntitle: 学习计划草案\n---\n每天学习一小时。',
    'utf-8'
  );
  fs.mkdirSync(path.join(root, 'clip-storage', '分类A'), { recursive: true });

  const r = svc.initLocalIndex(root);
  assert.equal(r.ready, true);
  // 前面的 clip 已被删除，此时仅 2 条 md 入库
  const total = svc.status().count;
  assert.ok(total >= 1, '应有 vault 索引');
  assert.equal(search.search('西湖').length, 1);

  const hits = search.searchAll('西湖');
  assert.ok(hits.length >= 1, 'vault 命中应至少 1 条');
  const vaultHit = hits.find((h) => h.type === 'vault');
  assert.ok(vaultHit, '应包含 type=vault 命中');
  assert.equal(vaultHit.title, '西湖');
  assert.ok(vaultHit.filePath && vaultHit.filePath.indexOf('西湖.md') !== -1, '应附带源文件路径');

  // frontmatter title 生效
  const planHits = search.searchAll('学习计划');
  const planHit = planHits.find((h) => h.type === 'vault' && h.title === '学习计划草案');
  assert.ok(planHit, 'frontmatter title 应成为命中标题');
});