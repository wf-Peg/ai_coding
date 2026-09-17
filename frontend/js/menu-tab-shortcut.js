/**
 * menu-tab-shortcut.js — 模块 iframe 内的 Ctrl+Tab 菜单切换转发
 * 主界面是「主窗口 + 各模块 iframe」架构，keydown 只落在当前聚焦的 document。
 * 本脚本在各模块页把 Ctrl/Cmd+Tab（含 Shift 反向）转发给顶层窗口 index.html，
 * 由顶层统一决策：写作视图 → 编辑区标签切换；其它视图 → 菜单栏循环切换。
 * editor.html 不引入本脚本（写作区内部保留编辑区自身行为）。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var topWin = window.top;
  if (!topWin || topWin === window) return; // 仅在 iframe 内生效

  function isEditableTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== 'Tab') return;
    if (isEditableTarget(e.target)) return; // 输入框/可编辑区不拦截
    e.preventDefault();
    try {
      topWin.postMessage({ type: 'menuTabSwitch', dir: e.shiftKey ? -1 : 1 }, '*');
    } catch (err) { /* 跨域顶层（牛马侧车）时静默忽略 */ }
  }, true);
})();
