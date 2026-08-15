/* ===== Tools Hub 交互逻辑 ===== */
(function () {
  'use strict';

  // ── API base ──
  const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8081' : '';

  // ── Theme sync ──
  function applyTheme() {
    const theme = localStorage.getItem('app_appearance_v1') || 'notion';
    let isDark = theme === 'dark';
    if (theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : theme);
  }
  window.addEventListener('message', e => {
    if (e.data && e.data.action === 'themeChange') applyTheme();
  });
  applyTheme();

  // ── State ──
  const $ = id => document.getElementById(id);
  let tools = [];
  let activeCategory = '全部';
  let searchTerm = '';
  let currentPromptId = null;

  // ── Load tools ──
  async function loadTools() {
    $('loading').style.display = 'flex';
    $('grid').innerHTML = '';
    try {
      const res = await fetch(API_BASE + '/api/tools');
      const data = await res.json();
      tools = data.tools || [];
      renderChips();
      renderGrid();
    } catch (e) {
      $('loading').style.display = 'none';
      $('empty').style.display = 'block';
      $('empty').querySelector('h3').textContent = '无法连接后端';
      $('empty').querySelector('p').textContent = '请确认后端服务已启动';
    }
  }

  function renderChips() {
    const cats = ['全部'];
    tools.forEach(t => { if (t.category && !cats.includes(t.category)) cats.push(t.category); });
    const chips = $('chips');
    chips.innerHTML = '';
    cats.forEach(c => {
      const el = document.createElement('button');
      el.className = 'th-chip' + (c === activeCategory ? ' active' : '');
      el.textContent = c;
      el.addEventListener('click', () => { activeCategory = c; renderChips(); renderGrid(); });
      chips.appendChild(el);
    });
  }

  function filteredTools() {
    const term = searchTerm.trim().toLowerCase();
    return tools.filter(t => {
      if (activeCategory !== '全部' && t.category !== activeCategory) return false;
      if (!term) return true;
      const hay = [t.name, t.description, (t.keywords || []).join(' '), t.category].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }

  function renderGrid() {
    const list = filteredTools();
    const grid = $('grid');
    $('loading').style.display = 'none';
    grid.innerHTML = '';
    $('empty').style.display = list.length ? 'none' : 'block';
    list.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'th-card';
      card.style.animationDelay = (i * 0.03) + 's';
      card.innerHTML = `
        <div class="th-card-icon">${t.icon || '🧰'}</div>
        <div class="th-card-name">${escapeHtml(t.name)}</div>
        <div class="th-card-desc">${escapeHtml(t.description || '')}</div>
        <div class="th-card-footer">
          <span class="th-card-badge">${escapeHtml(t.category || '其他')}</span>
          <button class="th-card-menu" title="更多操作">⋮</button>
        </div>`;
      card.addEventListener('click', () => openTool(t));
      card.querySelector('.th-card-menu').addEventListener('click', ev => {
        ev.stopPropagation();
        openMenu(t, card);
      });
      grid.appendChild(card);
    });
  }

  // ── Open tool in overlay ──
  function openTool(t) {
    $('overlayTitle').textContent = (t.icon || '🧰') + ' ' + t.name;
    currentPromptId = t.id;
    const frame = $('toolFrame');
    frame.src = API_BASE + '/api/tools/' + t.id + '/page';
    $('overlay').classList.add('show');
  }
  $('overlayCloseBtn').addEventListener('click', () => { $('overlay').classList.remove('show'); $('toolFrame').src = ''; });

  // ── Card menu (prompt / delete) ──
  function openMenu(t, card) {
    currentPromptId = t.id;
    if (t.builtin) {
      viewPrompt(t.id);
      return;
    }
    const action = window.confirm('删除工具「' + t.name + '」？\n该操作不可恢复。');
    if (!action) return;
    deleteTool(t.id);
  }

  // ── Prompt modal ──
  async function viewPrompt(id) {
    try {
      const res = await fetch(API_BASE + '/api/tools/' + id + '/prompt');
      const data = await res.json();
      $('promptContent').textContent = data.prompt || '(无提示词)';
      currentPromptId = id;
      $('promptModal').style.display = 'flex';
    } catch (e) {
      alert('获取提示词失败: ' + e.message);
    }
  }
  $('viewPromptBtn').addEventListener('click', () => currentPromptId && viewPrompt(currentPromptId));
  $('promptClose').addEventListener('click', () => $('promptModal').style.display = 'none');
  $('copyPromptBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('promptContent').textContent).then(() => {
      $('copyPromptBtn').textContent = '已复制 ✓';
      setTimeout(() => $('copyPromptBtn').textContent = '复制提示词', 1500);
    });
  });

  // ── Delete tool ──
  async function deleteTool(id) {
    try {
      const res = await fetch(API_BASE + '/api/tools/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '删除失败'); return; }
      loadTools();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  // ── Import tool ──
  $('importToolBtn').addEventListener('click', () => { $('importModal').style.display = 'flex'; $('importMsg').textContent = ''; });
  $('importModalClose').addEventListener('click', () => $('importModal').style.display = 'none');

  let importFile = null;
  const fileZone = $('fileZone');
  fileZone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.onchange = () => { importFile = input.files[0]; $('fileName').textContent = importFile.name; };
    input.click();
  });
  fileZone.addEventListener('dragover', e => { e.preventDefault(); fileZone.classList.add('drag'); });
  fileZone.addEventListener('dragleave', () => fileZone.classList.remove('drag'));
  fileZone.addEventListener('drop', e => {
    e.preventDefault(); fileZone.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f && /\.html?$/i.test(f.name)) { importFile = f; $('fileName').textContent = f.name; }
  });

  $('importConfirmBtn').addEventListener('click', async () => {
    const name = $('importName').value.trim();
    if (!name) { $('importMsg').textContent = '请填写工具名称'; return; }
    if (!importFile) { $('importMsg').textContent = '请选择 HTML 文件'; return; }
    const fd = new FormData();
    fd.append('html', importFile);
    fd.append('name', name);
    fd.append('category', $('importCategory').value.trim());
    fd.append('description', $('importDesc').value.trim());
    fd.append('prompt', $('importPrompt').value.trim());
    const btn = $('importConfirmBtn');
    btn.disabled = true;
    btn.textContent = '导入中…';
    try {
      const res = await fetch(API_BASE + '/api/tools', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { $('importMsg').textContent = data.error || '导入失败'; return; }
      resetImportForm();
      $('importModal').style.display = 'none';
      loadTools();
    } catch (e) {
      $('importMsg').textContent = '导入失败: ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '导入';
    }
  });

  function resetImportForm() {
    $('importName').value = ''; $('importCategory').value = '';
    $('importDesc').value = ''; $('importPrompt').value = '';
    $('fileName').textContent = ''; importFile = null;
  }

  // ── Search ──
  $('searchInput').addEventListener('input', e => {
    searchTerm = e.target.value;
    $('searchClear').style.display = searchTerm ? 'block' : 'none';
    renderGrid();
  });
  $('searchClear').addEventListener('click', () => {
    $('searchInput').value = ''; searchTerm = ''; $('searchClear').style.display = 'none'; renderGrid();
  });

  // ── Click mask to close modal ──
  document.querySelectorAll('.th-modal-mask').forEach(mask => {
    mask.addEventListener('mousedown', e => { if (e.target === mask) mask.style.display = 'none'; });
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadTools();
})();