'use strict';
/**
 * 灵感橱窗「核心内容快照」脚本（在目标页上下文通过 executeJavaScript 执行）。
 *
 * 做三件事：
 * 1. 定位正文根（article/main/[role=main]/正文 class 提示，否则按文本密度启发式）；
 * 2. 洗涤：移除脚本/广告/导航/评论等噪音节点；
 * 3. 图片内联：正文内有效图片转 base64 写入单文件，控制总量上限。
 *
 * 返回 { title, html, stats:{chars,imgCount,inlineKb,totalKb,skipped}, error? }。
 * 注意：本文件被 main.js require，module.exports 为脚本源码字符串；脚本内禁止使用反引号与 ${}。
 */
module.exports = `
(function () {
  function statsEmpty() {
    return { chars: 0, imgCount: 0, inlineKb: 0, totalKb: 0, skipped: 0 };
  }
  try {
    var doc = document;

    // ── 1. 定位正文根 ──
    function textLen(el) { return (el.innerText || '').trim().length; }
    function score(el) { return textLen(el) + el.querySelectorAll('p').length * 80; }
    var candidates = [];
    var sel;
    for (sel in { article: 1, main: 1 }) {
      var el = doc.querySelector(sel);
      if (el) candidates.push(el);
    }
    var roleMain = doc.querySelector('[role="main"]');
    if (roleMain) candidates.push(roleMain);
    doc.querySelectorAll('[class*="post-content"], [class*="article-content"], [class*="entry-content"], [class*="article-body"], [class*="post-body"], [class*="entry-text"], [class*="post-text"]').forEach(function (el) { candidates.push(el); });
    if (candidates.length === 0 || candidates.reduce(function (m, el) { return Math.max(m, score(el)); }, 0) < 400) {
      var bestScore = 0, best = null;
      doc.querySelectorAll('body div').forEach(function (el) {
        var s = score(el);
        if (s > 400 && s > bestScore) { bestScore = s; best = el; }
      });
      if (best) candidates.push(best);
    }
    var bestRoot = null, bs = 0;
    candidates.forEach(function (el) {
      if (!el || !el.parentNode) return;
      if (el.querySelector('article')) return; // 避免外层容器重复
      var s = score(el);
      if (s > bs) { bs = s; bestRoot = el; }
    });
    if (!bestRoot) bestRoot = doc.body;
    if (textLen(bestRoot) < 80) {
      return Promise.resolve({ title: doc.title || '', html: null, stats: statsEmpty(), error: '页面未发现可读正文内容' });
    }

    // ── 2. 克隆并洗涤 ──
    var clone = bestRoot.cloneNode(true);
    var removeSel = 'script, iframe, noscript, template, object, embed, video, audio, canvas, form, button, input, select, textarea, nav, aside, footer, header, .advertisement, .ads, .ad, [class*="ad-"], [class*="ads-"], [id*="ad-"], [aria-hidden="true"], [hidden], [style*="display:none"], [style*="display: none"]';
    var toRemove = [];
    clone.querySelectorAll(removeSel).forEach(function (el) { toRemove.push(el); });
    toRemove.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    // 图片列表在洗涤后收集
    var imgs = [];
    clone.querySelectorAll('img').forEach(function (img) { imgs.push(img); });

    var MAX_INLINE_KB = 3072; // 内联体积上限 3MB
    var MAX_IMGS = 40;        // 图多则跳过转码（保持小快照）
    var tooMany = imgs.length > MAX_IMGS;
    var stats = statsEmpty();
    stats.chars = textLen(clone);

    function loadBlob(url) {
      return fetch(url, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .catch(function () { return null; });
    }

    return Promise.all(imgs.map(function (img) {
      var src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      var abs = null;
      try { abs = new URL(src, location.href).href; } catch (e) { abs = null; }
      if (!abs || /^data:/i.test(abs) || /^blob:/i.test(abs)) { stats.skipped++; return Promise.resolve(); }
      // 占位/小图标跳过
      if (img.naturalWidth && img.naturalHeight && (img.naturalWidth < 48 || img.naturalHeight < 48)) { stats.skipped++; return Promise.resolve(); }
      if (tooMany) { stats.skipped++; return Promise.resolve(); }
      var sameOrigin = false;
      try { sameOrigin = new URL(abs).origin === location.origin; } catch (e) { /* ignore */ }
      function inlineFromImage() {
        return new Promise(function (res) {
          var i = new Image();
          i.crossOrigin = 'anonymous';
          i.onload = function () {
            try {
              var c = document.createElement('canvas');
              c.width = i.naturalWidth; c.height = i.naturalHeight;
              var ctx = c.getContext('2d');
              ctx.drawImage(i, 0, 0);
              var dataUrl = c.toDataURL('image/jpeg', 0.8);
              if (dataUrl && dataUrl.length > 300) {
                img.setAttribute('src', dataUrl);
                img.removeAttribute('srcset'); img.removeAttribute('data-src'); img.removeAttribute('data-lazy-src');
                img.removeAttribute('width'); img.removeAttribute('height');
                stats.imgCount++;
                stats.inlineKb += Math.round(dataUrl.length / 1024);
              } else { stats.skipped++; }
            } catch (e) { stats.skipped++; }
            res();
          };
          i.onerror = function () { stats.skipped++; res(); };
          i.src = abs;
        });
      }
      if (sameOrigin) return inlineFromImage();
      // 跨域：先尝试 fetch → blob → dataURL（无 CORS 时跳过，保留原 src）
      return loadBlob(abs).then(function (blob) {
        if (!blob) { stats.skipped++; return Promise.resolve(); }
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () {
            if (fr.result && typeof fr.result === 'string') {
              img.setAttribute('src', fr.result);
              img.removeAttribute('srcset'); img.removeAttribute('data-src'); img.removeAttribute('data-lazy-src');
              img.removeAttribute('width'); img.removeAttribute('height');
              stats.imgCount++;
              stats.inlineKb += Math.round(fr.result.length / 1024);
            } else { stats.skipped++; }
            res();
          };
          fr.onerror = function () { stats.skipped++; res(); };
          fr.readAsDataURL(blob);
        });
      });
    })).then(function () {
      // 总量控制：超限时删除尚未内联的远程图，避免快照失控
      if (stats.inlineKb > MAX_INLINE_KB) {
        var left = [];
        clone.querySelectorAll('img').forEach(function (img) { left.push(img); });
        left.forEach(function (img) {
          var s = img.getAttribute('src') || '';
          if (!/^data:/i.test(s)) { if (img.parentNode) img.parentNode.removeChild(img); stats.skipped++; }
        });
      }

      // ── 3. 生成自包含正文快照 HTML ──
      var title = doc.title || '';
      var styleText = 'html{color-scheme:light}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.8;color:#333;max-width:760px;margin:0 auto;padding:24px 18px 48px;font-size:15px;-webkit-text-size-adjust:100%}img{max-width:100%;height:auto;border-radius:6px}h1,h2,h3,h4{line-height:1.4}h1{font-size:1.5em}h2{font-size:1.3em}h3{font-size:1.15em}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}blockquote{border-left:3px solid #d0d7de;margin:0 0 0 0;padding-left:14px;color:#57606a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:6px 10px}figure{margin:16px 0;text-align:center}figcaption{font-size:12px;color:#777;margin-top:6px}a{color:#0969da;word-break:break-all}';
      var escapedTitle = String(title).replace(/[<>&]/g, '');
      var snapshot = '<!DOCTYPE html>\\n<html lang="zh-CN">\\n<head>\\n<meta charset="utf-8">\\n<meta name="viewport" content="width=device-width, initial-scale=1">\\n<title>' + (escapedTitle || '内容快照') + '</title>\\n<style>' + styleText + '</style>\\n</head>\\n<body>\\n<article class="core-snapshot">\\n' + clone.innerHTML + '\\n</article>\\n</body>\\n</html>';
      stats.totalKb = Math.round(snapshot.length / 1024);
      return { title: title, html: snapshot, stats: stats };
    });
  } catch (e) {
    return Promise.resolve({ title: '', html: null, stats: statsEmpty(), error: String((e && e.message) || e) });
  }
})()
`;