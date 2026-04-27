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
  const clearBtn = document.getElementById('clearBtn');
  const statusMessage = document.getElementById('statusMessage');
  const settingsBtn = document.getElementById('settingsBtn');
  const openClipList = document.getElementById('openClipList');
  const openOptions = document.getElementById('openOptions');

  let currentTags = [];
  let currentCaptureData = {};
  let activeTabContext = null;
  const MAX_TAGS = 10;

  // 检查是否有待处理的剪藏数据
  const result = await chrome.storage.local.get('pendingClip');
  if (result.pendingClip) {
    currentCaptureData = result.pendingClip;
    fillFormWithData(result.pendingClip);
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
  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  openClipList.addEventListener('click', openClipListPage);
  openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // AI标签复选框事件
  aiTagsCheckbox.addEventListener('change', handleAiTagsToggle);

  // 标签输入事件
  tagInput.addEventListener('keydown', handleTagInput);

  // 初始状态
  handleAiTagsToggle();

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
        title: currentCaptureData.title || activeTabContext?.title || '',
        siteName: currentCaptureData.siteName || inferSiteName(sourceInput.value.trim()),
        capturedAt: currentCaptureData.capturedAt || new Date().toISOString(),
        selectedText: currentCaptureData.selectedText || '',
        captureMethod: currentCaptureData.captureMethod || 'popup',
        workflowStatus: currentCaptureData.workflowStatus || 'inbox',
        category: categorySelect.value,
        tags: aiTagsCheckbox.checked ? null : currentTags,
        useAiTags: typeSelect.value === 'store-only' ? false : aiTagsCheckbox.checked,
        imageDataList: currentCaptureData.imageDataList || []
      };

      const response = await chrome.runtime.sendMessage({
        action: 'sendToBackend',
        data: data
      });

      if (response.success) {
        showStatus('✅ 剪藏成功！', 'success');
        setTimeout(() => {
          handleClear();
          window.close();
        }, 1500);
      } else {
        showStatus('❌ ' + formatErrorMessage(response.errorType, response.error), 'error');
      }
    } catch (error) {
      console.error('提交失败:', error);
      showStatus('❌ 发送失败，请重试', 'error');
    } finally {
      setLoading(false);
    }
  }

  // 清空表单
  function handleClear() {
    contentInput.value = '';
    sourceInput.value = '';
    typeSelect.value = 'ai-text';
    categorySelect.value = '';
    aiTagsCheckbox.checked = true;
    currentTags = [];
    currentCaptureData = {};
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

  // 渲染标签
  function renderTags() {
    tagsList.innerHTML = currentTags.map(tag => `
      <div class="tag">
        <span>${escapeHtml(tag)}</span>
        <span class="tag-remove" data-tag="${escapeHtml(tag)}">&times;</span>
      </div>
    `).join('');

    // 绑定移除事件
    tagsList.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => removeTag(btn.dataset.tag));
    });
  }

  // 用数据填充表单
  function fillFormWithData(data) {
    if (data.content) contentInput.value = data.content;
    if (data.sourceUrl || data.source) sourceInput.value = data.sourceUrl || data.source;
    if (data.type) typeSelect.value = data.type;
    categorySelect.value = data.category || '';
    if (data.useAiTags !== undefined) aiTagsCheckbox.checked = data.useAiTags;
    
    handleAiTagsToggle();
  }

  // 设置加载状态
  function setLoading(loading) {
    submitBtn.disabled = loading;
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

  function applyTheme(themeId) {
    const resolvedTheme = themeId === 'regular' ? 'regular' : 'notion';
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }
});
