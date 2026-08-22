/* ============================================================================
   ui-common.js — 全模块共享 UI 方法
   暴露全局 window.UI，纯原生、无依赖。
   依赖：需先引入 styles/ui-common.css（自动适配 light/regular/dark 主题）。
   用法：
     UI.toast('保存成功');
     UI.toast('删除失败', { type: 'error', duration: 4000 });
     UI.confirm({ title, message, okText, cancelText, danger }).then(ok => ...)
     UI.alert({ title, message });
     UI.empty(el, { icon, title, description, actionLabel, onAction });
     UI.loading(el, true) / UI.loading(el, false);
     UI.friendlyError(err);
   ============================================================================ */
(function (global) {
  'use strict';

  var root;
  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.getElementById('ui-root') || document.createElement('div');
    if (!root.id) { root.id = 'ui-root'; }
    root.className = 'ui-root';
    document.body.appendChild(root);
    return root;
  }

  /* ---------- Toast ---------- */
  var TOAST_ICONS = { success: '✓', error: '✕', warning: '!', info: 'ℹ' };
  var toastCount = 0;

  function toast(message, opts) {
    opts = opts || {};
    var type = opts.type || 'info';
    var duration = opts.duration == null ? 2500 : opts.duration;
    var r = ensureRoot();

    var el = document.createElement('div');
    el.className = 'ui-toast ui-toast--' + type + ' ui-fade-in ui-slide-up';
    el.id = 'ui-toast-' + (++toastCount);
    var icon = document.createElement('span');
    icon.className = 'ui-toast__icon';
    icon.textContent = TOAST_ICONS[type] || 'ℹ';
    var text = document.createElement('span');
    text.className = 'ui-toast__text';
    text.textContent = String(message == null ? '' : message);
    var close = document.createElement('button');
    close.className = 'ui-toast__close';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '✕';
    close.addEventListener('click', function () { dismiss(); });
    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(close);
    r.appendChild(el);

    // 多 toast 纵向堆叠：调整 top 位置
    var offset = 16 + (toastCount % 6) * 64;
    el.style.top = offset + 'px';

    var timer = null;
    function dismiss() {
      if (!el.isConnected) return;
      if (timer) { clearTimeout(timer); timer = null; }
      var done = false;
      function finish() {
        if (done) return; done = true;
        el.remove();
      }
      el.style.transition = 'opacity .2s ease, transform .2s ease';
      el.style.opacity = '0';
      setTimeout(finish, 220);
    }

    timer = setTimeout(dismiss, duration);
    return el;
  }

  /* ---------- Modal ---------- */
  var _currentResolve = null;

  function openModal(opts, isConfirm) {
    var r = ensureRoot();
    var backdrop = document.createElement('div');
    backdrop.className = 'ui-modal-backdrop ui-fade-in';
    var modal = document.createElement('div');
    modal.className = 'ui-modal ui-pop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    var title = document.createElement('h3');
    title.className = 'ui-modal__title';
    title.textContent = opts.title || (isConfirm ? '操作确认' : '提示');
    var body = document.createElement('div');
    body.className = 'ui-modal__body';
    body.textContent = opts.message || '';
    modal.appendChild(title);
    modal.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'ui-modal__actions';
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    r.appendChild(backdrop);

    function destroy() {
      if (backdrop.isConnected) {
        modal.classList.remove('ui-pop');
        backdrop.classList.remove('ui-fade-in');
        setTimeout(function () {
          backdrop.remove();
          modal.remove();
        }, 220);
      }
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('click', onBackdrop);
    }
    function done(val) {
      if (modal._done) return; modal._done = true;
      destroy();
      if (typeof _currentResolve === 'function') { _currentResolve(val); _currentResolve = null; }
    }

    function makeBtn(text, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls || 'ui-btn';
      b.textContent = text;
      return b;
    }

    if (isConfirm) {
      var cancel = makeBtn(opts.cancelText || '取消', 'ui-btn');
      cancel.addEventListener('click', function () { done(false); });
      actions.appendChild(cancel);
      var ok = makeBtn(opts.okText || '确定', 'ui-btn ui-btn--primary' + (opts.danger ? ' ui-btn--danger' : ''));
      ok.addEventListener('click', function () { done(true); });
      actions.appendChild(ok);
    } else {
      var alone = makeBtn(opts.okText || '确定', 'ui-btn ui-btn--primary');
      alone.addEventListener('click', function () { done(true); });
      actions.appendChild(alone);
    }

    function onKey(e) {
      if (e.key === 'Escape') { done(isConfirm ? false : true); }
      if (e.key === 'Enter' && e.target === modal) { done(true); }
    }
    document.addEventListener('keydown', onKey);
    function onBackdrop(e) {
      if (e.target === backdrop) { done(isConfirm ? false : true); }
    }
    backdrop.addEventListener('click', onBackdrop);

    var first = modal.querySelector('.ui-btn');
    if (first) first.focus();
    return modal;
  }

  function confirmModal(opts) {
    return new Promise(function (resolve) {
      _currentResolve = resolve;
      openModal(opts || {}, true);
    });
  }

  function alertModal(opts) {
    return new Promise(function (resolve) {
      _currentResolve = resolve;
      openModal(opts || {}, false);
    });
  }

  /* ---------- Empty / Loading ---------- */
  function empty(el, opts) {
    if (!el) return;
    opts = opts || {};
    el.innerHTML = '';
    el.classList.add('ui-empty');
    if (opts.icon) {
      var ic = document.createElement('div');
      ic.className = 'ui-empty__icon';
      ic.textContent = opts.icon;
      el.appendChild(ic);
    }
    var title = document.createElement('h3');
    title.className = 'ui-empty__title';
    title.textContent = opts.title || '暂无数据';
    el.appendChild(title);
    if (opts.description) {
      var d = document.createElement('p');
      d.className = 'ui-empty__desc';
      d.textContent = opts.description;
      el.appendChild(d);
    }
    if (opts.actionLabel) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-btn ui-btn--primary';
      b.textContent = opts.actionLabel;
      b.addEventListener('click', function () { if (opts.onAction) opts.onAction(); });
      el.appendChild(b);
    }
    el.style.display = 'flex';
  }

  function loading(el, show) {
    if (!el) return;
    if (show) {
      el.innerHTML = '';
      el.classList.add('ui-loading');
      var sp = document.createElement('div');
      sp.className = 'ui-spinner';
      el.appendChild(sp);
      var t = document.createElement('span');
      t.textContent = '加载中…';
      el.appendChild(t);
      el.style.display = 'flex';
    } else {
      el.classList.remove('ui-loading');
      el.style.display = 'none';
    }
  }

  /* ---------- friendlyError ---------- */
  function friendlyError(err) {
    var msg = String((err && err.message) || err || '');
    if (/Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|net::ERR/i.test(msg)) {
      return '无法连接本地服务，请确认后端已启动（在标题栏点击"启动后端"）';
    }
    if (/timeout|timed out/i.test(msg)) {
      return '请求超时，请稍后重试';
    }
    return msg || '操作失败，请稍后重试';
  }

  global.UI = {
    toast: toast,
    confirm: confirmModal,
    alert: alertModal,
    empty: empty,
    loading: loading,
    friendlyError: friendlyError
  };
})(typeof window !== 'undefined' ? window : globalThis);