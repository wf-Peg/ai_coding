/**
 * editor-pure.js — 编辑器纯逻辑模块（Phase 4-1 拆分第一步）
 * ------------------------------------------------------------
 * 将 editor.js 中不依赖 DOM / ACE 实例 / 编辑器闭包状态的纯函数
 * 抽取到独立模块，供：
 *   1. editor.js 委托调用（前置守卫 + 原实现兜底，行为无差异）；
 *   2. node 单元测试（electron/editor-pure.test.js）；
 *   3. ace-jump.js 复用（AceJump 标签分配算法）。
 *
 * 兼容性约定：
 *   - 浏览器中挂到 window.EditorPure；node 测试中挂到 global。
 *   - 每个函数均带「原实现兜底」，EditorPure 缺失时调用方行为不变。
 */
(function (global) {
  'use strict';

  /** 标签字符集（与 editor.js extractTags 一致）：中英文、数字、下划线、点、连字符 */
  var TAG_CHARS = '[\\w\\u4e00-\\u9fa5.-]';

  /**
   * 构造标签定位正则：用否定前瞻判断标签后是否仍为标签字符，
   * 避免 \b 对中文/标点失效导致误判。
   */
  function tagPattern(tag) {
    return '#(' + String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?!' + TAG_CHARS + ')';
  }

  /**
   * 转义 HTML 特殊字符（与 DOM textContent→innerHTML 序列化结果一致）。
   * 对齐 HTML 片段序列化规则：仅转义 &、非断空格、<、>；
   * 引号在文本节点中不转义（与浏览器 innerHTML 行为一致，保证委托后无差异）。
   * 顺序不可变：& 必须先转，避免二次转义。
   */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/\u00a0/g, '&nbsp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Obsidian 风格前向模糊匹配：query 每个字符须按序出现（可跳格），
   * 前缀/连续/词首命中加分；返回分数，-1 表示不匹配。
   */
  function fuzzyScore(query, str) {
    if (!query) return 0;
    var q = String(query).toLowerCase();
    var s = String(str == null ? '' : str).toLowerCase();
    var qi = 0, score = 0, last = -1, consec = 0;
    for (var i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) {
        var bonus = 4;
        if (last === i - 1) { consec++; bonus = 8 + consec; }
        else { consec = 0; }
        if (i === 0) bonus += 8;
        else if (s[i - 1] === ' ' || s[i - 1] === '-' || s[i - 1] === '_' || s[i - 1] === '.' || s[i - 1] === '/' || s[i - 1] === '\\') bonus += 6;
        score += bonus;
        last = i;
        qi++;
      }
    }
    if (qi < q.length) return -1;
    return score - (s.length - q.length) * 0.5;
  }

  /**
   * AceJump 字母标签分配算法（纯函数，可单测）。
   * ------------------------------------------------------------
   * 输入候选数 count，输出与候选一一对应的标签码数组：
   *   - count <= 26：单字母 a-z；
   *   - count  > 26：两阶段码「组字母 + 组内字母」，先按组定位再按组内字母精确命中。
   * 保证：
   *   1. 每个码唯一；
   *   2. 首字母（组字母）最多 26 种，组内字母最多 26 种；
   *   3. 任意 count >= 0 均合法。
   */
  function assignJumpCodes(count) {
    var letters = 'abcdefghijklmnopqrstuvwxyz';
    var n = Math.max(0, Math.floor(Number(count) || 0));
    var codes = [];
    if (n <= 26) {
      for (var i = 0; i < n; i++) codes.push(letters[i]);
      return codes;
    }
    var bucketSize = Math.ceil(n / 26); // 每组候选数，<=26（当 n<=676）
    for (var j = 0; j < n; j++) {
      var bucket = Math.min(25, Math.floor(j / bucketSize)); // 组字母 0..25
      var idx = j % bucketSize;                              // 组内字母 0..bucketSize-1
      codes.push(letters[bucket] + letters[idx]);
    }
    return codes;
  }

  global.EditorPure = {
    TAG_CHARS: TAG_CHARS,
    tagPattern: tagPattern,
    escapeHtml: escapeHtml,
    fuzzyScore: fuzzyScore,
    assignJumpCodes: assignJumpCodes
  };
})(typeof window !== 'undefined' ? window : globalThis);
