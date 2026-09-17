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

  var registry = {};      // id -> { id,title,defaultSize,minSize,render,destroy,scope }
  var board = null;       // 容器元素
  var boardScope = 'overview'; // 当前板的组件归属（palette 过滤用）
  var ro = null;          // 当前板 ResizeObserver（换板时断开，避免旧板幽灵重排）
  var opts = { cols: 4, rowH: 170 };
  var state = { widgets: [] }; // [{ id,col,row,w,h }]
  var cards = {};         // id -> 对应 DOM .wb-card
  var colW = 0;
  var editing = false;
  var live = null;        // 拖拽/缩放中的临时状态
  var lockPointer = true; // 捕获指针，支持拖出容器

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
      return { id: e.id, title: typeof e.title === 'string' ? e.title : '', col: clamp(e.col || 0, 0, opts.cols - w), row: Math.max(0, e.row | 0), w: w, h: h };
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
    var entry = state.widgets.find(function (e) { return e.id === id; });
    var el = document.createElement('article');
    el.className = 'wb-card';
    el.dataset.id = id;
    el.innerHTML =
      '<div class="wb-head">' +
        '<span class="wb-drag" title="拖动换位"><svg viewBox="0 0 24 24"><path d="M9 5h2v2H9zM13 5h2v2h-2zM9 11h2v2H9zM13 11h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z"/></svg></span>' +
        '<h3 class="wb-title">' + ((entry && entry.title) ? entry.title : def.title) + '</h3>' +
        '<button type="button" class="wb-settings" title="组件设置" aria-label="组件设置">' +
          '<svg viewBox="0 0 24 24"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 2.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM19.4 13c0-.3.1-.7.1-1s0-.7-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5c-.6.3-1.2.6-1.7 1l-2.4-1-2 3.4 2 1.6c-.1.3-.1.7-.1 1s0 .7.1 1l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6z"/></svg>' +
        '</button>' +
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

  // ── 交互（跟手拖拽：rAF 按帧合并 + transform 合成位移 + 实时让位替换 + 松手丝滑归位）──
  var GLIDE_MS = 220;          // 松手后拖拽卡片滑入目标格的时长（与 CSS 过渡配合）
  var settleTimer = null;
  var settleEl = null;         // 上一轮松手后仍在 glide 的卡片，供 flush 收尾

  // 若上一轮松手后还有未收尾的 glide，立即写回网格位并落盘，避免打断残留 transform
  function flushPendingSettle() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (settleEl) { settleEl.style.transition = ''; settleEl.style.willChange = ''; settleEl = null; }
    removeTransforms();
    relayout();
    persist();
  }

  function onPointerDown(ev) {
    if (!editing) return;
    flushPendingSettle(); // 收尾上一轮 drag 的 glide，再开始本轮
    var rm = ev.target.closest('.wb-remove');
    if (rm) {
      var c = ev.target.closest('.wb-card');
      if (c && c.dataset.id) { ev.preventDefault(); ev.stopPropagation(); api.removeWidget(c.dataset.id); }
      return;
    }
    var st = ev.target.closest('.wb-settings');
    if (st) {
      var sc = ev.target.closest('.wb-card');
      if (sc && sc.dataset.id) { ev.preventDefault(); ev.stopPropagation(); api.openSettings(sc.dataset.id); }
      return;
    }
    // 拖拽区：编辑态下整条卡片头均可拖（排除按钮），把手保留
    var resize = ev.target.closest('.wb-resize');
    var drag = resize ? null : (ev.target.closest('.wb-drag') || ev.target.closest('.wb-head'));
    if (!drag && !resize) return;
    if (drag && ev.target.closest('button')) return;
    ev.preventDefault();
    var card = ev.target.closest('.wb-card');
    var entry = state.widgets.find(function (e) { return e.id === card.dataset.id; });
    if (!entry) return;
    measure(); // 拖动开始时缓存一次网格单元尺寸，拖动过程不再读布局
    var bases = {};
    state.widgets.forEach(function (e) { bases[e.id] = { col: e.col, row: e.row, w: e.w, h: e.h }; });
    live = {
      mode: resize ? 'resize' : 'drag',
      id: entry.id,
      startX: ev.clientX, startY: ev.clientY,
      clientX: ev.clientX, clientY: ev.clientY,
      origCol: entry.col, origRow: entry.row,
      origW: entry.w, origH: entry.h,
      bases: bases, raf: 0
    };
    var el = cards[entry.id];
    if (el) el.classList.add('is-live'); // 提升层级 + will-change，禁用过渡保证跟手
    board.classList.add('wb-reflowing'); // 让位卡片短暂过渡，换位过程更顺滑
    document.body.classList.add('wb-dragging');
    if (lockPointer) card.setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev) {
    if (!live) return;
    live.clientX = ev.clientX; live.clientY = ev.clientY;
    // 每帧最多结算一次（rAF 合并高频 pointermove），避免布局抖动
    if (!live.raf) live.raf = requestAnimationFrame(applyLive);
  }
  function applyLive() {
    if (!live) return;
    live.raf = 0;
    if (!board || !colW) return;
    var rowW = colW, rowH = opts.rowH || 1;
    if (live.mode === 'resize') {
      // 仅更新当前卡片宽高，其余卡片与网格高度不动
      var elR = cards[live.id];
      if (!elR) return;
      var minS = registry[live.id].minSize;
      var nw = clamp(live.origW + Math.round((live.clientX - live.startX) / rowW), minS.w, opts.cols - live.origCol);
      var nh = clamp(live.origH + Math.round((live.clientY - live.startY) / rowH), minS.h, 12);
      elR.style.width = (nw * rowW) + 'px';
      elR.style.height = (nh * rowH) + 'px';
      return;
    }
    var entry = state.widgets.find(function (e) { return e.id === live.id; });
    var el = cards[live.id];
    if (!entry || !el) return;
    var g = ghostOf(entry, rowW, rowH);
    // 其它卡片实时让位：被目标格占用的卡片按「下移」预演，transform 平滑滑开（替换感）
    var others = state.widgets.filter(function (e) { return e.id !== live.id; });
    var cells = planPush(others, [{ col: g.col, row: g.row, w: entry.w, h: entry.h }]);
    others.forEach(function (o) {
      var t = cards[o.id], b = live.bases[o.id], c2 = cells[o.id];
      if (!t || !b || !c2) return;
      var tx = (c2.col - b.col) * rowW, ty = (c2.row - b.row) * rowH;
      t.style.transform = (tx || ty) ? 'translate(' + tx + 'px,' + ty + 'px)' : '';
    });
    // 拖拽卡片：transform 像素级跟手（合成器位移，不触发重排），略放大提升拖起手感
    var dx = live.clientX - live.startX, dy = live.clientY - live.startY;
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.03)';
  }
  // 根据指针位移换算目标格（超网格边界被钳制）
  function ghostOf(entry, rowW, rowH) {
    var col = clamp(live.origCol + Math.round((live.clientX - live.startX) / rowW), 0, opts.cols - entry.w);
    var row = Math.max(0, live.origRow + Math.round((live.clientY - live.startY) / rowH));
    return { col: col, row: row, w: entry.w, h: entry.h };
  }
  function endPointer(ev) {
    if (!live) return;
    if (ev) ev.preventDefault();
    if (live.raf) { cancelAnimationFrame(live.raf); live.raf = 0; }
    var entry = state.widgets.find(function (e) { return e.id === live.id; });
    var el = cards[live.id];
    var rowW = colW || 1, rowH = opts.rowH || 1;
    board.classList.remove('wb-reflowing');
    if (entry && el) {
      if (live.mode === 'resize') {
        // 尺寸拖动中已实时写 px，直接提交单元格便与视觉一致
        var minS = registry[entry.id].minSize;
        entry.w = clamp(live.origW + Math.round((live.clientX - live.startX) / rowW), minS.w, opts.cols - live.origCol);
        entry.h = clamp(live.origH + Math.round((live.clientY - live.startY) / rowH), minS.h, 12);
        // resize 放大到盖住其它卡片时，让被覆盖者整体下移避让（与拖拽同一 planPush 算法，不留重叠）
        var others = state.widgets.filter(function (o) { return o.id !== live.id; });
        var cells = planPush(others, [{ col: entry.col, row: entry.row, w: entry.w, h: entry.h }]);
        others.forEach(function (o) { var c2 = cells[o.id]; if (c2) { o.col = c2.col; o.row = c2.row; } });
        el.classList.remove('is-live');
        removeTransforms();
        relayout();
        persist();
      } else {
        var g = ghostOf(entry, rowW, rowH);
        entry.col = g.col; entry.row = g.row;
        // 提交让位结果（与拖动中预演同一算法，位置与视觉完全一致，无回跳）
        var others = state.widgets.filter(function (e) { return e.id !== live.id; });
        var cells = planPush(others, [{ col: g.col, row: g.row, w: entry.w, h: entry.h }]);
        others.forEach(function (o) { var c2 = cells[o.id]; if (c2) { o.col = c2.col; o.row = c2.row; } });
        // 拖拽卡片：transform 从指针位置滑向目标格（scale 同步回落），随后写回网格位
        el.classList.remove('is-live');
        el.style.willChange = 'transform';
        el.style.transition = 'transform ' + GLIDE_MS + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = 'translate(' + (g.col - live.origCol) * rowW + 'px,' + (g.row - live.origRow) * rowH + 'px) scale(1)';
        settleEl = el;
        settleTimer = setTimeout(function () {
          settleTimer = null;
          if (settleEl) { settleEl.style.transition = ''; settleEl.style.willChange = ''; settleEl = null; }
          removeTransforms();
          relayout(); // 把卡片 left/top 写回最终网格位
          persist();
        }, GLIDE_MS + 40);
      }
    }
    document.body.classList.remove('wb-dragging');
    live = null;
  }
  function removeTransforms() {
    for (var id in cards) {
      var t = cards[id];
      if (t) { t.style.transform = ''; t.style.transition = ''; t.style.willChange = ''; }
    }
  }
  // 让位预演：给定固定占用区 fixed，其余卡片按「上→下、左→右」顺序，重叠者整体下移避让
  function planPush(list, fixed) {
    var sorted = list.slice().sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    var placed = fixed.slice();
    var out = {};
    sorted.forEach(function (o) {
      var r = { col: o.col, row: o.row, w: o.w, h: o.h };
      var guard = 0;
      while (placed.some(function (p) { return overlaps(r, p); }) && guard++ < 60) {
        var collider = placed.find(function (p) { return overlaps(r, p); });
        r.row = collider.row + collider.h;
      }
      placed.push(r);
      out[o.id] = r;
    });
    return out;
  }
  function closeSettingsModal() {
    var m = document.querySelector('.wb-settings-modal');
    if (m) m.remove();
  }
  // 紧凑排列：按 上→下、左→右 稳定顺序，把卡片依次塞到首个不与已放置卡片冲突的空位，消除拖拽遗留的空洞
  function compactLayout() {
    var sorted = state.widgets.slice().sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    var placed = [];
    sorted.forEach(function (o) {
      var found = false;
      outer:
      for (var row = 0; row < 60; row++) {
        for (var c = 0; c <= opts.cols - o.w; c++) {
          var r = { col: c, row: row, w: o.w, h: o.h };
          if (placed.every(function (p) { return !overlaps(r, p); })) { o.col = c; o.row = row; placed.push(r); found = true; break outer; }
        }
      }
      // 兜底：扫描不到空位时追加到底部最末项之下
      if (!found) {
        o.col = 0;
        o.row = placed.reduce(function (mx, p) { return Math.max(mx, p.row + p.h); }, 0);
        placed.push({ col: o.col, row: o.row, w: o.w, h: o.h });
      }
    });
  }

  // ‾‾‾‾‾ 公开 API ‾‾‾‾‾
  var api = {
    register: function (def) {
      if (!def || !def.id || typeof def.render !== 'function') return;
      registry[def.id] = {
        id: def.id,
        title: def.title || def.id,
        scope: def.scope || 'overview',
        defaultSize: def.defaultSize || { w: 1, h: 1 },
        minSize: def.minSize || { w: 1, h: 1 },
        render: def.render,
        destroy: def.destroy || null
      };
    },
    // 卸载当前板：旧布局落盘 → 各组件 destroy（销毁 chart 等资源）→ 清状态。
    // 换板（mount 到另一容器）与 destroy() 前调用，避免 chart 实例 / ResizeObserver 泄漏。
    detachBoard: function () {
      if (!board) return;
      persist();
      state.widgets.forEach(function (e) {
        var d = registry[e.id] && registry[e.id].destroy;
        if (d) { try { d(cards[e.id]); } catch (err) {} }
      });
      if (ro) { try { ro.disconnect(); } catch (err) {} ro = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      settleEl = null;
      cards = {};
      state.widgets = [];
      editing = false;
      live = null;
    },
    mount: function (el, cfg) {
      if (board && board !== el) api.detachBoard();
      board = el;
      opts = Object.assign({ cols: 4, rowH: 170 }, cfg || {});
      if (!opts.cols) opts.cols = 4;
      boardScope = opts.scope || 'overview';
      // 切换布局命名空间（先切 key 再拉取布局，避免先载入旧 key 布局）
      if (cfg && cfg.layoutKey && cfg.layoutKey !== STORAGE_KEY) STORAGE_KEY = cfg.layoutKey;
      editing = false;
      loadLayout(cfg && cfg.initialLayout);
      buildCards();
      relayout();
      if (window.ResizeObserver) {
        try { ro = new ResizeObserver(function () { relayout(); }); ro.observe(board); } catch (e) {}
      }
    },
    setEditMode: function (on) { editing = !!on; applyEditControls(); },
    isEditing: function () { return editing; },
    // 切换整套布局的持久化命名空间（多工作台独立布局）。
    // 先落盘当前键的布局，再换键重载新布局；无新键存档时回落默认布局。
    setLayoutKey: function (key) {
      if (!key || key === STORAGE_KEY) return;
      if (state.widgets.length) persist();
      editing = false;
      applyEditControls();
      STORAGE_KEY = key;
      loadLayout(null);
      buildCards();
      relayout();
    },
    // 一键紧凑排列：消除拖拽遗留的空洞
    compact: function () {
      if (!state.widgets.length) return;
      compactLayout();
      relayout();
      persist();
    },
    // 组件设置弹窗：自定义标题与宽/高（clamp 到 minSize..上限），随布局存档
    openSettings: function (id) {
      var entry = state.widgets.find(function (e) { return e.id === id; });
      var def = registry[id];
      if (!entry || !def) return;
      closeSettingsModal();
      var modal = document.createElement('div');
      modal.className = 'wb-settings-modal';
      modal.innerHTML =
        '<div class="wb-settings-panel">' +
          '<h3>' + def.title + ' · 设置</h3>' +
          '<label class="ws-field">标题<input type="text" class="ws-input" id="wsTitle" maxlength="40" placeholder="留空恢复默认标题"></label>' +
          '<div class="ws-row">' +
            '<label class="ws-field">宽度<input type="number" class="ws-input" id="wsW" min="' + def.minSize.w + '" max="' + opts.cols + '"></label>' +
            '<label class="ws-field">高度<input type="number" class="ws-input" id="wsH" min="' + def.minSize.h + '" max="12"></label>' +
          '</div>' +
          '<div class="ws-actions">' +
            '<button type="button" class="ws-cancel">取消</button>' +
            '<button type="button" class="ws-save">保存</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.querySelector('#wsTitle').value = entry.title || '';
      modal.querySelector('#wsW').value = entry.w;
      modal.querySelector('#wsH').value = entry.h;
      modal.addEventListener('click', function (e) { if (e.target === modal) closeSettingsModal(); });
      modal.querySelector('.ws-cancel').addEventListener('click', closeSettingsModal);
      modal.querySelector('.ws-save').addEventListener('click', function () {
        var w = parseInt(modal.querySelector('#wsW').value, 10);
        var h = parseInt(modal.querySelector('#wsH').value, 10);
        if (isNaN(w) || isNaN(h)) return;
        entry.w = clamp(w, def.minSize.w, opts.cols);
        entry.h = clamp(h, def.minSize.h, 12);
        entry.title = (modal.querySelector('#wsTitle').value || '').trim();
        var card = cards[id];
        if (card) {
          var t = card.querySelector('.wb-title');
          if (t) t.textContent = entry.title || def.title;
        }
        relayout();
        persist();
        closeSettingsModal();
      });
      var ti = modal.querySelector('#wsTitle');
      if (ti) ti.focus();
    },
    addWidget: function (id) {
      if (!registry[id] || state.widgets.some(function (e) { return e.id === id; })) return;
      var def = registry[id]; if (!def) return;
      // 找一个空位：从 (0,0) 向后找首个不与已放置冲突的格子
      var col = 0, baseRow = 0, found = false;
      outer:
      for (var row = 0; row < 24; row++) {
        for (var c = 0; c <= opts.cols - def.defaultSize.w; c++) {
          var r = { col: c, row: row, w: def.defaultSize.w, h: def.defaultSize.h };
          if (state.widgets.every(function (o) { return !overlaps(r, rectOf(o)); })) { col = c; baseRow = row; found = true; break outer; }
        }
      }
      // 前 24 行已无空位时，追加到底部最末项之下，避免与现有卡片重叠
      if (!found) {
        col = 0;
        baseRow = state.widgets.reduce(function (mx, o) { return Math.max(mx, o.row + o.h); }, 0);
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
    getRegistered: function (scope) {
      if (!scope) return Object.keys(registry);
      return Object.keys(registry).filter(function (id) { return (registry[id].scope || 'overview') === scope; });
    },
    destroy: function () {
      api.detachBoard();
      if (board) { board.onpointerdown = null; board.onpointermove = null; board.onpointerup = null; board = null; }
    }
  };

  // 绑定板级指针事件（事件委托 + 指针捕获，支持拖出容器）
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', endPointer, true);
  document.addEventListener('pointercancel', endPointer, true);

  return api;
});