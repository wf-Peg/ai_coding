// ============================================================
// 强制刷新（hardRefresh）时的滚动位置保存/恢复
// 相对位置（ratio = top / maxScroll）跨 iframe reload 用 sessionStorage 传递，
// 避免「强刷后回到顶部」。每个模块用独立 key，防止同源 iframe（如剪藏的 todo+clip）
// 互相覆盖。vault（密码）不参与强刷，故不在此处理 .vault-* 容器。
// ============================================================
(function (global) {
  'use strict';
  var PREFIX = '__cs_scroll_';

  function stateKey(key) {
    return PREFIX + key;
  }

  // 记录相对滚动：窗口 + 已知内滚容器（todo 的 .timeline）
  function capture(key) {
    try {
      var docEl = document.scrollingElement || document.documentElement;
      var state = {
        window: {
          top: (window.scrollY || docEl.scrollTop) || 0,
          max: Math.max(1, docEl.scrollHeight - window.innerHeight)
        }
      };
      document.querySelectorAll('.timeline').forEach(function (el) {
        if (el.scrollTop > 0) {
          state.timeline = { top: el.scrollTop, max: Math.max(1, el.scrollHeight - el.clientHeight) };
        }
      });
      sessionStorage.setItem(stateKey(key), JSON.stringify(state));
    } catch (e) { /* 静默：保存失败不阻断强刷 */ }
  }

  function clampRatio(top, max) {
    return Math.min(1, Math.max(0, top / max));
  }

  // 按相对位置恢复，读后即删
  function restore(key) {
    try {
      var raw = sessionStorage.getItem(stateKey(key));
      if (!raw) return;
      sessionStorage.removeItem(stateKey(key));
      var state = JSON.parse(raw);

      if (state.window) {
        var docEl = document.scrollingElement || document.documentElement;
        var ratio = clampRatio(state.window.top, state.window.max);
        var max = Math.max(0, docEl.scrollHeight - window.innerHeight);
        window.scrollTo(0, ratio * max);
      }
      if (state.timeline) {
        var el = document.querySelector('.timeline');
        if (el) {
          var tRatio = clampRatio(state.timeline.top, state.timeline.max);
          el.scrollTop = tRatio * Math.max(0, el.scrollHeight - el.clientHeight);
        }
      }
    } catch (e) { /* 静默：恢复失败不报错 */ }
  }

  global.CutShelterScroll = { capture: capture, restore: restore };
})(window);
