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
    document.getElementById('categorySelect').value = topic.category || 'other';

    tags = topic.tags || [];
    renderTags();
  } catch (error) {
    console.error('加载话题失败:', error);
  }
}

// 加载剪藏列表
async function loadClips() {
  try {
    const response = await fetch(`${CLIP_API}/list`);
    const clips = await response.json();
    const select = document.getElementById('clipSelect');
    clips.forEach(clip => {
      const option = document.createElement('option');
      option.value = clip.id;
      option.textContent = clip.title || clip.summary || `剪藏 #${clip.id}`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('加载剪藏列表失败:', error);
  }
}

// 从剪藏导入（仅数据回显，不创建话题）
async function importFromClip() {
  const clipId = document.getElementById('clipSelect').value;
  if (!clipId) {
    showToast('请先选择一个剪藏');
    return;
  }

  try {
    // 直接从已加载的剪藏列表中获取数据，做数据回显
    const response = await fetch(`${CLIP_API}/list`);
    const clips = await response.json();
    const clip = clips.find(c => String(c.id) === String(clipId));
    if (!clip) {
      showToast('未找到该剪藏');
      return;
    }

    document.getElementById('titleInput').value = clip.title || clip.summary || `剪藏 #${clip.id}`;
    document.getElementById('summaryInput').value = clip.summary || '';
    document.getElementById('contentInput').value = clip.content || '';
    document.getElementById('categorySelect').value = clip.category || 'other';
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
    if (clipTitle) document.getElementById('titleInput').value = clipTitle;
    if (clipContent) document.getElementById('contentInput').value = clipContent;
  }

  loadClips();

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
  document.getElementById('publishBtn').addEventListener('click', () => saveTopic(true));

  // 保存草稿按钮 - 已注释，统一使用发布
  // document.getElementById('saveDraftBtn').addEventListener('click', () => saveTopic(false));

  // 导入按钮
  document.getElementById('importBtn').addEventListener('click', importFromClip);
});