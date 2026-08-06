const API_BASE = 'http://127.0.0.1:8081/api/knowledge';
let currentCategory = '';
let allTopics = [];
let pageSize = 12;
let currentIndex = 0;
let isLoading = false;

// 获取知识列表
async function fetchTopics(keyword) {
  const list = document.getElementById('topicList');
  list.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';
  allTopics = [];
  currentIndex = 0;

  try {
    let url = `${API_BASE}/list`;
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (currentCategory) params.set('category', currentCategory);
    if (params.toString()) url += '?' + params.toString();

    const response = await fetch(url);
    const topics = await response.json();

    allTopics = topics.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (allTopics.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div style="font-size:3rem;margin-bottom:16px;">&#128236;</div>
          <h3>暂无知识条目</h3>
          <p>点击右上角"新建知识"开始构建你的知识库吧！</p>
        </div>`;
      return;
    }

    list.innerHTML = '';
    loadMore();
  } catch (error) {
    console.error('获取知识列表失败:', error);
    list.innerHTML = `
      <div class="empty-state">
        <h3>加载失败</h3>
        <p>请检查后端服务是否正常运行</p>
      </div>`;
  }
}

// 流式加载更多
function loadMore() {
  if (isLoading || currentIndex >= allTopics.length) return;
  isLoading = true;

  const list = document.getElementById('topicList');
  const batch = allTopics.slice(currentIndex, currentIndex + pageSize);
  currentIndex += pageSize;

  batch.forEach(t => {
    list.insertAdjacentHTML('beforeend', createTopicItem(t));
  });

  isLoading = false;
}

// 创建知识列表项 — 纯文字，无封面
function createTopicItem(topic) {
  const date = topic.createdAt ? new Date(topic.createdAt).toLocaleDateString('zh-CN', {
    month: '2-digit', day: '2-digit'
  }) : '';

  const tagsHtml = (topic.tags || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  const sourceCount = topic.sourceCount || 0;
  const linkedCount = topic.linkedCount || 0;

  return `
    <div class="topic-item" onclick="location.href='knowledge-detail.html?id=${topic.id}'">
      <div class="item-row">
        <div class="title">${escapeHtml(topic.title)}</div>
        <div class="date">${date}</div>
      </div>
      <div class="summary">${escapeHtml(topic.summary || '暂无摘要')}</div>
      <div class="tags">${tagsHtml}</div>
      <div class="meta-row">
        <span class="meta-stat">📎 ${sourceCount} 来源</span>
        <span class="meta-stat">🔗 ${linkedCount} 关联</span>
      </div>
    </div>`;
}

// HTML转义
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 注入 meta-stat 样式
function injectMetaStyles() {
  if (document.getElementById('meta-stat-styles')) return;
  const style = document.createElement('style');
  style.id = 'meta-stat-styles';
  style.textContent = `
    .meta-row {
      display: flex;
      gap: 4px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .meta-stat {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-right: 12px;
    }
  `;
  document.head.appendChild(style);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  injectMetaStyles();
  fetchTopics();

  document.getElementById('newTopicBtn').addEventListener('click', () => {
    location.href = 'knowledge-editor.html';
  });

  document.getElementById('graphBtn').addEventListener('click', () => {
    location.href = 'knowledge-graph.html';
  });

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    const keyword = searchInput.value.trim();
    fetchTopics(keyword || null);
  });

  document.getElementById('filterBar').addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-tag')) {
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.category;
      fetchTopics(searchInput.value.trim() || null);
    }
  });

  // 无限滚动
  const sentinel = document.createElement('div');
  sentinel.id = 'scrollSentinel';
  sentinel.style.height = '1px';
  document.getElementById('topicList').appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoading) {
      loadMore();
    }
  }, { rootMargin: '200px' });

  observer.observe(sentinel);
});

// ====== 接收主框架消息：滚动到顶部 / 刷新 ======
window.addEventListener('message', (e) => {
  if (e.data.action === 'scrollToTop') {
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (e.data.action === 'refresh') {
    location.reload();
  } else if (e.data.action === 'themeChange') {
    if (typeof window.applyTheme === 'function') window.applyTheme();
  }
});