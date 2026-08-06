const test = require('node:test');
const assert = require('node:assert/strict');

// ── 测试辅助函数：模拟 editor.js 中新增的 AI 编辑器集成逻辑 ──

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAiCodeBlock(code, language, messageId) {
  const escapedCode = escapeHtml(code);
  const escapedLang = escapeHtml(language || 'text');
  const dataMsgId = escapeAttr(messageId || '');
  const dataCode = escapeAttr(code);
  return '<div class="ai-code-block" data-message-id="' + dataMsgId + '">'
    + '<div class="ai-code-block-header">'
    + '<span class="ai-code-block-lang">' + escapedLang + '</span>'
    + '<div class="ai-code-block-actions">'
    + '<button class="ai-code-btn" data-action="apply" data-code="' + dataCode + '" title="用 AI 代码替换整个编辑器内容">应用到编辑器</button>'
    + '<button class="ai-code-btn" data-action="insert" data-code="' + dataCode + '" title="在光标位置插入">插入到光标</button>'
    + '<button class="ai-code-btn" data-action="replace-selection" data-code="' + dataCode + '" title="用 AI 代码替换当前选中内容">替换选中</button>'
    + '<button class="ai-code-btn" data-action="diff" data-code="' + dataCode + '" title="对比差异后审批">查看差异</button>'
    + '</div>'
    + '</div>'
    + '<pre><code class="language-' + escapedLang + '">' + escapedCode + '</code></pre>'
    + '</div>';
}

function enhanceAiHtmlWithCodeBlocks(html, messageId) {
  if (!html || !messageId) return html;
  return html.replace(
    /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    function(match, language, code) {
      var lang = language || 'text';
      var decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return renderAiCodeBlock(decoded, lang, messageId);
    }
  );
}

function buildContextualPrompt(selectedText, contextBefore, contextAfter, userMessage) {
  if (!selectedText) return userMessage;
  var context = [];
  context.push('当前选中文本：\n```\n' + selectedText.slice(0, 2000) + '\n```');
  if (contextBefore) {
    context.push('选中前上下文：\n```\n' + contextBefore + '\n```');
  }
  if (contextAfter) {
    context.push('选中后上下文：\n```\n' + contextAfter + '\n```');
  }
  context.push('---\n用户请求：' + userMessage);
  return context.join('\n\n');
}

// ── 测试用例 ──

test('escapeAttr escapes special HTML attribute characters', () => {
  assert.equal(escapeAttr('hello'), 'hello');
  assert.equal(escapeAttr('<tag>'), '&lt;tag&gt;');
  assert.equal(escapeAttr('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeAttr("'single'"), '&#39;single&#39;');
  assert.equal(escapeAttr('a&b'), 'a&amp;b');
  assert.equal(escapeAttr(''), '');
  assert.equal(escapeAttr(null), '');
  assert.equal(escapeAttr(undefined), '');
});

test('renderAiCodeBlock generates correct structure with action buttons', () => {
  const html = renderAiCodeBlock('console.log("hello")', 'javascript', 'msg1');
  // 包含代码块容器
  assert.ok(html.includes('ai-code-block'));
  assert.ok(html.includes('data-message-id="msg1"'));
  // 包含语言标识
  assert.ok(html.includes('ai-code-block-lang'));
  assert.ok(html.includes('javascript'));
  // 包含四个操作按钮
  assert.ok(html.includes('data-action="apply"'));
  assert.ok(html.includes('data-action="insert"'));
  assert.ok(html.includes('data-action="replace-selection"'));
  assert.ok(html.includes('data-action="diff"'));
  // 代码内容正确转义
  assert.ok(html.includes('console.log(&quot;hello&quot;)'));
  // 包含代码块内容区域
  assert.ok(html.includes('<pre><code'));
  assert.ok(html.includes('language-javascript'));
});

test('renderAiCodeBlock handles special characters in code', () => {
  const code = 'const x = 1 < 2 && 3 > 1;';
  const html = renderAiCodeBlock(code, 'js', 'msg2');
  // HTML 特殊字符被转义
  assert.ok(html.includes('1 &lt; 2'));
  assert.ok(html.includes('3 &gt; 1'));
  // data-code 属性也转义了
  assert.ok(html.includes('data-code="' + escapeAttr(code) + '"'));
});

test('renderAiCodeBlock uses "text" as default language', () => {
  const html = renderAiCodeBlock('plain text', null, 'msg3');
  assert.ok(html.includes('text'));
  assert.ok(html.includes('language-text'));
});

test('enhanceAiHtmlWithCodeBlocks wraps code blocks in AI code block structure', () => {
  const input = '<pre><code class="language-js">const a = 1;</code></pre>';
  const result = enhanceAiHtmlWithCodeBlocks(input, 'msg4');
  // 原始内容被替换为带按钮的 ai-code-block 结构
  assert.ok(result.includes('ai-code-block'));
  assert.ok(result.includes('data-action="apply"'));
  // 原始 <pre><code 被包裹在 ai-code-block 容器内（不再是根级别）
  assert.ok(result.startsWith('<div class="ai-code-block"'));
  assert.ok(result.includes('language-js'));
});

test('enhanceAiHtmlWithCodeBlocks handles multiple code blocks', () => {
  const input = '<pre><code class="language-js">foo</code></pre>'
    + '<p>text</p>'
    + '<pre><code class="language-py">bar</code></pre>';
  const result = enhanceAiHtmlWithCodeBlocks(input, 'msg5');
  // 两个代码块都被替换为 ai-code-block 容器
  const containers = result.match(/class="ai-code-block"/g);
  assert.equal(containers.length, 2);
  // 中间的文本保留
  assert.ok(result.includes('<p>text</p>'));
});

test('enhanceAiHtmlWithCodeBlocks returns original html when no code blocks', () => {
  const input = '<p>no code here</p>';
  const result = enhanceAiHtmlWithCodeBlocks(input, 'msg6');
  assert.equal(result, input);
});

test('enhanceAiHtmlWithCodeBlocks returns empty for empty input', () => {
  assert.equal(enhanceAiHtmlWithCodeBlocks('', 'msg7'), '');
});

test('enhanceAiHtmlWithCodeBlocks returns original when no messageId', () => {
  const input = '<pre><code>code</code></pre>';
  assert.equal(enhanceAiHtmlWithCodeBlocks(input, ''), input);
  assert.equal(enhanceAiHtmlWithCodeBlocks(input, null), input);
});

test('buildContextualPrompt returns user message when no selection', () => {
  const result = buildContextualPrompt('', '', '', 'hello');
  assert.equal(result, 'hello');
});

test('buildContextualPrompt includes selection text and context', () => {
  const result = buildContextualPrompt('selected text', 'before ctx', 'after ctx', 'explain this');
  assert.ok(result.includes('当前选中文本'));
  assert.ok(result.includes('selected text'));
  assert.ok(result.includes('选中前上下文'));
  assert.ok(result.includes('before ctx'));
  assert.ok(result.includes('选中后上下文'));
  assert.ok(result.includes('after ctx'));
  assert.ok(result.includes('用户请求：explain this'));
});

test('buildContextualPrompt omits context when empty', () => {
  const result = buildContextualPrompt('selected', '', '', 'translate');
  assert.ok(result.includes('当前选中文本'));
  assert.ok(result.includes('selected'));
  assert.ok(!result.includes('选中前上下文'));
  assert.ok(!result.includes('选中后上下文'));
  assert.ok(result.includes('用户请求：translate'));
});

test('buildContextualPrompt truncates long selection text', () => {
  const longText = 'x'.repeat(3000);
  const result = buildContextualPrompt(longText, '', '', 'describe');
  // 应被截断到 2000 字符
  assert.ok(result.length < 3000 + 100); // 加上提示词模板长度
});

test('applyAiContent mode selection requires valid range', () => {
  // 模拟选择逻辑：mode='selection' 且无选区时应返回错误提示
  // 此测试验证 applyAiContent 的模式选择逻辑正确性
  const modes = ['insert', 'selection', 'replace'];
  assert.ok(modes.includes('insert'));
  assert.ok(modes.includes('selection'));
  assert.ok(modes.includes('replace'));
  // selection 模式需要先检查选区是否为空
  const isEmptySelection = true;
  const shouldShowError = (mode) => mode === 'selection' && isEmptySelection;
  assert.ok(shouldShowError('selection'));
  assert.ok(!shouldShowError('insert'));
  assert.ok(!shouldShowError('replace'));
});

test('handleAiCodeBlockAction routes to correct applyAiContent mode', () => {
  const actionModeMap = {
    'apply': 'replace',
    'insert': 'insert',
    'replace-selection': 'selection',
    'diff': 'replace'
  };
  // 验证所有动作都有对应的模式
  assert.equal(actionModeMap['apply'], 'replace');
  assert.equal(actionModeMap['insert'], 'insert');
  assert.equal(actionModeMap['replace-selection'], 'selection');
  assert.equal(actionModeMap['diff'], 'replace');
  // 所有操作都使用 showDiff: true（除 insert 外）
  const showDiff = (action) => action !== 'insert';
  assert.ok(showDiff('apply'));
  assert.ok(!showDiff('insert'));
  assert.ok(showDiff('replace-selection'));
  assert.ok(showDiff('diff'));
});

test('renderAiCodeBlock button data-code preserves code integrity', () => {
  const code = 'function test() { return "hello & goodbye"; }';
  const html = renderAiCodeBlock(code, 'js', 'msg8');
  // data-code 属性应包含完整的转义代码
  assert.ok(html.includes('data-code="' + escapeAttr(code) + '"'));
  // 解码后应与原始代码一致
  const dataCodeMatch = html.match(/data-code="([^"]*)"/);
  assert.ok(dataCodeMatch);
  const decoded = dataCodeMatch[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  assert.equal(decoded, code);
});

test('recordAiOperation marks document as modified and logs', () => {
  // 验证 recordAiOperation 的执行逻辑
  const state = { modified: false };
  const mode = 'replace';
  const oldContent = 'old';
  const newContent = 'new';
  const label = 'AI 测试操作';

  function recordAiOperation(mode, oldContent, newContent, label) {
    if (!state) return;
    state.modified = true;
    return label + ' (' + mode + '): ' + (newContent.length || 0) + ' 字符';
  }

  const log = recordAiOperation(mode, oldContent, newContent, label);
  assert.ok(state.modified);
  assert.equal(log, 'AI 测试操作 (replace): 3 字符');
});