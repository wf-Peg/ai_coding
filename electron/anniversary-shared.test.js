/* 纪念日/倒数日共享内核单测（node --test） */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../frontend/js/anniversary-shared.js');

test('daysBetween 本地日历日解析（负时区不差一天）', () => {
  // new Date('2026-01-01') 在 UTC- 时区会得 2025-12-31；本实现按本地日历日
  assert.strictEqual(A.daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.strictEqual(A.daysBetween('2026-01-11', '2026-01-01'), 10);
  assert.strictEqual(A.daysBetween('2026-01-01', '2026-01-11'), -10);
  assert.strictEqual(A.daysBetween('2025-12-31', '2026-01-01'), -1);
  assert.strictEqual(A.daysBetween('2026-03-01', '2026-02-28'), 1); // 平年跨月
  assert.strictEqual(A.daysBetween('2024-03-01', '2024-02-28'), 2); // 闰年 2 月 29
});

test('parseLocalDate 拒绝非法日期与溢出', () => {
  assert.ok(A.parseLocalDate('2026-09-14'));
  assert.strictEqual(A.parseLocalDate('2026-13-01'), null);
  assert.strictEqual(A.parseLocalDate('2026-02-30'), null); // 02-30 进位到 03-02，回读失败
  assert.strictEqual(A.parseLocalDate('2026/09/14'), null);
  assert.strictEqual(A.parseLocalDate(''), null);
});

test('toReminderState 方向与临期判定', () => {
  const past = { type: 'anniversary', date: '2022-05-20', remind: 7 };
  assert.deepStrictEqual(
    { label: A.toReminderState(past, '2026-09-14').label, cls: A.toReminderState(past, '2026-09-14').cls },
    { label: '已过 1578 天', cls: 'passed' }
  );
  assert.strictEqual(A.toReminderState(past, '2026-09-14').upcoming, false); // 已过不算临期

  const future = { type: 'countdown', date: '2026-09-20', remind: 7 };
  const st = A.toReminderState(future, '2026-09-14');
  assert.strictEqual(st.label, '剩余 6 天');
  assert.strictEqual(st.cls, 'upcoming');
  assert.strictEqual(st.upcoming, true);

  const today = { type: 'countdown', date: '2026-09-14', remind: 0 };
  const ts = A.toReminderState(today, '2026-09-14');
  assert.strictEqual(ts.label, '今天');
  assert.strictEqual(ts.upcoming, true);

  const far = { type: 'countdown', date: '2026-10-01', remind: 7 };
  const fs = A.toReminderState(far, '2026-09-14');
  assert.strictEqual(fs.upcoming, false); // 剩余 17 天 > remind 7
});

test('getUpcoming 只含今天/未来窗口，按剩余升序', () => {
  const entries = [
    { id: 'e1', title: '已过', date: '2020-01-01' },
    { id: 'e2', title: '还有3天', date: '2026-09-17' },
    { id: 'e3', title: '今天', date: '2026-09-14' },
    { id: 'e4', title: '还有12天', date: '2026-09-26' } // 默认窗口 7 之外
  ];
  const up = A.getUpcoming(entries, '2026-09-14');
  assert.deepStrictEqual(up.map(o => o.id), ['e3', 'e2']);
  assert.strictEqual(up[0].label, '今天');
  assert.strictEqual(up[1].label, '剩余 3 天');
});

test('mergeImport 按 id 去重、同 id 以导入覆盖、剔除软删除', () => {
  const base = { ver: 1, entries: [{ id: 'a', title: '旧', date: '2026-01-01' }] };
  const incoming = {
    ver: 1,
    entries: [
      { id: 'a', title: '新', date: '2026-01-02' },
      { id: 'b', title: '新增', date: '2026-02-01' },
      { id: 'c', title: '已删', date: '2026-03-01', _drop: true }
    ]
  };
  const merged = A.mergeImport(base, incoming);
  assert.strictEqual(merged.entries.length, 2);
  assert.strictEqual(merged.entries.find(e => e.id === 'a').title, '新');
  assert.strictEqual(merged.entries.find(e => e.id === 'a')._drop, false);
  assert.ok(merged.entries.every(e => !e._drop));
});

test('mergeImport 在未设置 localStorage 的 Node 下仍可用（纯函数）', () => {
  // load/save 依赖 localStorage，仅确认在无存储环境不抛错
  assert.strictEqual(A.load(), null);
  assert.strictEqual(A.save({ ver: 1, entries: [] }), false);
});