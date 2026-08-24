// 模拟浏览器环境，顺序加载拆分后的 clip JS，验证顶层执行无 ReferenceError
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILES = ['clip-shared.js', 'clip-form.js', 'clip-list.js', 'clip-actions.js', 'clip-sync.js'];
const BASE = path.join(__dirname, '..', 'frontend', 'js');

// ── Mock DOM / window / navigator / axios ──
function mockElement() {
  const el = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    insertAdjacentHTML() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, dispatchEvent() {}, contains() { return false; },
    value: '', textContent: '', innerHTML: '', checked: false, files: [], disabled: false,
    parentElement: null
  };
  return el;
}
const documentMock = {
  getElementById() { return mockElement(); },
  querySelector() { return mockElement(); },
  querySelectorAll() { return []; },
  addEventListener() {}, createElement() { return mockElement(); },
  body: mockElement(), documentElement: mockElement(),
  addEventListener() {}, title: ''
};
const windowMock = {
  addEventListener() {}, matchMedia() { return { addEventListener() {} }; },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {} },
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  parent: { postMessage() {} },
  scrollTo() {}, location: { reload() {} }, document: documentMock,
  setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, clearInterval() {},
  getComputedStyle() { return { getPropertyValue() { return ''; } }; }
};
windowMock.window = windowMock;
documentMock.defaultView = windowMock;

// axios mock
const axiosMock = {
  interceptors: { response: { use() {} }, request: { use() {} } },
  defaults: {},
  get() { return Promise.resolve({ data: {} }); },
  post() { return Promise.resolve({ data: { status: 'success' } }); },
  put() { return Promise.resolve({ data: {} }); },
  delete() { return Promise.resolve({ data: {} }); }
};

const sandbox = {
  window: windowMock, document: documentMock, navigator: windowMock.navigator,
  localStorage: windowMock.localStorage, sessionStorage: windowMock.sessionStorage,
  axios: axiosMock, console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Map, Set, Number, String, Boolean, Object, Array, Math, Date, JSON, RegExp, Error, Symbol,
  sessionStorage: windowMock.sessionStorage, location: { reload() {} },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  FormData: class { append() {} }, FileReader: class { readAsDataURL() {} },
  SpeechRecognition: undefined, webkitSpeechRecognition: undefined,
  URL, URLSearchParams, Blob, File: class {}, Image: class { set src(v) {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let errors = 0;
for (const f of FILES) {
  const code = fs.readFileSync(path.join(BASE, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
    console.log('✓ ' + f + ' 顶层执行 OK');
  } catch (e) {
    errors++;
    console.error('✗ ' + f + ' 顶层执行失败: ' + e.constructor.name + ': ' + e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}
console.log(errors === 0 ? '\n✓ 全部文件顶层执行通过（无 ReferenceError）' : '\n✗ 存在 ' + errors + ' 个错误');
process.exit(errors === 0 ? 0 : 1);
