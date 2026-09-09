// 内容脚本 - 在页面上下文中运行
console.log('智能剪藏助手: 内容脚本已加载');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPageData') {
    handleExtraction(false, sendResponse);
    return true;
  }

  if (request.action === 'extractSelectionData') {
    handleExtraction(true, sendResponse);
    return true;
  }
});

async function handleExtraction(selectionOnly, sendResponse) {
  try {
    const result = await extractCapturePayload(selectionOnly);
    sendResponse({ success: true, data: result });
  } catch (error) {
    console.error('提取页面内容失败:', error);
    sendResponse({ success: false, error: error.message || '提取页面内容失败' });
  }
}

async function extractCapturePayload(selectionOnly) {
  const selection = window.getSelection().toString().trim();
  const selectionContext = extractSelectionContext(window.getSelection());
  const pageContent = selectionOnly ? '' : await extractPageContent();
  const primaryContent = selectionOnly ? selection : (pageContent || selection);

  return {
    content: cleanContent(primaryContent),
    selectedText: selection,
    contextBefore: cleanContent(selectionContext.before),
    contextAfter: cleanContent(selectionContext.after),
    sourceUrl: window.location.href,
    title: document.title,
    siteName: extractSiteName(),
    capturedAt: new Date().toISOString()
  };
}

function extractSelectionContext(selection) {
  const context = { before: '', after: '' };
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return context;
  }

  try {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const textNode = container.nodeType === Node.TEXT_NODE ? container : findPrimaryTextNode(container);
    if (!textNode || !textNode.textContent) {
      return context;
    }

    const selected = selection.toString();
    if (!selected) {
      return context;
    }

    const fullText = textNode.textContent;
    const index = fullText.indexOf(selected);
    if (index < 0) {
      return context;
    }

    const windowSize = 120;
    context.before = fullText.slice(Math.max(0, index - windowSize), index);
    context.after = fullText.slice(index + selected.length, index + selected.length + windowSize);
  } catch (error) {
    console.warn('提取选区上下文失败:', error);
  }

  return context;
}

function findPrimaryTextNode(container) {
  if (!container) {
    return null;
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.textContent && node.textContent.trim().length > 0) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  return walker.nextNode();
}

async function extractPageContent() {
  let content = '';

  try {
    const result = await chrome.storage.local.get('contentSelectors');
    let contentSelectors = result.contentSelectors;

    if (!contentSelectors || contentSelectors.length === 0) {
      contentSelectors = [
        'article',
        'main',
        '.content', '.article-content', '.post-content', '.entry-content',
        '#content', '.main-content', '.page-content', '.article-body',
        '.post-body', '.blog-content'
      ];
    }

    for (const selector of contentSelectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        content = el.innerText;
        console.log(`智能剪藏助手: 使用选择器 ${selector} 提取内容`);
        break;
      }
    }

    if (!content) {
      const paragraphs = document.querySelectorAll('p');
      if (paragraphs.length > 5) {
        const texts = Array.from(paragraphs).map(p => p.innerText.trim());
        content = texts.filter(t => t.length > 20).join('\n\n');
        console.log('智能剪藏助手: 使用 p 标签提取内容');
      }
    }

    if (!content) {
      content = document.body.innerText;
      console.log('智能剪藏助手: 使用 body 文本提取内容');
    }
  } catch (error) {
    console.error('读取提取规则失败:', error);
    content = document.body.innerText;
  }

  return content;
}

function extractSiteName() {
  const metaSiteName = document.querySelector('meta[property="og:site_name"]')?.content;
  if (metaSiteName) {
    return metaSiteName.trim();
  }

  return window.location.hostname.replace(/^www\./, '');
}

function cleanContent(content) {
  if (!content) return '';

  return content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

function createFloatingButton() {
  if (document.getElementById('clip-assistant-btn')) {
    return;
  }

  const button = document.createElement('div');
  button.id = 'clip-assistant-btn';
  button.innerHTML = '📝';
  button.title = '剪藏当前页面';
  button.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    z-index: 99999;
    transition: all 0.3s ease;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('click', () => {
    // 视觉反馈动画
    button.style.transform = 'scale(0.92)';
    button.style.opacity = '0.8';
    button.textContent = '⏳';
    chrome.runtime.sendMessage({ action: 'clipCurrentPage' }, (response) => {
      if (response && response.success) {
        button.textContent = '✅';
        button.style.background = 'linear-gradient(135deg, #22c55e, #4ade80)';
      } else {
        button.textContent = '❌';
        button.style.background = 'linear-gradient(135deg, #ef4444, #f87171)';
      }
      setTimeout(() => {
        button.textContent = '📝';
        button.style.background = 'linear-gradient(135deg, #3b82f6, #60a5fa)';
        button.style.transform = 'scale(1)';
        button.style.opacity = '1';
      }, 2000);
    });
    // 即使无回调也恢复
    setTimeout(() => {
      if (button.textContent === '⏳') {
        button.textContent = '📝';
        button.style.transform = 'scale(1)';
        button.style.opacity = '1';
      }
    }, 3000);
  });

  document.body.appendChild(button);
}

chrome.storage.local.get(['enableFloatingButton'], (result) => {
  if (result.enableFloatingButton) {
    createFloatingButton();
  }
});

// ==================== 网页标注（摘录留痕） ====================
// 一次设计、两端共用：插件负责「打标」（高亮 + 想法随剪藏入库），
// 知识模块负责「看标」（二期透视列表）。
(() => {
  const ANN_COLORS = ['yellow', 'green', 'blue', 'purple'];
  const MAX_ANN_TEXT = 5000;
  const MAX_NOTE_LENGTH = 1000;
  /** id -> {text, note, color, persisted}，persisted 为 true 表示已入库/已恢复 */
  const annState = new Map();
  let toolbar = null;
  let activeId = null;

  initAnnotationMode();

  async function initAnnotationMode() {
    const { enableHighlightToolbar } = await chrome.storage.local.get(['enableHighlightToolbar']);
    if (enableHighlightToolbar === false) {
      return;
    }
    restoreAnnotations();
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideToolbar();
      }
    });
    document.addEventListener('scroll', () => {
      if (toolbar && toolbar.style.display !== 'none') {
        hideToolbar();
      }
    }, true);
  }

  // ---------------- 交互入口 ----------------

  function onMouseUp(event) {
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        const text = sel.toString().trim();
        if (!canAnnotate(sel.anchorNode)) {
          return;
        }
        if (text.length > MAX_ANN_TEXT) {
          toast('选中内容超过 5000 字，请分段标注');
          return;
        }
        const id = 'ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        markSelection(sel, 'yellow', id);
        annState.set(id, { text, note: '', color: 'yellow', persisted: false });
        activeId = id;
        showToolbar(rectFromSelection(sel), id);
        return;
      }

      // 点击已高亮片段：pending 的显示工具条编辑，已入库的仅提示
      const hit = event.target.closest ? event.target.closest('.clip-hl') : null;
      if (hit) {
        const id = hit.dataset.clipAnnId;
        const state = annState.get(id);
        if (state && !state.persisted) {
          activeId = id;
          showToolbar(hit.getBoundingClientRect(), id);
        } else {
          toast('这条标注已入库，可在剪藏详情查看');
        }
        return;
      }

      if (!(toolbar && toolbar.contains(event.target))) {
        hideToolbar();
      }
    }, 10);
  }

  function canAnnotate(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return true;
    }
    const blocked = node.parentElement && node.parentElement.closest(
      'input, textarea, select, [contenteditable="true"], video, audio, iframe, svg, pre, code, .clip-hl, .clip-ann-toolbar');
    return !blocked;
  }

  // ---------------- 高亮渲染 ----------------

  function markSelection(sel, color, id) {
    const ranges = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      ranges.push(sel.getRangeAt(i).cloneRange());
    }
    ranges.forEach((range) => wrapRange(range, color, id));
    sel.removeAllRanges();
  }

  function wrapRange(range, color, id) {
    const mark = document.createElement('mark');
    mark.className = 'clip-hl clip-hl-' + color;
    mark.dataset.clipAnnId = id;
    mark.title = '点击编辑这条标注';
    try {
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    } catch (err) {
      try {
        range.surroundContents(mark);
      } catch (err2) {
        console.warn('智能剪藏助手: 该片段无法标注', err2);
      }
    }
  }

  function unwrapMark(id) {
    document.querySelectorAll(`mark.clip-hl[data-clip-ann-id="${id}"]`).forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    });
  }

  function recolorMark(id, color) {
    document.querySelectorAll(`mark.clip-hl[data-clip-ann-id="${id}"]`).forEach((mark) => {
      ANN_COLORS.forEach((c) => mark.classList.remove('clip-hl-' + c));
      mark.classList.add('clip-hl-' + color);
    });
    const state = annState.get(id);
    if (state) {
      state.color = color;
    }
  }

  // ---------------- 恢复已入库标注 ----------------

  async function restoreAnnotations() {
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'getPageAnnotations',
        sourceUrl: window.location.href
      });
      if (!resp || !resp.success || !Array.isArray(resp.annotations)) {
        return;
      }
      resp.annotations.forEach((ann) => {
        if (!ann || !ann.text || annState.has(ann.id)) {
          return;
        }
        const wrapped = wrapTextInPage(ann.text, ann.color || 'yellow', ann.id);
        if (wrapped > 0) {
          annState.set(ann.id, {
            text: ann.text,
            note: ann.note || '',
            color: ann.color || 'yellow',
            persisted: true
          });
        }
      });
    } catch (error) {
      console.warn('智能剪藏助手: 恢复标注失败（后端未连接时跳过）', error);
    }
  }

  /**
   * 在页面中定位并包裹目标文字。
   * 思路：收集页面全部有效文本节点，把每个节点的文本压缩空白后拼接，
   * 用压缩后的全局文本做索引，再通过字符映射回算到原始节点的字符偏移，
   * 保证跨节点选中片段也能恢复。仅包裹第一处命中。
   */
  function wrapTextInPage(rawText, color, id) {
    const target = rawText.replace(/\s+/g, ' ');
    if (!target) {
      return 0;
    }
    const nodes = collectTextNodes();
    if (nodes.length === 0) {
      return 0;
    }

    const segments = nodes.map((node) => {
      const raw = node.nodeValue;
      const collapsed = raw.replace(/\s+/g, ' ');
      const charMap = [];
      let ri = 0;
      for (let ci = 0; ci < collapsed.length; ci++) {
        const ch = collapsed[ci];
        while (ri < raw.length && raw[ri] !== ch && !(ch === ' ' && /\s/.test(raw[ri]))) {
          ri++;
        }
        charMap.push(ri);
        ri = Math.min(ri + 1, raw.length);
      }
      return { node, raw, collapsed, charMap };
    });

    let fullText = '';
    const starts = [];
    segments.forEach((seg) => {
      starts.push(fullText.length);
      fullText += seg.collapsed;
    });

    const idx = fullText.indexOf(target);
    if (idx < 0) {
      return 0;
    }
    const endIdx = idx + target.length;

    const startLoc = locate(segments, starts, idx, true);
    const endLoc = locate(segments, starts, endIdx, false);
    if (!startLoc || !endLoc) {
      return 0;
    }

    const range = document.createRange();
    try {
      range.setStart(startLoc.node, startLoc.offset);
      range.setEnd(endLoc.node, endLoc.offset);
      const frag = range.extractContents();
      const mark = document.createElement('mark');
      mark.className = 'clip-hl clip-hl-' + color;
      mark.dataset.clipAnnId = id;
      mark.title = '已入库标注';
      mark.appendChild(frag);
      range.insertNode(mark);
      return 1;
    } catch (error) {
      console.warn('智能剪藏助手: 恢复标注包裹失败', error);
      return 0;
    }
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        continue;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, .clip-hl, .clip-ann-toolbar')) {
        continue;
      }
      nodes.push(node);
    }
    return nodes;
  }

  function locate(segments, starts, globalOffset, isStart) {
    // 找到包含 globalOffset 的段
    let segIndex = starts.length - 1;
    for (let i = 0; i < starts.length; i++) {
      const segStart = starts[i];
      const segLen = segments[i].collapsed.length;
      if (globalOffset >= segStart && (isStart ? globalOffset <= segStart + segLen : globalOffset < segStart + segLen)) {
        segIndex = i;
        break;
      }
    }
    const seg = segments[segIndex];
    const local = globalOffset - starts[segIndex];
    if (isStart) {
      if (local >= seg.collapsed.length) {
        return local === seg.collapsed.length ? { node: seg.node, offset: seg.raw.length } : null;
      }
      return { node: seg.node, offset: seg.charMap[local] };
    }
    if (local >= seg.collapsed.length) {
      // 结尾落在下一段开头
      return { node: seg.node, offset: seg.raw.length };
    }
    const rawIdx = seg.charMap[local];
    return { node: seg.node, offset: Math.min(rawIdx + 1, seg.raw.length) };
  }

  // ---------------- 工具条 ----------------

  function buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'clip-ann-toolbar';
    bar.innerHTML = `
      <div class="clip-ann-row">
        <span class="clip-ann-hint">标注</span>
        ${ANN_COLORS.map((c) => `<button type="button" class="clip-ann-color clip-ann-color-${c}" data-color="${c}" title="切换颜色"></button>`).join('')}
        <button type="button" class="clip-ann-btn note" id="clipAnnNoteBtn">想法</button>
        <button type="button" class="clip-ann-btn save" id="clipAnnSaveBtn">保存入库</button>
        <button type="button" class="clip-ann-close" id="clipAnnCloseBtn">×</button>
      </div>
      <div class="clip-ann-note-panel" style="display:none;">
        <textarea id="clipAnnNoteText" maxlength="${MAX_NOTE_LENGTH}" placeholder="给这条高亮写句想法（可留空，1000 字内）"></textarea>
        <div class="clip-ann-note-actions">
          <button type="button" class="clip-ann-undo" id="clipAnnUndoBtn">撤销这条标注</button>
        </div>
      </div>`;
    document.body.appendChild(bar);

    bar.addEventListener('mousedown', (e) => e.stopPropagation());

    bar.querySelectorAll('.clip-ann-color').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!activeId) {
          return;
        }
        recolorMark(activeId, btn.dataset.color);
        refreshToolbarState();
      });
    });

    bar.querySelector('#clipAnnNoteBtn').addEventListener('click', () => {
      const panel = bar.querySelector('.clip-ann-note-panel');
      const show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      if (show) {
        bar.querySelector('#clipAnnNoteText').focus();
      }
    });

    bar.querySelector('#clipAnnNoteText').addEventListener('input', (e) => {
      const state = activeId ? annState.get(activeId) : null;
      if (state) {
        state.note = e.target.value;
      }
    });

    bar.querySelector('#clipAnnUndoBtn').addEventListener('click', () => {
      if (!activeId) {
        return;
      }
      unwrapMark(activeId);
      annState.delete(activeId);
      hideToolbar();
    });

    bar.querySelector('#clipAnnCloseBtn').addEventListener('click', hideToolbar);
    bar.querySelector('#clipAnnSaveBtn').addEventListener('click', saveAnnotations);

    return bar;
  }

  function showToolbar(rect, id) {
    if (!toolbar) {
      toolbar = buildToolbar();
    }
    toolbar.style.display = 'block';
    toolbar.querySelector('.clip-ann-note-panel').style.display = 'none';
    refreshToolbarState();
    positionToolbar(rect);
  }

  function refreshToolbarState() {
    const state = activeId ? annState.get(activeId) : null;
    if (!state) {
      return;
    }
    toolbar.querySelectorAll('.clip-ann-color').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === state.color);
    });
    toolbar.querySelector('#clipAnnNoteText').value = state.note || '';
  }

  function positionToolbar(rect) {
    if (!rect) {
      return;
    }
    const margin = 8;
    const width = toolbar.offsetWidth || 280;
    const height = toolbar.offsetHeight || 42;
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.top - height - margin;
    if (top < margin) {
      top = rect.bottom + margin;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  function hideToolbar() {
    if (toolbar) {
      toolbar.style.display = 'none';
    }
    activeId = null;
  }

  function rectFromSelection(sel) {
    try {
      const range = sel.getRangeAt(0);
      return range.getBoundingClientRect();
    } catch (error) {
      return null;
    }
  }

  // ---------------- 保存入库 ----------------

  async function saveAnnotations() {
    const unsaved = [...annState.values()].filter((state) => !state.persisted);
    if (unsaved.length === 0) {
      toast('本次没有新增标注');
      return;
    }
    const annotations = unsaved.map((state) => ({
      id: state.id,
      text: state.text,
      note: state.note || '',
      color: state.color,
      sourceUrl: window.location.href,
      sourceTitle: document.title,
      source: 'extension'
    }));

    let pageContent = '';
    try {
      pageContent = await extractPageContent();
    } catch (error) {
      console.warn('智能剪藏助手: 提取整页正文失败，仍可保存标注', error);
    }

    const selectionText = unsaved.map((s) => s.text).join('\n');
    // 剪藏正文用「网页摘录」（高亮原文逐段拼接），想法备注只放在结构化 annotations 中，
    // 避免把备注再以 Markdown 引用拼进正文造成与标注字段重复（原数据流不合理）
    const content = unsaved.map((s) => s.text).join('\n\n');

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'saveAnnotations',
        data: {
          annotations,
          content,
          selectedText: selectionText,
          pageContent,
          sourceUrl: window.location.href,
          title: document.title,
          siteName: extractSiteName(),
          capturedAt: new Date().toISOString()
        }
      });
      if (resp && resp.success) {
        unsaved.forEach((state) => {
          state.persisted = true;
        });
        if (resp.opened) {
          hideToolbar();
        } else {
          toast('已暂存标注，请点击浏览器工具栏的剪藏图标完成保存');
        }
      } else {
        toast('后端不可达，请稍后重试');
      }
    } catch (error) {
      console.error('智能剪藏助手: 保存标注失败', error);
      toast('后端不可达，请稍后重试');
    }
  }

  // ---------------- 轻提示 ----------------

  function toast(message) {
    let el = document.getElementById('clip-ann-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'clip-ann-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.display = 'none';
    }, 3000);
  }
})();
