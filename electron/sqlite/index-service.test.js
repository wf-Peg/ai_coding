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