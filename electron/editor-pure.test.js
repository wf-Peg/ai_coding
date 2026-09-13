/**
 * editor-pure.test.js — 编辑器纯逻辑模块回归测试
 *
 * editor-pure.js 是浏览器 IIFE，依赖 window / globalThis。
 * 此处注入 window 命名空间后加载，验证：
 *   - tagPattern 正则（中文/标点边界、转义、否定前瞻）
 *   - escapeHtml（对齐 DOM innerHTML 序列化，含非断空格，引号不转义）
 *   - fuzzyScore（前向模糊匹配打分与不匹配返回 -1）
 *   - assignJumpCodes（AceJump 标签分配：单字母 / 两阶段分组 / 边界）
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

global.window = global;

const { EditorPure: EP } = (() => {
  require(path.join(__dirname, '..', 'frontend', 'js', 'editor-pure.js'));
  return global.window;
})();

test('tagPattern：转义正则特殊字符并匹配中文标签', () => {
  const re = new RegExp(EP.tagPattern('每日'), 'g');
  const hits = ('#每日 good #每日 收藏'.match(re) || []);
  assert.deepEqual(hits, ['#每日', '#每日']);
  const reSpecial = new RegExp(EP.tagPattern('a.b'), 'g');
  assert.equal('#a.b y'.match(reSpecial) !== null, true);
  assert.equal('#ab y'.match(reSpecial), null);
});

test('tagPattern：否定前瞻避免把标签字符延续误判为完整标签', () => {
  const re = new RegExp(EP.tagPattern('read'), 'g');
  assert.equal('#readonly'.match(re), null); // read 后继仍是标签字符（字母）→ 不命中
  assert.equal('#read more'.match(re) !== null, true);
});

test('escapeHtml：转义 &<> 与非断空格，引号不转义（对齐 innerHTML）', () => {
  assert.equal(EP.escapeHtml('<a href="x">&'), '&lt;a href="x"&gt;&amp;');
  assert.equal(EP.escapeHtml('A\u00a0B'), 'A&nbsp;B');
  assert.equal(EP.escapeHtml('plain text'), 'plain text');
  assert.equal(EP.escapeHtml(null), '');
  assert.equal(EP.escapeHtml(undefined), '');
  assert.equal(EP.escapeHtml(0), '0');
});

test('fuzzyScore：按序匹配打分，前缀加分，不匹配返回 -1', () => {
  assert.equal(EP.fuzzyScore('', 'anything'), 0);
  assert.ok(EP.fuzzyScore('abc', 'abc') > 0); // 全命中必有分
  assert.ok(EP.fuzzyScore('ed', 'editor') > EP.fuzzyScore('ed', 'xedition'));
  assert.equal(EP.fuzzyScore('zzz', 'abc'), -1);
  // 词首命中加分：'cmd' 应命中 'command palette' 优于乱序 'comd'（后者不匹配）
  const cm = EP.fuzzyScore('cmd', 'command palette');
  assert.ok(cm > 0);
});

test('fuzzyScore：大小写不敏感', () => {
  assert.equal(EP.fuzzyScore('SAVE', 'saveFile') > 0, true);
});

test('assignJumpCodes：≤26 单字母唯一且递增', () => {
  const codes = EP.assignJumpCodes(26);
  assert.equal(codes.length, 26);
  assert.equal(new Set(codes).size, 26);
  assert.equal(codes[0], 'a');
  assert.equal(codes[25], 'z');
});

test('assignJumpCodes：>26 两阶段分组，码唯一且首字母不超过 26 种', () => {
  const n = 60;
  const codes = EP.assignJumpCodes(n);
  assert.equal(codes.length, n);
  assert.equal(new Set(codes).size, n, '每个码必须唯一');
  const firstLetters = new Set(codes.map(c => c[0]));
  assert.ok(firstLetters.size <= 26, '组字母最多 26 种');
  codes.forEach(c => {
    assert.equal(c.length, 2, '60 个候选应为两字母码');
    assert.ok(/^[a-z][a-z]$/.test(c), '码为两个小写字母');
  });
});

test('assignJumpCodes：边界与非法输入', () => {
  assert.deepEqual(EP.assignJumpCodes(0), []);
  assert.deepEqual(EP.assignJumpCodes(-5), []);
  assert.deepEqual(EP.assignJumpCodes(NaN), []);
  assert.equal(EP.assignJumpCodes(1)[0], 'a');
  const maxCodes = EP.assignJumpCodes(676);
  assert.equal(maxCodes.length, 676);
  assert.equal(new Set(maxCodes).size, 676);
  // 676 = aa..zz 全覆盖，首字母与次字母均 26 种
  const first = new Set(maxCodes.map(c => c[0]));
  const second = new Set(maxCodes.map(c => c[1]));
  assert.equal(first.size, 26);
  assert.equal(second.size, 26);
});