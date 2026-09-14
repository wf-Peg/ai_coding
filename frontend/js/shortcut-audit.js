/**
 * shortcut-audit.js — 快捷键检测（工具模块「快捷键检测」面板的数据层）
 * ---------------------------------------------------------------------
 * 汇总应用内三类快捷键，检测同一组合键被多个不同功能占用（冲突）：
 *   1. 菜单 accelerators   → 来自主进程 shortcut:audit（menu 字段）
 *   2. 全局快捷键          → 来自主进程 shortcut:audit（global 字段，含截图/贴图）
 *   3. 编辑器键位表        → 直接读 localStorage['editor_shortcuts_v1']（tools 页同源）
 *
 * 冲突判定：「同一规范化组合键」绑定 ≥2 个不同 feature → 冲突；
 * 多个条目绑同一 feature（如全局搜索在菜单与编辑器各一份）→ 同功能重复（正常，不误报）。
 * 系统级占用：全局快捷键 registered=false → 可能被系统或其它应用占用（占用风险）。
 *
 * 纯函数（normalize / detect / compute）不依赖窗口环境，可在 node 测试中直接加载。
 */
(function () {
  'use strict';

  // 编辑器 12 个 action 的中文标签与默认键位（与 editor-shortcuts.js DEFAULTS 保持一致）
  var EDITOR_LABELS = {
    globalSearch: { label: '全局搜索', shortcut: 'Ctrl+Shift+F' },
    fileTree:     { label: '文件浏览器', shortcut: 'Ctrl+Shift+E' },
    outline:      { label: '文档大纲', shortcut: 'Ctrl+Shift+D' },
    tags:         { label: '文档标签', shortcut: 'Ctrl+Shift+T' },
    backlinks:    { label: '反链面板', shortcut: 'Ctrl+Shift+B' },
    quickOpen:    { label: '快速打开文件', shortcut: 'Ctrl+Shift+O' },
    history:      { label: '编辑历史', shortcut: 'Ctrl+Shift+H' },
    recent:       { label: '最近打开文件', shortcut: 'Ctrl+Shift+N' },
    favorite:     { label: '常用文件收藏', shortcut: 'Ctrl+Shift+A' },
    overview:     { label: '内容概览', shortcut: 'Ctrl+Shift+Y' },
    aceJump:      { label: 'AceJump 跳跃导航', shortcut: 'Ctrl+;' },
    posBack:      { label: '返回上一编辑位置', shortcut: 'Ctrl+Alt+ArrowLeft' },
    posForward:   { label: '前进到下一编辑位置', shortcut: 'Ctrl+Alt+ArrowRight' }
  };

  function isMac(platform) {
    return platform === 'darwin' || !platform;
  }

  // 跨作用域的功能归一：同一功能在菜单(英文)/全局(中文)/编辑器(中文 label 或 action)文案可能不同，
  // 统一映射为规范功能键，避免"同名功能各写一份文案"被误判为冲突。
  var ACTION_TO_KEY = {
    globalSearch: 'global-search',
    aceJump: 'ace-jump'
  };
  var LABEL_TO_KEY = {
    'Global Search': 'global-search', '全局搜索': 'global-search',
    'AceJump': 'ace-jump', 'AceJump 跳跃导航': 'ace-jump',
    'Command Palette': 'command-palette', '命令面板': 'command-palette', '全局命令面板': 'command-palette',
    'Settings': 'settings', '设置': 'settings',
    '全局唤起窗口': 'global-show'
  };
  function featureKey(feature, action) {
    if (action && ACTION_TO_KEY[action]) return ACTION_TO_KEY[action];
    if (LABEL_TO_KEY[feature]) return LABEL_TO_KEY[feature];
    return (feature || '').trim().toLowerCase() || action || '';
  }

  /**
   * 规范化组合键：把 Electron accelerator / 编辑器写法统一为规范形。
   * 返回 'Cmd+Shift+K' 等；找不到主键时返回 ''。
   *
   * 语义对齐：编辑器用 'Ctrl' 表示"平台主修饰符"（mac 上为 Cmd，见 editor-shortcuts.js 注释），
   * Electron 的 'CmdOrCtrl'/'CommandOrControl' 同为平台主修饰符。故：
   *   - mac(darwin)：Cmd/CmdOrCtrl/CommandOrControl/Ctrl/Control/Command/Meta → 'Cmd'（主修饰符）
   *   - 其它平台：CmdOrCtrl/CommandOrControl/Ctrl/Control → 'Ctrl'（主修饰符）；Cmd/Command/Meta → 'Cmd'
   * 这样菜单的 CmdOrCtrl+K 与编辑器键位的 Ctrl+K 会被归一为同一组合，正确判为同功能而非冲突。
   */
  function normalize(acc, platform) {
    if (!acc || typeof acc !== 'string') return '';
    var primary = isMac(platform) ? 'Cmd' : 'Ctrl';
    var mods = { Cmd: false, Ctrl: false, Alt: false, Shift: false };
    var key = null;
    var parts = acc.split('+');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (!t) continue;
      switch (t) {
        case 'CmdOrCtrl': case 'CommandOrControl': case 'Command': case 'Cmd': case 'Meta':
        case 'Control': case 'Ctrl':
          // 平台主修饰符：mac 上统一为 Cmd，其余平台为 Ctrl
          if (primary === 'Cmd') mods.Cmd = true; else mods.Ctrl = true;
          break;
        case 'Alt': case 'Option':
          mods.Alt = true; break;
        case 'Shift':
          mods.Shift = true; break;
        default:
          if (!key) key = t.length === 1 ? t.toUpperCase() : t;
          else key = key + '+' + (t.length === 1 ? t.toUpperCase() : t);
      }
    }
    if (!key) return '';
    var order = [];
    if (primary === 'Cmd') { if (mods.Cmd) order.push('Cmd'); if (mods.Ctrl) order.push('Ctrl'); }
    else { if (mods.Ctrl) order.push('Ctrl'); if (mods.Cmd) order.push('Cmd'); }
    if (mods.Alt) order.push('Alt');
    if (mods.Shift) order.push('Shift');
    order.push(key);
    return order.join('+');
  }

  /** 采集编辑器键位为 entry 列表（读 localStorage 覆盖 + 默认回落） */
  function collectEditorEntries(platform) {
    var overrides = {};
    try {
      var raw = JSON.parse((window && window.localStorage && window.localStorage.getItem('editor_shortcuts_v1')) || '{}');
      if (raw && typeof raw === 'object') overrides = raw;
    } catch (e) { /* 忽略非法 JSON */ }
    var out = [];
    Object.keys(EDITOR_LABELS).forEach(function (action) {
      var def = EDITOR_LABELS[action];
      var shortcut = (typeof overrides[action] === 'string' && overrides[action].trim()) ? overrides[action].trim() : def.shortcut;
      var norm = normalize(shortcut, platform);
      if (!norm) return;
      out.push({ feature: def.label, accelerator: shortcut, scope: 'editor', action: action, _norm: norm, _fkey: featureKey(def.label, action) });
    });
    return out;
  }

  /** 把主进程清单（menu/global）转为 entry 列表并补充规范形与功能键 */
  function entriesFrom(data) {
    var platform = (data && data.platform) || undefined;
    var list = [];
    (data && data.menu || []).forEach(function (m) {
      var norm = normalize(m.accelerator, platform);
      if (norm) list.push({ feature: m.feature, accelerator: m.accelerator, scope: 'menu', _norm: norm, _fkey: featureKey(m.feature) });
    });
    (data && data.global || []).forEach(function (g) {
      var norm = normalize(g.accelerator, platform);
      if (norm) list.push({
        feature: g.feature, accelerator: g.accelerator, scope: 'global',
        registered: g.registered !== false, enabled: !!g.enabled,
        status: g.status || (g.enabled ? (g.registered !== false ? 'registered' : 'occupied') : 'disabled'),
        _norm: norm, _fkey: featureKey(g.feature)
      });
    });
    list = list.concat(collectEditorEntries(platform));
    return list;
  }

  /** 冲突检测：entries 需含 _norm（规范组合）与 _fkey（功能键） */
  function detect(entries) {
    var groups = new Map();
    entries.forEach(function (en) {
      if (!en._norm) return;
      if (!groups.has(en._norm)) groups.set(en._norm, { combo: en._norm, entries: [] });
      groups.get(en._norm).entries.push(en);
    });
    var conflicts = [], duplicates = [];
    groups.forEach(function (g) {
      var seen = new Map();
      g.entries.forEach(function (en) {
        var k = en._fkey || String(en.feature || '').trim();
        if (!seen.has(k)) seen.set(k, en);
      });
      if (seen.size > 1) {
        conflicts.push({ combo: g.combo, features: Array.from(seen.values()) });
      } else if (g.entries.length > 1) {
        duplicates.push({ combo: g.combo, feature: seen.values().next().value, count: g.entries.length });
      }
    });
    conflicts.sort(function (a, b) { return a.combo.localeCompare(b.combo); });
    duplicates.sort(function (a, b) { return a.combo.localeCompare(b.combo); });
    return { conflicts: conflicts, duplicates: duplicates };
  }

  /** 汇总计算：由原始主进程清单 data 得完整分类报告（供键位总览面板使用） */
  function compute(data) {
    var entries = entriesFrom(data || {});
    var res = detect(entries);
    var conflictSet = new Set(res.conflicts.map(function (c) { return c.combo; }));
    var dupSet = new Set(res.duplicates.map(function (d) { return d.combo; }));

    var menu = [], global = [], editor = [], occupied = [], disabled = [];
    entries.forEach(function (en) {
      // 每条记录的状态：冲突 > 同功能重复 > 全局自身状态 > 正常
      en.state = conflictSet.has(en._norm) ? 'conflict'
        : (dupSet.has(en._norm) ? 'dup'
          : (en.scope === 'global' ? (en.status || 'registered') : 'ok'));
      if (en.scope === 'menu') menu.push(en);
      else if (en.scope === 'global') { global.push(en); if (en.state === 'occupied') occupied.push(en); else if (en.state === 'disabled') disabled.push(en); }
      else if (en.scope === 'editor') editor.push(en);
    });

    return {
      platform: (data && data.platform) || undefined,
      total: entries.length,
      conflictCount: res.conflicts.length,
      dupCount: res.duplicates.length,
      occupiedCount: occupied.length,
      disabledCount: disabled.length,
      conflicts: res.conflicts,
      duplicates: res.duplicates,
      menu: menu,
      global: global,
      editor: editor,
      occupied: occupied,
      disabled: disabled
    };
  }

  /** 在工具面板内调用：经 parent.electronAPI.auditShortcuts() 取主进程清单再计算 */
  function report() {
    var api = (window && window.parent && window.parent.electronAPI) || (window && window.electronAPI);
    if (!api || typeof api.auditShortcuts !== 'function') {
      return Promise.reject(new Error('当前环境不支持快捷键检测（需桌面应用）'));
    }
    return api.auditShortcuts().then(function (data) {
      return compute(data || {});
    });
  }

  window.ShortcutAudit = {
    EDITOR_LABELS: EDITOR_LABELS,
    isMac: isMac,
    normalize: normalize,
    collectEditorEntries: collectEditorEntries,
    entriesFrom: entriesFrom,
    detect: detect,
    compute: compute,
    report: report
  };
})();