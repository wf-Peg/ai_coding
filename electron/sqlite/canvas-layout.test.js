/**
 * canvas-layout.test.js - 无限画布·布局层单元测试（阶段一：位置持久化）
 *
 * 覆盖：schema v3 建表、坐标保存/读取、同节点覆盖、无效条目过滤。
 * 运行：node --test electron/sqlite/canvas-layout.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const svc = require('./index-service');
const canvas = require('./canvas-layout');

let root;
let base;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-layout-test-'));
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

test('布局：schema v3 建表 + 坐标保存/读取', () => {
  svc.initLocalIndex(base);
  const db = require('./db').getDatabase();
  canvas.clearPositions(db);

  const saved = canvas.savePositions(db, [
    { id: 'clip:1', x: 10.5, y: -20.2 },
    { id: 'knowledge:3', x: 0, y: 0 }
  ]);
  assert.equal(saved, 2);

  const pos = canvas.positions(db);
  assert.equal(pos.size, 2);
  assert.deepEqual(pos.get('clip:1'), { x: 10.5, y: -20.2 });
  assert.deepEqual(pos.get('knowledge:3'), { x: 0, y: 0 });
});

test('布局：无效条目过滤 + 同节点覆盖', () => {
  svc.initLocalIndex(base);
  const db = require('./db').getDatabase();
  canvas.clearPositions(db);

  // 无效条目：缺 id / 坐标非有限值，应被跳过
  const saved = canvas.savePositions(db, [
    { x: 1, y: 2 },
    { id: 'clip:9', x: NaN, y: 3 },
    { id: 'clip:1', x: 1, y: 1 }
  ]);
  assert.equal(saved, 1);

  // 覆盖：同一节点再次保存，取最新坐标
  canvas.savePositions(db, [{ id: 'clip:1', x: 99, y: 88 }]);
  const pos = canvas.positions(db);
  assert.deepEqual(pos.get('clip:1'), { x: 99, y: 88 });
  assert.equal(pos.has('clip:9'), false);
});