/**
 * canvas-outline-md.js - 大纲/画布共用的「行内 Markdown ↔ HTML/符文」纯函数模块
 *
 * 数据契约：节点文本始终是**纯文本 markdown 行内标记**（`**加粗**`、`==高亮==`、`[文字](url)`）；
 * 大纲 contenteditable 与画布 SVG 卡片只是「渲染层」。本模块负责三者的互转，
 * 不触碰 DOM 之外的任何状态，方便浏览器（window.CanvasInlineMd）与 node 单测（module.exports）双用。
 *
 * 设计要点：
 *  - 单一 tokenizer：mdToHtml / parseInline 共用，保证 HTML 与符文形状永远一致；
 *  - 先 tokenize 原始文本、再对片段转义 → 天然免疫 `& < > "` 注入，且无需反转义；
 *  - 孤立的 `**` / `==` / 非法链接一律按字面量输出，绝不产生破坏性的半成品标记；
 *  - href 走白名单（http(s)://、# 锚、相对路径），其余视为纯文本；
 *  - htmlToMarkdown 仅认 STRONG/B、SPAN.ol-hl、A（href 白名单），其余标签剥离为纯文本；
 *    快路径：片段内没有任何样式标记时直接返回 textContent，保证「没加样式时文本一字不变」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanvasInlineMd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 工具 ----------

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * href 白名单：仅允许 http(s)://、# 锚、相对路径（/、./、../、纯相对），
   * 显式排除 javascript: / data: / vbscript: 等危险协议。
   */
  function isSafeHref(href) {
    var h = String(href == null ? '' : href).trim().replace(/\s+/g, '');
    if (!h) return false;
    if (h.indexOf('http://') === 0 || h.indexOf('https://') === 0) return true;
    if (h.indexOf('#') === 0) return true;
    if (h.indexOf('/') === 0 || h.indexOf('./') === 0 || h.indexOf('../') === 0) return true;
    var scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(h);
    if (scheme) return scheme[0].toLowerCase() === 'http:' || scheme[0].toLowerCase() === 'https:';
    return true; // 纯相对路径
  }

  // ---------- 单一 tokenizer：`**bold**` / `==hl==` / `[text](url)` ----------

  /**
   * 把行内 markdown 拆成符文数组：[{kind:'text'|'bold'|'hl'|'link', text, url}]。
   * 从左到右贪心：链接优先（`[` 开头），其次 `**`、`==`；
   * 找不到闭合标记的孤立 `**`/`==` 按字面量累积；链接文本不做二次嵌套解析（简单可靠）。
   */
  function tokenize(text) {
    var toks = [];
    var buf = '';
    var i = 0;
    var len = text.length;
    function flush() {
      if (buf) { toks.push({ kind: 'text', text: buf }); buf = ''; }
    }
    while (i < len) {
      var c = text.charAt(i);
      if (c === '[') {
        var closeB = text.indexOf(']', i + 1);
        if (closeB > i + 1 && text.charAt(closeB + 1) === '(') {
          var closeP = text.indexOf(')', closeB + 2);
          if (closeP > closeB + 2) {
            var inner = text.slice(i + 1, closeB);
            var url = String(text.slice(closeB + 2, closeP)).trim();
            if (inner && isSafeHref(url)) {
              flush();
              toks.push({ kind: 'link', text: inner, url: url });
              i = closeP + 1;
              continue;
            }
          }
        }
        buf += c; i++;
        continue;
      }
      if (c === '*' && text.charAt(i + 1) === '*') {
        var bClose = text.indexOf('**', i + 2);
        if (bClose > i + 2) {
          flush();
          toks.push({ kind: 'bold', text: text.slice(i + 2, bClose) });
          i = bClose + 2;
          continue;
        }
        buf += '**'; i += 2;
        continue;
      }
      if (c === '=' && text.charAt(i + 1) === '=') {
        var hClose = text.indexOf('==', i + 2);
        if (hClose > i + 2) {
          flush();
          toks.push({ kind: 'hl', text: text.slice(i + 2, hClose) });
          i = hClose + 2;
          continue;
        }
        buf += '=='; i += 2;
        continue;
      }
      buf += c; i++;
    }
    flush();
    return toks;
  }

  // ---------- markdown → HTML（渲染层：大纲行 innerHTML 用） ----------

  function mdToHtml(text) {
    var toks = tokenize(text == null ? '' : String(text));
    var out = '';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.kind === 'bold') out += '<strong>' + escapeHtml(t.text) + '</strong>';
      else if (t.kind === 'hl') out += '<span class="ol-hl">' + escapeHtml(t.text) + '</span>';
      else if (t.kind === 'link') out += '<a class="ol-link" href="' + escapeHtml(t.url) + '">' + escapeHtml(t.text) + '</a>';
      else out += escapeHtml(t.text);
    }
    return out;
  }

  // ---------- markdown → 符文数组（画布 SVG 卡片分段渲染用） ----------

  function parseInline(text) {
    var toks = tokenize(text == null ? '' : String(text));
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.kind === 'bold') out.push({ text: t.text, bold: true });
      else if (t.kind === 'hl') out.push({ text: t.text, hl: true });
      else if (t.kind === 'link') out.push({ text: t.text, link: t.url });
      else out.push({ text: t.text });
    }
    return out;
  }

  // ---------- HTML → markdown（落库/导出用） ----------

  function hasAnyMarkup(el) {
    if (!el || !el.querySelectorAll) return false;
    if (el.querySelector('strong, b, a')) return true;
    var spans = el.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].classList && spans[i].classList.contains('ol-hl')) return true;
    }
    return false;
  }

  function serialize(node) {
    if (node.nodeType === 3) return node.nodeValue || ''; // TEXT_NODE
    if (node.nodeType !== 1) return ''; // 其余节点类型（注释等）忽略
    var child = node.firstChild;
    var inner = '';
    while (child) {
      inner += serialize(child);
      child = child.nextSibling;
    }
    var tag = node.tagName || '';
    if (tag === 'STRONG' || tag === 'B') {
      return (inner && inner.replace(/^[*=\s]+|[*=\s]+$/g, '') ? '**' + inner + '**' : inner);
    }
    if (tag === 'SPAN' && node.classList && node.classList.contains('ol-hl')) {
      return (inner && inner.replace(/^[*=\s]+|[*=\s]+$/g, '') ? '==' + inner + '==' : inner);
    }
    if (tag === 'A') {
      var href = node.getAttribute && node.getAttribute('href');
      // 链接内文含 [ ] 时包起来会破坏下一次解析，退化为纯文本（保真优先，宁可不包）
      if (href && isSafeHref(href) && inner && !/[\[\]]/u.test(inner)) {
        var clean = inner.replace(/\s+/g, ' ').trim();
        if (clean) return '[' + clean + '](' + href.trim() + ')';
      }
      return inner;
    }
    return inner; // 其余标签一律剥离，仅取文本
  }

  /**
   * elOrFragment 可以是元素、DocumentFragment 或（Node 列表兜底）——统一按「首个子级容器」处理。
   * 快路径：无任何样式标记时直接返回 textContent，保证纯文本行一字不变。
   */
  function htmlToMarkdown(elOrFragment) {
    var el = elOrFragment || null;
    if (!el) return '';
    if (el.nodeType === 3) return el.nodeValue || ''; // 直接文本节点
    if (!hasAnyMarkup(el)) return el.textContent || '';
    var out = '';
    var child = el.firstChild;
    while (child) {
      out += serialize(child);
      child = child.nextSibling;
    }
    return out;
  }

  return {
    mdToHtml: mdToHtml,
    htmlToMarkdown: htmlToMarkdown,
    parseInline: parseInline,
    tokenize: tokenize,
    isSafeHref: isSafeHref
  };
});