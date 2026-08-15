// 模拟浏览器环境，执行 workspace.js（IIFE），验证顶层/初始化执行无致命错误
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'workspace.js'), 'utf8');

function mockEl() {
  return new Proxy({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    insertAdjacentHTML() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, dispatchEvent() {}, contains() { return false; },
    value: '', textContent: '', innerHTML: '', checked: false, files: [], disabled: false,
    getContext() { return mockCtx(); }, width: 300, height: 150,
    parentElement: null, clientWidth: 300, clientHeight: 150, offsetWidth: 100, offsetHeight: 100
  }, {
    get(t, k) { return k in t ? t[k] : (k === 'style' ? t.style : undefined); },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function mockCtx() {
  return new Proxy({ canvas: null }, { get(t, k) { if (k === 'canvas') return mockEl(); return typeof k === 'string' ? (() => {}) : undefined; }, set() { return true; } });
}

const doc = {
  getElementById() { return mockEl(); },
  querySelector() { return mockEl(); },
  querySelectorAll() { return []; },
  addEventListener() {}, createElement() { return mockEl(); },
  body: mockEl(), documentElement: mockEl(), title: '',
  createElementNS() { return mockEl(); }
};
const win = {
  addEventListener() {}, matchMedia() { return { addEventListener() {} }; },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {} },
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  parent: { postMessage() {} }, scrollTo() {}, location: { reload() {} },
  document: doc, setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, clearInterval() {},
  getComputedStyle() { return { getPropertyValue() { return ''; } }; },
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1
};
win.window = win; doc.defaultView = win;

const axiosMock = {
  interceptors: { response: { use() {} }, request: { use() {} } }, defaults: {},
  get() { return Promise.resolve({ data: {} }); },
  post() { return Promise.resolve({ data: {} }); },
  put() { return Promise.resolve({ data: {} }); },
  delete() { return Promise.resolve({ data: {} }); }
};

// Chart / d3 mock（workspace.js 引用）
function ChartMock() {}
ChartMock.prototype.destroy = function() {};
class ChartClass { constructor() {} destroy() {} }
const sandbox = {
  window: win, document: doc, navigator: win.navigator, localStorage: win.localStorage,
  sessionStorage: win.sessionStorage, axios: axiosMock, console, setTimeout, clearTimeout,
  setInterval, clearInterval, Promise, Map, Set, WeakMap, Number, String, Boolean, Object, Array,
  Math, Date, JSON, RegExp, Error, Symbol, Intl, URL, URLSearchParams, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  Chart: ChartClass, d3: {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  FormData: class { append() {} }, Blob: class {}, File: class {},
  customElements: { get() { return undefined; } }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { filename: 'workspace.js', timeout: 5000 });
  console.log('✓ workspace.js 顶层执行 OK（IIFE 初始化未抛致命错误）');
  process.exit(0);
} catch (e) {
  console.error('✗ workspace.js 顶层执行失败: ' + e.constructor.name + ': ' + e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
