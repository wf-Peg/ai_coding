/**
 * canvas-outline.js - 画布页·层级大纲面板（对标幕布「极简大纲笔记」）
 *
 * 职责边界：只管「树模型 + 大纲 DOM」，不碰 SVG 画布与任何 IPC。
 * 通过 init(opts) 注入的回调与 canvas.js 交换数据：
 *   - onEdit(id, text)            文本落库（canvas.js 调 updateCanvasNode）
 *   - onStructure(entries)        结构落库（canvas.js 调 saveCanvasStructure，一次批量）
 *   - onCreate({parentId, afterId}) -> Promise<node>  新建节点（canvas.js 调 createCanvasNode）
 *   - onDelete(id)               删除节点（canvas.js 调 deleteCanvasNode）
 *   - onSelect(id|null)          选中联动（canvas.js 高亮对应画布卡片）
 *   - onScaleWarn(count)         节点规模提示（性能口径）
 *
 * 结构真源是每个节点的 parentId / orderIndex（与后端 canvas_node 一致）；
 * 本模块在内存中即时重排 + 规范化同级 orderIndex，只把「变化了的行」合并成一次 IPC。
 *
 * 键盘范式（对齐幕布 / Logseq 公开交互约定，行内聚焦时生效）：
 *   Enter 同级新行 / Tab 缩进 / Shift+Tab 反缩进 / Alt+↑↓ 兄弟换序 /
 *   Ctrl|Cmd+↑↓ 折叠展开 / 空行 Backspace 合并（有子节点则先升级）/ Esc 退出
 */
(function () {
  'use strict';

  var ROOT = '__root__';
  var TEXT_DEBOUNCE_MS = 300;

  var treeEl = null;
  var emptyEl = null;
  var opts = {};
  var wired = false;

  var nodes = [];
  var byId = new Map();
  var childrenMap = new Map();
  var rowEls = new Map();
  var collapsed = new Set();
  var selectedId = null;
  var editingId = null;
  var textTimer = null;
  var pendingTextId = null;
  var autoCollapsed = false;

  // ---------- 索引与扁平化 ----------

  function orderKey(n) {
    return n.orderIndex == null ? Number.MAX_SAFE_INTEGER : n.orderIndex;
  }

  function buildIndex() {
    byId = new Map();
    childrenMap = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      byId.set(n.id, n);
      var key = n.parentId || ROOT;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key).push(n);
    }
    childrenMap.forEach(function (arr) {
      arr.sort(function (a, b) {
        var d = orderKey(a) - orderKey(b);
        if (d !== 0) return d;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    });
  }

  /** DFS 扁平化（含折叠状态），孤立节点兜底挂到根层，避免数据异常时“看不见”。 */
  function flatten() {
    var out = [];
    var seen = new Set();
    (function walk(key, depth, hidden) {
      var arr = childrenMap.get(key) || [];
      for (var i = 0; i < arr.length; i++) {
        var n = arr[i];
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        var hid = hidden || (n.parentId ? collapsed.has(n.parentId) : false);
        out.push({ node: n, depth: depth, hidden: hid });
        walk(n.id, depth + 1, hid);
      }
    })(ROOT, 0, false);

    for (var j = 0; j < nodes.length; j++) {
      if (!seen.has(nodes[j].id)) out.push({ node: nodes[j], depth: 0, hidden: false });
    }
    return out;
  }

  function visibleRows() {
    return flatten().filter(function (r) { return !r.hidden; });
  }

  function indexOfNode(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
    return -1;
  }

  // ---------- 渲染（按 id 复用 DOM 行，禁止整树 innerHTML 重建） ----------

  function createRow(node) {
    var row = document.createElement('div');
    row.className = 'outline-row';
    row.dataset.id = node.id;

    var caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'outline-caret';
    caret.textContent = '▾';
    caret.title = '折叠 / 展开';
    caret.addEventListener('mousedown', function (e) { e.preventDefault(); });
    caret.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCollapse(node.id);
    });

    var marker = document.createElement('span');
    marker.className = 'outline-marker';

    var text = document.createElement('div');
    text.className = 'outline-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.dataset.id = node.id;
    text.dataset.placeholder = '输入内容';

    row.appendChild(caret);
    row.appendChild(marker);
    row.appendChild(text);
    return { row: row, caret: caret, text: text };
  }

  function updateRow(rec, item) {
    var n = item.node;
    rec.row.style.setProperty('--depth', String(item.depth));
    rec.row.dataset.kind = n.kind || 'note';
    rec.row.classList.toggle('is-hidden', !!item.hidden);

    var kids = childrenMap.get(n.id) || [];
    rec.caret.classList.toggle('is-empty', kids.length === 0);
    rec.caret.classList.toggle('is-collapsed', collapsed.has(n.id));

    if (editingId !== n.id) {
      var want = n.text != null ? String(n.text) : '';
      if (rec.text.textContent !== want) rec.text.textContent = want;
    }
  }

  function render() {
    if (!treeEl) return;
    buildIndex();
    var rows = flatten();
    var seen = new Set();
    var prev = null;

    for (var i = 0; i < rows.length; i++) {
      var item = rows[i];
      var id = item.node.id;
      var rec = rowEls.get(id);
      if (!rec) {
        rec = createRow(item.node);
        rowEls.set(id, rec);
      }
      updateRow(rec, item);
      seen.add(id);

      if (prev === null) {
        if (treeEl.firstChild !== rec.row) treeEl.insertBefore(rec.row, treeEl.firstChild);
      } else if (prev.nextSibling !== rec.row) {
        treeEl.insertBefore(rec.row, prev.nextSibling);
      }
      prev = rec.row;
    }

    rowEls.forEach(function (rec, rid) {
      if (seen.has(rid)) return;
      if (rec.row.parentNode === treeEl) treeEl.removeChild(rec.row);
      rowEls.delete(rid);
    });

    if (emptyEl) emptyEl.style.display = nodes.length ? 'none' : 'block';
  }

  // ---------- 结构变更：本地即时重排 + 一次批量落库 ----------

  function structureSnapshot() {
    var map = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      map.set(n.id, { parentId: n.parentId || null, orderIndex: n.orderIndex == null ? null : n.orderIndex });
    }
    return map;
  }

  /** 同级 orderIndex 规范化为 0..n-1（顺序按现有 orderIndex，缺省用 createdAt 兜底）。 */
  function normalizeOrders() {
    var groups = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var key = n.parentId || ROOT;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    groups.forEach(function (arr) {
      arr.sort(function (a, b) {
        var d = orderKey(a) - orderKey(b);
        if (d !== 0) return d;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      for (var k = 0; k < arr.length; k++) arr[k].orderIndex = k;
    });
  }

  function commitStructure(before, focusTarget) {
    normalizeOrders();
    render();
    var entries = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var b = before.get(n.id);
      var pid = n.parentId || null;
      var oi = n.orderIndex;
      if (!b || b.parentId !== pid || b.orderIndex !== oi) entries.push({ id: n.id, parentId: pid, orderIndex: oi });
    }
    if (entries.length && typeof opts.onStructure === 'function') opts.onStructure(entries);
    if (focusTarget) focusRow(focusTarget, 'end');
  }

  function insertSiblingAfter(id) {
    var node = byId.get(id);
    if (!node || typeof opts.onCreate !== 'function') return;
    flushText();
    var parentId = node.parentId || null;
    var anchorOrder = node.orderIndex == null ? 0 : node.orderIndex;
    opts.onCreate({ parentId: parentId, afterId: id }).then(function (created) {
      if (!created || !created.id) return;
      created.parentId = parentId;
      created.orderIndex = anchorOrder + 0.5;
      nodes.push({
        id: created.id,
        kind: created.kind || 'note',
        text: created.text != null ? created.text : '',
        title: created.title || '',
        parentId: parentId,
        orderIndex: created.orderIndex,
        createdAt: created.createdAt || ''
      });
      var before = structureSnapshot();
      before.delete(created.id);
      commitStructure(before, created.id);
    }).catch(function () {});
  }

  function indent(id) {
    var node = byId.get(id);
    if (!node) return;
    flushText();
    var siblings = childrenMap.get(node.parentId || ROOT) || [];
    var idx = indexOfNode(siblings, id);
    if (idx <= 0) return;
    var prev = siblings[idx - 1];
    collapsed.delete(prev.id);

    var before = structureSnapshot();
    var kids = childrenMap.get(prev.id) || [];
    var maxChild = -1;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].id === id) continue;
      var oi = kids[i].orderIndex;
      if (oi != null && oi > maxChild) maxChild = oi;
    }
    node.parentId = prev.id;
    node.orderIndex = maxChild + 0.5;
    commitStructure(before, id);
  }

  function outdent(id) {
    var node = byId.get(id);
    if (!node || !node.parentId) return;
    flushText();
    var parent = byId.get(node.parentId);
    var before = structureSnapshot();
    node.parentId = parent ? (parent.parentId || null) : null;
    node.orderIndex = (parent && parent.orderIndex != null ? parent.orderIndex : 0) + 0.5;
    commitStructure(before, id);
  }

  function moveSibling(id, dir) {
    var node = byId.get(id);
    if (!node) return;
    flushText();
    var siblings = (childrenMap.get(node.parentId || ROOT) || []).slice();
    var idx = indexOfNode(siblings, id);
    var target = idx + dir;
    if (idx < 0 || target < 0 || target >= siblings.length) return;
    var before = structureSnapshot();
    var tmp = siblings[idx];
    siblings[idx] = siblings[target];
    siblings[target] = tmp;
    for (var i = 0; i < siblings.length; i++) siblings[i].orderIndex = i;
    commitStructure(before, id);
  }

  function toggleCollapse(id) {
    var kids = childrenMap.get(id) || [];
    if (!kids.length) return;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    render();
  }

  function expandAll() {
    collapsed.clear();
    render();
  }

  function collapseAll() {
    buildIndex();
    collapsed.clear();
    for (var i = 0; i < nodes.length; i++) {
      if ((childrenMap.get(nodes[i].id) || []).length) collapsed.add(nodes[i].id);
    }
    render();
  }

  // ---------- 选中与聚焦 ----------

  function setSelected(id) {
    var next = id || null;
    if (next === selectedId) return;
    if (selectedId) {
      var prev = rowEls.get(selectedId);
      if (prev) prev.row.classList.remove('is-selected');
    }
    selectedId = next;
    if (selectedId) {
      var cur = rowEls.get(selectedId);
      if (cur) cur.row.classList.add('is-selected');
    }
    if (typeof opts.onSelect === 'function') opts.onSelect(selectedId);
  }

  function scrollRowIntoView(row) {
    if (!row || !row.scrollIntoView) return;
    try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 老内核忽略 */ }
  }

  function focusRow(id, caret) {
    var rec = rowEls.get(id);
    if (!rec) return;
    var el = rec.text;
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(caret !== 'end');
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* 忽略选区异常 */ }
    setSelected(id);
    scrollRowIntoView(rec.row);
  }

  function caretAtStart(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return true;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    var probe = range.cloneRange();
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length === 0;
  }

  function caretAtEnd(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return true;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    var probe = range.cloneRange();
    probe.selectNodeContents(el);
    probe.setStart(range.endContainer, range.endOffset);
    return probe.toString().length === 0;
  }

  function stepVisible(id, dir) {
    var rows = visibleRows();
    var idx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].node.id === id) { idx = i; break; }
    }
    if (idx < 0) return null;
    var t = idx + dir;
    if (t < 0 || t >= rows.length) return null;
    return rows[t].node.id;
  }

  // ---------- 文本编辑落库 ----------

  function flushText() {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; }
    var id = pendingTextId;
    pendingTextId = null;
    if (!id) return;
    var rec = rowEls.get(id);
    var n = byId.get(id);
    if (!rec || !n) return;
    var val = rec.text.textContent || '';
    if (val === (n.text != null ? String(n.text) : '')) return;
    n.text = val;
    if (typeof opts.onEdit === 'function') opts.onEdit(id, val);
  }

  // ---------- DOM 事件 ----------

  function onInput(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('outline-text')) return;
    pendingTextId = el.dataset.id;
    if (textTimer) clearTimeout(textTimer);
    textTimer = setTimeout(flushText, TEXT_DEBOUNCE_MS);
  }

  function onFocusIn(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('outline-text')) return;
    editingId = el.dataset.id;
    setSelected(editingId);
  }

  function onFocusOut(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('outline-text')) return;
    editingId = null;
    flushText();
  }

  /** 粘贴一律按纯文本插入，避免带入外部 HTML 破坏行结构（富文本排 M4）。 */
  function onPaste(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('outline-text')) return;
    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text == null) return;
    e.preventDefault();
    var clean = String(text).replace(/\s*\n\s*/g, ' ');
    if (!clean) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var node = document.createTextNode(clean);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    pendingTextId = el.dataset.id;
    if (textTimer) clearTimeout(textTimer);
    textTimer = setTimeout(flushText, TEXT_DEBOUNCE_MS);
  }

  function onTreeClick(e) {
    var row = e.target && e.target.closest ? e.target.closest('.outline-row') : null;
    if (!row || !treeEl.contains(row)) return;
    if (e.target.classList && e.target.classList.contains('outline-caret')) return;
    var id = row.dataset.id;
    setSelected(id);
    if (!(e.target.classList && e.target.classList.contains('outline-text'))) focusRow(id, 'end');
  }

  function handleBackspace(e, id, el) {
    if ((el.textContent || '').length !== 0) return;
    var node = byId.get(id);
    if (!node) return;
    e.preventDefault();

    var kids = childrenMap.get(id) || [];
    if (kids.length) { outdent(id); return; }
    if (nodes.length <= 1) return;
    if (typeof opts.onDelete !== 'function') return;
    var prevId = stepVisible(id, -1);
    removeNode(id);
    opts.onDelete(id);
    if (prevId) focusRow(prevId, 'end');
  }

  function onKeydown(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('outline-text')) return;
    var id = el.dataset.id;
    if (!id) return;

    if (e.key === 'Escape') {
      el.blur();
      setSelected(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insertSiblingAfter(id);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent(id); else indent(id);
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveSibling(id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      toggleCollapse(id);
      return;
    }
    if (e.key === 'Backspace') { handleBackspace(e, id, el); return; }
    if (e.key === 'ArrowUp' && caretAtStart(el)) {
      var upId = stepVisible(id, -1);
      if (upId) { e.preventDefault(); focusRow(upId, 'end'); }
      return;
    }
    if (e.key === 'ArrowDown' && caretAtEnd(el)) {
      var downId = stepVisible(id, 1);
      if (downId) { e.preventDefault(); focusRow(downId, 'start'); }
    }
  }

  // ---------- 对外接口 ----------

  function toNode(raw) {
    return {
      id: raw.id,
      kind: raw.kind || 'note',
      text: raw.text != null ? String(raw.text) : (raw.title != null ? String(raw.title) : ''),
      title: raw.title != null ? String(raw.title) : '',
      parentId: raw.parentId || null,
      orderIndex: typeof raw.orderIndex === 'number' ? raw.orderIndex : null,
      createdAt: raw.createdAt || ''
    };
  }

  function setNodes(list) {
    nodes = (list || []).filter(function (n) { return n && n.id; }).map(toNode);
    collapsed.clear();
    render();
    if (nodes.length > 500 && !autoCollapsed) {
      autoCollapsed = true;
      collapseAll();
      if (typeof opts.onScaleWarn === 'function') opts.onScaleWarn(nodes.length);
    }
  }

  function upsertNode(raw) {
    if (!raw || !raw.id) return;
    var existing = byId.get(raw.id);
    if (existing) {
      if (raw.kind) existing.kind = raw.kind;
      if (raw.text != null) existing.text = String(raw.text);
      if (raw.title != null) existing.title = String(raw.title);
      if (raw.parentId !== undefined) existing.parentId = raw.parentId || null;
      if (typeof raw.orderIndex === 'number') existing.orderIndex = raw.orderIndex;
      render();
      return;
    }
    nodes.push(toNode(raw));
    render();
  }

  function removeNode(id) {
    if (!id) return;
    buildIndex();
    var doomed = new Set([id]);
    var stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      var kids = childrenMap.get(cur) || [];
      for (var i = 0; i < kids.length; i++) {
        if (doomed.has(kids[i].id)) continue;
        doomed.add(kids[i].id);
        stack.push(kids[i].id);
      }
    }
    nodes = nodes.filter(function (n) { return !doomed.has(n.id); });
    doomed.forEach(function (d) {
      collapsed.delete(d);
      if (selectedId === d) selectedId = null;
    });
    render();
  }

  function reset() {
    nodes = [];
    collapsed.clear();
    selectedId = null;
    editingId = null;
    render();
  }

  function focusFirst() {
    var rows = visibleRows();
    if (!rows.length) return;
    focusRow(rows[0].node.id, 'end');
  }

  function highlight(id) {
    if (!id) return;
    if (byId.size !== nodes.length) buildIndex();
    var target = byId.get(id);
    if (!target) return;
    // 行可能在折叠分支里：先展开祖先
    var changed = false;
    var pid = target.parentId;
    var guard = 0;
    while (pid && guard < 100) {
      if (collapsed.has(pid)) { collapsed.delete(pid); changed = true; }
      var pnode = byId.get(pid);
      pid = pnode ? pnode.parentId : null;
      guard++;
    }
    if (changed) render();
    var rec = rowEls.get(id);
    if (!rec) return;
    setSelected(id);
    scrollRowIntoView(rec.row);
    rec.row.classList.add('is-flash');
    setTimeout(function () { rec.row.classList.remove('is-flash'); }, 700);
  }

  function toMarkdown() {
    buildIndex();
    var lines = [];
    var seen = new Set();
    (function walk(key, depth) {
      var arr = childrenMap.get(key) || [];
      for (var i = 0; i < arr.length; i++) {
        var n = arr[i];
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        var text = String(n.text == null ? '' : n.text).replace(/\s*\n\s*/g, ' ').trim();
        lines.push(new Array(depth + 1).join('  ') + '- ' + text);
        walk(n.id, depth + 1);
      }
    })(ROOT, 0);
    for (var j = 0; j < nodes.length; j++) {
      if (seen.has(nodes[j].id)) continue;
      lines.push('- ' + String(nodes[j].text || '').trim());
    }
    return lines.join('\n');
  }

  function downloadMarkdown(filename) {
    flushText();
    var text = toMarkdown();
    if (!text) return false;
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || '大纲.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  function init(options) {
    opts = options || {};
    treeEl = document.getElementById('outlineTree');
    emptyEl = document.getElementById('outlineEmpty');
    if (!treeEl || wired) return;

    treeEl.addEventListener('input', onInput);
    treeEl.addEventListener('keydown', onKeydown);
    treeEl.addEventListener('click', onTreeClick);
    treeEl.addEventListener('focusin', onFocusIn);
    treeEl.addEventListener('focusout', onFocusOut);
    treeEl.addEventListener('paste', onPaste);

    var expandBtn = document.getElementById('outlineExpandBtn');
    if (expandBtn) expandBtn.addEventListener('click', expandAll);
    var collapseBtn = document.getElementById('outlineCollapseBtn');
    if (collapseBtn) collapseBtn.addEventListener('click', collapseAll);
    var exportBtn = document.getElementById('outlineExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (typeof opts.getExportName === 'function') downloadMarkdown(opts.getExportName());
        else downloadMarkdown('大纲.md');
      });
    }

    wired = true;
  }

  window.CanvasOutline = {
    init: init,
    setNodes: setNodes,
    upsertNode: upsertNode,
    removeNode: removeNode,
    reset: reset,
    highlight: highlight,
    focusFirst: focusFirst,
    setSelected: function (id) { setSelected(id || null); },
    expandAll: expandAll,
    collapseAll: collapseAll,
    toMarkdown: toMarkdown,
    downloadMarkdown: downloadMarkdown,
    getSelectedId: function () { return selectedId; },
    getCount: function () { return nodes.length; },
    flush: flushText
  };
})();
