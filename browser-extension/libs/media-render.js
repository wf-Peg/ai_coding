// 与 frontend/js/media-render.js 保持同步（决策 D-L），修改请两端同步。
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

  /** 允许的标签白名单（D-K） */
  var ALLOWED_TAGS = new Set([
    'p', 'div', 'strong', 'em', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'
  ]);

  /** 允许的属性白名单（D-K） */
  var ALLOWED_ATTRS = new Set(['src', 'href', 'alt', 'title', 'class']);

  /** class 前缀白名单 */
  var ALLOWED_CLASS_PREFIXES = ['language-', 'markdown-content', 'media-image'];

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
        html = global.marked.parse(md);
      } catch (e) {
        html = String(md);
      }
    } else {
      html = String(md).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return rewriteImageSrc(sanitizeHtml(html));
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
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
