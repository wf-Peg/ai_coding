/* ============================================================================
   theme-bridge.js — CutShelter 全局主题桥接
   依赖：theme-core.js（window.CutShelterThemeCore）
   职责：页面初始化、postMessage/storage 同步、DOM 主题应用。
   主页面（index.html）作为唯一事实来源：读取偏好 → 应用 data-theme/data-motion
   → 广播 { action: "themeChange", theme, motion } 到所有 iframe。
   iframe 子页面：init 读取同一份 storage 先应用主题，再 listen 接收广播并回执
   { type: "themeReady", theme }。
   暴露：window.CutShelterThemeBridge。
   ============================================================================ */
(function (global) {
  'use strict';

  var core = global.CutShelterThemeCore;
  var THEME_KEY = 'app_theme_v1';
  var MOTION_KEY = 'app_motion_v1';
  var APPEARANCE_KEY = 'app_appearance_v1';

  var current = { theme: 'notion', motion: 'full' };

  function defaultStorage() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }

  function pickStorage(storage) {
    if (storage && typeof storage.getItem === 'function') return storage;
    return defaultStorage();
  }

  function pickRoot(root) {
    if (root && typeof root.setAttribute === 'function') return root;
    try { return (typeof document !== 'undefined') ? document.documentElement : null; } catch (e) { return null; }
  }

  function systemPrefersDark(matchMedia) {
    try {
      if (matchMedia && typeof matchMedia.matches === 'boolean') return matchMedia.matches;
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function readAppearance(storage) {
    try {
      var v = storage && typeof storage.getItem === 'function' ? storage.getItem(APPEARANCE_KEY) : null;
      return v || 'notion';
    } catch (e) { return 'notion'; }
  }

  function applyToDom(root, theme, motion) {
    if (!root || typeof root.setAttribute !== 'function') return;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-motion', motion);
  }

  function persist(storage, theme, motion) {
    if (!storage) return;
    try { storage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    try { storage.setItem(MOTION_KEY, motion); } catch (e) { /* ignore */ }
  }

  function broadcast(frames, theme, motion) {
    var msg = core.buildThemeMessage(theme, motion);
    (frames || []).forEach(function (frame) {
      try {
        if (frame && frame.contentWindow && frame.contentWindow.postMessage) {
          frame.contentWindow.postMessage(msg, '*');
        }
      } catch (e) { /* ignore */ }
    });
  }

  // 页面初始化：读取偏好（含 system 外观）并同步应用，返回解析后的 { theme, motion }
  function init(opts) {
    opts = opts || {};
    var storage = pickStorage(opts.storage);
    var root = pickRoot(opts.root);
    var appearance = opts.appearance || readAppearance(storage);
    var theme = core.resolveAppearance(appearance, systemPrefersDark(opts.matchMedia));
    var motion = core.readStoredMotion(storage);
    current = { theme: theme, motion: motion };
    applyToDom(root, theme, motion);
    if (opts.frames) broadcast(opts.frames, theme, motion);
    return { theme: theme, motion: motion };
  }

  // 应用主题：更新 data-theme/data-motion，可选持久化与广播
  function apply(theme, motion, opts) {
    opts = opts || {};
    var storage = pickStorage(opts.storage);
    var root = pickRoot(opts.root);
    var t = core.normalizeTheme(theme == null ? current.theme : theme);
    var m = core.normalizeMotion(motion == null ? current.motion : motion);
    current = { theme: t, motion: m };
    applyToDom(root, t, m);
    if (opts.persist) persist(storage, t, m);
    if (opts.frames) broadcast(opts.frames, t, m);
    return { theme: t, motion: m };
  }

  // iframe 子页面监听父页面广播，并回执 themeReady
  function listen(opts) {
    opts = opts || {};
    var storage = pickStorage(opts.storage);
    var root = pickRoot(opts.root);
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (!d || d.action !== 'themeChange') return;
      var t = core.normalizeTheme(d.theme);
      var m = core.normalizeMotion(d.motion);
      current = { theme: t, motion: m };
      applyToDom(root, t, m);
      if (opts.persist) persist(storage, t, m);
      if (opts.ack !== false) {
        try {
          if (window.parent && window.parent !== window && window.parent.postMessage) {
            window.parent.postMessage({ type: 'themeReady', theme: t, motion: m }, '*');
          }
        } catch (e) { /* ignore */ }
      }
      if (typeof opts.onChange === 'function') opts.onChange({ theme: t, motion: m });
    });
  }

  global.CutShelterThemeBridge = {
    init: init,
    apply: apply,
    listen: listen,
    getCurrent: function () { return { theme: current.theme, motion: current.motion }; },
    THEME_KEY: THEME_KEY,
    MOTION_KEY: MOTION_KEY,
    APPEARANCE_KEY: APPEARANCE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
