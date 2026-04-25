// 背景脚本：管理右键菜单和消息通信
chrome.runtime.onInstalled.addListener(() => {
  // 创建右键菜单
  createContextMenus();
  console.log('智能剪藏助手已安装');
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab);
});

// 监听命令快捷键
chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab);
});

// 监听来自content script和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'sendToBackend':
      sendToBackend(request.data, sendResponse);
      return true; // 保持消息通道开放
    case 'getConfig':
      getConfig(sendResponse);
      return true;
    case 'saveConfig':
      saveConfig(request.data, sendResponse);
      return true;
    default:
      sendResponse({ error: '未知操作' });
  }
});

// 创建右键菜单
function createContextMenus() {
  // 主菜单
  chrome.contextMenus.create({
    id: 'clip-main',
    title: '智能剪藏',
    contexts: ['page', 'selection', 'image']
  });

  // 剪藏整个页面
  chrome.contextMenus.create({
    id: 'clip-entire-page',
    parentId: 'clip-main',
    title: '剪藏整个页面',
    contexts: ['page']
  });

  // 剪藏选中内容
  chrome.contextMenus.create({
    id: 'clip-selection',
    parentId: 'clip-main',
    title: '剪藏选中内容',
    contexts: ['selection']
  });

  // 剪藏图片
  chrome.contextMenus.create({
    id: 'clip-image',
    parentId: 'clip-main',
    title: '剪藏图片',
    contexts: ['image']
  });

  // 分隔线
  chrome.contextMenus.create({
    id: 'clip-separator',
    parentId: 'clip-main',
    type: 'separator',
    contexts: ['page', 'selection', 'image']
  });

  // 快速剪藏选项
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

  // 打开选项页
  chrome.contextMenus.create({
    id: 'clip-settings',
    parentId: 'clip-main',
    title: '设置',
    contexts: ['page', 'selection', 'image']
  });
}

// 处理右键菜单点击
async function handleContextMenuClick(info, tab) {
  switch (info.menuItemId) {
    case 'clip-entire-page':
      clipPage(tab);
      break;
    case 'clip-selection':
      clipSelection(tab, info.selectionText);
      break;
    case 'clip-image':
      clipImage(tab, info.srcUrl);
      break;
    case 'clip-ai-text':
      clipWithType(tab, 'ai-text', info);
      break;
    case 'clip-store-only':
      clipWithType(tab, 'store-only', info);
      break;
    case 'clip-settings':
      openOptions();
      break;
  }
}

// 处理命令快捷键
async function handleCommand(command, tab) {
  switch (command) {
    case 'clip-page':
      clipPage(tab);
      break;
    case 'clip-selection':
      // 获取选中文本
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });
      if (result.result) {
        clipSelection(tab, result.result);
      } else {
        showNotification('请先选择要剪藏的内容', 'warning');
      }
      break;
  }
}

// 剪藏整个页面
async function clipPage(tab) {
  showNotification('正在解析页面内容...', 'info');
  
  try {
    // 注入content script提取内容
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });
    
    if (result.result) {
      const config = await getConfigAsync();
      
      // 使用大模型清理内容
      let cleanedContent = result.result.content;
      if (config.enableModelCleanup && config.modelApiKey) {
        cleanedContent = await cleanContentWithModel(cleanedContent, config);
      }
      
      const data = {
        type: 'ai-text',
        content: cleanedContent,
        source: tab.url,
        title: tab.title,
        useAiTags: true
      };
      
      // 打开popup确认编辑
      openPopupWithData(data);
    }
  } catch (error) {
    console.error('剪藏页面失败:', error);
    showNotification('剪藏失败，请重试', 'error');
  }
}

// 剪藏选中内容
async function clipSelection(tab, selectionText) {
  if (!selectionText) {
    showNotification('请先选择要剪藏的内容', 'warning');
    return;
  }
  
  const config = await getConfigAsync();
  
  // 使用大模型清理内容
  let cleanedContent = selectionText;
  if (config.enableModelCleanup && config.modelApiKey) {
    cleanedContent = await cleanContentWithModel(cleanedContent, config);
  }
  
  const data = {
    type: 'ai-text',
    content: cleanedContent,
    source: tab.url,
    title: tab.title,
    useAiTags: true
  };
  
  openPopupWithData(data);
}

// 剪藏图片
async function clipImage(tab, imageUrl) {
  showNotification('正在获取图片...', 'info');
  
  try {
    // 简单实现，实际需要下载图片并编码
    const data = {
      type: 'ai-text',
      content: `图片来源: ${imageUrl}`,
      source: tab.url,
      title: tab.title,
      useAiTags: true
    };
    
    openPopupWithData(data);
  } catch (error) {
    console.error('剪藏图片失败:', error);
    showNotification('剪藏图片失败', 'error');
  }
}

// 指定类型剪藏
async function clipWithType(tab, type, info) {
  let content = info.selectionText || '';
  
  if (!content) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });
    content = result.result?.content || '';
  }
  
  const data = {
    type: type,
    content: content,
    source: tab.url,
    title: tab.title,
    useAiTags: type !== 'store-only'
  };
  
  sendToBackendSilent(data);
}

// 提取页面内容（在页面上下文中执行）
function extractPageContent() {
  // 智能提取页面正文
  let content = '';
  
  // 优先使用article标签
  const article = document.querySelector('article');
  if (article) {
    content = article.innerText;
  }
  
  // 其次使用main标签
  if (!content) {
    const main = document.querySelector('main');
    if (main) {
      content = main.innerText;
    }
  }
  
  // 尝试常见的内容容器
  if (!content) {
    const contentSelectors = [
      '.content', '.article-content', '.post-content',
      '#content', '.main-content', '.entry-content'
    ];
    
    for (const selector of contentSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        content = el.innerText;
        break;
      }
    }
  }
  
  // 最后使用body文本
  if (!content) {
    content = document.body.innerText;
  }
  
  // 清理多余空白
  content = content.replace(/\s+/g, ' ').trim();
  
  return {
    content: content,
    url: window.location.href,
    title: document.title
  };
}

// 使用大模型清理内容
async function cleanContentWithModel(content, config) {
  if (!config.enableModelCleanup || !config.modelApiKey) {
    return content;
  }
  
  try {
    showNotification('正在使用AI清理内容...', 'info');
    
    let apiUrl, headers, body;
    
    // 根据模型提供商构建请求
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
        // Azure OpenAI 需要完整的API URL
        apiUrl = config.modelApiKey; // 假设API密钥中包含完整URL
        headers = {
          'Content-Type': 'application/json',
          'api-key': config.modelName // 假设模型名称中包含API密钥
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
      headers: headers,
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    const result = await response.json();
    
    let cleanedContent;
    if (config.modelProvider === 'openai') {
      cleanedContent = result.choices[0].message.content;
    } else if (config.modelProvider === 'anthropic') {
      cleanedContent = result.content[0].text;
    } else {
      cleanedContent = result.choices[0].message.content;
    }
    
    showNotification('内容清理完成', 'success');
    return cleanedContent;
  } catch (error) {
    console.error('大模型清理失败:', error);
    showNotification('AI清理失败，使用原始内容', 'warning');
    return content;
  }
}

// 发送到后端
async function sendToBackend(data, sendResponse) {
  try {
    const config = await getConfigAsync();
    const apiUrl = config.apiUrl || 'http://localhost:8080/api/clip/add';
    const timeout = config.apiTimeout * 1000; // 转换为毫秒
    const maxRetries = config.apiRetryCount;
    
    let retries = 0;
    let lastError;
    
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
        
        const result = await response.json();
        
        if (result.status === 'success') {
          showNotification('剪藏成功！', 'success');
          sendResponse({ success: true });
          return;
        } else {
          showNotification('剪藏失败: ' + (result.message || '未知错误'), 'error');
          sendResponse({ success: false, error: result.message });
          return;
        }
      } catch (error) {
        lastError = error;
        retries++;
        
        if (retries <= maxRetries) {
          console.log(`重试 ${retries}/${maxRetries}...`);
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
    }
    
    console.error('发送到后端失败 (已达最大重试次数):', lastError);
    showNotification('连接后端失败，请检查配置', 'error');
    sendResponse({ success: false, error: lastError.message });
  } catch (error) {
    console.error('发送到后端失败:', error);
    showNotification('连接后端失败，请检查配置', 'error');
    sendResponse({ success: false, error: error.message });
  }
}

// 静默发送（不等待响应）
async function sendToBackendSilent(data) {
  showNotification('正在发送到后端...', 'info');
  sendToBackend(data, () => {});
}

// 打开选项页
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// 打开popup并预填充数据
async function openPopupWithData(data) {
  // 先保存数据到storage
  await chrome.storage.local.set({ pendingClip: data });
  
  // 打开popup
  chrome.action.openPopup();
}

// 获取配置
async function getConfig(sendResponse) {
  const config = await getConfigAsync();
  sendResponse({ config });
}

// 异步获取配置
function getConfigAsync() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiUrl', 'apiTimeout', 'apiRetryCount', 'defaultType', 'clipPageShortcut', 'clipSelectionShortcut', 'enableModelCleanup', 'modelApiKey', 'modelProvider', 'modelName'], (result) => {
      resolve({
        apiUrl: result.apiUrl || 'http://localhost:8080/api/clip/add',
        apiTimeout: result.apiTimeout || 30,
        apiRetryCount: result.apiRetryCount || 2,
        defaultType: result.defaultType || 'ai-text',
        clipPageShortcut: result.clipPageShortcut || 'Ctrl+Shift+S',
        clipSelectionShortcut: result.clipSelectionShortcut || 'Ctrl+Shift+D',
        enableModelCleanup: result.enableModelCleanup || false,
        modelApiKey: result.modelApiKey || '',
        modelProvider: result.modelProvider || 'openai',
        modelName: result.modelName || 'gpt-3.5-turbo'
      });
    });
  });
}

// 保存配置
async function saveConfig(data, sendResponse) {
  try {
    await chrome.storage.local.set(data);
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// 显示通知
function showNotification(message, type = 'info') {
  // 使用简单的console.log，实际可以使用chrome.notifications
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // 尝试使用浏览器通知
  if (Notification.permission === 'granted') {
    new Notification('智能剪藏助手', {
      body: message,
      icon: 'icons/icon-48.png'
    });
  }
}

// 请求通知权限
chrome.runtime.onInstalled.addListener(() => {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
});
