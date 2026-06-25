const API_BASE = 'http://127.0.0.1:8080/api/topic';
let currentCategory = '';
let allTopics = [];
let pageSize = 12;
let currentIndex = 0;
let isLoading = false;

// 获取话题列表
async function fetchTopics(keyword) {
  const grid = document.getElementById('topicGrid');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';
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

    // 按创建时间倒序排列（最新在前）
    allTopics = topics.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (allTopics.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div style="font-size:3rem;margin-bottom:16px;">📭</div>
          <h3>暂无话题</h3>
          <p>点击右上角"新建话题"开始分享你的AI对话吧！</p>
        </div>`;
      return;
    }

    grid.innerHTML = '';
    loadMore();
  } catch (error) {
    console.error('获取话题列表失败:', error);
    grid.innerHTML = `
      <div class="empty-state">
        <h3>加载失败</h3>
        <p>请检查后端服务是否正常运行</p>
      </div>`;
  }
}

// 流式加载更多卡片
function loadMore() {
  if (isLoading || currentIndex >= allTopics.length) return;
  isLoading = true;

  const grid = document.getElementById('topicGrid');
  const batch = allTopics.slice(currentIndex, currentIndex + pageSize);
  currentIndex += pageSize;

  batch.forEach(t => {
    grid.insertAdjacentHTML('beforeend', createTopicCard(t));
  });

  isLoading = false;
}

// 创建话题卡片
function createTopicCard(topic) {
  const date = topic.createdAt ? new Date(topic.createdAt).toLocaleDateString('zh-CN', {
    month: '2-digit', day: '2-digit'
  }) : '';

  const tagsHtml = (topic.tags || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  const coverHtml = topic.coverImage
    ? `<img class="cover" src="${escapeHtml(topic.coverImage)}" alt="${escapeHtml(topic.title)}" loading="lazy" />`
    : `<div class="cover-placeholder">${getCategoryEmoji(topic.category)}</div>`;

  return `
    <div class="topic-card" onclick="location.href='topic-detail.html?id=${topic.id}'">
      ${coverHtml}
      <div class="body">
        <div class="title">${escapeHtml(topic.title)}</div>
        <div class="summary">${escapeHtml(topic.summary || '暂无摘要')}</div>
        <div class="footer">
          <div class="tags">${tagsHtml}</div>
          <div class="meta">
            <span>${date}</span>
          </div>
        </div>
      </div>
    </div>`;
}

// 分类emoji
function getCategoryEmoji(category) {
  const map = { work: '💼', study: '📚', life: '🏠', tech: '💻', other: '📌' };
  return map[category] || '📌';
}

// HTML转义
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  fetchTopics();

  // 新建话题
  document.getElementById('newTopicBtn').addEventListener('click', () => {
    location.href = 'topic-editor.html';
  });

  // 搜索
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    const keyword = searchInput.value.trim();
    fetchTopics(keyword || null);
  });

  // 分类筛选
  document.getElementById('filterBar').addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-tag')) {
      document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.category;
      fetchTopics(searchInput.value.trim() || null);
    }
  });

  // 无限滚动：IntersectionObserver 监听滚动到底部
  const sentinel = document.createElement('div');
  sentinel.id = 'scrollSentinel';
  sentinel.style.height = '1px';
  document.getElementById('topicGrid').appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !isLoading) {
      loadMore();
    }
  }, { rootMargin: '200px' });

  observer.observe(sentinel);
});