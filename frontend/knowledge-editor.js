const API_BASE = 'http://127.0.0.1:8081/api/knowledge';
const CLIP_API = 'http://127.0.0.1:8081/api/clip';
let editId = null;
let tags = [];
let sourceClips = []; // { id, title } - 关联来源剪藏

// 获取URL参数中的编辑ID
function getEditId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// 加载已有知识（编辑模式）
async function loadKnowledge(id) {
  try {
    const response = await fetch(`${API_BASE}/${id}`);
    if (!response.ok) return;
    const knowledge = await response.json();

    document.getElementById('pageTitle').textContent = '编辑知识';
    document.getElementById('titleInput').value = knowledge.title || '';
    document.getElementById('summaryInput').value = knowledge.summary || '';
    document.getElementById('contentInput').value = knowledge.content || '';
    document.getElementById('myThoughtsInput').value = knowledge.myThoughts || '';
    document.getElementById('categorySelect').value = knowledge.category || 'other';

    tags = knowledge.tags || [];
    renderTags();

    // 加载关联来源
    sourceClips = (knowledge.sourceClipIds || []).map(function(id) {
      return { id: String(id), title: '剪藏 #' + id };
    });
    // 尝试获取剪藏标题
    if (sourceClips.length > 0) {
      loadSourceClipTitles();
    } else {
      renderSourceChips();
    }
  } catch (error) {
    console.error('加载知识失败:', error);
  }
}

// 获取关联来源剪藏的标题
async function loadSourceClipTitles() {
  try {
    const response = await fetch(CLIP_API + '/list');
    if (!response.ok) { renderSourceChips(); return; }
    const clips = await response.json();
    const clipMap = {};
    clips.forEach(function(c) {
      clipMap[String(c.id)] = {
        title: c.title || c.summary || ('剪藏 #' + c.id),
        siteName: c.siteName || ''
      };
    });
    sourceClips.forEach(function(sc) {
      if (clipMap[sc.id]) {
        if (clipMap[sc.id].title) sc.title = clipMap[sc.id].title;
        if (clipMap[sc.id].siteName) sc.siteName = clipMap[sc.id].siteName;
      }
    });
    renderSourceChips();
  } catch (e) {
    renderSourceChips();
  }
}

let allClips = [];
let selectedClipId = null;

// 加载剪藏列表（导入用）
async function loadClips() {
  try {
    const response = await fetch(CLIP_API + '/list');
    allClips = await response.json();
  } catch (error) {
    console.error('加载剪藏列表失败:', error);
  }
}

// 过滤并渲染剪藏选择列表（导入用）
function filterClips(query) {
  const listEl = document.getElementById('clipSelectList');
  const q = query.trim().toLowerCase();
  const filtered = q ? allClips.filter(function(c) {
    const title = (c.title || c.summary || ('剪藏 #' + c.id)).toLowerCase();
    const content = (c.content || '').toLowerCase();
    return title.indexOf(q) !== -1 || content.indexOf(q) !== -1;
  }) : allClips;

  if (filtered.length === 0) {
    listEl.style.display = 'none';
    return;
  }

  listEl.style.display = 'block';
  listEl.innerHTML = filtered.map(function(clip) {
    const title = clip.title || clip.summary || ('剪藏 #' + clip.id);
    const meta = clip.source ? '来源: ' + clip.source : '';
    const cls = selectedClipId === String(clip.id) ? 'clip-option selected' : 'clip-option';
    return '<div class="' + cls + '" data-clip-id="' + clip.id + '">' +
      '<div class="clip-option-title">' + escapeHtml(title) + '</div>' +
      (meta ? '<div class="clip-option-meta">' + escapeHtml(meta) + '</div>' : '') +
    '</div>';
  }).join('');

  // 绑定点击事件
  listEl.querySelectorAll('.clip-option').forEach(function(opt) {
    opt.addEventListener('click', function() {
      selectedClipId = opt.dataset.clipId;
      document.getElementById('clipSearchInput').value = opt.querySelector('.clip-option-title').textContent;
      listEl.style.display = 'none';
      listEl.querySelectorAll('.clip-option').forEach(function(o) { o.classList.remove('selected'); });
      opt.classList.add('selected');
    });
  });
}

// 从剪藏导入（数据回显）
async function importFromClip() {
  if (!selectedClipId) {
    showToast('请先选择一个剪藏');
    return;
  }

  try {
    const clip = allClips.find(function(c) { return String(c.id) === String(selectedClipId); });
    if (!clip) {
      showToast('未找到该剪藏');
      return;
    }

    document.getElementById('titleInput').value = clip.title || clip.summary || ('剪藏 #' + clip.id);
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
  container.innerHTML = tags.map(function(t, i) {
    return '<span class="tag-item">' + escapeHtml(t) + '<span class="remove" data-index="' + i + '">&times;</span></span>';
  }).join('');

  container.querySelectorAll('.remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const index = parseInt(btn.dataset.index);
      tags.splice(index, 1);
      renderTags();
    });
  });
}

// ========== 关联来源管理 ==========

// 渲染关联来源 chips
function renderSourceChips() {
  const container = document.getElementById('sourceChipsContainer');
  container.innerHTML = sourceClips.map(function(sc, i) {
    const title = sc.title || ('剪藏 #' + sc.id);
    const site = sc.siteName ? '<span class="source-chip-site">' + escapeHtml(sc.siteName) + '</span>' : '';
    return '<span class="source-chip">' + escapeHtml(title) + site + '<span class="remove" data-index="' + i + '">&times;</span></span>';
  }).join('');

  container.querySelectorAll('.remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const index = parseInt(btn.dataset.index);
      sourceClips.splice(index, 1);
      renderSourceChips();
    });
  });
}

// 关联来源弹窗
let modalSearchResults = [];
let modalSelectedIds = {}; // 弹窗中的临时选中状态

function openSourceModal() {
  // 初始化弹窗选中状态为当前已选
  modalSelectedIds = {};
  sourceClips.forEach(function(sc) { modalSelectedIds[sc.id] = true; });
  document.getElementById('modalSearchInput').value = '';
  document.getElementById('sourceModal').classList.add('active');
  searchModalClips('');
}

function closeSourceModal() {
  document.getElementById('sourceModal').classList.remove('active');
}

function confirmSourceModal() {
  // 将弹窗选中状态同步到 sourceClips
  sourceClips = [];
  Object.keys(modalSelectedIds).forEach(function(id) {
    if (modalSelectedIds[id]) {
      const found = modalSearchResults.find(function(c) { return String(c.id) === id; });
      sourceClips.push({
        id: id,
        title: found ? (found.title || found.summary || ('剪藏 #' + found.id)) : ('剪藏 #' + id)
      });
    }
  });
  renderSourceChips();
  closeSourceModal();
}

async function searchModalClips(query) {
  try {
    const q = query.trim();
    let url = CLIP_API + '/list';
    if (q) url += '?keyword=' + encodeURIComponent(q);
    const response = await fetch(url);
    modalSearchResults = await response.json();
    renderModalResults();
  } catch (e) {
    console.error('搜索剪藏失败:', e);
  }
}

function renderModalResults() {
  const container = document.getElementById('modalResults');
  if (modalSearchResults.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">没有找到匹配的剪藏</div>';
    return;
  }

  container.innerHTML = modalSearchResults.map(function(clip) {
    const id = String(clip.id);
    const title = clip.title || clip.summary || ('剪藏 #' + clip.id);
    const meta = clip.source ? '来源: ' + clip.source : '';
    const isSelected = modalSelectedIds[id];
    const cls = isSelected ? 'modal-clip-item selected' : 'modal-clip-item';
    return '<div class="' + cls + '" data-clip-id="' + id + '">' +
      '<div class="check-icon">' + (isSelected ? '✓' : '') + '</div>' +
      '<div class="clip-info">' +
        '<div class="clip-info-title">' + escapeHtml(title) + '</div>' +
        (meta ? '<div class="clip-info-meta">' + escapeHtml(meta) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.modal-clip-item').forEach(function(item) {
    item.addEventListener('click', function() {
      const id = item.dataset.clipId;
      if (modalSelectedIds[id]) {
        delete modalSelectedIds[id];
      } else {
        modalSelectedIds[id] = true;
      }
      renderModalResults();
    });
  });
}

// ========== Wikilink [[ 自动补全 ==========

let allKnowledgeList = [];
let wikilinkActive = false;
let wikilinkStartIndex = -1;
let wikilinkSelectedIdx = -1;

async function fetchKnowledgeList() {
  try {
    const response = await fetch(API_BASE + '/list');
    allKnowledgeList = await response.json();
  } catch (e) {
    console.error('获取知识列表失败:', e);
    allKnowledgeList = [];
  }
}

function getCaretCoordinates(textarea) {
  // 获取光标在 textarea 中的像素位置
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseInt(style.lineHeight) || 20;
  const paddingLeft = parseInt(style.paddingLeft) || 14;
  const paddingTop = parseInt(style.paddingTop) || 10;

  const text = textarea.value.substring(0, textarea.selectionStart);
  const lines = text.split('\n');
  const currentLine = lines.length - 1;
  const currentCol = lines[currentLine].length;

  const scrollTop = textarea.scrollTop;
  const top = (currentLine * lineHeight) + paddingTop - scrollTop;
  const left = currentCol * 8 + paddingLeft; // 近似等宽字体字符宽度

  return { top: top, left: left };
}

function showWikilinkDropdown(textarea) {
  const coords = getCaretCoordinates(textarea);
  const dropdown = document.getElementById('wikilinkDropdown');
  const rect = textarea.getBoundingClientRect();

  dropdown.style.top = (rect.top + window.scrollY + coords.top + 20) + 'px';
  dropdown.style.left = (rect.left + window.scrollX + coords.left) + 'px';
  dropdown.classList.add('active');
  wikilinkActive = true;
  wikilinkSelectedIdx = -1;
}

function hideWikilinkDropdown() {
  const dropdown = document.getElementById('wikilinkDropdown');
  dropdown.classList.remove('active');
  wikilinkActive = false;
  wikilinkSelectedIdx = -1;
}

function filterWikilinkResults(query) {
  const dropdown = document.getElementById('wikilinkDropdown');
  const q = query.trim().toLowerCase();

  if (!q) {
    // 显示所有知识条目
    renderWikilinkItems(allKnowledgeList);
    return;
  }

  const filtered = allKnowledgeList.filter(function(k) {
    const title = (k.title || '').toLowerCase();
    return title.indexOf(q) !== -1;
  });
  renderWikilinkItems(filtered);
}

function renderWikilinkItems(items) {
  const dropdown = document.getElementById('wikilinkDropdown');
  if (items.length === 0) {
    dropdown.innerHTML = '<div class="wikilink-item" style="color: var(--text-muted); cursor: default;">无匹配结果</div>';
    return;
  }

  const displayItems = items.slice(0, 20);
  dropdown.innerHTML = displayItems.map(function(item, i) {
    const cls = i === wikilinkSelectedIdx ? 'wikilink-item active' : 'wikilink-item';
    const title = item.title || '未命名知识';
    const category = item.category ? item.category : '';
    return '<div class="' + cls + '" data-index="' + i + '" data-title="' + escapeHtml(title) + '">' +
      '<span class="wikilink-title">' + escapeHtml(title) + '</span>' +
      (category ? '<span class="wikilink-category">' + escapeHtml(category) + '</span>' : '') +
    '</div>';
  }).join('');

  // 绑定点击事件
  dropdown.querySelectorAll('.wikilink-item[data-index]').forEach(function(item) {
    item.addEventListener('mousedown', function(e) {
      e.preventDefault(); // 阻止 textarea 失焦
      insertWikilink(item.dataset.title);
    });
  });
}

function insertWikilink(title) {
  const textarea = document.getElementById('contentInput');
  const text = textarea.value;
  const before = text.substring(0, wikilinkStartIndex);
  const after = text.substring(textarea.selectionStart);
  textarea.value = before + '[[' + title + ']]' + after;
  hideWikilinkDropdown();
  textarea.focus();
  // 将光标移到插入内容之后
  const newPos = before.length + title.length + 4; // [[ + title + ]]
  textarea.setSelectionRange(newPos, newPos);
}

function handleWikilinkInput(textarea, e) {
  const text = textarea.value;
  const cursorPos = textarea.selectionStart;

  // 检查光标前是否刚输入了 [[
  if (cursorPos >= 2 && text.substring(cursorPos - 2, cursorPos) === '[[') {
    wikilinkStartIndex = cursorPos - 2;
    showWikilinkDropdown(textarea);
    filterWikilinkResults('');
    return;
  }

  // 如果下拉已打开，更新过滤
  if (wikilinkActive && wikilinkStartIndex >= 0) {
    const query = text.substring(wikilinkStartIndex + 2, cursorPos);
    // 如果用户输入了 ]] 或光标移到了 [[ 之前，关闭下拉
    if (query.indexOf(']]') !== -1 || cursorPos < wikilinkStartIndex + 2) {
      hideWikilinkDropdown();
      return;
    }
    filterWikilinkResults(query);
  }
}

function handleWikilinkKeydown(textarea, e) {
  if (!wikilinkActive) return;

  const dropdown = document.getElementById('wikilinkDropdown');
  const items = dropdown.querySelectorAll('.wikilink-item[data-index]');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    wikilinkSelectedIdx = Math.min(wikilinkSelectedIdx + 1, items.length - 1);
    updateWikilinkSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    wikilinkSelectedIdx = Math.max(wikilinkSelectedIdx - 1, 0);
    updateWikilinkSelection();
  } else if (e.key === 'Enter') {
    if (wikilinkSelectedIdx >= 0 && items.length > 0) {
      e.preventDefault();
      const selected = items[wikilinkSelectedIdx];
      if (selected) insertWikilink(selected.dataset.title);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideWikilinkDropdown();
  }
}

function updateWikilinkSelection() {
  const dropdown = document.getElementById('wikilinkDropdown');
  dropdown.querySelectorAll('.wikilink-item').forEach(function(item, i) {
    if (i === wikilinkSelectedIdx) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

// ========== 保存知识 ==========

async function saveKnowledge(published) {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();

  if (!title) { showToast('请输入标题'); return; }
  if (!content) { showToast('请输入AI对话内容'); return; }

  // 校验来源剪藏是否已关联到其他知识
  const conflicts = await findSourceConflicts();
  if (conflicts.length > 0) {
    const names = conflicts.map(function(c) {
      return '「' + c.clipTitle + '」已被 <b>' + escapeHtml(c.knowledgeTitle) + '</b> 关联';
    }).join('<br>');
    showConfirm(names + '<br><small style="opacity:0.7">继续保存会形成同一剪藏对应多条知识，是否仍要保存？</small>', async function() {
      await doSaveKnowledge(published, title, content);
    });
    return;
  }
  await doSaveKnowledge(published, title, content);
}

// 找出已被其他知识关联的来源剪藏
async function findSourceConflicts() {
  const conflicts = [];
  for (const sc of sourceClips) {
    try {
      const response = await fetch(API_BASE + '/by-clip/' + sc.id);
      if (!response.ok) continue;
      const knowledges = await response.json();
      const conflict = knowledges.find(function(k) { return String(k.id) !== String(editId); });
      if (conflict) {
        conflicts.push({ clipTitle: sc.title || ('剪藏 #' + sc.id), knowledgeTitle: conflict.title });
      }
    } catch (e) { /* ignore */ }
  }
  return conflicts;
}

async function doSaveKnowledge(published, title, content) {

  const data = {
    title: title,
    summary: document.getElementById('summaryInput').value.trim(),
    content: content,
    category: document.getElementById('categorySelect').value,
    tags: tags,
    sourceClipIds: sourceClips.map(function(sc) { return parseInt(sc.id); }),
    myThoughts: document.getElementById('myThoughtsInput').value.trim(),
    published: published
  };

  try {
    let response;
    if (editId) {
      response = await fetch(API_BASE + '/' + editId, {
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
      setTimeout(function() { location.href = 'knowledge.html'; }, 800);
    } else {
      showToast('保存失败，请稍后重试');
    }
  } catch (error) {
    console.error('保存失败:', error);
    showToast('保存失败，请检查网络连接');
  }
}

// 显示提示
function showToast(message, isError = false) {
  if (window.UI && UI.toast) {
    UI.toast(message, { type: isError ? 'error' : 'info', duration: isError ? 4000 : 2000 });
    return;
  }
  // 兜底（理论上不会触发：knowledge-editor.html 已加载 ui-common.js）
  const existing = document.querySelector('.ui-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'ui-toast ui-toast--' + (isError ? 'error' : 'info');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 3000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showConfirm(message, onConfirm) {
  let overlay = document.getElementById('confirmOverlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="confirm-btn" id="confirmCancelBtn">取消</button>
        <button class="confirm-btn danger" id="confirmOkBtn">继续保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  function close() { overlay.remove(); }
  overlay.querySelector('#confirmCancelBtn').addEventListener('click', close);
  overlay.querySelector('#confirmOkBtn').addEventListener('click', function() { close(); onConfirm(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', function() {
  editId = getEditId();
  if (editId) {
    loadKnowledge(editId);
  }

  // 处理从剪藏列表「合成知识条目」传入的 AI 合成内容
  var synthesizedData = sessionStorage.getItem('synthesizedKnowledge');
  if (synthesizedData) {
    try {
      var synthesized = JSON.parse(synthesizedData);
      if (synthesized.title) {
        document.getElementById('titleInput').value = synthesized.title;
      }
      if (synthesized.summary) {
        document.getElementById('summaryInput').value = synthesized.summary;
      }
      if (synthesized.content) {
        document.getElementById('contentInput').value = synthesized.content;
      }
      // 设置关联来源
      if (synthesized.sourceClipIds && synthesized.sourceClipIds.length > 0) {
        sourceClips = synthesized.sourceClipIds.map(function(id) {
          return { id: String(id), title: '剪藏 #' + id };
        });
        renderSourceChips();
        loadSourceClipTitles();
      }
      document.getElementById('pageTitle').textContent = '编辑合成知识';
      showToast('AI 已生成知识草稿，请检查并编辑后发布');
    } catch (e) {
      console.error('解析合成知识数据失败:', e);
    }
    sessionStorage.removeItem('synthesizedKnowledge');
  }

  // 处理从浏览器扩展右键菜单传入的参数
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
  fetchKnowledgeList();

  // 剪藏搜索输入（导入用）
  const clipSearchInput = document.getElementById('clipSearchInput');
  clipSearchInput.addEventListener('input', function() {
    selectedClipId = null;
    filterClips(clipSearchInput.value);
  });
  clipSearchInput.addEventListener('focus', function() {
    if (allClips.length > 0) filterClips(clipSearchInput.value);
  });
  document.addEventListener('click', function(e) {
    const listEl = document.getElementById('clipSelectList');
    if (listEl && !e.target.closest('#clipSelectList') && !e.target.closest('#clipSearchInput')) {
      listEl.style.display = 'none';
    }
  });

  // 标签输入
  const tagInput = document.getElementById('tagInput');
  tagInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = tagInput.value.trim();
      if (value && tags.indexOf(value) === -1) {
        tags.push(value);
        renderTags();
        tagInput.value = '';
      }
    }
  });

  // 关联来源弹窗
  document.getElementById('addSourceBtn').addEventListener('click', openSourceModal);
  document.getElementById('modalClose').addEventListener('click', closeSourceModal);
  document.getElementById('modalCancel').addEventListener('click', closeSourceModal);
  document.getElementById('modalConfirm').addEventListener('click', confirmSourceModal);
  document.getElementById('sourceModal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeSourceModal();
  });

  const modalSearchInput = document.getElementById('modalSearchInput');
  let modalSearchTimer;
  modalSearchInput.addEventListener('input', function() {
    clearTimeout(modalSearchTimer);
    modalSearchTimer = setTimeout(function() {
      searchModalClips(modalSearchInput.value);
    }, 300);
  });
  // 打开弹窗时立即搜索
  modalSearchInput.addEventListener('focus', function() {
    if (modalSearchResults.length === 0) {
      searchModalClips(modalSearchInput.value);
    }
  });

  // Wikilink 自动补全
  const contentInput = document.getElementById('contentInput');
  contentInput.addEventListener('input', function(e) {
    handleWikilinkInput(contentInput, e);
  });
  contentInput.addEventListener('keydown', function(e) {
    handleWikilinkKeydown(contentInput, e);
  });
  // 点击其他地方关闭 wikilink 下拉
  document.addEventListener('click', function(e) {
    if (wikilinkActive && !e.target.closest('#wikilinkDropdown') && e.target !== contentInput) {
      hideWikilinkDropdown();
    }
  });

  // 发布按钮
  document.getElementById('publishBtn').addEventListener('click', async function() {
    const btn = document.getElementById('publishBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '发布中...';
    try {
      await saveKnowledge(true);
    } finally {
      btn.disabled = false;
      btn.textContent = '发布';
    }
  });

  // 导入按钮
  document.getElementById('importBtn').addEventListener('click', importFromClip);
});