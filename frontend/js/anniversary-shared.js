/* ===== 纪念日 / 倒数日 —— 共享内核（存储 + 纯函数计时）=====
 * 桌面（Electron iframe）与移动端 PWA 共用同一逻辑，保证天数口径一致。
 * UMD 形态：浏览器挂 window.AnniversaryShared，Node（单测）走 module.exports。
 * 日期规则：日期字符串一律按「本地日历日」解析（手动拆 Y-M-D → new Date(y,m-1,d)），
 * 禁止 new Date('YYYY-MM-DD')（JS 按 UTC 零点解析，负时区会差一天）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnniversaryShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'anniversary_data_v1';
  var NOTIFIED_KEY = 'anniversary_notified_v1'; // 通知去重：entryId → 上次通知的日期字符串
  var CURRENT_VER = 1;
  var DEFAULT_REMIND = 7; // 临期提前提醒天数（天），0 = 仅当天

  // ── 工具函数 ──
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 本地日期 → 'YYYY-MM-DD'
  function toDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // 本地日历日解析（不经过 UTC）
  function parseLocalDate(str) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || '').trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    // 溢出校验：3-01 之类会被进位，必须回读确认
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function todayStr() { return toDateStr(new Date()); }

  // 天数差（自然日）：today - date。>0 已过，=0 今天，<0 剩余
  function daysBetween(today, date) {
    var t = parseLocalDate(today); if (!t) throw new Error('invalid today: ' + today);
    var d = parseLocalDate(date); if (!d) throw new Error('invalid date: ' + date);
    t.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((t.getTime() - d.getTime()) / 86400000);
  }

  // 条目 → 显示状态。返回 { diff, remaining, label, cls, upcoming }
  //  diff: today - date（>0 已过 / 0 今天 / <0 剩余）
  //  remaining: 剩余天数（>=0，仅对未来/今天有值）
  //  upcoming: 需要提醒（今天 or 剩余在 remind 内）
  function toReminderState(entry, today) {
    var date = (entry && entry.date) || today;
    var diff = daysBetween(today, date);
    var remind = typeof entry.remind === 'number' ? entry.remind : DEFAULT_REMIND;
    var remaining = diff <= 0 ? -diff : 0;
    var upcoming = diff <= 0 && remaining <= remind; // remind=0 → 仅今天；已过条目不算临期
    var label, cls;
    if (diff === 0) { label = '今天'; cls = 'today'; }
    else if (diff > 0) { label = '已过 ' + diff + ' 天'; cls = 'passed'; }
    else { label = '剩余 ' + (-diff) + ' 天'; cls = 'upcoming'; }
    return { diff: diff, remaining: remaining, label: label, cls: cls, upcoming: upcoming };
  }

  // 临期/今天条目（供工作台渲染，只读）：days = 提前窗口（默认 7），不含已过条目
  function getUpcoming(entries, today, days) {
    if (days === undefined) days = DEFAULT_REMIND;
    var n = today || todayStr();
    return (entries || [])
      .filter(function (e) { return e && (e._drop !== true); })
      .map(function (e) { var s = toReminderState(e, n); return { id: e.id, title: e.title, date: e.date, label: s.label, cls: s.cls, remaining: s.remaining, diff: s.diff }; })
      .filter(function (o) { return o.diff <= 0 && o.remaining <= days; })
      .sort(function (a, b) { return a.remaining - b.remaining; });
  }

  // ── 存储层（纯浏览器；Node 环境下 load/save 返回 null 便于单测纯函数）──
  function safeStore() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      if (typeof localStorage.getItem !== 'function' || typeof localStorage.setItem !== 'function') return null;
      return localStorage;
    } catch (e) { return null; }
  }
  function migrate(data) {
    // 版本迁移钩子：ver 递增时在此顺序升级结构
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
      return { ver: CURRENT_VER, updatedAt: new Date().toISOString(), entries: [] };
    }
    return data;
  }
  function load() {
    var ls = safeStore(); if (!ls) return null;
    var raw = ls.getItem(STORAGE_KEY);
    if (!raw) return { ver: CURRENT_VER, updatedAt: new Date().toISOString(), entries: [] };
    try { return migrate(JSON.parse(raw)); } catch (e) { return { ver: CURRENT_VER, updatedAt: new Date().toISOString(), entries: [] }; }
  }
  function save(data) {
    var ls = safeStore(); if (!ls) return false;
    data.updatedAt = new Date().toISOString();
    ls.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  }
  function clear() {
    var ls = safeStore(); if (!ls) return;
    ls.removeItem(STORAGE_KEY); ls.removeItem(NOTIFIED_KEY);
  }

  // ── 通知去重 ──
  function wasNotifiedToday(entryId, dateStr) {
    var ls = safeStore(); if (!ls) return true; // 无存储时默认已通知，避免重复弹
    try {
      var m = JSON.parse(ls.getItem(NOTIFIED_KEY) || '{}');
      return m[entryId] === dateStr;
    } catch (e) { return false; }
  }
  function markNotified(entryId, dateStr) {
    var ls = safeStore(); if (!ls) return;
    try {
      var m = JSON.parse(ls.getItem(NOTIFIED_KEY) || '{}');
      m[entryId] = dateStr;
      ls.setItem(NOTIFIED_KEY, JSON.stringify(m));
    } catch (e) { /* 忽略 */ }
  }

  // ── 条目工厂 ──
  function genId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function newEntry(partial) {
    var now = new Date().toISOString();
    return {
      id: genId(),
      type: 'countdown',        // anniversary(纪念日/已过) | countdown(倒数日/未来)
      title: '',
      date: todayStr(),
      category: '',
      pinned: false,
      remind: DEFAULT_REMIND,
      note: '',
      createdAt: now,
      updatedAt: now,
      _drop: false              // 删除动画期间的软删除标记
    };
  }

  // 校验导入数据合法性
  function validate(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return false;
    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      if (!e || typeof e.title !== 'string' || typeof e.date !== 'string') return false;
      if (!parseLocalDate(e.date)) return false;
      if (e.type !== 'anniversary' && e.type !== 'countdown') return false;
    }
    return true;
  }

  // 合并导入（按 id 去重；同 id 以导入值覆盖）
  function mergeImport(base, incoming) {
    var byId = {};
    (base.entries || []).forEach(function (e) { byId[e.id] = e; });
    (incoming.entries || []).forEach(function (e) {
      if (!e || e._drop) return;
      var clean = {};
      for (var k in e) clean[k] = e[k];
      clean._drop = false;
      byId[e.id] = clean;
    });
    return {
      ver: CURRENT_VER,
      updatedAt: new Date().toISOString(),
      entries: Object.keys(byId).map(function (k) { return byId[k]; })
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VER: CURRENT_VER,
    DEFAULT_REMIND: DEFAULT_REMIND,
    todayStr: todayStr,
    toDateStr: toDateStr,
    parseLocalDate: parseLocalDate,
    daysBetween: daysBetween,
    toReminderState: toReminderState,
    getUpcoming: getUpcoming,
    load: load,
    save: save,
    clear: clear,
    migrate: migrate,
    validate: validate,
    mergeImport: mergeImport,
    wasNotifiedToday: wasNotifiedToday,
    markNotified: markNotified,
    genId: genId,
    newEntry: newEntry
  };
});