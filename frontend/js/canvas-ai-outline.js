/**
 * canvas-ai-outline.js - 画布「智能创建」AI 大纲生成器（对标幕布）
 *
 * 交互链路：主题/示例 → 流式生成 Markdown 大纲（打字机）→ textarea 可编辑
 * + 旁侧只读树预览 → 一键「作为新画布」或「插入当前文档」落库排版。
 *
 * 后端走 /api/ai/outline/stream（薄透传 systemPrompt+userMessage 的 SSE），
 * prompt 约束常量留在本文件，便于迭代不重编译后端。
 */

(function () {
  'use strict';

  /** AI 大纲流式端点（与 canvas.js 的 API_GRAPH 同款取址硬编码） */
  var API_AI_OUTLINE = 'http://127.0.0.1:8081/api/ai/outline/stream';

  /** 示例主题 seeds：点选即用该主题直接生成，零门槛感受效果 */
  var EXAMPLES = [
    { icon: '📖', text: '《三体》读书笔记' },
    { icon: '🚀', text: '一次产品发布复盘' },
    { icon: '🌱', text: '新员工入职 30 天成长计划' }
  ];

  /** 单次生成的最大节点数（与后端 importTree 截断一致） */
  var MAX_TREE_NODES = 60;

  /**
   * 大纲生成 system prompt：约束输出格式，保证前端可稳定解析。
   * 1) 只输出纯缩进式 Markdown 列表（"- " 列表 + 2 空格的子项缩进）
   * 2) 层级不超过 4 层、总条数不超过 60
   * 3) 不做前后说明文字、不用 ``` 代码块围栏、不加粗斜体标记、每行不带编号序号
   * 4) 主题来自用户，写给人类看、具体可落地的中文条目
   */
  var OUTLINE_SYSTEM_PROMPT =
    '你是一个专业的思维导图/大纲生成助手。根据用户给出的主题，生成一棵层级清晰、' +
    '可直接转换为大纲/思维导图的 Markdown 列表。严格遵循以下格式约束：\n' +
    '1. 只输出纯缩进式的 Markdown 列表：根节点以 "- " 开头，子节点以 2 空格缩进加 "- " 开头，逐层累加；\n' +
    '2. 层级最多 4 层，总条数不超过 60 条；\n' +
    '3. 禁止输出任何前后说明文字、结尾总结、代码块围栏（```）、加粗/斜体/行内代码标记；每条内容为一个根或子节点文本，直接以 "- " 或缩进 "- " 开头；\n' +
    '4. 内容写给人类看：具体、可落地、避免空话套话，使用中文。';

  // ---- 内部状态 ----
  var maskEl = null;
  var chipsEl = null;
  var topicInputEl = null;
  var genBtnEl = null;
  var statusEl = null;
  var previewWrapEl = null;
  var taEl = null;
  var treeEl = null;
  var footerEl = null;
  var applyNewBtnEl = null;
  var applyCurrentBtnEl = null;
  var regenBtnEl = null;
  var cancelBtnEl = null;

  var busy = false;
  var aborter = null;        // AbortController（流式取消）
  var lastTopic = '';        // 最近一次生成的主题（重新生成/作为新画布标题用）
  var cb = {};               // 外部回调

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // ---- 弹层 DOM 构建 ----

  function buildDom() {
    maskEl = el('div', 'ai-composer-mask');
    maskEl.id = 'aiComposerMask';
    maskEl.style.display = 'none';

    var panel = el('div', 'ai-composer-panel');

    // 头部
    var head = el('div', 'ai-composer-head');
    head.appendChild(el('span', 'ai-composer-title', '✨ 智能创建大纲'));
    var closeBtn = el('button', 'ai-composer-close', '✕');
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    // 主题区
    var topicRow = el('div', 'ai-composer-topic');
    topicInputEl = el('input', 'ai-composer-topic-input');
    topicInputEl.type = 'text';
    topicInputEl.placeholder = '输入主题，如：读完《置身事内》的感想';
    topicRow.appendChild(topicInputEl);
    genBtnEl = el('button', 'ai-composer-gen-btn', '生成大纲');
    genBtnEl.type = 'button';
    genBtnEl.addEventListener('click', function () { runGenerate(topicInputEl.value); });
    topicRow.appendChild(genBtnEl);
    panel.appendChild(topicRow);

    // 示例 chips
    chipsEl = el('div', 'ai-example-chips');
    for (var i = 0; i < EXAMPLES.length; i++) {
      (function (example) {
        var chip = el('button', 'ai-example-chip', escapeHtml(example.icon + ' ' + example.text));
        chip.type = 'button';
        chip.title = '用「' + example.text + '」直接生成大纲';
        chip.addEventListener('click', function () {
          topicInputEl.value = example.text;
          runGenerate(example.text);
        });
        chipsEl.appendChild(chip);
      })(EXAMPLES[i]);
    }
    panel.appendChild(chipsEl);

    // 状态行（加载/错误提示）
    statusEl = el('div', 'ai-composer-status');
    statusEl.style.display = 'none';
    panel.appendChild(statusEl);

    // 生成结果区：左边 textarea 编辑 Markdown，右边只读树预览
    previewWrapEl = el('div', 'ai-composer-preview');
    previewWrapEl.style.display = 'none';
    var taWrap = el('div', 'ai-composer-preview-col');
    taWrap.appendChild(el('div', 'ai-composer-preview-label', 'Markdown 编辑（改字 / 用缩进控制层级）'));
    taEl = el('textarea', 'ai-composer-textarea');
    taEl.spellcheck = false;
    taEl.addEventListener('input', renderTreePreview);
    taEl.addEventListener('keydown', function (e) {
      // Tab 在 textarea 里插入 2 空格缩进，避免焦点跳出
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = taEl.selectionStart, t = taEl.selectionEnd;
        taEl.value = taEl.value.slice(0, s) + '  ' + taEl.value.slice(t);
        taEl.selectionStart = taEl.selectionEnd = s + 2;
        renderTreePreview();
      }
    });
    taWrap.appendChild(taEl);
    var rightCol = el('div', 'ai-composer-preview-col');
    rightCol.appendChild(el('div', 'ai-composer-preview-label', '大纲效果预览（只读）'));
    treeEl = el('div', 'ai-composer-tree');
    rightCol.appendChild(treeEl);
    previewWrapEl.appendChild(taWrap);
    previewWrapEl.appendChild(rightCol);
    panel.appendChild(previewWrapEl);

    // footer 动作
    footerEl = el('div', 'ai-composer-footer');
    applyNewBtnEl = el('button', 'modal-btn ok', '✨ 作为新画布');
    applyNewBtnEl.type = 'button';
    applyNewBtnEl.addEventListener('click', function () { applyTree('new'); });
    footerEl.appendChild(applyNewBtnEl);

    applyCurrentBtnEl = el('button', 'modal-btn', '插入当前文档');
    applyCurrentBtnEl.type = 'button';
    applyCurrentBtnEl.addEventListener('click', function () { applyTree('current'); });
    footerEl.appendChild(applyCurrentBtnEl);

    regenBtnEl = el('button', 'modal-btn', '重新生成');
    regenBtnEl.type = 'button';
    regenBtnEl.addEventListener('click', function () { runGenerate(lastTopic || topicInputEl.value); });
    footerEl.appendChild(regenBtnEl);

    cancelBtnEl = el('button', 'modal-btn', '取消');
    cancelBtnEl.type = 'button';
    cancelBtnEl.addEventListener('click', function () {
      if (busy) abortGenerate(); else close();
    });
    footerEl.appendChild(cancelBtnEl);
    panel.appendChild(footerEl);

    // 点击遮罩空白处关闭（忙碌时阻止，避免误关正在生成）
    maskEl.addEventListener('click', function (e) {
      if (e.target === maskEl && !busy) close();
    });

    maskEl.appendChild(panel);
    (document.body || document.documentElement).appendChild(maskEl);
  }

  function ensureDom() {
    if (maskEl) return;
    buildDom();
  }

  // ---- 状态切换 ----

  function setStatus(kind, text) {
    if (!statusEl) return;
    statusEl.style.display = text ? 'flex' : 'none';
    statusEl.className = 'ai-composer-status' + (kind ? ' is-' + kind : '');
    statusEl.textContent = text || '';
  }

  function setGensState(generating) {
    busy = generating;
    if (genBtnEl) genBtnEl.disabled = generating;
    if (regenBtnEl) regenBtnEl.disabled = generating;
    if (applyNewBtnEl) applyNewBtnEl.disabled = generating;
    if (applyCurrentBtnEl) applyCurrentBtnEl.disabled = generating;
  }

  function showPreview() {
    if (!previewWrapEl) return;
    previewWrapEl.style.display = 'flex';
    previewWrapEl.classList.add('is-visible');
  }

  // ---- Markdown 大纲解析 ----

  /**
   * 把缩进式 Markdown 列表解析为树：[{ text, children: [] }]。
   * 兼容 Tab / 2~4 空格缩进；剥离 "- " "* " "+ " 以及 "1. " 编号前缀；
   * 跳过空行与 ``` 围栏；无标记的普通行视为根级文本节点；
   * 超出 MAX_TREE_NODES 截断。
   */
  function parseMarkdownOutline(md) {
    var lines = String(md || '').split(/\r?\n/);
    var roots = [];
    var stack = [];
    var count = 0;

    function pushNode(level, text) {
      if (count >= MAX_TREE_NODES) return;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      var node = { text: text, children: [] };
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ node: node, level: level });
      count++;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim() || /^```/.test(line.trim())) continue;
      var indentMatch = line.match(/^[\t ]*/);
      var indentStr = indentMatch ? indentMatch[0] : '';
      var indent = 0;
      for (var j = 0; j < indentStr.length; j++) {
        indent += indentStr.charAt(j) === '\t' ? 4 : 1;
      }
      var content = line.slice(indentStr.length).trim();
      content = content.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
      if (!content) continue;
      var level = Math.round(indent / 2);
      if (level > 4) level = 4;
      pushNode(level, content);
    }
    return roots;
  }

  // ---- 树预览（只读） ----

  function renderTreePreview() {
    if (!treeEl || !taEl) return;
    var tree = parseMarkdownOutline(taEl.value);
    treeEl.innerHTML = '';
    if (!tree.length) {
      treeEl.appendChild(el('div', 'ai-composer-tree-empty', '暂无大纲内容，输入主题生成或直接手写 Markdown'));
      return;
    }
    var ul = el('ul', 'ai-composer-tree-root');
    treeEl.appendChild(ul);
    var firstRoot = true;
    (function walk(nodes, parentUl) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var li = el('li', 'ai-composer-tree-item' + (firstRoot ? ' is-root' : ''));
        firstRoot = false;
        li.appendChild(el('span', 'ai-composer-tree-text', escapeHtml(node.text)));
        parentUl.appendChild(li);
        if (node.children && node.children.length) {
          var childUl = el('ul', 'ai-composer-tree-child');
          li.appendChild(childUl);
          walk(node.children, childUl);
        }
      }
    })(tree, ul);
  }

  // ---- SSE 流式消费 ----

  function readSseStream(response, onEvent) {
    return new Promise(function (resolve, reject) {
      if (!response.ok || !response.body) {
        reject(new Error('AI 服务返回异常（HTTP ' + response.status + '）'));
        return;
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function processBlock(block) {
        var eventName = 'message';
        var dataLines = [];
        var lines = block.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) return;
        var data;
        try { data = JSON.parse(dataLines.join('\n')); } catch (e) { return; }
        onEvent(eventName, data);
      }

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (buffer.trim()) processBlock(buffer);
            resolve();
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          // 按空行切分完整 SSE 块，末尾不完整块留到下一轮
          var blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop();
          for (var i = 0; i < blocks.length; i++) processBlock(blocks[i]);
          return pump();
        });
      }

      pump().catch(reject);
    });
  }

  // ---- 生成 ----

  function abortGenerate() {
    if (aborter) {
      try { aborter.abort(); } catch (e) { /* 忽略 */ }
    }
    aborter = null;
    setGensState(false);
    setStatus('warn', '已取消本次生成');
  }

  function runGenerate(topic) {
    var t = String(topic == null ? '' : topic).trim();
    if (!t) {
      setStatus('warn', '先输入一个主题，或点上面的示例试试');
      if (topicInputEl) topicInputEl.focus();
      return;
    }
    ensureDom();
    lastTopic = t;
    setGensState(true);
    setStatus('info', '正在构建大纲…');

    if (taEl) taEl.value = '';
    if (treeEl) treeEl.innerHTML = '';
    showPreview();

    aborter = new AbortController();
    var collected = '';

    fetch(API_AI_OUTLINE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ systemPrompt: OUTLINE_SYSTEM_PROMPT, userMessage: t }),
      signal: aborter.signal
    }).then(function (response) {
      return readSseStream(response, function (eventName, data) {
        if (eventName === 'delta' && data && data.content) {
          collected += data.content;
          if (taEl) taEl.value = collected;
          renderTreePreview();
        } else if (eventName === 'error' && data) {
          var code = data.code;
          var msg = data.message || 'AI 服务调用失败';
          if (code === 'NOT_CONFIGURED') {
            msg = '未配置可用的 AI 模型，请先在「设置」中配置并测试模型连接';
          }
          setGensState(false);
          setStatus('error', msg);
        }
      });
    }).then(function () {
      setGensState(false);
      if (!taEl || !taEl.value.trim()) {
        setStatus('warn', '没有生成到内容，换一个主题或重新生成试试');
      } else {
        setStatus('ok', '生成完成，可修改后一键应用');
        renderTreePreview();
      }
    }).catch(function (e) {
      // 用户主动取消不做错误提示
      if (e && e.name === 'AbortError') return;
      setGensState(false);
      setStatus('error', '网络或服务异常：' + (e && e.message ? e.message : String(e)));
    });
  }

  // ---- 应用 ----

  function applyTree(mode) {
    if (busy) return;
    if (!taEl) return;
    var tree = parseMarkdownOutline(taEl.value);
    if (!tree.length) {
      setStatus('warn', '大纲为空，还无法应用');
      return;
    }
    var title = lastTopic || topicInputEl.value;
    try {
      if (mode === 'new' && typeof cb.onApplyAsNewDoc === 'function') {
        cb.onApplyAsNewDoc(tree, String(title || '').trim() || '未命名画布', taEl.value);
      } else if (mode === 'current' && typeof cb.onApplyToCurrent === 'function') {
        cb.onApplyToCurrent(tree);
      }
    } catch (e) {
      setStatus('error', '应用失败：' + (e && e.message ? e.message : String(e)));
      return;
    }
    close();
  }

  // ---- 打开 / 关闭 ----

  function open(opts) {
    ensureDom();
    cb = opts || {};
    maskEl.style.display = 'flex';
    if (statusEl) setStatus('', '');
    if (topicInputEl) {
      topicInputEl.value = '';
      setTimeout(function () { topicInputEl.focus(); }, 30);
    }
    if (taEl) taEl.value = '';
    if (treeEl) treeEl.innerHTML = '';
    if (previewWrapEl) previewWrapEl.style.display = 'none';
    setGensState(false);
  }

  function close() {
    if (busy) abortGenerate();
    if (maskEl) maskEl.style.display = 'none';
    // 转场动画：等待 fade 结束再真正隐藏
  }

  // ---- 对外接口 ----

  window.CanvasAIOutline = {
    open: open,
    close: close,
    parseMarkdownOutline: parseMarkdownOutline,
    OUTLINE_SYSTEM_PROMPT: OUTLINE_SYSTEM_PROMPT
  };
})();