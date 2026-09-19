/**
 * canvas-outline-md.test.js - 行内 Markdown 纯函数模块 + OPML 纯函数 的 node:test 单测
 * 运行：node --test frontend/js/canvas-outline-md.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const Md = require(path.join(__dirname, 'canvas-outline-md.js'));
const AI = require(path.join(__dirname, 'canvas-ai-outline.js'));
const Outline = require(path.join(__dirname, 'canvas-outline.js'));

// ===================================================================
// 伪 DOM shim：仅满足 htmlToMarkdown 依赖的最小接口
//   nodeType 3 = 文本；nodeType 1 = 元素（tagName/attrs/children）
//   firstChild / nextSibling 链 + classList / getAttribute / querySelector(All) / contains
// ===================================================================

function matchSel(node, sel) {
  const selectors = String(sel).split(',').map(s => s.trim());
  const tag = (node.tagName || '').toUpperCase();
  return selectors.some(s => {
    if (s === 'span') return tag === 'SPAN';
    if (s === 'strong') return tag === 'STRONG';
    if (s === 'b') return tag === 'B';
    if (s === 'a') return tag === 'A';
    return false;
  });
}

function qsa(node, sel) {
  let out = [];
  if (matchSel(node, sel)) out.push(node);
  (node.childNodes || []).forEach(c => { out = out.concat(qsa(c, sel)); });
  return out;
}

function collectText(node, acc) {
  if (node.nodeType === 3) acc.push(node.nodeValue);
  (node.childNodes || []).forEach(c => collectText(c, acc));
  return acc;
}

/** 创建元素节点；attrs 如 { class: 'ol-hl' }。children 为子节点数组（文本用 txt()）。 */
function el(tagName, attrs, children) {
  const kids = children || [];
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    nodeName: String(tagName).toUpperCase(),
    childNodes: kids,
    className: (attrs && attrs.class) || '',
    getAttribute(name) {
      return attrs && attrs[name] != null ? String(attrs[name]) : null;
    },
    querySelectorAll(sel) { return qsa(node, sel); },
    querySelector(sel) { const arr = qsa(node, sel); return arr.length ? arr[0] : null; },
    contains(n) {
      if (n === node) return true;
      return kids.some(k => k.contains(n));
    }
  };
  node.classList = {
    contains(c) { return (' ' + node.className + ' ').indexOf(' ' + c + ' ') !== -1; }
  };
  node.textContent = collectText(node, []).join('');
  node.firstChild = kids.length ? kids[0] : null;
  kids.forEach((k, i) => {
    k.nextSibling = i + 1 < kids.length ? kids[i + 1] : null;
    k.parentNode = node;
  });
  return node;
}

function txt(value) {
  return { nodeType: 3, nodeValue: String(value), firstChild: null, nextSibling: null, childNodes: [] };
}

// ===================================================================
// mdToHtml
// ===================================================================

test('mdToHtml: 加粗 / 高亮 / 链接 / 混合', () => {
  assert.strictEqual(Md.mdToHtml('**粗**'), '<strong>粗</strong>');
  assert.strictEqual(Md.mdToHtml('==亮=='), '<span class="ol-hl">亮</span>');
  assert.strictEqual(
    Md.mdToHtml('[文档](https://a.b/c)'),
    '<a class="ol-link" href="https://a.b/c">文档</a>'
  );
  assert.strictEqual(
    Md.mdToHtml('前**中**后==亮==尾[链](http://x.y/z)'),
    '前<strong>中</strong>后<span class="ol-hl">亮</span>尾<a class="ol-link" href="http://x.y/z">链</a>'
  );
});

test('mdToHtml: HTML 转义（注入免疫）', () => {
  assert.strictEqual(Md.mdToHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(Md.mdToHtml('a & b "q" \'s\''), 'a &amp; b &quot;q&quot; &#39;s&#39;');
  assert.strictEqual(Md.mdToHtml('**a<b>c**'), '<strong>a&lt;b&gt;c</strong>');
});

test('mdToHtml: 孤立的 ** / == 按字面量', () => {
  assert.strictEqual(Md.mdToHtml('a ** b'), 'a ** b');
  assert.strictEqual(Md.mdToHtml('a**b'), 'a**b');
  assert.strictEqual(Md.mdToHtml('a==b'), 'a==b');
  assert.strictEqual(Md.mdToHtml('**x*'), '**x*');
});

test('mdToHtml: href 白名单（非法协议不包链接，原样转义）', () => {
  assert.strictEqual(Md.mdToHtml('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.strictEqual(Md.mdToHtml('[x](data:text/html,x)'), '[x](data:text/html,x)');
  assert.strictEqual(Md.mdToHtml('[x](https://ok.com)'), '<a class="ol-link" href="https://ok.com">x</a>');
  assert.strictEqual(Md.mdToHtml('[x](#锚)'), '<a class="ol-link" href="#锚">x</a>');
  assert.strictEqual(Md.mdToHtml('[x](../rel.md)'), '<a class="ol-link" href="../rel.md">x</a>');
  // 链接缺 url 段（空括号）不包
  assert.strictEqual(Md.mdToHtml('[x]()'), '[x]()');
});

// ===================================================================
// parseInline（与 mdToHtml 同一 tokenizer，形状一致）
// ===================================================================

test('parseInline: 符文形状（bold/hl/link/plain）', () => {
  const toks = Md.parseInline('**粗**平==亮==[链](https://a.b/c)尾');
  assert.deepStrictEqual(toks, [
    { text: '粗', bold: true },
    { text: '平' },
    { text: '亮', hl: true },
    { text: '链', link: 'https://a.b/c' },
    { text: '尾' }
  ]);
});

test('parseInline: 空标记按字面量，不产生空符文', () => {
  assert.strictEqual(Md.mdToHtml('a **** b'), 'a **** b'); // **** 中间无内容 → 字面
  assert.strictEqual(Md.mdToHtml('a ==== b'), 'a ==== b');
  const parts = Md.parseInline('a **** b');
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].text, 'a **** b');
  assert.strictEqual(typeof parts[0].bold, 'undefined');
});

// ===================================================================
// htmlToMarkdown（伪 DOM shim）
// ===================================================================

test('htmlToMarkdown: 快路径——无样式节点原文返回（一字不变）', () => {
  const root = el('div', {}, [txt('纯文本 一行')]);
  assert.strictEqual(Md.htmlToMarkdown(root), '纯文本 一行');
});

test('htmlToMarkdown: 往返不丢（mdToHtml → htmlToMarkdown 还原）', () => {
  const src = '**加粗**和==高亮==与[链接](https://a.b/c)及纯文本';
  const html = Md.mdToHtml(src);
  const root = el('div', {}, [
    txt(''), // 开局空文本不干扰
    ...Array.from(html.matchAll(/<strong>(.*?)<\/strong>|<span class="ol-hl">(.*?)<\/span>|<a class="ol-link" href="([^"]*)">(.*?)<\/a>|([^<]*)/g)).map(m => {
      if (m[1] != null) return el('strong', {}, [txt(m[1])]);
      if (m[2] != null) return el('span', { class: 'ol-hl' }, [txt(m[2])]);
      if (m[3] != null) return el('a', { href: m[3] }, [txt(m[4])]);
      return m[5] ? txt(m[5]) : txt('');
    })
  ]);
  assert.strictEqual(Md.htmlToMarkdown(root), '**加粗**和==高亮==与[链接](https://a.b/c)及纯文本');
});

test('htmlToMarkdown: strong 嵌套 / span.ol-hl / a 还原边界', () => {
  const root = el('div', {}, [
    el('strong', {}, [txt('a'), txt('b')]),
    txt('|'),
    el('span', { class: 'ol-hl' }, [txt('h')]),
    txt('|'),
    el('a', { href: 'https://x.y' }, [txt('link')])
  ]);
  assert.strictEqual(Md.htmlToMarkdown(root), '**ab**|==h==|[link](https://x.y)');
});

test('htmlToMarkdown: 非法标签/属性剥离为纯文本', () => {
  const root = el('div', {}, [
    el('b', {}, [txt('粗')]),
    el('i', {}, [txt('斜')]),                 // <i> 不在白名单 → 剥离
    el('span', { class: 'foo' }, [txt('普通')]) // 非 ol-hl span → 剥离
  ]);
  assert.strictEqual(Md.htmlToMarkdown(root), '**粗**斜普通');
});

test('htmlToMarkdown: 非法 href 链接剥为纯文本', () => {
  const root = el('div', {}, [el('a', { href: 'javascript:bad()' }, [txt('文本')])]);
  assert.strictEqual(Md.htmlToMarkdown(root), '文本');
});

test('htmlToMarkdown: 链接内文含 [ ] 退化为纯文本（保真优先）', () => {
  const root = el('div', {}, [el('a', { href: 'https://x.y' }, [txt('文[字]')])]);
  assert.strictEqual(Md.htmlToMarkdown(root), '文[字]');
});

// ===================================================================
// opmlDocToMarkdown（伪 doc）
// ===================================================================

function opmlDoc(bodyChildren) {
  const body = el('body', {}, bodyChildren);
  return {
    getElementsByTagName(name) {
      if (name === 'body') return [body];
      return [];
    }
  };
}

function outline(attrs, children) {
  return el('outline', attrs, children || []);
}

test('opmlDocToMarkdown: 嵌套层级', () => {
  const doc = opmlDoc([
    outline({ text: '读书笔记' }, [
      outline({ text: '第一章' }, [outline({ text: '内容要点' })]),
      outline({ text: '第二章' })
    ])
  ]);
  assert.strictEqual(
    AI.opmlDocToMarkdown(doc),
    '- 读书笔记\n  - 第一章\n    - 内容要点\n  - 第二章'
  );
});

test('opmlDocToMarkdown: _note 作为该节点子节点追加（7.9）', () => {
  const doc = opmlDoc([
    outline({ text: '会议', _note: '记得带上例会材料' }, [outline({ text: '议题' })])
  ]);
  assert.strictEqual(
    AI.opmlDocToMarkdown(doc),
    '- 会议\n  - 记得带上例会材料\n  - 议题'
  );
});

test('opmlDocToMarkdown: 无 text 的 outline 行忽略（子级仍递归）', () => {
  const doc = opmlDoc([
    outline({ text: '根' }),
    outline({}, [outline({ text: '孤儿子' })])
  ]);
  assert.strictEqual(AI.opmlDocToMarkdown(doc), '- 根\n  - 孤儿子');
});

test('opmlDocToMarkdown: 空 doc 返回空串', () => {
  assert.strictEqual(AI.opmlDocToMarkdown(null), '');
  assert.strictEqual(AI.opmlDocToMarkdown(opmlDoc([])), '');
});

// ===================================================================
// opmlSerialize（F1 导出 OPML）：嵌套 / 转义 / 空节点 / 往返
// ===================================================================

test('opmlSerialize: 嵌套层级 + XML 转义 + 空节点跳过（子树顶上）', () => {
  const nodes = [
    { id: 'r', text: '根<&"\'', orderIndex: 0 },
    { id: 'a', text: '子1', parentId: 'r', orderIndex: 0 },
    { id: 'empty', text: '   ', parentId: 'r', orderIndex: 1 }, // 空白 text 视为空 → 跳过
    { id: 'grand', text: '孙', parentId: 'empty', orderIndex: 0 },
    { id: 'b', text: '子2', parentId: 'r', orderIndex: 2 }
  ];
  const xml = Outline.opmlSerialize(nodes, '标题&A');
  assert.strictEqual(xml.indexOf('<?xml version="1.0" encoding="UTF-8"?>') === 0, true);
  assert.strictEqual(xml.indexOf('<title>标题&amp;A</title>') !== -1, true);
  assert.strictEqual(xml.indexOf('text="根&lt;&amp;&quot;&apos;"') !== -1, true);
  // 空节点不产生 <outline>，其子「孙」与「子2」同级（同缩进 6 空格）
  const lineOf = txt => xml.split('\n').find(l => l.indexOf('text="' + txt + '"') !== -1);
  const indentOf = l => l.length - l.replace(/^[ ]*/, '').length;
  assert.strictEqual(lineOf('孙').indexOf('  <outline') === 0, false); // 孙非最外层
  assert.strictEqual(indentOf(lineOf('孙')), indentOf(lineOf('子2')));
  assert.strictEqual(xml.indexOf('text=""') === -1, true); // 无空 text outline
});

test('opmlSerialize → parseMarkdownOutline 往返还原（幕布导入链路同构）', () => {
  const nodes = [
    { id: 'r', text: '读书笔记', orderIndex: 0 },
    { id: 'a', text: '第一章', parentId: 'r', orderIndex: 0 },
    { id: 'a1', text: '内容要点', parentId: 'a', orderIndex: 0 },
    { id: 'b', text: '第二章', parentId: 'r', orderIndex: 1 }
  ];
  const xml = Outline.opmlSerialize(nodes, '笔记');
  const unescape = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const md = xml.split('\n')
    .filter(l => l.indexOf('<outline text=') !== -1)
    .map(l => {
      const m = /<outline text="([^"]*)">/.exec(l);
      const depth = Math.max(0, (l.length - l.replace(/^[ ]*/, '').length) / 2 - 2); // body 内 4 空格起始
      return new Array(depth + 1).join('  ') + '- ' + unescape(m[1]);
    })
    .join('\n');
  const tree = AI.parseMarkdownOutline(md);
  assert.deepStrictEqual(tree, [
    { text: '读书笔记', children: [
        { text: '第一章', children: [{ text: '内容要点', children: [] }] },
        { text: '第二章', children: [] }
      ] }
  ]);
});

// ===================================================================
// 导出面
// ===================================================================

test('UMD 导出形状', () => {
  for (const fn of ['mdToHtml', 'htmlToMarkdown', 'parseInline', 'tokenize', 'isSafeHref']) {
    assert.strictEqual(typeof Md[fn], 'function', `canvas-outline-md 应导出 ${fn}`);
  }
  for (const fn of ['open', 'openImport', 'close', 'parseMarkdownOutline', 'opmlDocToMarkdown']) {
    assert.strictEqual(typeof AI[fn], 'function', `canvas-ai-outline 应导出 ${fn}`);
  }
  for (const fn of ['toOPML', 'downloadOPML', 'opmlSerialize', 'toMarkdown']) {
    assert.strictEqual(typeof Outline[fn], 'function', `canvas-outline 应导出 ${fn}`);
  }
});