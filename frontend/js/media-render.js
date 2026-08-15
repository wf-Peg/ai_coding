/**
 * 媒体渲染共享 helper（media-render.js）
 *
 * 剪藏图文一体（决策 D-B / D-K）的渲染层工具：
 *  - rewriteImageSrc：将 content 中的相对路径 media/{yyMM}/{uuid}.{ext}
 *    按 API origin 重写为绝对 URL（/api/media/{yyMM}/{file}）
 *  - sanitizeHtml：DOMParser 白名单消毒（防 XSS，不引入依赖）
 *  - renderMarkdown：marked 渲染 → 消毒 → 图片重写（三端统一入口）
 *
 * 依赖：marked（各页面已引入 libs/marked.min.js）
 * 使用：<script src="js/media-render.js"></script>，之后 window.MediaKit.render
 * 扩展端复制到 browser-extension/libs/ 并保持同步（决策 D-L）。
 */
(function (global) {
  'use strict';

  /** 允许的标签白名单（D-K）。
   *  Mermaid 渲染产物为 SVG，故加入 svg 及常用子标签；Mermaid 实际输出在
   *  sanize 之后直接注入 DOM（不经 sanitize），此处白名单主要供普通内容与兜底路径使用。 */
  var ALLOWED_TAGS = new Set([
    'p', 'div', 'strong', 'em', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polygon',
    'polyline', 'text', 'tspan', 'defs', 'marker', 'use', 'foreignObject',
    'style', 'clipPath', 'title', 'desc'
  ]);

  /** 允许的属性白名单（D-K） */
  var ALLOWED_ATTRS = new Set([
    'src', 'href', 'alt', 'title', 'class',
    // SVG 展示属性
    'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r',
    'rx', 'ry', 'width', 'height', 'transform', 'points', 'marker-end',
    'marker-start', 'font-size', 'font-family', 'text-anchor',
    'dominant-baseline', 'clip-path', 'style', 'preserveAspectRatio', 'id'
  ]);

  /** class 前缀白名单 */
  var ALLOWED_CLASS_PREFIXES = ['language-', 'markdown-content', 'media-image', 'callout', 'mermaid'];

  /** 判断相对路径是否指向 media 资源 */
  function isMediaRelative(path) {
    return typeof path === 'string' && /^media\/\d{4}\/[\w.-]+\.\w{1,10}$/.test(path);
  }

  /** 获取 API 根地址：优先页面级 API_ROOT，其次 API_BASE_URL，最后空串（相对路径） */
  function getApiRoot() {
    if (global.API_ROOT) return global.API_ROOT;
    if (global.API_BASE_URL) {
      return String(global.API_BASE_URL).replace(/\/clip\/?$/, '');
    }
    return '';
  }

  /** 相对路径 → 绝对媒体 URL */
  function mediaUrl(rel) {
    if (!rel) return rel;
    if (/^https?:\/\//.test(rel) || rel.indexOf('data:') === 0) return rel;
    if (rel.indexOf('/api/media/') === 0) return rel;
    var apiRoot = getApiRoot();
    return apiRoot + '/' + String(rel).replace(/^\/+/, '');
  }

  /** 重写 HTML 中 src/href 指向 media 相对路径的资源 */
  function rewriteImageSrc(html) {
    if (!html) return html;
    return html.replace(
      /(src|href)=["']([^"']*media\/\d{4}\/[\w.-]+\.\w{1,10})["']/gi,
      function (match, attr, path) {
        return attr + '="' + mediaUrl(path) + '"';
      }
    );
  }

  /** class 是否允许保留 */
  function isAllowedClass(value) {
    if (!value) return true;
    return value.split(/\s+/).every(function (cls) {
      return ALLOWED_CLASS_PREFIXES.some(function (prefix) { return cls.indexOf(prefix) === 0; });
    });
  }

  /** 属性是否允许保留 */
  function isAllowedAttr(node, name, value) {
    if (!ALLOWED_ATTRS.has(name)) return false;
    if (name === 'class') return isAllowedClass(value);
    // 链接/图片仅允许 http(s)、相对路径（杜绝 javascript: 协议）
    if (name === 'href' || name === 'src') {
      var v = String(value).trim().toLowerCase();
      if (v.indexOf('javascript:') === 0 || v.indexOf('vbscript:') === 0 || v.indexOf('data:text/html') === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * DOMParser 白名单消毒。
   * 解析 → 深度遍历删除非法节点/属性 → 序列化。
   */
  function sanitizeHtml(html) {
    if (!html) return '';
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null, false);
      var toRemove = [];
      var node;
      while ((node = walker.nextNode())) {
        // 移除非法标签
        if (!ALLOWED_TAGS.has(node.tagName ? node.tagName.toLowerCase() : '')) {
          toRemove.push(node);
          continue;
        }
        // 移除非法属性
        for (var i = node.attributes.length - 1; i >= 0; i--) {
          var attr = node.attributes[i];
          if (!isAllowedAttr(node, attr.name.toLowerCase(), attr.value)) {
            node.removeAttribute(attr.name);
          }
        }
      }
      toRemove.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      return doc.body.innerHTML;
    } catch (e) {
      // 极端环境兜底：转义为纯文本
      return String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  /**
   * Markdown → 安全 HTML（marked → 消毒 → 图片重写）。
   * 无 marked 时降级为纯文本转义。
   */
  function renderMarkdown(md) {
    if (!md) return '';
    var html;
    if (global.marked && typeof global.marked.parse === 'function') {
      try {
        html = global.marked.parse(md, { renderer: getCalloutRenderer() });
      } catch (e) {
        html = String(md);
      }
    } else {
      html = String(md).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // 加点：Mermaid 代码块在消毒后占位，交由异步 renderMermaid 渲染
    return extractMermaid(rewriteImageSrc(sanitizeHtml(html)));
  }

  // ── Callout 提示块渲染（Obsidian 风格，FP-8）──

  /** Callout 类型 → 标题图标 */
  var CALLOUT_ICONS = {
    note: '💡', quote: '💬', info: 'ℹ️', tip: '✨',
    warning: '⚠️', danger: '🔥', success: '✅'
  };

  /** Callout 类型 → 默认标题（当未手写标题时） */
  var CALLOUT_TITLES = {
    note: 'Note', quote: 'Quote', info: 'Info', tip: 'Tip',
    warning: 'Warning', danger: 'Danger', success: 'Success'
  };

  var calloutRenderer = null;

  /**
   * 借用 marked 的 blockquote 渲染器识别 Obsidian Callout 语法
   * `> [!type] 标题`，转为带颜色的 callout 卡片。优先于普通 blockquote。
   */
  function getCalloutRenderer() {
    if (calloutRenderer || !global.marked || !global.marked.Renderer) return calloutRenderer;
    var r = new global.marked.Renderer();
    var origBlockquote = r.blockquote.bind(r);
    r.blockquote = function (quote) {
      var m = quote.match(/^\s*<p>\[!([a-z]+)\]([^<]*)<\/p>\s*/i);
      if (m) {
        var type = String(m[1]).toLowerCase();
        var titleText = String(m[2]).trim();
        var body = quote
          .replace(/^\s*<p>\[![a-z]+\][^<]*<\/p>\s*/i, '')
          .replace(/<\/p>\s*$/, '</p>');
        var title = titleText || CALLOUT_TITLES[type] || type;
        return '<div class="callout callout-' + type + '">' +
          '<div class="callout-title">' + (CALLOUT_ICONS[type] || '📌') + ' ' + escapeHtml(title) + '</div>' +
          '<div class="callout-body">' + body + '</div>' +
          '</div>';
      }
      return origBlockquote(quote);
    };
    calloutRenderer = r;
    return calloutRenderer;
  }

  // ── Mermaid 流程图渲染（FP-7）──

  var mermaidInited = false;
  var mermaidSeq = 0;

  function ensureMermaidInit() {
    if (mermaidInited || !global.mermaid) return;
    mermaidInited = true;
    try {
      global.mermaid.initialize({ startOnLoad: false, theme: 'default' });
    } catch (e) { /* 忽略初始化失败，走到 render 时兜底 */ }
  }

  /** 把 `<pre><code class="language-mermaid">code</code></pre>` 替换为 `.mermaid` 占位 div */
  function extractMermaid(html) {
    if (!html || !global.mermaid) return html;
    return html.replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi,
      '<div class="mermaid">$1</div>'
    );
  }

  /**
   * 异步渲染容器内所有 `.mermaid` 占位为 SVG 流程图。
   * 在把 renderMarkdown 结果写入 DOM 后调用；失败时保留源码并加 .mermaid-error。
   * @returns {Promise}
   */
  function renderMermaid(container) {
    if (!container || !global.mermaid) return Promise.resolve();
    ensureMermaidInit();
    var els = container.querySelectorAll('.mermaid');
    var promises = [];
    Array.prototype.forEach.call(els, function (el) {
      var code = el.textContent || '';
      if (!code.trim()) { el.classList.add('mermaid-error'); return; }
      var id = 'mmd-' + (++mermaidSeq);
      promises.push(
        global.mermaid.render(id, code).then(function (res) {
          el.innerHTML = res.svg;
          el.classList.add('mermaid-rendered');
        }).catch(function () {
          el.classList.add('mermaid-error');
          el.textContent = code;
        })
      );
    });
    return Promise.all(promises).catch(function () { });
  }

  /** 渲染纯文本（转义 HTML） */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.MediaKit = global.MediaKit || {};
  global.MediaKit.render = {
    getApiRoot: getApiRoot,
    mediaUrl: mediaUrl,
    isMediaRelative: isMediaRelative,
    rewriteImageSrc: rewriteImageSrc,
    sanitizeHtml: sanitizeHtml,
    renderMarkdown: renderMarkdown,
    renderMermaid: renderMermaid,
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
