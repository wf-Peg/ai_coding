const DEFAULT_CATEGORY = 'inbox';

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
  console.log('智能剪藏助手已安装');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'sendToBackend':
      sendToBackend(request.data, sendResponse);
      return true;
    case 'getConfig':
      getConfig(sendResponse);
      return true;
    case 'saveConfig':
      saveConfig(request.data, sendResponse);
      return true;
    case 'clipCurrentPage':
      clipPage(sender.tab, 'floating-button')
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    default:
      sendResponse({ error: '未知操作' });
  }
});

function createContextMenus() {
  chrome.contextMenus.create({
    id: 'clip-main',
    title: '智能剪藏',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'clip-entire-page',
    parentId: 'clip-main',
    title: '剪藏整个页面',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'clip-selection',
    parentId: 'clip-main',
    title: '剪藏选中内容',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'clip-image',
    parentId: 'clip-main',
    title: '剪藏图片',
    contexts: ['image']
  });

  chrome.contextMenus.create({
    id: 'clip-separator',
    parentId: 'clip-main',
    type: 'separator',
    contexts: ['page', 'selection', 'image']
  });

  chrome.contextMenus.create({
    id: 'clip-ai-text',
    parentId: 'clip-main',
    title: 'AI文本整理',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'clip-store-only',
    parentId: 'clip-main',
    title: '仅存储内容',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'clip-settings',
    parentId: 'clip-main',
    title: '设置',
    contexts: ['page', 'selection', 'image']
  });
}

async function handleContextMenuClick(info, tab) {
  switch (info.menuItemId) {
    case 'clip-entire-page':
      await clipPage(tab, 'context-menu');
      break;
    case 'clip-selection':
      await clipSelection(tab, 'context-menu');
      break;
    case 'clip-image':
      await clipImage(tab, info.srcUrl);
      break;
    case 'clip-ai-text':
      await clipWithType(tab, 'ai-text', Boolean(info.selectionText));
      break;
    case 'clip-store-only':
      await clipWithType(tab, 'store-only', Boolean(info.selectionText));
      break;
    case 'clip-settings':
      openOptions();
      break;
  }
}

async function handleCommand(command, tab) {
  switch (command) {
    case 'clip-page':
      await clipPage(tab, 'shortcut');
      break;
    case 'clip-selection':
      await clipSelection(tab, 'shortcut');
      break;
  }
}

async function clipPage(tab, captureMethod = 'context-menu') {
  await ensureTab(tab);
  showNotification('正在解析页面内容...', 'info');

  try {
    const extraction = await requestCaptureData(tab.id, 'extractPageData');
    const payload = await buildCapturePayload({
      tab,
      extraction,
      type: 'ai-text',
      useAiTags: true,
      captureMethod
    });

    if (!payload.content) {
      throw createClassifiedError('extract_failed', '未提取到可用页面内容');
    }

    await openPopupWithData(payload);
  } catch (error) {
    handleCaptureError(error, '剪藏页面失败');
    throw error;
  }
}

async function clipSelection(tab, captureMethod = 'shortcut') {
  await ensureTab(tab);
  showNotification('正在获取选中内容...', 'info');

  try {
    const extraction = await requestCaptureData(tab.id, 'extractSelectionData');
    if (!extraction.selectedText) {
      throw createClassifiedError('selection_empty', '请先选择要剪藏的内容');
    }

    const payload = await buildCapturePayload({
      tab,
      extraction,
      type: 'ai-text',
      useAiTags: true,
      captureMethod
    });

    await openPopupWithData(payload);
  } catch (error) {
    handleCaptureError(error, '剪藏选中内容失败');
    throw error;
  }
}

async function clipImage(tab, imageUrl) {
  await ensureTab(tab);
  showNotification('正在获取图片...', 'info');

  try {
    if (!imageUrl) {
      throw createClassifiedError('image_missing', '未找到图片地址');
    }

    const imageData = await fetchImageAsBase64(imageUrl);
    const extraction = await requestCaptureData(tab.id, 'extractPageData');
    const payload = createPayload({
      type: 'store-only',
      content: `图片剪藏\n来源页面: ${extraction.title || tab.title || ''}\n图片地址: ${imageUrl}`,
      sourceUrl: extraction.sourceUrl || tab.url,
      title: extraction.title || tab.title,
      siteName: extraction.siteName,
      capturedAt: extraction.capturedAt,
      selectedText: '',
      captureMethod: 'context-menu',
      useAiTags: false,
      imageDataList: [imageData]
    });

    await openPopupWithData(payload);
  } catch (error) {
    handleCaptureError(error, '剪藏图片失败');
    throw error;
  }
}

async function clipWithType(tab, type, preferSelection) {
  await ensureTab(tab);
  showNotification('正在准备剪藏内容...', 'info');

  try {
    const extraction = await requestCaptureData(tab.id, preferSelection ? 'extractSelectionData' : 'extractPageData');
    if (preferSelection && !extraction.selectedText) {
      throw createClassifiedError('selection_empty', '请先选择要剪藏的内容');
    }

    const payload = await buildCapturePayload({
      tab,
      extraction,
      type,
      useAiTags: type !== 'store-only',
      captureMethod: preferSelection ? 'shortcut' : 'context-menu'
    });

    if (!payload.content) {
      throw createClassifiedError('extract_failed', '未提取到可用内容');
    }

    const result = await sendToBackendPromise(payload);
    if (!result.success) {
      throw createClassifiedError(result.errorType || 'api_error', result.error || '发送失败');
    }
  } catch (error) {
    handleCaptureError(error, '快速剪藏失败');
  }
}

async function requestCaptureData(tabId, action) {
  const response = await chrome.tabs.sendMessage(tabId, { action });
  if (!response || !response.success) {
    throw createClassifiedError('extract_failed', response?.error || '无法从页面提取内容');
  }
  return response.data;
}

async function buildCapturePayload({ tab, extraction, type, useAiTags, captureMethod }) {
  const config = await getConfigAsync();
  let content = extraction.selectedText && captureMethod === 'shortcut'
    ? extraction.selectedText
    : extraction.content;

  if (config.enableModelCleanup && config.modelApiKey && content) {
    content = await cleanContentWithModel(content, config);
  }

  return createPayload({
    type,
    content,
    sourceUrl: extraction.sourceUrl || tab.url,
    title: extraction.title || tab.title,
    siteName: extraction.siteName,
    capturedAt: extraction.capturedAt || new Date().toISOString(),
    selectedText: extraction.selectedText,
    captureMethod,
    useAiTags
  });
}

function createPayload(data) {
  const sourceUrl = data.sourceUrl || '';
  return {
    type: data.type || 'ai-text',
    content: data.content || '',
    source: sourceUrl,
    sourceUrl,
    title: data.title || '',
    siteName: data.siteName || '',
    capturedAt: data.capturedAt || new Date().toISOString(),
    selectedText: data.selectedText || '',
    captureMethod: data.captureMethod || 'popup',
    category: data.category || DEFAULT_CATEGORY,
    useAiTags: data.useAiTags !== false,
    tags: data.tags || null,
    imageDataList: data.imageDataList || []
  };
}

async function fetchImageAsBase64(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const base64Data = await blobToBase64(blob);
    const fileName = extractImageFileName(imageUrl, blob.type);

    return {
      base64Data: base64Data.split(',')[1],
      fileName
    };
  } catch (error) {
    throw createClassifiedError('image_fetch_failed', `当前图片无法抓取: ${error.message}`);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片转码失败'));
    reader.readAsDataURL(blob);
  });
}

function extractImageFileName(imageUrl, mimeType) {
  try {
    const url = new URL(imageUrl);
    const rawName = url.pathname.split('/').pop();
    if (rawName && rawName.includes('.')) {
      return rawName;
    }
  } catch (error) {
    console.log('解析图片文件名失败:', error);
  }

  const extension = mimeType?.split('/')[1] || 'png';
  return `clipped-image.${extension}`;
}

async function sendToBackend(data, sendResponse) {
  const result = await sendToBackendPromise(data);
  sendResponse(result);
}

async function sendToBackendPromise(data) {
  try {
    const config = await getConfigAsync();
    const apiUrl = config.apiUrl || 'http://localhost:8080/api/clip/add';
    const timeout = (config.apiTimeout || 30) * 1000;
    const maxRetries = config.apiRetryCount || 0;
    let retries = 0;
    let lastError = null;

    while (retries <= maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw createClassifiedError('http_error', `接口请求失败 (${response.status})`);
        }

        const result = await response.json();
        if (result.status === 'success') {
          showNotification('剪藏成功！', 'success');
          return { success: true };
        }

        return {
          success: false,
          errorType: 'api_error',
          error: result.message || '服务返回失败状态'
        };
      } catch (error) {
        lastError = normalizeTransportError(error);
        retries += 1;
        if (retries <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
    }

    showNotification(lastError.message, 'error');
    return {
      success: false,
      errorType: lastError.errorType || 'network_error',
      error: lastError.message
    };
  } catch (error) {
    const normalizedError = normalizeTransportError(error);
    showNotification(normalizedError.message, 'error');
    return {
      success: false,
      errorType: normalizedError.errorType,
      error: normalizedError.message
    };
  }
}

function normalizeTransportError(error) {
  if (error?.errorType) {
    return error;
  }

  if (error?.name === 'AbortError') {
    return createClassifiedError('timeout', '请求超时，请稍后重试');
  }

  if (error instanceof TypeError) {
    return createClassifiedError('service_unreachable', '无法连接后端服务，请确认服务已启动');
  }

  return createClassifiedError('network_error', error?.message || '发送到后端失败');
}

function createClassifiedError(errorType, message) {
  const error = new Error(message);
  error.errorType = errorType;
  return error;
}

function handleCaptureError(error, fallbackMessage) {
  const message = error?.message || fallbackMessage;
  console.error(fallbackMessage, error);
  showNotification(message, 'error');
}

async function ensureTab(tab) {
  if (tab?.id) {
    return tab;
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw createClassifiedError('tab_missing', '未找到可用标签页');
  }
  return activeTab;
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function openPopupWithData(data) {
  await chrome.storage.local.set({ pendingClip: data });
  await chrome.action.openPopup();
}

async function getConfig(sendResponse) {
  const config = await getConfigAsync();
  sendResponse({ config });
}

function getConfigAsync() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'uiTheme',
      'apiUrl',
      'apiTimeout',
      'apiRetryCount',
      'defaultType',
      'clipPageShortcut',
      'clipSelectionShortcut',
      'enableNotifications',
      'successNotification',
      'enableModelCleanup',
      'modelApiKey',
      'modelProvider',
      'modelName'
    ], (result) => {
      resolve({
        uiTheme: result.uiTheme || 'notion',
        apiUrl: result.apiUrl || 'http://localhost:8080/api/clip/add',
        apiTimeout: result.apiTimeout || 30,
        apiRetryCount: result.apiRetryCount || 2,
        defaultType: result.defaultType || 'ai-text',
        clipPageShortcut: result.clipPageShortcut || 'Ctrl+Shift+S',
        clipSelectionShortcut: result.clipSelectionShortcut || 'Ctrl+Shift+V',
        enableNotifications: result.enableNotifications !== false,
        successNotification: result.successNotification !== false,
        enableModelCleanup: result.enableModelCleanup || false,
        modelApiKey: result.modelApiKey || '',
        modelProvider: result.modelProvider || 'openai',
        modelName: result.modelName || 'gpt-3.5-turbo'
      });
    });
  });
}

async function saveConfig(data, sendResponse) {
  try {
    await chrome.storage.local.set(data);
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function showNotification(message, type = 'info') {
  const config = await getConfigAsync();
  const theme = config.uiTheme === 'regular' ? 'regular' : 'notion';
  const title = theme === 'notion' ? '剪藏收集箱' : '智能剪藏助手';
  const prefix = theme === 'notion' ? 'Collected' : type.toUpperCase();

  console.log(`[${prefix}] ${message}`);

  if (!config.enableNotifications) {
    return;
  }

  if (type === 'success' && !config.successNotification) {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body: message,
      icon: 'icons/icon-48.png'
    });
  }
}

async function cleanContentWithModel(content, config) {
  if (!config.enableModelCleanup || !config.modelApiKey) {
    return content;
  }

  try {
    showNotification('正在使用 AI 清理内容...', 'info');

    let apiUrl;
    let headers;
    let body;

    switch (config.modelProvider) {
      case 'openai':
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.modelApiKey}`
        };
        body = {
          model: config.modelName,
          messages: [
            {
              role: 'system',
              content: '你是一个内容清理助手，负责清理网页内容中的噪声，使内容更清晰、有条理。请保留主要内容，去除广告、导航、评论等无关内容。'
            },
            {
              role: 'user',
              content: `请清理以下内容，去除噪声，保留核心信息：\n\n${content}`
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        };
        break;
      case 'anthropic':
        apiUrl = 'https://api.anthropic.com/v1/messages';
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': config.modelApiKey,
          'anthropic-version': '2023-06-01'
        };
        body = {
          model: config.modelName,
          messages: [
            {
              role: 'user',
              content: `请清理以下内容，去除噪声，保留核心信息：\n\n${content}`
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        };
        break;
      case 'azure':
        apiUrl = config.modelApiKey;
        headers = {
          'Content-Type': 'application/json',
          'api-key': config.modelName
        };
        body = {
          messages: [
            {
              role: 'system',
              content: '你是一个内容清理助手，负责清理网页内容中的噪声，使内容更清晰、有条理。请保留主要内容，去除广告、导航、评论等无关内容。'
            },
            {
              role: 'user',
              content: `请清理以下内容，去除噪声，保留核心信息：\n\n${content}`
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        };
        break;
      default:
        return content;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const result = await response.json();
    const cleanedContent = config.modelProvider === 'anthropic'
      ? result.content[0].text
      : result.choices[0].message.content;

    showNotification('内容清理完成', 'success');
    return cleanedContent;
  } catch (error) {
    console.error('大模型清理失败:', error);
    showNotification('AI 清理失败，使用原始内容', 'warning');
    return content;
  }
}
