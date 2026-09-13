/**
 * ace-jump.test.js — AceJump 跳跃模式纯逻辑回归测试
 *
 * ace-jump.js 是浏览器 IIFE（依赖 window / document）。注入轻量 DOM mock 后加载，
 * 验证候选收集的纯逻辑（_candidateColsForLine）与标签分配兜底（_assignJumpCodes）。
 *
 * 编辑器交互（坐标换算/键盘捕获）依赖真实 ACE，不在单测范围，标记冒烟验证。
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

// 最小化 DOM mock（仅覆盖 ace-jump.js 顶层加载所需）
global.window = global;
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({ appendChild: () => {}, addEventListener: () => {}, parentNode: null })
};

const { EditorAceJump: AJ } = (() => {
  require(path.join(__dirname, '..', 'frontend', 'js', 'ace-jump.js'));
  return global.window;
})();

test('candidateColsForLine：word 模式取单词/CJK 单字首字符', () => {
  const cols = AJ._candidateColsForLine('hello 世界 world', 'word');
  // 'hello'(0) '世界'(6,7) 'world'(9)
  assert.deepEqual(cols, [0, 6, 7, 9]);
});

test('candidateColsForLine：word 模式忽略分隔符噪声', () => {
  const cols = AJ._candidateColsForLine('  ab\tcd  ', 'word');
  assert.deepEqual(cols, [2, 5]);
});

test('candidateColsForLine：char 模式取所有非空白字符', () => {
  const cols = AJ._candidateColsForLine('a b c', 'char');
  assert.deepEqual(cols, [0, 2, 4]);
});

test('candidateColsForLine：line 模式取首个非空白字符', () => {
  assert.deepEqual(AJ._candidateColsForLine('   hello world', 'line'), [3]);
  assert.deepEqual(AJ._candidateColsForLine('', 'line'), []);
  assert.deepEqual(AJ._candidateColsForLine('   ', 'line'), []);
});

test('candidateColsForLine：空行/纯空白不产生 word/char 候选', () => {
  assert.deepEqual(AJ._candidateColsForLine('', 'word'), []);
  assert.deepEqual(AJ._candidateColsForLine('   \t ', 'char'), []);
});

test('assignJumpCodes 兜底：与 EditorPure 一致（单字母 + 两阶段）', () => {
  // lean 模式：未引入 EditorPure 时走本地兜底
  const s1 = AJ._assignJumpCodes(10);
  assert.equal(s1.length, 10);
  assert.equal(s1[0], 'a');
  const s2 = AJ._assignJumpCodes(40);
  assert.equal(s2.length, 40);
  assert.equal(new Set(s2).size, 40);
  s2.forEach(c => assert.equal(c.length, 2));
  assert.deepEqual(AJ._assignJumpCodes(0), []);
});