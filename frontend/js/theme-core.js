/* ============================================================================
   theme-core.js — CutShelter 全局主题纯逻辑核心
   可在浏览器与 Node.js 测试中运行：不访问 localStorage / matchMedia / DOM。
   职责：主题与动效偏好的规范化、持久化值与消息契约。
   暴露：Node 下 module.exports，浏览器下 window.CutShelterThemeCore。
   ============================================================================ */
(function (global) {
  'use strict';

  // 全局主题集合（固定，版本无关）
  var THEMES = ['regular', 'notion', 'dark'];
  var DEFAULT_THEME = 'notion';

  // 动效偏好集合
  var MOTIONS = ['full', 'reduced'];
  var DEFAULT_MOTION = 'full';

  // 持久化键（契约的一部分，保持版本兼容）
  var THEME_KEY = 'app_theme_v1';
  var MOTION_KEY = 'app_motion_v1';

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // 将任意输入规范化为三套主题之一，默认 notion
  function normalizeTheme(value) {
    if (typeof value === 'string' && THEMES.indexOf(value) !== -1) {
      return value;
    }
    return DEFAULT_THEME;
  }

  // 将任意输入规范化为 full | reduced，默认 full
  function normalizeMotion(value) {
    if (typeof value === 'string' && MOTIONS.indexOf(value) !== -1) {
      return value;
    }
    return DEFAULT_MOTION;
  }

  // appearance 为偏好值：三主题之一或 'system'；system 映射为 dark / notion
  function resolveAppearance(appearance, systemPrefersDark) {
    if (appearance === 'system') {
      return systemPrefersDark ? 'dark' : 'notion';
    }
    return normalizeTheme(appearance);
  }

  // 版本无关的主题变更消息契约
  function buildThemeMessage(theme, motion) {
    return {
      action: 'themeChange',
      theme: normalizeTheme(theme),
      motion: normalizeMotion(motion)
    };
  }

  function safeGet(storage, key) {
    try {
      return storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function readStoredTheme(storage) {
    return normalizeTheme(safeGet(storage, THEME_KEY));
  }

  function readStoredMotion(storage) {
    return normalizeMotion(safeGet(storage, MOTION_KEY));
  }

  var api = {
    THEMES: THEMES,
    THEME_KEY: THEME_KEY,
    MOTION_KEY: MOTION_KEY,
    normalizeTheme: normalizeTheme,
    normalizeMotion: normalizeMotion,
    resolveAppearance: resolveAppearance,
    buildThemeMessage: buildThemeMessage,
    readStoredTheme: readStoredTheme,
    readStoredMotion: readStoredMotion
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global === 'object' && global) {
    global.CutShelterThemeCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
