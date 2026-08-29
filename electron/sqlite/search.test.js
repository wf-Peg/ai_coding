/**
 * search.test.js - M4 全库统一搜索单元测试
 *
 * 覆盖：searchAll 跨实体命中（clip/knowledge/learning-plan）、类型过滤、
 *       FTS/LIKE 双路径兜底、统一命中结构、空查询守卫。
 * 运行：node --test electron/sqlite/search.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const svc = require('./index-service');
const search = require('./search');

let root;
let base;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
  base = path.join(root, 'Clip_Bed');
  fs.mkdirSync(path.join(base, 'clip-storage', 'inbox', 'screen'), { recursive: true });
  fs.mkdirSync(path.join(base, 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(base, 'learning-plan'), { recursive: true });
  fs.mkdirSync(path.join(base, 'obsidian-vault', 'sources'), { recursive: true });
});

after(() => {
  const db = require('./db');
  try { db.closeDatabase(); } catch (e) {}
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

function seed() {
  fs.writeFileSync(
    path.join(base, 'clip-storage', 'inbox', 'screen', '260823.json'),
    JSON.stringify([
      { id: 1, title: '剪辑 note 教程', content: 'node 学习记录' },
      { id: 2, title: '纯文本收藏', content: '普通内容' }
    ])
  );
  fs.writeFileSync(
    path.join(base, 'knowledge', '260823.json'),
    JSON.stringify([
      { id: 11, title: '知识卡片 node 学习', content: 'node react 随笔' },
      { id: 12, title: '无关卡片', content: '不相关' }
    ])
  );
  fs.writeFileSync(
    path.join(base, 'learning-plan', '260823.json'),
    JSON.stringify([
      { id: 21, goal: 'node 进阶学习计划', phases: [{ title: 'node 基础' }, { title: '模块化' }] },
      { id: 22, goal: '烹饪计划', phases: [{ title: '切菜' }] }
    ])
  );
  fs.writeFileSync(
    path.join(base, 'obsidian-vault', 'sources', 'WinUI 应用列表.md'),
    '# WinUI 应用列表\n\n这是网页剪藏源头文件，内容包含 node 生态与 unique-vault-token。'
  );
  fs.writeFileSync(
    path.join(base, 'obsidian-vault', 'sources', '无关源文件.md'),
    '# 无关源文件\n\n不相关的正文内容。'
  );
}

test('M4.1 searchAll 跨实体命中：返回统一类型化结构', () => {
  seed();
  svc.initLocalIndex(base);

  const hits = search.searchAll('node');
  // clip:1(knowledge) + knowledge:11 + learning-plan:21 均含 'node'
  const types = new Map();
  for (const h of hits) types.set(h.type, h);
  assert.ok(types.has('clip'), '应命中 clip');
  assert.ok(types.has('knowledge'), '应命中 knowledge');
  assert.ok(types.has('learning-plan'), '应命中 learning-plan');

  // 统一结构校验
  for (const h of hits) {
    assert.equal(typeof h.type, 'string');
    assert.equal(typeof h.id, 'string');
    assert.equal(typeof h.title, 'string');
    assert.equal(typeof h.snippet, 'string');
  }
  // learning-plan id 形如 'learning-plan:21'
  const lp = types.get('learning-plan');
  assert.equal(lp.id, 'learning-plan:21');
  assert.ok(String(lp.title).includes('node'));
});

test('M4.1 searchAll 类型过滤：type 等值过滤', () => {
  seed();
  svc.initLocalIndex(base);

  const onlyKnowledge = search.searchAll('node', { type: 'knowledge' });
  assert.ok(onlyKnowledge.length > 0);
  assert.ok(onlyKnowledge.every((h) => h.type === 'knowledge'));

  const onlyLearning = search.searchAll('node', { type: 'learning-plan' });
  assert.ok(onlyLearning.length > 0);
  assert.ok(onlyLearning.every((h) => h.type === 'learning-plan'));

  // 'all' / '*' / null → 不限
  assert.ok(search.searchAll('node', { type: 'all' }).length >= onlyKnowledge.length);
  assert.ok(search.searchAll('node', { type: '*' }).length >= onlyKnowledge.length);
  assert.ok(search.searchAll('node', { type: null }).length >= onlyKnowledge.length);
});

test('M4.1 searchAll LIKE 兜底：FTS 未命中时子串匹配', () => {
  seed();
  svc.initLocalIndex(base);

  // 中文子串'随笔'仅命中 knowledge:11，FTS unicode61 对中文整句分词弱时走 LIKE 子串兜底
  const hits = search.searchAll('随笔');
  assert.ok(hits.some((h) => h.type === 'knowledge'), 'knowledge LIKE 命中');
  assert.equal(hits.some((h) => h.type === 'learning-plan'), false, 'learning-plan 不含该词');

  // '学习'跨 clip/knowledge 命中
  const hits2 = search.searchAll('学习');
  assert.ok(hits2.some((h) => h.type === 'clip'), 'clip LIKE 命中');
  assert.ok(hits2.some((h) => h.type === 'knowledge'), 'knowledge LIKE 命中');
});

test('M4.1 searchAll 空查询/空库守卫', () => {
  seed();
  svc.initLocalIndex(base);
  assert.deepEqual(search.searchAll(''), []);
  assert.deepEqual(search.searchAll('   '), []);
  assert.deepEqual(search.searchAll(null), []);

  assert.ok(Array.isArray(search.SEARCHABLE_TYPES));
  assert.deepEqual(search.SEARCHABLE_TYPES, ['clip', 'knowledge', 'learning-plan', 'vault']);
});

test('M4.x searchAll 命中 vault 源文件：type/title/snippet/filePath', () => {
  seed();
  svc.initLocalIndex(base);

  const hits = search.searchAll('unique-vault-token');
  assert.ok(hits.some((h) => h.type === 'vault'), '应命中 vault 源文件');
  const v = hits.find((h) => h.type === 'vault');
  assert.equal(v.title, 'WinUI 应用列表');
  assert.ok(typeof v.snippet === 'string' && v.snippet.length > 0, 'snippet 应为正文截断');
  assert.ok(v.filePath && v.filePath.endsWith('WinUI 应用列表.md'), '应携带绝对路径 filePath');

  // 类型过滤
  const onlyVault = search.searchAll('node', { type: 'vault' });
  assert.ok(onlyVault.length > 0);
  assert.ok(onlyVault.every((h) => h.type === 'vault'));

  // 中文子串 LIKE 兜底命中源文件标题
  const byTitle = search.searchAll('WinUI');
  assert.ok(byTitle.some((h) => h.type === 'vault'), 'vault 标题 LIKE 命中');
});