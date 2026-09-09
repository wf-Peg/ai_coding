/**
 * editor-shortcuts.test.js — 编辑器功能快捷键统一配置模块回归测试
 *
 * editor-shortcuts.js 是浏览器 IIFE，依赖 window 与 localStorage。
 * 这里在加载前注入 mock 环境，验证默认映射、覆盖读写、
 * 组合键解析/匹配、冲突检测与恢复默认等核心逻辑。
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

// ---------- 构造轻量 localStorage mock ----------
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};
// 提供 window 命名空间，脚本将导出挂到 window.EditorShortcuts
global.window = global;

const { EditorShortcuts: ES } = (() => {
  require(path.join(__dirname, '..', 'frontend', 'js', 'editor-shortcuts.js'));
  return global.window;
})();

test('默认映射完整且全局搜索/文件浏览器键位正确', () => {
  const defs = ES.DEFAULTS;
  assert.equal(Object.keys(defs).length >= 10, true);
  assert.equal(defs.globalSearch.shortcut, 'Ctrl+Shift+F');
  assert.equal(defs.fileTree.shortcut, 'Ctrl+Shift+E');
  assert.equal(defs.outline.shortcut, 'Ctrl+Shift+D');
});

test('get 未配置时回落默认值', () => {
  store.clear();
  assert.equal(ES.get('globalSearch'), 'Ctrl+Shift+F');
  assert.equal(ES.get('fileTree'), 'Ctrl+Shift+E');
  assert.equal(ES.get('not-exist'), '');
});

test('保存覆盖后 get 返回覆盖值，reset 恢复默认', () => {
  store.clear();
  const map = ES.getAll();
  map.globalSearch = 'Ctrl+Shift+G';
  ES.save(map);
  assert.equal(ES.get('globalSearch'), 'Ctrl+Shift+G');
  ES.reset();
  assert.equal(ES.get('globalSearch'), 'Ctrl+Shift+F');
});

test('save 忽略非法 action，仅持久化合法键', () => {
  store.clear();
  ES.save({ globalSearch: 'Ctrl+Shift+Q', bogus: 'Ctrl+Shift+Z', empty: '   ' });
  assert.equal(ES.get('globalSearch'), 'Ctrl+Shift+Q');
  assert.equal(ES.getAll().hasOwnProperty('bogus'), false);
});

test('parse 正确解析修饰符与裸功能键', () => {
  assert.deepEqual(ES.parse('Ctrl+Shift+F'), { ctrl: true, shift: true, alt: false, key: 'F' });
  assert.equal(ES.parse('F5').key, 'F5');
  assert.equal(ES.parse('Ctrl+Shift+F').ctrl, true);
});

test('parse 拒绝无修饰符的裸字母键', () => {
  assert.equal(ES.parse('A'), null);
});

test('match 精确匹配组合键', () => {
  const evt = { ctrlKey: true, shiftKey: true, altKey: false, key: 'F' };
  assert.equal(ES.match(evt, 'Ctrl+Shift+F'), true);
  assert.equal(ES.match(evt, 'Ctrl+Shift+E'), false);
  assert.equal(ES.match({ ctrlKey: true, shiftKey: false, altKey: false, key: 'F' }, 'Ctrl+Shift+F'), false);
});

test('match 大小写不敏感', () => {
  const evt = { ctrlKey: true, shiftKey: true, altKey: false, key: 'f' };
  assert.equal(ES.match(evt, 'Ctrl+Shift+F'), true);
});

test('findConflicts 检出重复组合键', () => {
  store.clear();
  const map = ES.getAll();
  map.fileTree = 'Ctrl+Shift+F'; // 与 globalSearch 相同
  ES.save(map);
  const conflicts = ES.findConflicts(ES.getAll());
  assert.equal(conflicts.includes('Ctrl+Shift+F'), true);
  ES.reset();
});

test('normalizeCombo 规范输出与非法输入返回 null', () => {
  assert.equal(ES.normalizeCombo({ ctrlKey: true, shiftKey: true, altKey: false, key: 'f' }), 'Ctrl+Shift+F');
  assert.equal(ES.normalizeCombo({ ctrlKey: false, shiftKey: false, altKey: false, key: 'a' }), null); // 裸字母
});