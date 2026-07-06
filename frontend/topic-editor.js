const API_BASE = 'http://127.0.0.1:8080/api/topic';
const CLIP_API = 'http://127.0.0.1:8080/api/clip';
let editId = null;
let tags = [];

// 获取URL参数中的编辑ID
function getEditId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// 加载已有话题（编辑模式）
async function loadTopic(id) {
  try {
    const response = await fetch(`${API_BASE}/${id}`);
    if (!response.ok) return;
    const topic = await response.json();

    document.getElementById('pageTitle').textContent = '编辑话题';
    document.getElementById('titleInput').value = topic.title || '';
    document.getElementById('summaryInput').value = topic.summary || '';
    document.getElementById('contentInput').value = topic.content || '';
    document.getElementById('myThoughtsInput').value = topic.myThoughts || '';
    document.getElementById('categorySelect').value = topic.category || 'other';

    tags = topic.tags || [];
    renderTags();
  } catch (error) {
    console.error('加载话题失败:', error);
  }
}

let allClips = [];
let selectedClipId = null;

// 加载剪藏列表
async function loadClips() {
  try {
    const response = await fetch(`${CLIP_API}/list`);
    allClips = await response.json();
  } catch (error) {
    console.error('加载剪藏列表失败:', error);
  }
}

// 过滤并渲染剪藏选择列表
function filterClips(query) {
  const listEl = document.getElementById('clipSelectList');
  const q = query.trim().toLowerCase();
  const filtered = q ? allClips.filter(c => {
    const title = (c.title || c.summary || `剪藏 #${c.id}`).toLowerCase();
    const content = (c.content || '').toLowerCase();
    return title.includes(q) || content.includes(q);
  }) : allClips;

  if (filtered.length === 0) {
    listEl.style.display = 'none';
    return;
  }

  listEl.style.display = 'block';
  listEl.innerHTML = filtered.map(clip => {
    const title = clip.title || clip.summary || `剪藏 #${clip.id}`;
    const meta = clip.source ? `来源: ${clip.source}` : '';
    const cls = selectedClipId === String(clip.id) ? 'clip-option selected' : 'clip-option';
    return `<div class="${cls}" data-clip-id="${clip.id}">
      <div class="clip-option-title">${escapeHtml(title)}</div>
      ${meta ? `<div class="clip-option-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
  }).join('');

  // 绑定点击事件
  listEl.querySelectorAll('.clip-option').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedClipId = opt.dataset.clipId;
      document.getElementById('clipSearchInput').value = opt.querySelector('.clip-option-title').textContent;
      listEl.style.display = 'none';
      // 更新选中样式
      listEl.querySelectorAll('.clip-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

// 从剪藏导入（仅数据回显，不创建话题）
async function importFromClip() {
  if (!selectedClipId) {
    showToast('请先选择一个剪藏');
    return;
  }

  try {
    // 直接从已加载的剪藏列表中获取数据，做数据回显
    const clip = allClips.find(c => String(c.id) === String(selectedClipId));
    if (!clip) {
      showToast('未找到该剪藏');
      return;
    }

    document.getElementById('titleInput').value = clip.title || clip.summary || `剪藏 #${clip.id}`;
    document.getElementById('summaryInput').value = clip.summary || '';
    let content = clip.content || '';
    if (clip.analysis) {
      content += '\n\n---\n\n## AI 分析\n\n' + clip.analysis;
    }
    if (clip.divergentSummary) {
      content += '\n\n---\n\n## 发散性总结\n\n' + clip.divergentSummary;
    }
    document.getElementById('contentInput').value = content;
    document.getElementById('categorySelect').value = clip.category || 'other';
    const thoughts = clip.myThoughts || clip.divergentSummary || '';
    document.getElementById('myThoughtsInput').value = thoughts;
    tags = clip.tags || [];
    renderTags();
    showToast('已导入剪藏数据，请编辑后点击发布');
  } catch (error) {
    console.error('导入失败:', error);
    showToast('导入失败');
  }
}

// 渲染标签
function renderTags() {
  const container = document.getElementById('tagsContainer');
  container.innerHTML = tags.map((t, i) =>
    `<span class="tag-item">${escapeHtml(t)}<span class="remove" data-index="${i}">&times;</span></span>`
  ).join('');

  // 绑定移除事件
  container.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      tags.splice(index, 1);
      renderTags();
    });
  });
}

// 保存话题
async function saveTopic(published) {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();

  if (!title) { showToast('请输入标题'); return; }
  if (!content) { showToast('请输入AI对话内容'); return; }

  const data = {
    title: title,
    summary: document.getElementById('summaryInput').value.trim(),
    content: content,
    category: document.getElementById('categorySelect').value,
    tags: tags,
    myThoughts: document.getElementById('myThoughtsInput').value.trim(),
    published: published
  };

  try {
    let response;
    if (editId) {
      response = await fetch(`${API_BASE}/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } else {
      response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    if (response.ok) {
      const saved = await response.json();
      showToast(published ? '发布成功！' : '草稿已保存');
      setTimeout(() => location.href = 'topic.html', 800);
    } else {
      showToast('保存失败，请稍后重试');
    }
  } catch (error) {
    console.error('保存失败:', error);
    showToast('保存失败，请检查网络连接');
  }
}

// 显示提示
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  editId = getEditId();
  if (editId) {
    loadTopic(editId);
  }

  // 处理从浏览器扩展右键菜单"剪藏到话题"传入的参数
  const params = new URLSearchParams(window.location.search);
  if (params.get('fromClip') === '1') {
    const clipTitle = params.get('title');
    const clipContent = params.get('content');
    const clipSource = params.get('source');
    const clipMyThoughts = params.get('myThoughts');
    if (clipTitle) document.getElementById('titleInput').value = clipTitle;
    if (clipContent) document.getElementById('contentInput').value = clipContent;
    if (clipMyThoughts) document.getElementById('myThoughtsInput').value = clipMyThoughts;
  }

  loadClips();

  // 剪藏搜索输入
  const clipSearchInput = document.getElementById('clipSearchInput');
  clipSearchInput.addEventListener('input', () => {
    selectedClipId = null;
    filterClips(clipSearchInput.value);
  });
  clipSearchInput.addEventListener('focus', () => {
    if (allClips.length > 0) filterClips(clipSearchInput.value);
  });
  // 点击外部关闭下拉列表
  document.addEventListener('click', (e) => {
    const listEl = document.getElementById('clipSelectList');
    if (listEl && !e.target.closest('#clipSelectList') && !e.target.closest('#clipSearchInput')) {
      listEl.style.display = 'none';
    }
  });

  // 标签输入
  const tagInput = document.getElementById('tagInput');
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = tagInput.value.trim();
      if (value && !tags.includes(value)) {
        tags.push(value);
        renderTags();
        tagInput.value = '';
      }
    }
  });

  // 发布按钮
  document.getElementById('publishBtn').addEventListener('click', async () => {
    const btn = document.getElementById('publishBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '发布中...';
    try {
      await saveTopic(true);
    } finally {
      btn.disabled = false;
      btn.textContent = '发布';
    }
  });

  // 保存草稿按钮 - 已注释，统一使用发布
  // document.getElementById('saveDraftBtn').addEventListener('click', () => saveTopic(false));

  // 导入按钮
  document.getElementById('importBtn').addEventListener('click', importFromClip);
});