/* ===== Tools Hub 交互逻辑 ===== */
(function () {
  'use strict';

  // ── API base ──
  const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8081' : '';

  // ── Theme sync ──
  // 当前生效主题（notion | regular | dark），与主框架 data-theme 保持一致
  let currentTheme = 'notion';
  function resolveTheme(theme) {
    if (theme) return theme === 'dark' ? 'dark' : (theme === 'regular' ? 'regular' : 'notion');
    const appearance = localStorage.getItem('app_appearance_v1') || 'notion';
    if (appearance === 'dark') return 'dark';
    if (appearance === 'regular') return 'regular';
    if (appearance === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
    }
    return 'notion';
  }
  function applyTheme(theme) {
    currentTheme = resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    // 同步给正在运行的工具 iframe（工具内主题跟随全局）
    forwardThemeToTool();
  }
  // 将当前主题转发给工具运行 iframe；未加载完成时静默跳过（openTool 的 onload 会补发）
  function forwardThemeToTool() {
    try {
      const frame = document.getElementById('toolFrame');
      if (frame && frame.contentWindow && frame.src) {
        frame.contentWindow.postMessage({ action: 'themeChange', theme: currentTheme }, '*');
      }
    } catch (e) { /* 跨域或未加载，忽略 */ }
  }
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.action === 'themeChange') {
      applyTheme(d.theme);
    } else if (d.action === 'refresh' || (d.action === 'backendState' && d.state === 'ready')) {
      // 后端就绪广播（refresh / backendState:ready）：立即刷新工具列表，
      // 并重载正在运行的工具页面（依赖后端服务的工具恢复可用）
      onBackendReadyRefresh();
    }
  });
  applyTheme();

  // ── State ──
  const $ = id => document.getElementById(id);
  let tools = [];
  let activeCategory = '全部';
  let searchTerm = '';
  let currentPromptId = null;

  // ── 系统工具（Electron 主进程能力，不走后端注册表）──
  const SYSTEM_SCREENSHOT = {
    id: 'screenshot-system',
    name: '截图工具',
    icon: '📸',
    category: '系统工具',
    description: 'F1 全屏截图 · F2 贴图 · 离线 OCR，快捷键可在设置页修改',
    keywords: ['截图', '贴图', 'ocr', 'screenshot', 'screen'],
    builtin: true,
    system: true
  };
  const SYSTEM_TOOLS = [SYSTEM_SCREENSHOT];

  // ── Load tools ──
  async function loadTools() {
    $('loading').style.display = 'flex';
    $('grid').innerHTML = '';
    try {
      const res = await fetch(API_BASE + '/api/tools');
      const data = await res.json();
      tools = (data.tools || []).slice();
      // 前置系统工具卡片（截图等 Electron 能力）
      tools.unshift.apply(tools, SYSTEM_TOOLS);
      renderChips();
      renderGrid();
    } catch (e) {
      $('loading').style.display = 'none';
      $('empty').style.display = 'block';
      $('empty').querySelector('h3').textContent = '无法连接后端';
      $('empty').querySelector('p').textContent = '请确认后端服务已启动';
    }
  }

  // ── 后端就绪即时刷新（主框架广播 refresh / backendState:ready）──
  let lastReadyRefreshAt = 0;
  function onBackendReadyRefresh() {
    const now = Date.now();
    // 去重：主框架可能同时广播 refresh 与 backendState:ready，1 秒内只刷新一次
    if (now - lastReadyRefreshAt < 1000) return;
    lastReadyRefreshAt = now;
    loadTools();
    refreshOpenTool();
  }
  // 重载正在运行的工具页面，使其重新连接后端（依赖后端服务的工具有效）
  function refreshOpenTool() {
    const frame = document.getElementById('toolFrame');
    if (!frame || !frame.src) return;
    const url = frame.src;
    frame.onload = () => forwardThemeToTool();
    frame.src = '';
    frame.src = url;
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
      const disabled = t.system ? false : (t.enabled === false);
      card.className = 'th-card' + (disabled ? ' disabled' : '');
      card.style.animationDelay = (i * 0.03) + 's';
      card.innerHTML = `
        <div class="th-card-icon">${t.icon || '🧰'}</div>
        <div class="th-card-name">${escapeHtml(t.name)}</div>
        <div class="th-card-desc">${escapeHtml(t.description || '')}</div>
        <div class="th-card-footer">
          <span class="th-card-badge">${escapeHtml(t.category || '其他')}</span>
          <button class="th-card-menu" title="更多操作">⋮</button>
        </div>`;
      card.addEventListener('click', () => {
        if (disabled) { alert('该工具已禁用，可在卡片菜单中重新启用'); return; }
        openTool(t);
      });
      card.querySelector('.th-card-menu').addEventListener('click', ev => {
        ev.stopPropagation();
        openMenu(t, card);
      });
      grid.appendChild(card);
    });
  }

  // ── Open tool in overlay（系统工具走说明弹窗）──
  function openTool(t) {
    if (t.system) { openSystemTool(t); return; }
    $('overlayTitle').textContent = (t.icon || '🧰') + ' ' + t.name;
    currentPromptId = t.id;
    const frame = $('toolFrame');
    // 页面加载完成后补发当前主题，确保工具内主题跟随全局
    frame.onload = () => forwardThemeToTool();
    frame.src = API_BASE + '/api/tools/' + t.id + '/page';
    $('overlay').classList.add('show');
  }

  // 系统工具说明弹窗（截图工具：快捷键/OCR 状态/跳设置页）
  async function openSystemTool(t) {
    const api = (window.parent && window.parent.electronAPI) || window.electronAPI;
    let shot = 'F1', paste = 'F2', ocrText = 'OCR：查询中...';
    if (api && api.screenshotGetShortcuts) {
      try { const c = await api.screenshotGetShortcuts(); shot = c.screenshot || 'F1'; paste = c.paste || 'F2'; } catch (e) {}
    }
    if (api && api.screenshotOcrStatus) {
      try { const s = await api.screenshotOcrStatus(); ocrText = s.available ? '✅ 离线 OCR 可用' : ('⚠️ ' + (s.reason || 'OCR 未就绪')); } catch (e) {}
    }
    $('promptContent').innerHTML =
      '<div style="font-size:13px;line-height:1.9">' +
      '<p style="margin-bottom:8px"><b>📸 截图工具</b>（Snipaste 风格）</p>' +
      '<p>🖥 <b>' + escapeHtml(shot) + '</b> — 全屏选区截图，确认后复制 / 保存 / OCR / 贴图</p>' +
      '<p>📌 <b>' + escapeHtml(paste) + '</b> — 将剪贴板图片（或最近截图）置顶钉住，可拖动、双击关闭</p>' +
      '<p>🔤 ' + ocrText + '</p>' +
      '<p style="margin-top:8px;color:var(--app-text-secondary)">快捷键可在「设置 → 截图工具」中修改；OCR 模型见 electron/screenshot/download-ocr-models.ps1。</p>' +
      '</div>';
    currentPromptId = null;
    $('promptModal').style.display = 'flex';
    // 隐藏复制提示词按钮（系统工具无 prompt）
    const copyBtn = $('copyPromptBtn');
    if (copyBtn) copyBtn.style.display = 'none';
  }
  $('overlayCloseBtn').addEventListener('click', () => { $('overlay').classList.remove('show'); $('toolFrame').src = ''; });

  // ── Card menu (dropdown: prompt / enable-disable / delete) ──
  let menuEl = null;
  function openMenu(t, card) {
    closeMenu();
    const rect = card.querySelector('.th-card-menu').getBoundingClientRect();
    menuEl = document.createElement('div');
    menuEl.className = 'th-menu';
    menuEl.style.top = (rect.bottom + 6) + 'px';
    menuEl.style.right = (window.innerWidth - rect.right) + 'px';

    if (t.system) {
      // 系统工具：仅说明
      const item = document.createElement('button');
      item.className = 'th-menu-item';
      item.textContent = '📖 查看说明';
      item.addEventListener('click', () => { closeMenu(); openSystemTool(t); });
      menuEl.appendChild(item);
    } else {
      // 查看提示词
      const viewP = document.createElement('button');
      viewP.className = 'th-menu-item';
      viewP.textContent = '📋 查看提示词';
      viewP.addEventListener('click', () => { closeMenu(); viewPrompt(t.id); });
      menuEl.appendChild(viewP);

      // 禁用 / 启用（内置工具同样支持）
      const enabled = t.enabled !== false;
      const toggle = document.createElement('button');
      toggle.className = 'th-menu-item';
      toggle.textContent = enabled ? '⏸ 禁用' : '▶ 启用';
      toggle.addEventListener('click', () => { closeMenu(); toggleEnabled(t); });
      menuEl.appendChild(toggle);

      // 删除（仅非内置）
      if (!t.builtin) {
        const del = document.createElement('button');
        del.className = 'th-menu-item th-menu-item-danger';
        del.textContent = '🗑 删除';
        del.addEventListener('click', () => { closeMenu(); confirmDelete(t); });
        menuEl.appendChild(del);
      }
    }

    document.body.appendChild(menuEl);
    setTimeout(() => {
      document.addEventListener('mousedown', onMenuOutside, true);
    });
  }

  function onMenuOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) { closeMenu(); }
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('mousedown', onMenuOutside, true);
  }

  // ── Enable / Disable ──
  async function toggleEnabled(t) {
    const target = t.enabled === false;
    try {
      const res = await fetch(API_BASE + '/api/tools/' + t.id + '/enabled', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: target })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '操作失败'); return; }
      loadTools();
    } catch (e) {
      alert('操作失败: ' + e.message);
    }
  }

  // ── Confirm & delete（非内置）──
  function confirmDelete(t) {
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
      const copyBtn = $('copyPromptBtn');
      if (copyBtn) copyBtn.style.display = '';
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