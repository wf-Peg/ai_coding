/* ===== 工作台 · 组件网格引擎（widget board）=====
 * 把「全部概览」从静态写死的行(ov-dashboard / ov-chart-row / ov-section)
 * 升级为可自定义拼装的面板：拖动换位、右下角把手调大小、编辑态增删组件。
 * 布局持久化到 localStorage（键 workspace_widget_layout_v1），数据不上后端。
 *
 * 用法：
 *   window.WB.register({ id, title, defaultSize:{w,h}, minSize:{w,h},
 *                        render(el, {id,w,h}), destroy?(el) });
 *   window.WB.mount(container, { initialLayout: [ {id,col,row,w,h}, ... ] });
 *   window.WB.setEditMode(on) / WB.addWidget(id) / WB.removeWidget(id) / WB.refreshAll()
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'workspace_widget_layout_v1';
  var LAYOUT_VER = 1;

  var registry = {};      // id -> { id,title,defaultSize,minSize,render,destroy }
  var board = null;       // 容器元素
  var opts = { cols: 4, rowH: 170 };
  var state = { widgets: [] }; // [{ id,col,row,w,h }]
  var cards = {};         // id -> 对应 DOM .wb-card
  var colW = 0;
  var editing = false;
  var live = null;        // 拖拽/缩放中的临时状态

  // ── 工具 ──
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function safeStore() {
    try { if (typeof localStorage === 'undefined' || !localStorage) return null; return localStorage; }
    catch (e) { return null; }
  }

  // ── 布局持久化 ──
  function loadLayout(initialLayout) {
    var ls = safeStore(); var base = null;
    if (ls) { try { var raw = ls.getItem(STORAGE_KEY); if (raw) base = JSON.parse(raw); } catch (e) {} }
    var src = (base && base.widgets && base.widgets.length) ? base.widgets : (initialLayout || defaultLayout());
    state.widgets = normalize(src);
  }
  function defaultLayout() {
    // 未存档时的默认布局：数据概览整行 → 两张图 → 纪念日 + 最近活动
    return [
      { id: 'stat-cards',    col: 0, row: 0, w: 4, h: 1 },
      { id: 'chart-type',    col: 0, row: 1, w: 2, h: 2 },
      { id: 'chart-trend',   col: 2, row: 1, w: 2, h: 2 },
      { id: 'anniversary',   col: 0, row: 3, w: 2, h: 2 },
      { id: 'recent-activity', col: 2, row: 3, w: 2, h: 2 }
    ];
  }
  function normalize(src) {
    return (src || []).filter(function (e) { return e && e.id && registry[e.id]; }).map(function (e) {
      var def = registry[e.id];
      var w = clamp(e.w || def.defaultSize.w, def.minSize.w, opts.cols);
      var h = clamp(e.h || def.defaultSize.h, def.minSize.h, 10);
      return { id: e.id, col: clamp(e.col || 0, 0, opts.cols - w), row: Math.max(0, e.row | 0), w: w, h: h };
    });
  }
  function persist() {
    var ls = safeStore(); if (!ls) return;
    try { ls.setItem(STORAGE_KEY, JSON.stringify({ version: LAYOUT_VER, cols: opts.cols, widgets: state.widgets })); } catch (e) {}
  }

  function rectOf(e) { return { col: e.col, row: e.row, w: e.w, h: e.h }; }
  function overlaps(a, b) {
    return a.col < b.col + b.w && a.col + a.w > b.col &&
           a.row < b.row + b.h && a.row + a.h > b.row;
  }

  // ── DOM ──
  function measure() { if (!board) return; colW = board.clientWidth / opts.cols; }

  function cardDOM(id) {
    var def = registry[id];
    var el = document.createElement('article');
    el.className = 'wb-card';
    el.dataset.id = id;
    el.innerHTML =
      '<div class="wb-head">' +
        '<span class="wb-drag" title="拖动换位"><svg viewBox="0 0 24 24"><path d="M9 5h2v2H9zM13 5h2v2h-2zM9 11h2v2H9zM13 11h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z"/></svg></span>' +
        '<h3 class="wb-title">' + def.title + '</h3>' +
        '<button type="button" class="wb-remove" title="移除组件" aria-label="移除">&#10005;</button>' +
      '</div>' +
      '<div class="wb-body"></div>' +
      '<div class="wb-resize" title="拖拽调整大小"></div>';
    cards[id] = el;
    return el;
  }

  function buildCards() {
    if (!board) return;
    board.innerHTML = '';
    cards = {};
    state.widgets.forEach(function (e) {
      var el = cardDOM(e.id);
      board.appendChild(el);
      try { registry[e.id].render(el.querySelector('.wb-body'), { id: e.id, w: e.w, h: e.h }); }
      catch (err) { el.querySelector('.wb-body').textContent = '组件渲染失败'; }
    });
  }

  function relayout() {
    if (!board) return;
    measure();
    var maxBottom = 0;
    state.widgets.forEach(function (e) {
      var el = cards[e.id];
      if (!el) return;
      el.style.left = (e.col * colW) + 'px';
      el.style.top = (e.row * opts.rowH) + 'px';
      el.style.width = (e.w * colW) + 'px';
      el.style.height = (e.h * opts.rowH) + 'px';
      var bottom = e.row + e.h;
      if (bottom > maxBottom) maxBottom = bottom;
    });
    board.style.height = (maxBottom ? maxBottom * opts.rowH : opts.rowH) + 'px';
    board.classList.toggle('edit-on', editing);
    var empty = board.querySelector('.wb-empty');
    if (state.widgets.length === 0 && !empty) {
      var e = document.createElement('div');
      e.className = 'wb-empty';
      e.innerHTML = '还没有组件<br><span>点击右上角「自定义」→「添加组件」开始拼装</span>';
      board.appendChild(e);
    } else if (state.widgets.length > 0 && empty) {
      empty.remove();
    }
  }

  // 编辑态控件显隐由 CSS 控制（.edit-on .wb-drag/.wb-remove/.wb-resize 可见）
  function applyEditControls() {
    if (!board) return;
    board.classList.toggle('edit-on', editing);
  }

  // ── 交互 ──
  function onPointerDown(ev) {
    if (!editing) return;
    var rm = ev.target.closest('.wb-remove');
    if (rm) {
      var c = ev.target.closest('.wb-card');
      if (c && c.dataset.id) { ev.preventDefault(); ev.stopPropagation(); api.removeWidget(c.dataset.id); }
      return;
    }
    var drag = ev.target.closest('.wb-drag');
    var resize = ev.target.closest('.wb-resize');
    if (!drag && !resize) return;
    ev.preventDefault();
    var card = ev.target.closest('.wb-card');
    var entry = state.widgets.find(function (e) { return e.id === card.dataset.id; });
    if (!entry) return;
    live = {
      mode: resize ? 'resize' : 'drag',
      id: entry.id,
      startX: ev.clientX, startY: ev.clientY,
      origCol: entry.col, origRow: entry.row,
      origW: entry.w, origH: entry.h
    };
    if (lockPointer) card.setPointerCapture(ev.pointerId);
    document.body.classList.add('wb-dragging');
  }
  function onPointerMove(ev) {
    if (!live) return;
    var entry = state.widgets.find(function (e) { return e.id === live.id; });
    if (!entry) return;
    var dx = ev.clientX - live.startX;
    var dy = ev.clientY - live.startY;
    if (live.mode === 'resize') {
      var rowW = colW || 1, rowH = opts.rowH || 1;
      var nw = clamp(live.origW + Math.round(dx / rowW), registry[entry.id].minSize.w, opts.cols - entry.col);
      var nh = clamp(live.origH + Math.round(dy / rowH), registry[entry.id].minSize.h, 12);
      entry.w = nw; entry.h = nh;
      relayout();
    } else {
      if (!colW) return;
      var tCol = clamp(live.origCol + Math.round(dx / colW), 0, opts.cols - entry.w);
      var tRow = Math.max(0, live.origRow + Math.round(dy / opts.rowH));
      entry.col = tCol; entry.row = tRow;
      relayout();
    }
  }
  function endPointer(ev) {
    if (!live) return;
    if (ev) { ev.preventDefault(); }
    if (live.mode === 'drag') {
      reflowAll();
      relayout();
    }
    document.body.classList.remove('wb-dragging');
    live = null;
    persist();
  }

  // 拖动松手后解决全部重叠：按「上→下、左→右」顺序，重叠者整体下移
  function reflowAll() {
    var sorted = state.widgets.slice().sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    var placed = [];
    sorted.forEach(function (o) {
      var r = { col: o.col, row: o.row, w: o.w, h: o.h };
      var guard = 0;
      while (placed.some(function (p) { return overlaps(r, p); }) && guard++ < 60) {
        // 移到与其重叠的那个下方
        var collider = placed.find(function (p) { return overlaps(r, p); });
        r.row = collider.row + collider.h;
      }
      o.col = r.col; o.row = r.row;
      placed.push(r);
    });
  }

  // ‾‾‾‾‾ 公开 API ‾‾‾‾‾
  var api = {
    register: function (def) {
      if (!def || !def.id || typeof def.render !== 'function') return;
      registry[def.id] = {
        id: def.id,
        title: def.title || def.id,
        defaultSize: def.defaultSize || { w: 1, h: 1 },
        minSize: def.minSize || { w: 1, h: 1 },
        render: def.render,
        destroy: def.destroy || null
      };
    },
    mount: function (el, cfg) {
      board = el; opts = Object.assign({ cols: 4, rowH: 170 }, cfg || {});
      if (!opts.cols) opts.cols = 4;
      loadLayout(cfg && cfg.initialLayout);
      buildCards();
      relayout();
      if (window.ResizeObserver) {
        try { new ResizeObserver(function () { relayout(); }).observe(board); } catch (e) {}
      }
    },
    setEditMode: function (on) { editing = !!on; applyEditControls(); },
    isEditing: function () { return editing; },
    addWidget: function (id) {
      if (!registry[id] || state.widgets.some(function (e) { return e.id === id; })) return;
      var def = registry[id]; if (!def) return;
      // 找一个空位：从 (0,0) 向后找首个不与已放置冲突的格子
      var baseRow = 0, col = 0;
      outer:
      for (var row = 0; row < 24; row++) {
        for (var c = 0; c <= opts.cols - def.defaultSize.w; c++) {
          var r = { col: c, row: row, w: def.defaultSize.w, h: def.defaultSize.h };
          if (state.widgets.every(function (o) { return !overlaps(r, rectOf(o)); })) { col = c; baseRow = row; break outer; }
        }
      }
      state.widgets.push({ id: id, col: col, row: baseRow, w: def.defaultSize.w, h: def.defaultSize.h });
      var el = cardDOM(id);
      board.appendChild(el);
      try { registry[id].render(el.querySelector('.wb-body'), { id: id, w: def.defaultSize.w, h: def.defaultSize.h }); } catch (e) {}
      relayout();
      persist();
    },
    removeWidget: function (id) {
      var el = cards[id];
      var def = registry[id];
      if (def && def.destroy) { try { def.destroy(el); } catch (e) {} }
      if (el) { el.remove(); }
      delete cards[id];
      state.widgets = state.widgets.filter(function (e) { return e.id !== id; });
      relayout();
      persist();
    },
    refreshAll: function () {
      state.widgets.forEach(function (e) {
        var el = cards[e.id];
        if (!el) return;
        var body = el.querySelector('.wb-body');
        try { registry[e.id].render(body, { id: e.id, w: e.w, h: e.h }); }
        catch (err) { body.textContent = '组件渲染失败'; }
      });
    },
    getWidgets: function () { return state.widgets.slice(); },
    getRegistered: function () { return Object.keys(registry); },
    destroy: function () {
      if (board) { board.onpointerdown = null; board.onpointermove = null; board.onpointerup = null; board = null; }
      cards = {}; state.widgets = [];
    }
  };

  // 绑定板级指针事件（事件委托 + 指针捕获，支持拖出容器）
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', endPointer, true);
  document.addEventListener('pointercancel', endPointer, true);

  var lockPointer = true;
  return api;
});