// 内容脚本 - 在页面上下文中运行
console.log('智能剪藏助手: 内容脚本已加载');

// 监听来自背景脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    const content = extractPageContent();
    sendResponse(content);
  }
});

// 提取页面正文内容
async function extractPageContent() {
  let content = '';
  
  try {
    // 从配置中获取内容提取规则
    const result = await chrome.storage.local.get('contentSelectors');
    let contentSelectors = result.contentSelectors;
    
    // 如果没有配置，使用默认规则
    if (!contentSelectors || contentSelectors.length === 0) {
      contentSelectors = [
        'article',
        'main',
        '.content', '.article-content', '.post-content', '.entry-content',
        '#content', '.main-content', '.page-content', '.article-body',
        '.post-body', '.blog-content'
      ];
    }
    
    // 尝试使用配置的选择器提取内容
    for (const selector of contentSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        content = el.innerText;
        console.log(`智能剪藏助手: 使用选择器 ${selector} 提取内容`);
        break;
      }
    }
    
    // 方法4: 提取所有p标签
    if (!content) {
      const paragraphs = document.querySelectorAll('p');
      if (paragraphs.length > 5) {
        const texts = Array.from(paragraphs).map(p => p.innerText.trim());
        content = texts.filter(t => t.length > 20).join('\n\n');
        console.log('智能剪藏助手: 使用p标签提取内容');
      }
    }
    
    // 方法5: 回退到body文本（尽量避免）
    if (!content) {
      content = document.body.innerText;
      console.log('智能剪藏助手: 使用body标签提取内容');
    }
  } catch (error) {
    console.error('获取配置失败:', error);
    // 回退到默认提取方式
    const article = document.querySelector('article');
    if (article) {
      content = article.innerText;
    } else {
      const main = document.querySelector('main');
      if (main) {
        content = main.innerText;
      } else {
        content = document.body.innerText;
      }
    }
  }
  
  // 清理内容
  content = cleanContent(content);
  
  return {
    content: content,
    url: window.location.href,
    title: document.title,
    selection: window.getSelection().toString()
  };
}

// 清理内容
function cleanContent(content) {
  if (!content) return '';
  
  // 移除多余空白
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  return content;
}

// 创建页面悬浮按钮（可选功能）
function createFloatingButton() {
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
    // 发送消息给背景脚本
    chrome.runtime.sendMessage({ action: 'clipCurrentPage' });
  });
  
  document.body.appendChild(button);
}

// 检查是否启用悬浮按钮（通过配置）
chrome.storage.local.get(['enableFloatingButton'], (result) => {
  if (result.enableFloatingButton) {
    createFloatingButton();
  }
});
