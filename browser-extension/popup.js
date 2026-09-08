// 弹出窗口脚本
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme((await chrome.storage.local.get('uiTheme')).uiTheme);

  const form = document.getElementById('clipForm');
  const contentInput = document.getElementById('content');
  const sourceInput = document.getElementById('source');
  const typeSelect = document.getElementById('type');
  const categorySelect = document.getElementById('category');
  const aiTagsCheckbox = document.getElementById('aiGenerateTags');
  const tagInput = document.getElementById('tagInput');
  const tagsList = document.getElementById('tagsList');
  const submitBtn = document.getElementById('submitBtn');
  const smartIngestBtn = document.getElementById('smartIngestBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusMessage = document.getElementById('statusMessage');
  const settingsBtn = document.getElementById('settingsBtn');
  const openClipList = document.getElementById('openClipList');
  const openTopicList = document.getElementById('openTopicList');
  const openOptions = document.getElementById('openOptions');
  // ==================== 保存体验三件套：标题建议 / 去重提示 / 智能选中 ====================
  const titleInput = document.getElementById('title');
  const aiSuggestBtn = document.getElementById('aiSuggestBtn');
  const aiSuggestion = document.getElementById('aiSuggestion');
  const aiTitleValue = document.getElementById('aiTitleValue');
  const aiCategoryValue = document.getElementById('aiCategoryValue');
  const aiTagsValue = document.getElementById('aiTagsValue');
  const annoGroup = document.getElementById('annoGroup');
  const annoSummary = document.getElementById('annoSummary');
  const annoList = document.getElementById('annoList');
  const scopeGroup = document.getElementById('scopeGroup');
  const scopeSwitch = document.getElementById('scopeSwitch');
  const dupHint = document.getElementById('dupHint');

  let currentTags = [];
  let currentCaptureData = {};
  let activeTabContext = null;
  const MAX_TAGS = 10;

  // 标注流状态：本次随弹窗一起入库的高亮（可改想法/换色/移除）
  let pendingAnnotations = [];
  // 智能选中：可用的保存范围文本（packed=标注合集 / selection=选中原文 / fullpage=整页正文）
  let scopeTexts = {};
  let aiSuggestionData = null;
  let dupCheckTimer = null;

  // 检查是否有待处理的剪藏数据
  const result = await chrome.storage.local.get('pendingClip');
  if (result.pendingClip) {
    currentCaptureData = result.pendingClip;
    fillFormWithData(result.pendingClip);
    buildAnnotationUi(result.pendingClip);
    // 清除待处理数据
    await chrome.storage.local.remove('pendingClip');
  }

  // 如果没有填充数据，尝试获取当前标签页信息
  else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabContext = tab;
        sourceInput.value = tab.url || '';
        titleInput.value = tab.title || '';
        // 尝试获取选中文本
        const [selectionResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection().toString()
        });
        if (selectionResult.result) {
          contentInput.value = selectionResult.result;
        }
      }
    } catch (error) {
      console.log('获取当前标签页失败:', error);
    }
  }

  // 绑定事件
  form.addEventListener('submit', handleSubmit);
  clearBtn.addEventListener('click', handleClear);
  smartIngestBtn.addEventListener('click', handleSmartIngest);
  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  openClipList.addEventListener('click', openClipListPage);
  openTopicList.addEventListener('click', openTopicListPage);
  openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // AI标签复选框事件
  aiTagsCheckbox.addEventListener('change', handleAiTagsToggle);

  // 标签输入事件
  tagInput.addEventListener('keydown', handleTagInput);

  // ==================== 保存体验三件套事件 ====================
  aiSuggestBtn.addEventListener('click', handleAiSuggest);
  aiSuggestion.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-adopt-btn');
    if (btn) adoptSuggestion(btn.dataset.kind);
  });
  contentInput.addEventListener('input', () => {
    setActiveScope('custom');
    scheduleDupCheck();
  });
  sourceInput.addEventListener('input', scheduleDupCheck);

  // 初始状态
  handleAiTagsToggle();
  // 打开弹窗即做一次去重预检（内容为空时后端约定返回 found=false）
  scheduleDupCheck();

  // 处理表单提交
  async function handleSubmit(e) {
    e.preventDefault();
    
    const content = contentInput.value.trim();
    if (!content) {
      showStatus('请输入内容', 'error');
      return;
    }

    // 显示加载状态
    setLoading(true);
    showStatus('正在发送到后端...', 'info');

    try {
      const data = {
        type: typeSelect.value,
        content: content,
        source: sourceInput.value.trim(),
        sourceUrl: sourceInput.value.trim(),
        title: titleInput.value.trim() || currentCaptureData.title || activeTabContext?.title || '',
        siteName: currentCaptureData.siteName || inferSiteName(sourceInput.value.trim()),
        capturedAt: currentCaptureData.capturedAt || new Date().toISOString(),
        selectedText: currentCaptureData.selectedText || '',
        contextBefore: currentCaptureData.contextBefore || '',
        contextAfter: currentCaptureData.contextAfter || '',
        captureMethod: currentCaptureData.captureMethod || 'popup',
        target: currentCaptureData.target || 'clip',
        workflowStatus: currentCaptureData.workflowStatus || 'inbox',
        category: categorySelect.value,
        tags: aiTagsCheckbox.checked ? null : currentTags,
        useAiTags: typeSelect.value === 'store-only' ? false : aiTagsCheckbox.checked,
        imageDataList: currentCaptureData.imageDataList || [],
        // 网页标注随剪藏一并入库（保存弹窗编辑后的最终版本）
        annotations: pendingAnnotations.map((ann) => ({
          text: ann.text,
          note: ann.note || '',
          color: ann.color,
          sourceUrl: ann.sourceUrl || sourceInput.value.trim(),
          sourceTitle: ann.sourceTitle || activeTabContext?.title || ''
        }))
      };

      const response = await chrome.runtime.sendMessage({
        action: 'sendToBackend',
        data: data
      });

      if (response.success) {
        showStatus('✅ 剪藏成功！', 'success');
        // 通知 background（失败不影响主流程）
        try { chrome.runtime.sendMessage({ action: 'popupClipCompleted', success: true }); } catch (e) {}
        setTimeout(() => {
          handleClear();
          window.close();
        }, 2500);
      } else {
        showStatus('❌ ' + formatErrorMessage(response.errorType, response.error), 'error');
        try { chrome.runtime.sendMessage({ action: 'popupClipCompleted', success: false, error: formatErrorMessage(response.errorType, response.error) }); } catch (e) {}
      }
    } catch (error) {
      console.error('提交失败:', error);
      showStatus('❌ 发送失败，请重试', 'error');
      try { chrome.runtime.sendMessage({ action: 'popupClipCompleted', success: false, error: '发送失败，请重试' }); } catch (e) {}
    } finally {
      setLoading(false);
    }
  }

  async function handleSmartIngest() {
    const text = contentInput.value.trim();
    if (!text) {
      showStatus('请输入内容', 'error');
      return;
    }
    if (text.length < 5) {
      showStatus('内容过短，请至少输入5个字符', 'error');
      return;
    }

    setLoading(true);
    smartIngestBtn.querySelector('.btn-text').style.display = 'none';
    smartIngestBtn.querySelector('.btn-loading').style.display = 'inline';
    showStatus('正在智能分析...', 'info');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'smartIngest',
        data: { text }
      });

      if (response.success) {
        const intentLabel = response.intent === 'todo' ? '待办' : response.intent === 'topic' ? '话题' : '剪藏';
        const degradedNote = response.degraded ? ' (降级存储)' : '';
        showStatus(`✅ 智能入库成功！识别为${intentLabel}${degradedNote}`, 'success');
        try { chrome.runtime.sendMessage({ action: 'popupClipCompleted', success: true }); } catch (e) {}
        setTimeout(() => {
          handleClear();
          window.close();
        }, 2500);
      } else {
        showStatus('❌ ' + (response.error || '智能入库失败'), 'error');
        try { chrome.runtime.sendMessage({ action: 'popupClipCompleted', success: false, error: response.error }); } catch (e) {}
      }
    } catch (error) {
      console.error('智能入库失败:', error);
      showStatus('❌ 发送失败，请重试', 'error');
    } finally {
      setLoading(false);
      smartIngestBtn.querySelector('.btn-text').style.display = 'inline';
      smartIngestBtn.querySelector('.btn-loading').style.display = 'none';
    }
  }

  // 清空表单
  function handleClear() {
    contentInput.value = '';
    sourceInput.value = '';
    titleInput.value = '';
    typeSelect.value = 'ai-text';
    categorySelect.value = '';
    aiTagsCheckbox.checked = true;
    currentTags = [];
    currentCaptureData = {};
    pendingAnnotations = [];
    scopeTexts = {};
    aiSuggestionData = null;
    aiSuggestion.style.display = 'none';
    annoGroup.style.display = 'none';
    annoList.innerHTML = '';
    annoSummary.textContent = '';
    scopeGroup.style.display = 'none';
    scopeSwitch.innerHTML = '';
    hideDupHint();
    // 清理动态添加的分类选项（保留原始预设）
    Array.from(categorySelect.options).forEach((opt) => {
      if (opt.dataset.temp) {
        categorySelect.removeChild(opt);
      }
    });
    renderTags();
    handleAiTagsToggle();
    hideStatus();
  }

  // 处理AI标签切换
  function handleAiTagsToggle() {
    const useAiTags = aiTagsCheckbox.checked;
    tagInput.disabled = useAiTags;
    tagInput.placeholder = useAiTags ? 'AI自动生成标签' : '输入标签按回车添加';
    
    if (useAiTags) {
      currentTags = [];
      renderTags();
    }
  }

  // 处理标签输入
  function handleTagInput(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(tagInput.value.trim());
      tagInput.value = '';
    }
  }

  // 添加标签
  function addTag(tag) {
    if (!tag) return;
    if (currentTags.includes(tag)) {
      showStatus('标签已存在', 'error');
      return;
    }
    if (currentTags.length >= MAX_TAGS) {
      showStatus(`最多添加 ${MAX_TAGS} 个标签`, 'error');
      return;
    }
    
    currentTags.push(tag);
    renderTags();
  }

  // 移除标签
  function removeTag(tag) {
    currentTags = currentTags.filter(t => t !== tag);
    renderTags();
  }

  // 渲染标签（DOM API 构建，避免 XSS 与 dataset 二次转义导致删除不匹配）
  function renderTags() {
    tagsList.innerHTML = '';
    currentTags.forEach(tag => {
      const div = document.createElement('div');
      div.className = 'tag';
      const span = document.createElement('span');
      span.textContent = tag;
      const remove = document.createElement('span');
      remove.className = 'tag-remove';
      remove.textContent = '\u00d7';
      remove.title = '删除标签';
      remove.addEventListener('click', () => removeTag(tag));
      div.appendChild(span);
      div.appendChild(remove);
      tagsList.appendChild(div);
    });
  }

  // 用数据填充表单
  function fillFormWithData(data) {
    if (data.content) contentInput.value = data.content;
    if (data.sourceUrl || data.source) sourceInput.value = data.sourceUrl || data.source;
    if (data.type) typeSelect.value = data.type;
    categorySelect.value = data.category || '';
    if (data.title) titleInput.value = data.title;
    if (data.useAiTags !== undefined) aiTagsCheckbox.checked = data.useAiTags;
    
    handleAiTagsToggle();
  }

  // 设置加载状态
  function setLoading(loading) {
    submitBtn.disabled = loading;
    smartIngestBtn.disabled = loading;
    clearBtn.disabled = loading;
    contentInput.disabled = loading;
    sourceInput.disabled = loading;
    typeSelect.disabled = loading;
    categorySelect.disabled = loading;
    aiTagsCheckbox.disabled = loading;
    tagInput.disabled = loading || aiTagsCheckbox.checked;
    
    submitBtn.querySelector('.btn-text').style.display = loading ? 'none' : 'inline';
    submitBtn.querySelector('.btn-loading').style.display = loading ? 'inline' : 'none';
  }

  // 显示状态消息
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    
    if (type === 'success') {
      setTimeout(hideStatus, 3000);
    }
  }

  // 隐藏状态消息
  function hideStatus() {
    statusMessage.style.display = 'none';
  }

  // 打开剪藏列表页面
  function openClipListPage() {
    // 打开本地的index.html文件
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }

  // 打开话题列表页面
  function openTopicListPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL('topic.html') });
  }

  // HTML转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatErrorMessage(errorType, fallbackMessage) {
    switch (errorType) {
      case 'timeout':
        return '请求超时，请稍后重试';
      case 'service_unreachable':
        return '无法连接后端服务，请确认服务已启动';
      case 'http_error':
        return fallbackMessage || '接口请求失败';
      case 'api_error':
        return fallbackMessage || '服务处理失败';
      default:
        return fallbackMessage || '发送失败';
    }
  }

  function inferSiteName(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  // ==================== 保存体验三件套实现 ====================

  const ANN_COLORS = ['yellow', 'green', 'blue', 'purple'];

  /** 构建标注预览与智能选中范围（pendingClip 标注流专用） */
  function buildAnnotationUi(data) {
    const annotations = Array.isArray(data.annotations) ? data.annotations : [];
    scopeTexts = {
      packed: (data.content || '').trim(),
      selection: (data.selectedText || '').trim(),
      fullpage: (data.pageContent || '').trim()
    };

    if (annotations.length > 0) {
      pendingAnnotations = annotations.map((ann) => ({
        text: ann.text || '',
        note: ann.note || '',
        color: ANN_COLORS.includes(ann.color) ? ann.color : 'yellow',
        sourceUrl: ann.sourceUrl || data.sourceUrl || '',
        sourceTitle: ann.sourceTitle || data.title || ''
      }));
      annoGroup.style.display = 'block';
      renderAnnotations();
    }

    renderScopeSwitch();
  }

  /** 渲染标注预览列表：色点循环换色 + 想法可改 + 可移除 */
  function renderAnnotations() {
    annoSummary.textContent = `本次高亮 ${pendingAnnotations.length} 段 · 入库后可在剪藏详情回看并跳回原网页`;
    annoList.innerHTML = '';
    pendingAnnotations.forEach((ann, index) => {
      const item = document.createElement('div');
      item.className = 'anno-item';
      item.dataset.index = index;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `anno-dot anno-dot-${ann.color}`;
      dot.title = '点击切换颜色';
      dot.addEventListener('click', () => {
        ann.color = ANN_COLORS[(ANN_COLORS.indexOf(ann.color) + 1) % ANN_COLORS.length];
        renderAnnotations();
      });

      const body = document.createElement('div');
      body.className = 'anno-body';

      const text = document.createElement('div');
      text.className = 'anno-text';
      text.textContent = ann.text.length > 60 ? ann.text.slice(0, 60) + '…' : ann.text;
      text.title = ann.text;

      const note = document.createElement('textarea');
      note.className = 'anno-note';
      note.placeholder = '补一句想法（可留空）';
      note.maxLength = 1000;
      note.value = ann.note;
      note.addEventListener('input', () => {
        ann.note = note.value;
      });

      body.appendChild(text);
      body.appendChild(note);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'anno-remove';
      remove.title = '移除这条标注';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        pendingAnnotations.splice(index, 1);
        if (pendingAnnotations.length === 0) {
          annoGroup.style.display = 'none';
          annoList.innerHTML = '';
          annoSummary.textContent = '';
          if ((scopeTexts.packed || '').trim()) {
            // 只剩整页正文时保留可保存范围
            renderScopeSwitch();
          }
        } else {
          renderAnnotations();
        }
      });

      item.appendChild(dot);
      item.appendChild(body);
      item.appendChild(remove);
      annoList.appendChild(item);
    });
  }

  /** 渲染保存范围切换（智能选中：标注合集 / 选中原文 / 整页正文） */
  function renderScopeSwitch() {
    const options = [];
    if (scopeTexts.packed) options.push({ mode: 'packed', label: '💬 标注合集（含想法）' });
    if (scopeTexts.selection && scopeTexts.selection !== scopeTexts.packed) {
      options.push({ mode: 'selection', label: '🔤 仅选中原文' });
    }
    if (scopeTexts.fullpage && scopeTexts.fullpage !== scopeTexts.selection) {
      options.push({ mode: 'fullpage', label: '📄 整页正文' });
    }
    if (options.length <= 1) {
      return;
    }
    scopeGroup.style.display = 'block';
    scopeSwitch.innerHTML = '';
    options.forEach((opt) => {
      const label = document.createElement('label');
      label.className = 'scope-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'clipScope';
      radio.value = opt.mode;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setActiveScope(opt.mode);
        }
      });
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.appendChild(radio);
      label.appendChild(span);
      scopeSwitch.appendChild(label);
    });
    // 默认选中标注合集
    const defaultRadio = scopeSwitch.querySelector('input[value="packed"]') || scopeSwitch.querySelector('input');
    if (defaultRadio) {
      setActiveScope(defaultRadio.value);
    }
  }

  /** 切换保存范围；custom 表示用户已手改内容 */
  function setActiveScope(mode) {
    if (mode !== 'custom' && scopeTexts[mode]) {
      contentInput.value = scopeTexts[mode];
    }
    const radios = scopeSwitch.querySelectorAll('input[name="clipScope"]');
    radios.forEach((radio) => {
      radio.checked = mode !== 'custom' && radio.value === mode;
    });
  }

  /** AI 建议：调后端 /smart-organize 生成标题/分类/标签候选 */
  async function handleAiSuggest() {
    const content = contentInput.value.trim();
    if (!content) {
      showStatus('请先有内容再取建议', 'error');
      return;
    }
    aiSuggestBtn.disabled = true;
    aiSuggestBtn.textContent = '⏳';
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'suggestMeta',
        data: { content }
      });
      if (resp && resp.success && resp.data) {
        aiSuggestionData = resp.data;
        renderAiSuggestion();
      } else {
        showStatus('AI 建议失败，可手动填写', 'error');
      }
    } catch (error) {
      showStatus('AI 建议失败，可手动填写', 'error');
    } finally {
      aiSuggestBtn.disabled = false;
      aiSuggestBtn.textContent = '✨ AI 建议';
    }
  }

  function renderAiSuggestion() {
    if (!aiSuggestionData) {
      return;
    }
    const d = aiSuggestionData;
    const title = (d.title || '').trim();
    const category = (d.category || '').trim();
    const tags = Array.isArray(d.tags) ? d.tags.slice(0, 10) : [];

    if (!title && !category && tags.length === 0) {
      showStatus('AI 未返回有效建议', 'error');
      return;
    }

    aiTitleValue.textContent = title || '—';
    aiCategoryValue.textContent = category || '—';
    aiTagsValue.textContent = tags.length > 0 ? tags.join('、') : '—';

    aiSuggestion.querySelectorAll('.ai-adopt-btn').forEach((btn) => {
      const kind = btn.dataset.kind;
      const hasValue = kind === 'title' ? !!title : kind === 'category' ? !!category : tags.length > 0;
      btn.disabled = !hasValue;
    });
    aiSuggestion.style.display = 'block';
  }

  /** 采纳 AI 建议：标题直接写入，分类写入下拉（缺项动态补），标签合并到手打列表 */
  function adoptSuggestion(kind) {
    if (!aiSuggestionData) {
      return;
    }
    const d = aiSuggestionData;
    if (kind === 'title') {
      const title = (d.title || '').trim();
      if (title) {
        titleInput.value = title;
      }
    } else if (kind === 'category') {
      const category = (d.category || '').trim();
      if (category) {
        let option = Array.from(categorySelect.options).find((opt) => opt.value === category);
        if (!option) {
          option = document.createElement('option');
          option.value = category;
          option.textContent = category;
          option.dataset.temp = '1';
          categorySelect.appendChild(option);
        }
        categorySelect.value = category;
      }
    } else if (kind === 'tags') {
      const tags = Array.isArray(d.tags) ? d.tags : [];
      if (tags.length > 0) {
        aiTagsCheckbox.checked = false;
        handleAiTagsToggle();
        tags.forEach((tag) => {
          if (currentTags.length >= MAX_TAGS) {
            return;
          }
          if (!currentTags.includes(tag)) {
            currentTags.push(tag);
          }
        });
        renderTags();
      }
    }
    showStatus('✅ 已采纳建议', 'success');
  }

  /** 去重预检（防抖 500ms）：内容 + 来源 URL 指纹统计已收藏次数 */
  function scheduleDupCheck() {
    clearTimeout(dupCheckTimer);
    dupCheckTimer = setTimeout(runDupCheck, 500);
  }

  async function runDupCheck() {
    const content = contentInput.value.trim();
    const sourceUrl = sourceInput.value.trim();
    hideDupHint();
    if (!content) {
      return;
    }
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'dupCheck',
        data: { content, sourceUrl }
      });
      if (resp && resp.success && resp.found && resp.count > 0) {
        dupHint.textContent = `⚠️ 已收藏过 ${resp.count} 次（本次为第 ${resp.count + 1} 次），保存将合并标注`;
        dupHint.style.display = 'block';
      }
    } catch (error) {
      // 后端不可达时静默降级，不阻塞保存
    }
  }

  function hideDupHint() {
    clearTimeout(dupCheckTimer);
    dupHint.style.display = 'none';
    dupHint.textContent = '';
  }

  function applyTheme(themeId) {
    const resolvedTheme = themeId === 'regular' ? 'regular' : 'notion';
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }
});
