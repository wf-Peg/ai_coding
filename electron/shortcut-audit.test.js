/**
 * shortcut-audit.test.js — 快捷键检测模块回归测试
 *
 * shortcut-audit.js 是浏览器 IIFE，依赖 window 与 localStorage（读取编辑器键位）。
 * 这里在加载前注入 mock 环境，验证：组合键规范化（跨平台语义）、冲突/同功能重复分类、
 * 系统占用风险收集与 compute 报告结构。
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
// 提供 window 命名空间，脚本将导出挂到 window.ShortcutAudit
global.window = global;

const SA = (() => {
  require(path.join(__dirname, '..', 'frontend', 'js', 'shortcut-audit.js'));
  return global.window.ShortcutAudit;
})();

// 一份 mac 平台典型清单（与主进程 shortcut:audit 返回结构一致）
const MAC_DATA = {
  platform: 'darwin',
  menu: [
    { feature: 'Command Palette', accelerator: 'CmdOrCtrl+K', scope: 'menu' },
    { feature: 'Global Search', accelerator: 'CmdOrCtrl+Shift+F', scope: 'menu' },
    { feature: 'AceJump', accelerator: 'CmdOrCtrl+;', scope: 'menu' },
    { feature: 'Settings', accelerator: 'CmdOrCtrl+,', scope: 'menu' }
  ],
  global: [
    { feature: '全局唤起窗口', accelerator: 'Alt+X', scope: 'global', enabled: true, registered: true },
    { feature: '全局搜索', accelerator: 'CmdOrCtrl+Shift+F', scope: 'global', enabled: true, registered: true },
    { feature: '截图', accelerator: 'F1', scope: 'global', enabled: true, registered: true },
    { feature: '贴图', accelerator: 'F2', scope: 'global', enabled: true, registered: false }
  ],
  editor: null
};

test('normalize 把平台主修饰符语义统一（mac 用 Cmd）', () => {
  // 菜单 CmdOrCtrl 与编辑器 Ctrl 在 mac 上应归一为同一组合
  assert.equal(SA.normalize('CmdOrCtrl+Shift+F', 'darwin'), 'Cmd+Shift+F');
  assert.equal(SA.normalize('Ctrl+Shift+F', 'darwin'), 'Cmd+Shift+F');
  assert.equal(SA.normalize('CmdOrCtrl+K', 'darwin'), 'Cmd+K');
  assert.equal(SA.normalize('Cmd+K', 'darwin'), 'Cmd+K');
  assert.equal(SA.normalize('Alt+X', 'darwin'), 'Alt+X');
  assert.equal(SA.normalize('F1', 'darwin'), 'F1');
  assert.equal(SA.normalize('Ctrl+Alt+ArrowLeft', 'darwin'), 'Cmd+Alt+ArrowLeft');
  assert.equal(SA.normalize('', 'darwin'), '');
  assert.equal(SA.normalize('Shift', 'darwin'), '');
});

test('normalize 在 win/linux 用 Ctrl 表示平台主修饰符', () => {
  assert.equal(SA.normalize('CmdOrCtrl+Shift+F', 'linux'), 'Ctrl+Shift+F');
  assert.equal(SA.normalize('Ctrl+Shift+F', 'linux'), 'Ctrl+Shift+F');
  assert.equal(SA.normalize('CmdOrCtrl+K', 'win32'), 'Ctrl+K');
});

test('detect：同功能多绑定归入 duplicates，不误报为冲突', () => {
  const entries = [
    { feature: '全局搜索', accelerator: 'CmdOrCtrl+Shift+F', scope: 'menu', _norm: 'Cmd+Shift+F' },
    { feature: '全局搜索', accelerator: 'Ctrl+Shift+F', scope: 'editor', _norm: 'Cmd+Shift+F' }
  ];
  const res = SA.detect(entries);
  assert.equal(res.conflicts.length, 0);
  assert.equal(res.duplicates.length, 1);
  assert.equal(res.duplicates[0].combo, 'Cmd+Shift+F');
  assert.equal(res.duplicates[0].feature.feature, '全局搜索');
  assert.equal(res.duplicates[0].count, 2);
});

test('detect：不同功能占用同一组合判为冲突（跨 scope）', () => {
  const entries = [
    { feature: '全局搜索', accelerator: 'CmdOrCtrl+Shift+F', scope: 'menu', _norm: 'Cmd+Shift+F' },
    { feature: '文档大纲', accelerator: 'Ctrl+Shift+F', scope: 'editor', _norm: 'Cmd+Shift+F' }
  ];
  const res = SA.detect(entries);
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].combo, 'Cmd+Shift+F');
  assert.equal(res.conflicts[0].features.length, 2);
  assert.equal(res.duplicates.length, 0);
});

test('compute：汇总 mac 典型清单，空冲突但有同功能重复与占用风险', () => {
  store.clear();
  const r = SA.compute(MAC_DATA);
  assert.equal(r.total >= 21, true); // menu4 + global4 + editor13(默认)
  assert.equal(r.conflicts.length, 0);
  // 全局搜索（菜单英文 Global Search + 全局 + 编辑器）跨作用域归并为同功能重复
  const dupSearch = r.duplicates.find(d => d.combo === 'Cmd+Shift+F');
  assert.ok(dupSearch, '全局搜索应归入同功能重复');
  assert.equal(dupSearch.count, 3);
  // AceJump（菜单英文 AceJump + 编辑器 aceJump）同为同功能重复，不是冲突
  const dupAce = r.duplicates.find(d => d.combo === 'Cmd+;');
  assert.ok(dupAce, 'AceJump 应归入同功能重复而非冲突');
  assert.equal(dupAce.count, 2);
  // 贴图 registered=false 且 enabled → 占用风险
  assert.equal(r.occupied.length, 1);
  assert.equal(r.occupied[0].feature, '贴图');
  assert.equal(r.occupied[0].registered, false);
  assert.equal(r.occupied[0].state, 'occupied');
});

test('compute：编辑器覆盖与全局搜索撞键时判为冲突', () => {
  global.localStorage.setItem('editor_shortcuts_v1', JSON.stringify({ outline: 'Ctrl+Shift+F' }));
  const r = SA.compute(MAC_DATA);
  const hits = r.conflicts.filter(c => c.combo === 'Cmd+Shift+F');
  assert.equal(hits.length, 1);
  const features = hits[0].features.map(f => f.feature);
  assert.equal(features.includes('Global Search'), true); // 菜单英文标签
  assert.equal(features.includes('文档大纲'), true);      // 编辑器
  // 该组内已有不同功能（文档大纲）抢占 → 升级为冲突，不再出现在同功能重复中
  assert.equal(r.duplicates.some(d => d.combo === 'Cmd+Shift+F'), false);
});

test('calculate 编辑器占用风险不含编辑器键位', () => {
  store.clear();
  const r = SA.compute(MAC_DATA);
  // 占用风险仅来自真实 globalShortcut（global 组），编辑器键位不会落入
  assert.ok(r.occupied.every(g => g.scope === 'global'));
});