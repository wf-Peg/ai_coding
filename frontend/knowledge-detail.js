const API_BASE = 'http://127.0.0.1:8081/api/knowledge';
let knowledgeId = null;
let knowledgeData = null;

// 从URL获取知识ID
function getKnowledgeId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// 获取知识详情
async function fetchKnowledgeDetail() {
  const container = document.getElementById('detailContainer');
  try {
    const response = await fetch(`${API_BASE}/${knowledgeId}`);
    if (!response.ok) {
      container.innerHTML = '<div class="loading"><p>知识不存在</p></div>';
      return;
    }
    knowledgeData = await response.json();
    await renderDetail(knowledgeData);
    renderSourceClips(knowledgeData);
    renderLinkedKnowledge(knowledgeData);
    renderPlanBacklinks(knowledgeId);
  } catch (error) {
    console.error('获取知识详情失败:', error);
    container.innerHTML = '<div class="loading"><p>加载失败，请检查网络连接</p></div>';
  }
}

// 渲染详情
async function renderDetail(knowledge) {
  document.getElementById('navTitle').textContent = knowledge.title;

  const date = knowledge.createdAt
    ? new Date(knowledge.createdAt).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      })
    : '';

  const tagsHtml = (knowledge.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const categoryLabel = { work: '工作', study: '学习', life: '生活', tech: '技术', other: '其他' }[knowledge.category] || knowledge.category;

  // 构建标题→ID 映射表（用于 wikilink 渲染）
  const titleToIdMap = await buildTitleToIdMap(knowledge.linkedKnowledgeIds || []);

  // Markdown 渲染内容
  let contentHtml = '';
  if (knowledge.content) {
    if (typeof marked !== 'undefined') {
      const processed = processWikilinks(knowledge.content, titleToIdMap);
      contentHtml = marked.parse(processed);
    } else {
      contentHtml = `<pre>${escapeHtml(knowledge.content)}</pre>`;
    }
  } else {
    contentHtml = '<p>暂无内容</p>';
  }

  // 我的思考也做 wikilink 预处理
  let thoughtsHtml = '';
  if (knowledge.myThoughts) {
    if (typeof marked !== 'undefined') {
      const processed = processWikilinks(knowledge.myThoughts, titleToIdMap);
      thoughtsHtml = marked.parse(processed);
    } else {
      thoughtsHtml = `<pre>${escapeHtml(knowledge.myThoughts)}</pre>`;
    }
  }

  const container = document.getElementById('detailContainer');
  container.innerHTML = `
    <h1 class="topic-title">${escapeHtml(knowledge.title)}</h1>
    <div class="topic-meta">
      ${tagsHtml}
      ${categoryLabel ? `<span class="tag">${categoryLabel}</span>` : ''}
      <span class="date">${date}</span>
    </div>
    ${knowledge.summary ? `<div class="topic-summary">${escapeHtml(knowledge.summary)}</div>` : ''}

    <div class="section-title">知识内容</div>
    <div class="topic-content">${contentHtml}</div>
    ${knowledge.myThoughts ? `
    <div class="section-title" style="margin-top: 32px;">我的思考</div>
    <div class="topic-content thoughts-content">${thoughtsHtml}</div>
    ` : ''}
  `;
}

// 渲染来源剪藏
async function renderSourceClips(knowledge) {
  const section = document.getElementById('sourceClipsSection');
  const list = document.getElementById('sourceClipsList');
  if (!section || !list) return;

  const sourceClipIds = knowledge.sourceClipIds || [];
  if (sourceClipIds.length === 0) {
    section.style.display = 'none';
    return;
  }

  // 用 sourceRefs（来源元数据）优先，回退到逐个抓取剪藏
  const refMap = {};
  (knowledge.sourceRefs || []).forEach(r => { refMap[r.clipId] = r; });

  section.style.display = 'block';
  const clipItems = [];
  for (const id of sourceClipIds) {
    const ref = refMap[id];
    let item = {
      id,
      title: ref && ref.title ? ref.title : null,
      siteName: (ref && ref.siteName) || '',
      sourceUrl: (ref && ref.sourceUrl) || '',
      capturedAt: (ref && ref.capturedAt) || ''
    };
    try {
      const resp = await fetch(`http://127.0.0.1:8081/api/clip/${id}`);
      if (resp.ok) {
        const clip = await resp.json();
        item.title = clip.title || item.title || `剪藏 #${id}`;
        item.siteName = clip.siteName || item.siteName;
        item.sourceUrl = clip.sourceUrl || item.sourceUrl;
        item.capturedAt = clip.capturedAt || item.capturedAt;
        item.summary = clip.summary || '';
        item.content = clip.content || '';
      }
    } catch { /* keep fallback */ }
    item.title = item.title || `剪藏 #${id}`;
    clipItems.push(item);
  }

  list.innerHTML = clipItems.map(item => `
    <div class="clip-item" onclick="openClipPreview('${item.id}')">
      <div class="clip-item-title">
        📄 ${escapeHtml(item.title)}
        ${item.siteName ? `<span class="clip-item-site">${escapeHtml(item.siteName)}</span>` : ''}
      </div>
      ${item.summary ? `<span class="clip-item-summary">${escapeHtml(item.summary.substring(0, 60))}${item.summary.length > 60 ? '...' : ''}</span>` : ''}
    </div>
  `).join('');
}

// 被学习计划引用（反链）
async function renderPlanBacklinks(kid) {
  const section = document.getElementById('planBacklinksSection');
  const list = document.getElementById('planBacklinksList');
  if (!section || !list) return;
  try {
    const resp = await fetch(`http://127.0.0.1:8081/api/learning-plan/by-knowledge/${kid}`);
    if (!resp.ok) { section.style.display = 'none'; return; }
    const plans = await resp.json();
    if (!plans || plans.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    list.innerHTML = plans.map(p => `
      <div class="clip-item" onclick="openLearningPlan(${p.planId})">
        <div class="clip-item-title">
          📘 ${escapeHtml(p.planTitle)}
          <span class="clip-item-site">${(p.phases || []).map(ph => `阶段 ${ph.phaseNumber}`).join('、')}</span>
        </div>
        <span class="clip-item-summary">被 ${(p.phases || []).length} 个阶段引用</span>
      </div>
    `).join('');
  } catch (e) {
    section.style.display = 'none';
  }
}

function openLearningPlan(planId) {
  if (window.parent && window.parent.postMessage) {
    window.parent.postMessage({ type: 'navigateLearningPlan', planId: parseInt(planId) }, '*');
  }
}

// 来源剪藏内联预览弹窗
async function openClipPreview(clipId) {
  closeClipPreview();
  const overlay = document.createElement('div');
  overlay.className = 'clip-preview-overlay';
  overlay.id = 'clipPreviewOverlay';
  overlay.innerHTML = `
    <div class="clip-preview-modal">
      <div class="clip-preview-header">
        <h4 id="clipPreviewTitle">加载中...</h4>
        <button class="clip-preview-close" onclick="closeClipPreview()">✕</button>
      </div>
      <div class="clip-preview-meta" id="clipPreviewMeta"></div>
      <div class="clip-preview-body" id="clipPreviewBody"><div class="loading"><p>加载中...</p></div></div>
      <div class="clip-preview-footer">
        <button class="clip-preview-btn link" id="clipPreviewOpenSource" style="display:none;">打开原文</button>
        <button class="clip-preview-btn" onclick="openClipInEditor('${clipId}')">在编辑器中打开原文</button>
        <button class="clip-preview-btn primary" onclick="goToClipModule()">去剪藏模块</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeClipPreview(); });

  try {
    const resp = await fetch(`http://127.0.0.1:8081/api/clip/${clipId}`);
    let meta = '';
    let bodyHtml = '<div class="clip-preview-empty">无法加载剪藏内容</div>';
    let sourceUrl = '';
    if (resp.ok) {
      const clip = await resp.json();
      document.getElementById('clipPreviewTitle').textContent = clip.title || `剪藏 #${clipId}`;
      const site = clip.siteName ? escapeHtml(clip.siteName) : '';
      const cat = clip.category ? escapeHtml(clip.category) : '';
      const date = clip.capturedAt ? escapeHtml(clip.capturedAt) : '';
      meta = [site, cat, date].filter(Boolean).join(' · ');
      sourceUrl = clip.sourceUrl || '';
      const content = clip.content || clip.summary || '';
      if (content) {
        bodyHtml = `<pre class="clip-preview-content">${escapeHtml(content)}</pre>`;
      }
    }
    document.getElementById('clipPreviewMeta').textContent = meta;
    document.getElementById('clipPreviewBody').innerHTML = bodyHtml;
    const openSource = document.getElementById('clipPreviewOpenSource');
    if (sourceUrl) {
      openSource.style.display = 'inline-flex';
      openSource.onclick = () => { window.open(sourceUrl, '_blank'); };
    }
  } catch (error) {
    document.getElementById('clipPreviewTitle').textContent = `剪藏 #${clipId}`;
    document.getElementById('clipPreviewBody').innerHTML = '<div class="clip-preview-empty">加载失败</div>';
  }
}

function closeClipPreview() {
  const overlay = document.getElementById('clipPreviewOverlay');
  if (overlay) overlay.remove();
}

// 在编辑器模块中打开剪藏内容
function openClipInEditor(clipId) {
  closeClipPreview();
  // 发送消息给父框架，切换到编辑器并打开该剪藏
  window.parent.postMessage({ type: 'openClipInNewTab', clipId: parseInt(clipId) }, '*');
}

// 跳转到剪藏模块
function goToClipModule() {
  closeClipPreview();
  window.parent.postMessage({ type: 'navigateClip' }, '*');
}

// 在知识模块内跳转到指定知识详情
function navigateToKnowledge(id) {
  window.parent.postMessage({ type: 'navigateKnowledge', knowledgeId: parseInt(id) }, '*');
}

// 在知识模块内跳转到知识图谱
function navigateToKnowledgeGraph() {
  window.parent.postMessage({ type: 'navigateKnowledgeGraph' }, '*');
}

/**
 * 构建标题→ID 映射表
 * 从 linkedKnowledgeIds 获取每个关联知识的标题，建立映射
 */
async function buildTitleToIdMap(linkedIds) {
  const map = {};
  if (!linkedIds || linkedIds.length === 0) return map;

  await Promise.all(linkedIds.map(async (id) => {
    try {
      const resp = await fetch(`${API_BASE}/${id}`);
      if (resp.ok) {
        const k = await resp.json();
        map[k.title] = id;
      }
    } catch { /* ignore */ }
  }));

  return map;
}

/**
 * 将内容中的 [[知识标题]] 替换为 Obsidian 风格的可点击链接
 */
function processWikilinks(content, titleToIdMap) {
  if (!content || Object.keys(titleToIdMap).length === 0) return content || '';

  return content.replace(
    /\[\[([^\]]+)\]\]/g,
    (match, title) => {
      const id = titleToIdMap[title.trim()];
      if (id) {
        return `<a class="wikilink" href="javascript:void(0)" onclick="navigateToKnowledge(${id})" data-knowledge-id="${id}">${escapeHtml(title.trim())}</a>`;
      }
      return match; // 未匹配到的保留原文
    }
  );
}

// 渲染关联知识
async function renderLinkedKnowledge(knowledge) {
  const section = document.getElementById('linkedKnowledgeSection');
  const list = document.getElementById('linkedKnowledgeList');
  if (!section || !list) return;

  const linkedIds = knowledge.linkedKnowledgeIds || [];
  if (linkedIds.length === 0) {
    section.style.display = 'block';
    list.innerHTML = '<div class="section-empty">暂无关联知识<br><small>在知识内容中使用 <code>[[知识标题]]</code> 语法可创建双向链接</small></div>';
    return;
  }

  section.style.display = 'block';
  // 获取每个关联知识的标题
  const linkedItems = [];
  for (const id of linkedIds) {
    try {
      const resp = await fetch(`${API_BASE}/${id}`);
      if (resp.ok) {
        const k = await resp.json();
        linkedItems.push({ id, title: k.title || '未命名知识' });
      } else {
        linkedItems.push({ id, title: `知识 #${id}` });
      }
    } catch {
      linkedItems.push({ id, title: `知识 #${id}` });
    }
  }

  list.innerHTML = linkedItems.map(item => `
    <div class="link-item" onclick="navigateToKnowledge('${escapeHtml(String(item.id))}')">
      🔗 ${escapeHtml(item.title)}
    </div>
  `).join('');

  // 添加知识图谱入口
  const graphLink = document.createElement('div');
  graphLink.className = 'graph-link-row';
  graphLink.innerHTML = '<a href="javascript:void(0)" onclick="navigateToKnowledgeGraph()" style="color:var(--primary);font-size:0.85rem;text-decoration:none;">🕸️ 查看知识图谱</a>';
  list.appendChild(graphLink);
}

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
    const title = knowledgeData ? knowledgeData.title : '知识截图';
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

// 删除知识
async function deleteKnowledge() {
  showConfirm('确定要删除这条知识吗？', async () => {
    try {
      await fetch(`${API_BASE}/${knowledgeId}`, { method: 'DELETE' });
      location.href = 'knowledge.html';
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
  if (window.UI && UI.toast) {
    UI.toast(message, { type: 'info', duration: 2000 });
    return;
  }
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

// ==================== 讨论功能 ====================

/**
 * 加载讨论列表
 */
async function loadComments() {
  const listEl = document.getElementById('commentsList');
  const countEl = document.getElementById('commentCount');
  if (!listEl || !countEl) return;
  try {
    const response = await fetch(`${API_BASE}/${knowledgeId}/comments`);
    const comments = await response.json();
    countEl.textContent = comments.length;

    if (comments.length === 0) {
      listEl.innerHTML = '<div class="comment-empty">暂无讨论，来说点什么吧</div>';
      return;
    }

    listEl.innerHTML = comments.map(c => {
      const hasEdit = c.updatedAt != null;
      return `
      <div class="comment-item" data-comment-id="${c.id}">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.author || '匿名')}</span>
          <span class="comment-time">${formatTime(c.createdAt)}${hasEdit ? '<span class="edited-label">· 已编辑</span>' : ''}</span>
        </div>
        <div class="comment-body" id="commentBody_${c.id}">${escapeHtml(c.content)}</div>
        <div class="comment-actions">
          <button class="action-btn" onclick="editComment(${c.id})">编辑</button>
          <button class="action-btn danger" onclick="deleteComment(${c.id})">删除</button>
        </div>
      </div>
    `}).join('');
  } catch (error) {
    console.error('加载讨论失败:', error);
    if (listEl) listEl.innerHTML = '<div class="comment-empty">加载讨论失败</div>';
  }
}

/**
 * 提交讨论
 */
async function submitComment() {
  const authorInput = document.getElementById('commentAuthor');
  const contentInput = document.getElementById('commentContent');
  const btn = document.getElementById('submitCommentBtn');

  const author = authorInput ? authorInput.value.trim() : '';
  const content = contentInput ? contentInput.value.trim() : '';

  if (!content) {
    showToast('请输入讨论内容');
    return;
  }

  btn.disabled = true;
  btn.textContent = '发布中...';

  try {
    const response = await fetch(`${API_BASE}/${knowledgeId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: author || '匿名', content })
    });
    if (response.ok) {
      if (contentInput) contentInput.value = '';
      await loadComments();
      showToast('发布成功');
    } else {
      const errorText = await response.text().catch(() => '');
      showToast('发布失败 (HTTP ' + response.status + ')' + (errorText ? ': ' + errorText : ''));
    }
  } catch (error) {
    console.error('发布讨论失败:', error);
    showToast('发布失败: ' + (error.message || '请检查网络'));
  } finally {
    btn.disabled = false;
    btn.textContent = '发布讨论';
  }
}

/**
 * 编辑讨论 - 切换为内联编辑模式
 */
function editComment(commentId) {
  const bodyEl = document.getElementById(`commentBody_${commentId}`);
  const itemEl = bodyEl.closest('.comment-item');
  const currentContent = bodyEl.textContent;

  bodyEl.innerHTML = `
    <textarea class="comment-edit-textarea" id="editTextarea_${commentId}">${escapeHtml(currentContent)}</textarea>
    <div class="comment-edit-actions">
      <button class="save-btn" onclick="saveEdit(${commentId})">保存</button>
      <button class="cancel-btn" data-original="${escapeHtml(currentContent)}" onclick="cancelEdit(this, ${commentId})">取消</button>
    </div>
  `;

  const textarea = document.getElementById(`editTextarea_${commentId}`);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const actionsEl = itemEl.querySelector('.comment-actions');
  if (actionsEl) actionsEl.style.display = 'none';
}

/**
 * 保存编辑
 */
async function saveEdit(commentId) {
  const textarea = document.getElementById(`editTextarea_${commentId}`);
  const content = textarea.value.trim();

  if (!content) {
    showToast('讨论内容不能为空');
    return;
  }

  const bodyEl = document.getElementById(`commentBody_${commentId}`);
  bodyEl.innerHTML = '<span style="color:var(--text-muted)">保存中...</span>';

  try {
    const response = await fetch(`${API_BASE}/${knowledgeId}/comments/${commentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (response.ok) {
      await loadComments();
      showToast('已更新');
    } else {
      showToast('保存失败');
      bodyEl.textContent = content;
      const itemEl = bodyEl.closest('.comment-item');
      const actionsEl = itemEl.querySelector('.comment-actions');
      if (actionsEl) actionsEl.style.display = '';
    }
  } catch (error) {
    console.error('保存编辑失败:', error);
    showToast('保存失败: ' + (error.message || '请检查网络'));
    bodyEl.textContent = content;
    const itemEl = bodyEl.closest('.comment-item');
    const actionsEl = itemEl.querySelector('.comment-actions');
    if (actionsEl) actionsEl.style.display = '';
  }
}

/**
 * 取消编辑
 */
function cancelEdit(btnEl, commentId) {
  const bodyEl = document.getElementById(`commentBody_${commentId}`);
  const originalContent = btnEl.getAttribute('data-original');
  bodyEl.textContent = originalContent;

  const itemEl = bodyEl.closest('.comment-item');
  const actionsEl = itemEl.querySelector('.comment-actions');
  if (actionsEl) actionsEl.style.display = '';
}

/**
 * 删除讨论
 */
function deleteComment(commentId) {
  showConfirm('确定要删除这条讨论吗？', async () => {
    try {
      const response = await fetch(`${API_BASE}/${knowledgeId}/comments/${commentId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await loadComments();
        showToast('已删除');
      } else {
        showToast('删除失败');
      }
    } catch (error) {
      console.error('删除讨论失败:', error);
      showToast('删除失败: ' + (error.message || '请检查网络'));
    }
  });
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
  knowledgeId = getKnowledgeId();
  if (!knowledgeId) {
    document.getElementById('detailContainer').innerHTML = '<div class="loading"><p>缺少知识ID</p></div>';
    return;
  }
  fetchKnowledgeDetail();
  loadComments();

  document.getElementById('editBtn').addEventListener('click', () => {
    location.href = `knowledge-editor.html?id=${knowledgeId}`;
  });

  document.getElementById('deleteBtn').addEventListener('click', deleteKnowledge);
  document.getElementById('openFolderBtn').addEventListener('click', openStorageFolder);
  document.getElementById('exportPdfBtn').addEventListener('click', exportScreenshot);

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