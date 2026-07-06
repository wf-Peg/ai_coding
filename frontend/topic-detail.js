const API_BASE = 'http://127.0.0.1:8080/api/topic';
let topicId = null;
let topicData = null;

// 从URL获取话题ID
function getTopicId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// 获取话题详情
async function fetchTopicDetail() {
  const container = document.getElementById('detailContainer');
  try {
    const response = await fetch(`${API_BASE}/${topicId}`);
    if (!response.ok) {
      container.innerHTML = '<div class="loading"><p>话题不存在</p></div>';
      return;
    }
    topicData = await response.json();
    renderDetail(topicData);
  } catch (error) {
    console.error('获取话题详情失败:', error);
    container.innerHTML = '<div class="loading"><p>加载失败，请检查网络连接</p></div>';
  }
}

// 渲染详情
function renderDetail(topic) {
  document.getElementById('navTitle').textContent = topic.title;

  const date = topic.createdAt
    ? new Date(topic.createdAt).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      })
    : '';

  const tagsHtml = (topic.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const categoryLabel = { work: '工作', study: '学习', life: '生活', tech: '技术', other: '其他' }[topic.category] || topic.category;

  // Markdown 渲染内容
  let contentHtml = '';
  if (topic.content) {
    if (typeof marked !== 'undefined') {
      contentHtml = marked.parse(topic.content);
    } else {
      contentHtml = `<pre>${escapeHtml(topic.content)}</pre>`;
    }
  } else {
    contentHtml = '<p>暂无内容</p>';
  }

  const container = document.getElementById('detailContainer');
  container.innerHTML = `
    <h1 class="topic-title">${escapeHtml(topic.title)}</h1>
    <div class="topic-meta">
      ${tagsHtml}
      ${categoryLabel ? `<span class="tag">${categoryLabel}</span>` : ''}
      <span class="date">${date}</span>
    </div>
    ${topic.summary ? `<div class="topic-summary">${escapeHtml(topic.summary)}</div>` : ''}

    <div class="section-title">AI对话内容</div>
    <div class="topic-content">${contentHtml}</div>
    ${topic.myThoughts ? `
    <div class="section-title" style="margin-top: 32px;">我的思考</div>
    <div class="topic-content thoughts-content">${typeof marked !== 'undefined' ? marked.parse(topic.myThoughts) : `<pre>${escapeHtml(topic.myThoughts)}</pre>`}</div>
    ` : ''}
  `;
}

// ===== 收藏/点赞功能已注释 =====
// async function toggleLike() { ... }
// function toggleCollect() { ... }
// function isLikedLocal() { ... }
// function setLikedLocal() { ... }
// function isCollectedLocal() { ... }
// function addToCollection() { ... }
// function removeFromCollection() { ... }

// 打开文件存储目录
async function openStorageFolder() {
  try {
    const response = await fetch(`${API_BASE}/storage-path/open`, { method: 'POST' });
    const result = await response.json();
    if (result.status === 'success') {
      showToast('已打开存储目录: ' + result.path);
    } else {
      showToast('打开失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('打开目录失败:', error);
    showToast('打开目录失败，请检查后端服务');
  }
}

// 导出全页截图
async function exportScreenshot() {
  const exportBtn = document.getElementById('exportPdfBtn');
  exportBtn.disabled = true;
  exportBtn.textContent = '⏳ 生成中...';

  try {
    if (typeof html2canvas === 'undefined') {
      showToast('截图库加载失败，请刷新页面');
      return;
    }

    const theme = document.documentElement.getAttribute('data-theme');
    const isDark = theme === 'dark';
    const bgColor = isDark ? '#1e1e1e' : '#f9fafb';

    const container = document.getElementById('detailContainer');
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: bgColor,
      logging: false
    });

    // 下载为 PNG 图片
    const link = document.createElement('a');
    const title = topicData ? topicData.title : '话题截图';
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('截图已导出');
  } catch (error) {
    console.error('截图失败:', error);
    showToast('截图失败，请稍后重试');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = '📸 导出截图';
  }
}

// 删除话题
async function deleteTopic() {
  showConfirm('确定要删除这个话题吗？', async () => {
    try {
      await fetch(`${API_BASE}/${topicId}`, { method: 'DELETE' });
      location.href = 'topic.html';
    } catch (error) {
      console.error('删除失败:', error);
      showToast('删除失败，请稍后重试');
    }
  });
}

// 工具函数
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="confirm-btn" id="confirmCancelBtn">取消</button>
        <button class="confirm-btn danger" id="confirmOkBtn">确定</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#confirmCancelBtn').addEventListener('click', close);
  overlay.querySelector('#confirmOkBtn').addEventListener('click', () => { close(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// ==================== 评论功能 ====================

/**
 * 加载评论列表
 */
async function loadComments() {
  const listEl = document.getElementById('commentsList');
  const countEl = document.getElementById('commentCount');
  if (!listEl || !countEl) return;
  try {
    const response = await fetch(`${API_BASE}/${topicId}/comments`);
    const comments = await response.json();
    countEl.textContent = comments.length;

    if (comments.length === 0) {
      listEl.innerHTML = '<div class="comment-empty">暂无评论，来说点什么吧</div>';
      return;
    }

    listEl.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.author || '匿名')}</span>
          <span class="comment-time">${formatTime(c.createdAt)}</span>
        </div>
        <div class="comment-body">${escapeHtml(c.content)}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('加载评论失败:', error);
    if (listEl) listEl.innerHTML = '<div class="comment-empty">加载评论失败</div>';
  }
}

/**
 * 提交评论
 */
async function submitComment() {
  const authorInput = document.getElementById('commentAuthor');
  const contentInput = document.getElementById('commentContent');
  const btn = document.getElementById('submitCommentBtn');

  const author = authorInput ? authorInput.value.trim() : '';
  const content = contentInput ? contentInput.value.trim() : '';

  if (!content) {
    showToast('请输入评论内容');
    return;
  }

  btn.disabled = true;
  btn.textContent = '发布中...';

  try {
    const response = await fetch(`${API_BASE}/${topicId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: author || '匿名', content })
    });
    if (response.ok) {
      if (contentInput) contentInput.value = '';
      await loadComments();
      showToast('评论发布成功');
    } else {
      const errorText = await response.text().catch(() => '');
      showToast('评论发布失败 (HTTP ' + response.status + ')' + (errorText ? ': ' + errorText : ''));
    }
  } catch (error) {
    console.error('发布评论失败:', error);
    showToast('发布失败: ' + (error.message || '请检查网络'));
  } finally {
    btn.disabled = false;
    btn.textContent = '发布评论';
  }
}

/**
 * 格式化时间（相对时间）
 */
function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  topicId = getTopicId();
  if (!topicId) {
    document.getElementById('detailContainer').innerHTML = '<div class="loading"><p>缺少话题ID</p></div>';
    return;
  }
  fetchTopicDetail();
  // 加载评论
  loadComments();

  document.getElementById('editBtn').addEventListener('click', () => {
    location.href = `topic-editor.html?id=${topicId}`;
  });

  document.getElementById('deleteBtn').addEventListener('click', deleteTopic);
  document.getElementById('openFolderBtn').addEventListener('click', openStorageFolder);
  document.getElementById('exportPdfBtn').addEventListener('click', exportScreenshot);

  // 绑定评论提交按钮
  const submitBtn = document.getElementById('submitCommentBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitComment);
  }
});

// ====== 接收主框架消息：滚动到顶部 / 刷新 / 主题切换 ======
window.addEventListener('message', (e) => {
  if (e.data.action === 'scrollToTop') {
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (e.data.action === 'refresh') {
    location.reload();
  } else if (e.data.action === 'themeChange') {
    if (typeof window.applyTheme === 'function') window.applyTheme();
  }
});