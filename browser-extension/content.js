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
  const pageContent = selectionOnly ? '' : await extractPageContent();
  const primaryContent = selectionOnly ? selection : (pageContent || selection);

  return {
    content: cleanContent(primaryContent),
    selectedText: selection,
    sourceUrl: window.location.href,
    title: document.title,
    siteName: extractSiteName(),
    capturedAt: new Date().toISOString()
  };
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
    chrome.runtime.sendMessage({ action: 'clipCurrentPage' });
  });

  document.body.appendChild(button);
}

chrome.storage.local.get(['enableFloatingButton'], (result) => {
  if (result.enableFloatingButton) {
    createFloatingButton();
  }
});
