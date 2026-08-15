// clip.html 拆分重构 · 运行时冒烟自测
// 用 Node vm 模拟浏览器：按 clip.html 真实 script 顺序加载全部 JS，
// 触发 DOMContentLoaded 初始化，实际调用关键跨文件函数断言行为。
// 运行: node scripts/smoke-clip.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FRONTEND = path.join(__dirname, '..', 'frontend');
let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}
function check(name, cond, detail) {
  ok(name, () => assert.ok(cond, detail || ''));
}

// ───────────────────────── 浏览器环境 mock ─────────────────────────
// 注意：vm 里顶层 var/function 挂到 sandbox（=globalThis），等价于浏览器里挂 window。
// 因此测试断言统一用 sandbox.xxx 访问全局。
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach(x => this.classList._set.add(x)),
      remove: (...c) => c.forEach(x => this.classList._set.delete(x)),
      toggle: (c, force) => { const s = this.classList._set; const has = force !== undefined ? force : !s.has(c); has ? s.add(c) : s.delete(c); return has; },
      contains: c => this.classList._set.has(c)
    };
    this._listeners = {};
    this.value = ''; this._text = ''; this.checked = false;
    this.files = []; this.disabled = false; this.hidden = false;
    this.parentElement = null; this.clientWidth = 300; this.clientHeight = 150;
    this.offsetWidth = 100; this.offsetHeight = 100; this.scrollTop = 0;
    this._innerHTML = '';
  }
  get textContent() { return this._text; }
  set textContent(v) {
    this._text = String(v);
    // 模拟浏览器语义：textContent 赋值 → innerHTML 为转义后的文本
    this._innerHTML = String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); this._text = ''; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  dispatchEvent(ev) { const ls = this._listeners[ev.type] || []; ls.forEach(f => f.call(this, ev)); return true; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() { if (this.parentElement) { this.parentElement.removeChild(this); } }
  insertAdjacentHTML(_, html) { this._innerHTML += html; }
  querySelector() { return new FakeEl(); }
  querySelectorAll() { return []; }
  closest() { return new FakeEl(); }
  focus() {} click() {} setAttribute() {} getAttribute() { return null; }
  scrollIntoView() {} contains() { return false; }
  getContext() { return { canvas: this, fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, setLineDash() {}, fillText() {}, measureText() { return { width: 10 }; } }; }
}

const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = new FakeEl(); return elements[id]; }

const doc = {
  getElementById: getEl,
  querySelector: () => new FakeEl(),
  querySelectorAll: () => [],
  createElement: t => new FakeEl(t),
  addEventListener(type, fn) { (doc._ls = doc._ls || {})[type] = doc._ls[type] || []; doc._ls[type].push(fn); },
  dispatchEvent(ev) { const ls = (doc._ls || {})[ev.type] || []; ls.forEach(f => f(ev)); return true; },
  body: new FakeEl('body'),
  documentElement: new FakeEl('html'),
  title: '',
  _ls: {}
};
doc.body._children = [];

const storage = { _m: {} };
const win = {
  addEventListener(type, fn) { (win._ls = win._ls || {})[type] = win._ls[type] || []; win._ls[type].push(fn); },
  _ls: {},
  matchMedia: () => ({ addEventListener() {}, matches: false }),
  localStorage: { getItem: k => (storage._m[k] ?? null), setItem: (k, v) => { storage._m[k] = String(v); }, removeItem: k => delete storage._m[k] },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  parent: { postMessage() {} },
  scrollTo() {}, location: { reload() {} },
  document: doc,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}
};
win.window = win;
doc.defaultView = win;

const axios = {
  interceptors: { response: { use() {} }, request: { use() {} } },
  defaults: {},
  _calls: [],
  async get(url) { axios._calls.push(['get', url]); return { data: axios._resp.get || {} }; },
  async post(url, body) { axios._calls.push(['post', url, body]); return { data: axios._resp.post || { status: 'success' } }; },
  async put() { return { data: {} }; },
  async delete() { return { data: {} }; },
  _resp: {}
};

const marked = { setOptions() {}, parse: s => s };
function ChartClass() {}
ChartClass.prototype.destroy = function() {};

const sandbox = {
  window: win, document: doc, navigator: win.navigator,
  localStorage: win.localStorage, sessionStorage: win.sessionStorage,
  axios, console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Map, Set, WeakMap, Number, String, Boolean, Object, Array, Math, Date, JSON,
  RegExp, Error, Symbol, Intl, URL, URLSearchParams, FormData: class { append() {} },
  Blob: class {}, File: class {}, FileReader: class { readAsDataURL() {} },
  Image: class {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  marked, Chart: ChartClass, d3: { forceSimulation: () => ({ force() { return this; }, on() { return this; } }) },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  customElements: { get: () => undefined },
  DOMParser: class { parseFromString() { return { querySelectorAll: () => [], body: { innerHTML: '' } }; } },
  atob: s => s, btoa: s => s
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ───────────────────────── 按顺序加载脚本 ─────────────────────────
const html = fs.readFileSync(path.join(FRONTEND, 'clip.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"[^>]*>/g)].map(m => m[1]);
console.log('clip.html script 顺序:');
srcs.forEach((s, i) => console.log('  ' + (i + 1) + '. ' + s));

try {
  for (const s of srcs) {
    if (s === 'libs/axios.min.js') { console.log('  [skip axios.min.js — 使用 mock]'); continue; }
    vm.runInContext(fs.readFileSync(path.join(FRONTEND, s), 'utf8'), sandbox, { filename: s });
    console.log('  loaded: ' + s);
  }
} catch (e) {
  console.error('脚本加载阶段失败: ' + e.message);
  console.error(e.stack.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// ───────────────────────── 冒烟断言 ─────────────────────────
console.log('\n=== 冒烟断言 ===');
const G = sandbox; // vm globalThis（等价浏览器 window）

// 1. 共享状态跨文件可见（clip-shared 的 var）
check('shared 状态: API_BASE_URL', typeof G.API_BASE_URL === 'string' && G.API_BASE_URL.includes('8081'));
check('shared 状态: TYPE_LABELS', G.TYPE_LABELS && G.TYPE_LABELS['ai-text'] === 'AI文本整理');
check('shared 状态: CATEGORY_LABELS', G.CATEGORY_LABELS && G.CATEGORY_LABELS['work'] === '工作项目');
check('shared 状态: currentTags 数组', Array.isArray(G.currentTags));
check('shared 状态: PROMPT_TYPE_META', G.PROMPT_TYPE_META && G.PROMPT_TYPE_META.daily);

// 2. 函数全局可见（function 声明跨文件）
for (const fn of ['escapeHtml', 'handleTypeChange', 'fetchClips', 'addTag', 'showToast', 'performSearch', 'loadSyncStatus', 'toggleMode', 'renderClipList', 'smartIngestClip', 'generateDivergentSummary', 'doSyncGit', 'synthesizeKnowledge', 'renderLinkedKnowledge', 'bindImageEvents', 'applyTheme']) {
  check('函数可见: ' + fn, typeof G[fn] === 'function');
}

// 3. 实际调用关键函数
ok('escapeHtml 转义', () => {
  assert.strictEqual(G.escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});
ok('formatFileSize', () => {
  assert.strictEqual(G.formatFileSize(1024), '1.0 KB');
  assert.strictEqual(G.formatFileSize(5 * 1024 * 1024), '5.0 MB');
});
ok('getTypeLabel / getCategoryLabel / getWorkflowStatusLabel', () => {
  assert.strictEqual(G.getTypeLabel('ai-text'), 'AI文本整理');
  assert.strictEqual(G.getCategoryLabel('work'), '工作项目');
  assert.strictEqual(G.getWorkflowStatusLabel('inbox'), '收件箱');
});
ok('addTag 去重 + removeTag（form 引用 shared 状态）', () => {
  G.currentTags = [];
  G.addTag('测试标签');
  assert.deepStrictEqual(G.currentTags, ['测试标签']);
  G.addTag('测试标签');
  assert.strictEqual(G.currentTags.length, 1);
  G.addTag('  ');
  assert.strictEqual(G.currentTags.length, 1); // 空白标签忽略
  G.removeTag('测试标签');
  assert.strictEqual(G.currentTags.length, 0);
});
ok('MAX_TAGS 上限（form 引用 shared 常量）', () => {
  G.currentTags = Array.from({ length: 10 }, (_, i) => 't' + i);
  G.addTag('overflow');
  assert.strictEqual(G.currentTags.length, 10); // 达到上限不再添加
});
ok('toggleTagInput（AI 标签模式清空）', () => {
  const aiCheck = getEl('ai-generate-tags');
  aiCheck.checked = true;
  G.currentTags = ['a', 'b'];
  G.toggleTagInput();
  assert.strictEqual(G.currentTags.length, 0);
  aiCheck.checked = false;
});
ok('renderClipList 空数据（list 引用 form/shared 函数）', () => {
  G.renderClipList([]);
  assert.ok(getEl('clip-items').innerHTML.includes('暂无剪藏内容'));
});
ok('toggleMode 切换（list）', () => {
  G.currentMode = 'add-clip';
  G.toggleMode();
  assert.strictEqual(G.currentMode, 'search');
  G.toggleMode();
  assert.strictEqual(G.currentMode, 'add-clip');
});
ok('performSearch 空查询不发请求（list）', async () => {
  getEl('search-query').value = '';
  await G.performSearch();
  assert.ok(!axios._calls.some(c => c[0] === 'get' && c[1].includes('/search')));
});
ok('DOMContentLoaded 已注册（bindImageEvents 内）', () => {
  assert.ok((doc._ls['DOMContentLoaded'] || []).length > 0);
});
ok('showToast 不抛错（sync 全局工具）', () => {
  G.showToast('hello');
});
ok('loadSyncStatus 调用不抛错（sync 引用 shared API 常量）', async () => {
  await G.loadSyncStatus();
});
ok('handleTypeChange 调用不抛错（form 引用 shared 工具）', () => {
  G.handleTypeChange();
});

console.log('\n=== 结果: ' + passed + ' 通过 / ' + failed + ' 失败 ===');
process.exit(failed === 0 ? 0 : 1);
