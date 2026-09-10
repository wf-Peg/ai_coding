/**
 * 编辑器功能快捷键统一配置模块
 * ------------------------------------------------------------
 * 将原本分散硬编码在 editor.js / index.html / main.js 的功能级快捷键
 * 收敛为一份默认映射 + localStorage 持久化，供设置模块修改并即时生效。
 *
 * 存储：localStorage['editor_shortcuts_v1']
 *   例：{"fileTree":"Ctrl+Shift+E","globalSearch":"Ctrl+Shift+F",...}
 * 未配置的 action 自动回落到 DEFAULT 默认值（含修复后的冲突规避方案）。
 *
 * 同一份 localStorage 由 editor.html / index.html / settings.html 共享，
 * 故修改后三端均可见（对配置改动：editor 通过 storage 事件刷新 tooltip 与 keydown）。
 *
 * 默认键位对齐原则：
 *   - 全局搜索固定为 Ctrl+Shift+F（主进程菜单 + 主界面 keydown）
 *   - 文件树用其标注的 Ctrl+Shift+E（修正原先误绑为 F 的问题）
 *   - 收藏/最近原占用的 F、R 与更高优先级功能冲突，改配不冲突键且可配置
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'editor_shortcuts_v1';

  // action → { label, shortcut }
  // shortcut 采用 'Ctrl+Shift+X' 形式；Ctrl 同时表示平台主修饰键（mac 上为 Cmd）
  var DEFAULTS = {
    globalSearch: { label: '全局搜索', shortcut: 'Ctrl+Shift+F' },
    fileTree:     { label: '文件浏览器', shortcut: 'Ctrl+Shift+E' },
    outline:      { label: '文档大纲', shortcut: 'Ctrl+Shift+D' },
    tags:         { label: '文档标签', shortcut: 'Ctrl+Shift+T' },
    backlinks:    { label: '反链面板', shortcut: 'Ctrl+Shift+B' },
    quickOpen:    { label: '快速打开文件', shortcut: 'Ctrl+Shift+O' },
    history:      { label: '编辑历史', shortcut: 'Ctrl+Shift+H' },
    recent:       { label: '最近打开文件', shortcut: 'Ctrl+Shift+N' },
    favorite:     { label: '常用文件收藏', shortcut: 'Ctrl+Shift+A' },
    overview:     { label: '内容概览', shortcut: 'Ctrl+Shift+Y' }
  };

  /** 读取本地覆盖配置（已清洗，仅保留合法 action） */
  function readOverrides() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      var out = {};
      Object.keys(DEFAULTS).forEach(function (k) {
        if (raw && typeof raw[k] === 'string' && raw[k].trim()) out[k] = raw[k].trim();
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  /** 获取某 action 生效快捷键（覆盖 or 默认） */
  function get(action) {
    var overrides = readOverrides();
    if (action in overrides) return overrides[action];
    return (DEFAULTS[action] || {}).shortcut || '';
  }

  /** 获取全部 action 的生效快捷键副本 */
  function getAll() {
    var overrides = readOverrides();
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = overrides[k] || DEFAULTS[k].shortcut;
    });
    return out;
  }

  /** action → 展示标签 */
  function labelOf(action) {
    return (DEFAULTS[action] || {}).label || action;
  }

  /** 把所有 action 组合解析成 {ctrl,shift,alt,key} */
  function parse(combo) {
    if (!combo) return null;
    var parts = String(combo).toUpperCase().split('+').map(function (s) { return s.trim(); });
    var res = { ctrl: false, shift: false, alt: false, key: '' };
    var fns = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
               'DELETE','BACKSPACE','TAB','ENTER','ESCAPE','HOME','END','PAGEUP',
               'PAGEDOWN','INSERT','PRINTSCREEN'];
    parts.forEach(function (p) {
      if (p === 'CTRL' || p === 'META' || p === 'CMD') res.ctrl = true;
      else if (p === 'SHIFT') res.shift = true;
      else if (p === 'ALT') res.alt = true;
      else if (p === 'SPACE') res.key = ' ';
      else if (/^F([1-9]|1[0-2])$/.test(p)) res.key = p; // F1-F12
      else res.key = p;
    });
    // 功能键可不带修饰符；否则必须输完整修饰符，key 单字符强制匹配大小写无关
    var isFn = fns.indexOf(res.key) >= 0;
    if (!res.key) return null;
    if (!isFn && !res.ctrl && !res.alt && !res.shift) return null; // 无修饰的裸键非法
    return res;
  }

  /** 匹配 KeyboardEvent 与组合键描述 */
  function match(e, combo) {
    var p = parse(combo);
    if (!p) return false;
    var pressedCtrl = !!(e.ctrlKey || e.metaKey);
    var pressedShift = !!e.shiftKey;
    var pressedAlt = !!e.altKey;
    // 主修饰键判定：Ctrl 组合接受 ctrl 或 meta（mac/win 通用）
    var ctrlOk = p.ctrl ? pressedCtrl : !pressedCtrl;
    var shiftOk = p.shift === pressedShift;
    var altOk = p.alt === pressedAlt;
    if (!ctrlOk || !shiftOk || !altOk) return false;
    var k = String(e.key || '').toUpperCase();
    if (p.key === ' ') return e.key === ' ';
    // 单字符：忽略大小写；其实 e.key 已是 final 大小写，统一大写比较
    return k === p.key;
  }

  /** 保存整份配置 */
  function save(map) {
    var clean = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = map && map[k];
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
    });
    if (Object.keys(clean).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /** 恢复默认：清空覆盖 */
  function reset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /** 归一化输入为 'Ctrl+Shift+X' 规范形式（供录制 UI 校验/回显） */
  function normalizeCombo(e) {
    var parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    var key = e.key;
    if (!key || /^(Control|Alt|Shift|Meta|Escape)$/i.test(key)) return null;
    if (/^F([1-9]|1[0-2])$/i.test(key) || ['PrintScreen','Insert','Home','End','PageUp','PageDown','Delete','Backspace','Tab','Enter'].indexOf(key) >= 0) {
      parts.push(key.length === 1 ? key.toUpperCase() : key.replace(/^\w/, function (c) { return c.toUpperCase(); }));
    } else {
      if (parts.length === 0) return null; // 裸字母必须带修饰符
      parts.push(key.length === 1 ? key.toUpperCase() : key);
    }
    return parts.join('+');
  }

  /** 检测重复：返回重复组合的 action 集合 */
  function findConflicts(map) {
    var eff = {};
    Object.keys(DEFAULTS).forEach(function (k) { eff[k] = map && map[k]; });
    var seen = {};
    var dup = {};
    Object.keys(eff).forEach(function (k) {
      if (!eff[k]) return;
      if (seen[eff[k]]) { dup[eff[k]] = true; dup[seen[eff[k]]] = true; }
      else seen[eff[k]] = k;
    });
    return Object.keys(dup);
  }

  // ══════════════════════════════════════════════════════════
  // 统一捕获分发：将功能 action → handler 注册，集中在捕获阶段分发。
  // 捕获阶段(capture=true)在冒泡前拦截，焦点位于 ACE / 输入框 / 弹窗内
  // 也能命中组合键，避免被编辑器或高层监听吞掉 keydown（"选中没法唤起"）。
  // ══════════════════════════════════════════════════════════
  var _handlers = {};
  var _captureStarted = false;

  /** 注册某 action 的唤起回调（幂等覆盖同名 action） */
  function registerHandler(action, handler) {
    if (typeof handler === 'function') {
      _handlers[action] = handler;
    } else {
      delete _handlers[action];
    }
  }

  /** 读取某 action 已注册回调（无则 undefined） */
  function getHandler(action) {
    return _handlers[action];
  }

  /** 某 action 是否已注册回调 */
  function hasHandler(action) {
    return typeof _handlers[action] === 'function';
  }

  /** 捕获阶段分发函数：遍历已注册 handler，命中则执行 */
  function dispatchCapture(e) {
    Object.keys(_handlers).forEach(function (action) {
      if (e.defaultPrevented) return; // 已被更高优先级处理，跳过
      // match 的第二个参数需传实际组合键（get(action)），不能传 action 名
      if (match(e, get(action))) {
        e.preventDefault();
        e.stopImmediatePropagation(); // 完全消费该键，避免 ACE 自身的同键命令（如展开选区/重放宏）在编辑区内仍触发
        try { _handlers[action](e); } catch (err) { /* 单 handler 异常不影响其它 */ }
      }
    });
  }

  /** 开启捕获阶段全局监听（幂等，只会绑定一次） */
  function startCapture() {
    if (_captureStarted) return;
    _captureStarted = true;
    window.addEventListener('keydown', dispatchCapture, true);
  }

  window.EditorShortcuts = {
    DEFAULTS: DEFAULTS,
    STORAGE_KEY: STORAGE_KEY,
    get: get,
    getAll: getAll,
    labelOf: labelOf,
    parse: parse,
    match: match,
    save: save,
    reset: reset,
    normalizeCombo: normalizeCombo,
    findConflicts: findConflicts,
    registerHandler: registerHandler,
    getHandler: getHandler,
    hasHandler: hasHandler,
    startCapture: startCapture,
    dispatchCapture: dispatchCapture
  };
})();