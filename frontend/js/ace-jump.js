/**
 * ace-jump.js — AceJump 跳跃模式（对标 IDEA AceJump 的自研轻量实现）
 * ------------------------------------------------------------
 * 触发后进入「跳跃模式」：编辑器可视区内的单词/字符/行首上方叠加字母标签；
 * 连续键入标签字母即把光标（或选区）移动到对应位置；Esc / 滚动 / 点击取消。
 *
 * 支持三种模式（均可从命令面板触发）：
 *   - word（默认）：跳到每个单词 / CJK 单字的首字符；
 *   - char：跳到每个非空白字符；
 *   - line：跳到每个可视行的首个非空白字符。
 *
 * 关键设计（对齐 .trae/documents/编辑器模块对标IDEA与AceJump评估分期方案.md 4.2）：
 *   1. 坐标换算：renderer.textToScreenCoordinates + getBoundingClientRect 换算到覆盖层；
 *   2. 叠加渲染：在 editor.container 上盖一层 pointer-events:none 的绝对定位覆盖层；
 *   3. 标签分配：复用 EditorPure.assignJumpCodes（≤26 单字母，>26 两阶段分组）；
 *   4. 键盘捕获：跳跃模式下接管 keydown（过滤 isComposing，避免 IME 冲突）；
 *   5. 取消时机：Esc / 滚动 / resize / 点击空白 / 再按触发键。
 *
 * 集成方式：独立脚本引入（editor.html 末尾追加），由 editor.js 注册
 *   registerCommand('acejump-...') 与 EditorShortcuts 的 'aceJump' action 唤起。
 *   未触发时零副作用（不注册任何监听、不创建 DOM）。
 */
(function (global) {
  'use strict';

  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
  // 单词/中文单字字符集：ASCII 字母数字下划线 + CJK 中日韩统一表意文字
  var WORD_CHAR = /[A-Za-z0-9_\u4e00-\u9fa5]/;
  var MAX_CANDIDATES = 676; // 26 组 × 26 组内，足够覆盖可视区

  // ── 内部状态（仅在跳跃模式激活期间存在）──
  var jump = {
    active: false,
    editor: null,
    mode: 'word',
    select: false,
    stage: 0,            // 0=首层字母, 1=组内字母
    codes: [],           // 候选标签码数组（与 candidates 对齐）
    candidates: [],      // 当前候选：{row, col, code, el}
    baseCandidates: [],  // 首层完整候选（stage 回退时恢复）
    overlay: null,
    keydownHandler: null,
    wheelHandler: null,
    resizeHandler: null,
    mousedownHandler: null,
    cleanupFns: []
  };

  // ── 标签码分配（优先复用 EditorPure，缺失时本地兜底，逻辑一致）──
  function assignJumpCodes(count) {
    if (global.EditorPure && typeof global.EditorPure.assignJumpCodes === 'function') {
      return global.EditorPure.assignJumpCodes(count);
    }
    var n = Math.max(0, Math.floor(Number(count) || 0));
    var codes = [];
    if (n <= 26) {
      for (var i = 0; i < n; i++) codes.push(ALPHABET[i]);
      return codes;
    }
    var bucketSize = Math.ceil(n / 26);
    for (var j = 0; j < n; j++) {
      var bucket = Math.min(25, Math.floor(j / bucketSize));
      var idx = j % bucketSize;
      codes.push(ALPHABET[bucket] + ALPHABET[idx]);
    }
    return codes;
  }

  function noop() {}

  // ── 候选收集 ──
  /**
   * 收集可视区内候选 {row, col} 列表。
   * 使用 textToScreenCoordinates 校验可见性，天然兼容软换行（wrap）。
   */
  function collectCandidates(editor, mode) {
    var session = editor.session;
    var renderer = editor.renderer;
    if (!session || !renderer) return [];

    var firstRow = Math.max(0, renderer.getFirstFullyVisibleRow() || 0);
    var lastRow = Math.min(session.getLength() - 1, renderer.getLastFullyVisibleRow() || firstRow);
    if (lastRow < firstRow) return [];

    var viewHeight = renderer.$size ? renderer.$size.height : 0;
    // 兜底：编辑器容器尚未测量出 $size 时，回退用容器实际高度，避免可视区坐标被误判过滤导致"唤出无反应"
    if (!viewHeight || isNaN(viewHeight)) {
      var host = (renderer.container || editor.container);
      viewHeight = host ? (host.clientHeight || host.getBoundingClientRect().height || 0) : 0;
    }
    var out = [];

    for (var row = firstRow; row <= lastRow; row++) {
      var line = session.getLine(row) || '';
      var cols = candidateColsForLine(line, mode);
      for (var c = 0; c < cols.length; c++) {
        var col = cols[c];
        var pos;
        try {
          pos = renderer.textToScreenCoordinates(row, col);
        } catch (e) {
          continue; // 不可换算的坐标跳过（虚拟行/折叠边界等）
        }
        var rect = editor.container ? editor.container.getBoundingClientRect() : null;
        var x = rect ? pos.pageX - rect.left : pos.pageX;
        var y = rect ? pos.pageY - rect.top : pos.pageY;
        if (y < -1 || y > viewHeight + 1) continue; // 不在可视行内（含折叠隐藏行）
        if (x < 0 || x > (rect ? rect.width : Infinity)) continue; // 被横向滚动隐藏
        out.push({ row: row, col: col, x: x, y: y });
        if (out.length >= MAX_CANDIDATES) return out;
      }
    }
    return out;
  }

  /** 按模式计算一行内的候选列 */
  function candidateColsForLine(line, mode) {
    var cols = [];
    if (mode === 'line') {
      // 行首模式：取首个非空白字符
      for (var i = 0; i < line.length; i++) {
        if (!/[\s]/.test(line[i])) { cols.push(i); break; }
      }
      return cols;
    }
    if (mode === 'char') {
      for (var j = 0; j < line.length; j++) {
        if (!/[\s]/.test(line[j])) cols.push(j);
      }
      return cols;
    }
    // word 模式：单词/中文单字首字符。
    // - 拉丁/数字/下划线：按词首取（前驱不必仍是词字符时才算新的词）；
    // - CJK 单字：每个字符独立的跳跃目标（中文中每个汉字即一个"词"）。
    for (var k = 0; k < line.length; k++) {
      var ch = line[k];
      if (!WORD_CHAR.test(ch)) continue;
      if (/[\u4e00-\u9fa5]/.test(ch)) { cols.push(k); continue; }
      var prev = k > 0 ? line[k - 1] : '';
      if (!prev || !WORD_CHAR.test(prev)) cols.push(k);
    }
    return cols;
  }

  // ── 覆盖层渲染 ──
  function buildOverlay(editor) {
    var overlay = document.createElement('div');
    overlay.className = 'ace-jump-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:1000;overflow:hidden;';
    editor.container.appendChild(overlay);
    return overlay;
  }

  function clearOverlay() {
    if (jump.overlay) {
      jump.overlay.innerHTML = '';
    }
  }

  function renderStage0() {
    clearOverlay();
    jump.candidates = jump.baseCandidates;
    jump.stage = 0;
    var overlay = jump.overlay;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < jump.candidates.length; i++) {
      var c = jump.candidates[i];
      var el = document.createElement('span');
      el.className = 'ace-jump-label' + (jump.codes[i].length > 1 ? ' ace-jump-label-two' : '');
      el.textContent = jump.codes[i][0];
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      c.el = el;
      frag.appendChild(el);
    }
    overlay.appendChild(frag);
  }

  function renderStage1(bucketCode) {
    // 保留 code[0] === bucketCode 的候选，仅显示第二层字母
    var next = [];
    for (var i = 0; i < jump.baseCandidates.length; i++) {
      if (jump.codes[i][0] === bucketCode) next.push(jump.baseCandidates[i]);
    }
    if (next.length === 0) return;
    clearOverlay();
    jump.candidates = next;
    jump.stage = 1;
    var overlay = jump.overlay;
    var frag = document.createDocumentFragment();
    for (var j = 0; j < next.length; j++) {
      var c = next[j];
      var idx = jump.baseCandidates.indexOf(c);
      var code = jump.codes[idx];
      var el = document.createElement('span');
      el.className = 'ace-jump-label ace-jump-label-active';
      el.textContent = code[1] || '';
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      c.el = el;
      frag.appendChild(el);
    }
    overlay.appendChild(frag);
  }

  // ── 命中与导航 ──
  function resolveAndJump(letter) {
    if (jump.stage === 0) {
      // 单字母码：直接命中；两字母码：先选组
      var single = null, bucket = null, singleCount = 0, bucketCount = 0;
      for (var i = 0; i < jump.codes.length; i++) {
        var code = jump.codes[i];
        if (code.length === 1) {
          if (code[0] === letter) { single = jump.baseCandidates[i]; singleCount++; }
        } else {
          if (code[0] === letter) { bucket = code[0]; bucketCount++; }
        }
      }
      if (singleCount === 1 && single) { return finishJump(single); }
      if (bucketCount > 0) { renderStage1(bucket); return true; }
      return false; // 无匹配
    }
    // stage 1：在组内按第二层字母精确命中
    for (var j = 0; j < jump.candidates.length; j++) {
      var cand = jump.candidates[j];
      var idx = jump.baseCandidates.indexOf(cand);
      var fullCode = jump.codes[idx];
      if (fullCode && fullCode.length === 2 && fullCode[1] === letter) {
        return finishJump(cand);
      }
    }
    return false;
  }

  function finishJump(cand) {
    if (!cand || !jump.editor) return true;
    var editor = jump.editor;
    if (jump.select) {
      // 选区模式：从当前光标延伸选区到目标
      try { editor.selection.selectTo(cand.row, cand.col); } catch (e) { editor.navigateTo(cand.row, cand.col); }
    } else {
      editor.navigateTo(cand.row, cand.col);
    }
    editor.focus();
    stop();
    return true;
  }

  // ── 激活 / 取消 ──
  function start(editor, opts) {
    stop();
    if (!editor || !editor.container || !editor.renderer) return;
    opts = opts || {};
    jump.editor = editor;
    jump.mode = opts.mode || 'word';
    jump.select = !!opts.select;

    var base = collectCandidates(editor, jump.mode);
    if (typeof global.__debugShortcutLog === 'function') {
      global.__debugShortcutLog('AceJump start()', 'mode=' + jump.mode, '候选数=' + base.length,
        '文档行数=' + editor.session.getLength(),
        '容器尺寸=' + (editor.container.clientWidth) + 'x' + (editor.container.clientHeight));
    }
    if (base.length === 0) {
      jump.editor = null;
      if (typeof opts.onEmpty === 'function') opts.onEmpty();
      return;
    }
    jump.baseCandidates = base;
    jump.codes = assignJumpCodes(base.length);
    jump.overlay = buildOverlay(editor);
    renderStage0();
    jump.active = true;

    // 键盘捕获（捕获阶段，避免被编辑器/其它监听吞掉）
    jump.keydownHandler = function (e) {
      if (!jump.active) return;
      if (e.isComposing || e.keyCode === 229) return; // IME 输入中不拦截
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); return; }
      if (e.key === 'Backspace' && jump.stage === 1) { e.preventDefault(); e.stopPropagation(); renderStage0(); return; }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        var ok = resolveAndJump(e.key.toLowerCase());
        if (!ok && jump.active) { stop(); } // 无效键：退出（与 AceJump 行为一致）
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        // 组合键（如触发键 Ctrl+;）交给上层，不在此消费
      } else {
        e.preventDefault();
        e.stopPropagation();
        stop(); // 其它普通键：取消跳跃
      }
    };
    document.addEventListener('keydown', jump.keydownHandler, true);

    // 滚动/窗口变化/点击 → 取消（坐标失效或用户主动放弃）
    jump.wheelHandler = function () { stop(); };
    editor.container.addEventListener('wheel', jump.wheelHandler, true);
    jump.resizeHandler = function () { stop(); };
    window.addEventListener('resize', jump.resizeHandler);
    jump.mousedownHandler = function (e) {
      if (jump.overlay && e.target === jump.overlay) return;
      stop();
    };
    document.addEventListener('mousedown', jump.mousedownHandler, true);
  }

  function stop() {
    jump.active = false;
    if (jump.overlay && jump.overlay.parentNode) {
      jump.overlay.parentNode.removeChild(jump.overlay);
    }
    if (jump.keydownHandler) {
      document.removeEventListener('keydown', jump.keydownHandler, true);
    }
    if (jump.wheelHandler && jump.editor && jump.editor.container) {
      jump.editor.container.removeEventListener('wheel', jump.wheelHandler, true);
    }
    if (jump.resizeHandler) {
      window.removeEventListener('resize', jump.resizeHandler);
    }
    if (jump.mousedownHandler) {
      document.removeEventListener('mousedown', jump.mousedownHandler, true);
    }
    jump.editor = null;
    jump.overlay = null;
    jump.candidates = [];
    jump.baseCandidates = [];
    jump.codes = [];
    jump.stage = 0;
    jump.keydownHandler = null;
    jump.wheelHandler = null;
    jump.resizeHandler = null;
    jump.mousedownHandler = null;
    jump.cleanupFns = [];
  }

  /** 切换跳跃模式；已在激活状态时调用则取消（再按触发键退出） */
  function toggle(editor, opts) {
    if (jump.active && jump.editor === editor) {
      stop();
      return;
    }
    start(editor, opts);
  }

  function isActive() { return jump.active; }

  global.EditorAceJump = {
    toggle: toggle,
    start: start,
    stop: stop,
    isActive: isActive,
    // 供单元测试
    _collectCandidates: collectCandidates,
    _candidateColsForLine: candidateColsForLine,
    _assignJumpCodes: assignJumpCodes,
    _WORD_CHAR: WORD_CHAR
  };
})(typeof window !== 'undefined' ? window : globalThis);
