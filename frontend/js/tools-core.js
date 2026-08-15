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
    description: '截图 / 贴图 / 离线 OCR，快捷键可在设置页修改',
    keywords: ['截图', '贴图', 'ocr', 'screenshot', 'screen'],
    builtin: true,
    system: true
  };
  const SYSTEM_TOOLS = [SYSTEM_SCREENSHOT];

  // ── 主题化提示/确认（替代原生 alert/confirm，贴合全局主题、无 clip-demo 标题栏） ──
  let toastTimer = null;
  function showToast(msg, ms) {
    const el = document.getElementById('thToast');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms || 3500);
  }
  let confirmCb = null;
  function confirmAction(msg, onOk) {
    const mask = document.getElementById('thConfirmMask');
    if (!mask) { if (window.confirm(msg) && onOk) onOk(); return; }
    document.getElementById('thConfirmText').textContent = msg;
    mask.style.display = 'flex';
    confirmCb = onOk;
  }
  function hideConfirm() {
    const mask = document.getElementById('thConfirmMask');
    if (mask) mask.style.display = 'none';
    confirmCb = null;
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'thConfirmOk') { const cb = confirmCb; hideConfirm(); if (cb) cb(); }
      else if (e.target && e.target.id === 'thConfirmCancel') hideConfirm();
      else if (e.target && e.target.id === 'thConfirmMask') hideConfirm();
    });
  }

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

  function renderGrid(opts) {
    opts = opts || {};
    const list = filteredTools();
    const grid = $('grid');
    $('loading').style.display = 'none';
    grid.innerHTML = '';
    $('empty').style.display = list.length ? 'none' : 'block';
    list.forEach((t, i) => {
      const card = document.createElement('div');
      const disabled = t.system ? false : (t.enabled === false);
      card.className = 'th-card' + (disabled ? ' disabled' : '') + (t.system ? '' : ' th-drg');
      card.dataset.id = t.id;
      if (opts.animate === false) {
        card.style.animation = 'none';
      } else {
        card.style.animationDelay = (i * 0.03) + 's';
      }
      card.innerHTML = `
        <div class="th-card-icon">${t.icon || '🧰'}</div>
        <div class="th-card-name">${escapeHtml(t.name)}</div>
        <div class="th-card-desc">${escapeHtml(t.description || '')}</div>
        <div class="th-card-footer">
          <span class="th-card-badge">${escapeHtml(t.category || '其他')}</span>
          <div class="th-card-actions">
            <span class="th-drag-handle" title="拖拽排序">⠿</span>
            <button class="th-card-menu" title="更多操作">⋮</button>
          </div>
        </div>`;
      if (!t.system) card.draggable = true;
      card.addEventListener('click', () => {
        if (disabled) { showToast('该工具已禁用，可在卡片菜单中重新启用'); return; }
        openTool(t);
      });
      card.querySelector('.th-card-menu').addEventListener('click', ev => {
        ev.stopPropagation();
        openMenu(t, card);
      });
      grid.appendChild(card);
    });
  }

  // ── 拖拽排序（HTML5 原生 DnD + FLIP 平滑重排动画）──
  let dragState = null; // { el, id, persisted }

  function dragCards() {
    return [...$('grid').querySelectorAll('.th-card.th-drg')];
  }

  function initDragSort() {
    const grid = $('grid');

    grid.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.th-card.th-drg');
      if (!card) { e.preventDefault(); return; }
      dragState = { el: card, id: card.dataset.id, persisted: false };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
      // 自定义幽灵图：卡片放大 + 微旋转 + 浮起阴影
      const ghost = card.cloneNode(true);
      ghost.style.cssText =
        'position:absolute;top:-9999px;left:-9999px;width:' + card.offsetWidth + 'px;' +
        'opacity:.92;pointer-events:none;transform:rotate(2deg) scale(1.04);' +
        'box-shadow:0 18px 40px rgba(15,23,42,.25);border-radius:12px;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, card.offsetWidth / 2, 24);
      setTimeout(() => document.body.removeChild(ghost), 0);
      grid.classList.add('th-grid-dragging');
      requestAnimationFrame(() => card.classList.add('th-dragging'));
    });

    grid.addEventListener('dragover', (e) => {
      if (!dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const over = e.target.closest('.th-card.th-drg');
      if (!over || over === dragState.el) return;
      const rect = over.getBoundingClientRect();
      const placeAfter = e.clientY > rect.top + rect.height / 2;
      reorderLive(over, placeAfter);
    });

    grid.addEventListener('drop', (e) => { e.preventDefault(); finishDrag(true); });
    grid.addEventListener('dragend', (e) => { e.preventDefault(); finishDrag(true); });
  }

  // FLIP：把被拖卡片插到目标卡片前/后，其余卡片平滑让位
  function reorderLive(over, placeAfter) {
    const el = dragState.el;
    const cards = dragCards();
    if (placeAfter) {
      if (over.nextSibling === el) return;
      over.after(el);
    } else {
      if (over.previousSibling === el) return;
      over.before(el);
    }
    // FLIP：记录移动前位置
    cards.forEach(c => { c.style.transition = 'none'; c.style.transform = ''; });
    const first = new Map();
    cards.forEach(c => first.set(c, c.getBoundingClientRect()));
    requestAnimationFrame(() => {
      cards.forEach(c => {
        const b = c.getBoundingClientRect();
        const a = first.get(c);
        const dx = a.left - b.left, dy = a.top - b.top;
        if (dx || dy) c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      });
      requestAnimationFrame(() => {
        cards.forEach(c => {
          c.style.transition = 'transform .32s var(--app-ease-out-expo, cubic-bezier(.16,1,.3,1))';
          c.style.transform = '';
        });
      });
    });
  }

  function finishDrag(persist) {
    const grid = $('grid');
    grid.classList.remove('th-grid-dragging');
    if (!dragState) return;
    const el = dragState.el;
    if (el) {
      el.classList.remove('th-dragging');
      el.style.transition = '';
      el.style.transform = '';
    }
    if (persist && !dragState.persisted) {
      dragState.persisted = true;
      persistOrder();
    }
    dragState = null;
  }

  // 读取 DOM 新顺序 → 同步 tools 数组 → 提交后端持久化 → 无动画重渲染
  function persistOrder() {
    const ids = dragCards().map(c => c.dataset.id);
    const system = tools.filter(t => t.system);
    const rest = tools.filter(t => !t.system);
    // 按 DOM 顺序重排可见的工具；被筛选隐藏的按原相对顺序追加到末尾
    const ordered = ids.map(id => rest.find(t => t.id === id)).filter(Boolean);
    const shown = new Set(ordered.map(t => t.id));
    rest.forEach(t => { if (!shown.has(t.id)) ordered.push(t); });
    tools = [...system, ...ordered];
    fetch(API_BASE + '/api/tools/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ordered.map(t => t.id) })
    }).then(r => r.json()).then(d => {
      if (!d || d.ok !== true) showToast('排序保存失败', 3000);
    }).catch(() => showToast('排序保存失败', 3000));
    renderGrid({ animate: false });
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

  // ── Close tool overlay（返回工具列表）──
  function closeOverlay() {
    $('overlay').classList.remove('show');
    const frame = $('toolFrame');
    frame.src = '';
    currentPromptId = null;
  }

  // 系统工具配置面板（截图工具：快捷键/OCR 下载/高级开关，可交互）
  let recordingSysKey = null; // 'shot' | 'paste' | null

  async function openSystemTool(t) {
    const api = (window.parent && window.parent.electronAPI) || window.electronAPI;
    let shot = 'F1', paste = 'F2', hideMain = true, ocrText = '查询中...';
    if (api && api.screenshotGetShortcuts) {
      try {
        const cfg = await api.screenshotGetShortcuts();
        shot = cfg.screenshot || 'F1'; paste = cfg.paste || 'F2';
        hideMain = cfg.hideMain !== false;
      } catch (e) {}
    }
    if (api && api.screenshotOcrStatus) {
      try {
        const s = await api.screenshotOcrStatus();
        ocrText = s.available ? '✅ 离线 OCR 可用' : ('⚠️ ' + (s.reason || 'OCR 未就绪'));
      } catch (e) { ocrText = '⚠️ 查询 OCR 状态失败'; }
    }
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    $('promptContent').innerHTML =
      '<div style="font-size:13px;line-height:2">' +
      '<p style="margin-bottom:6px"><b>📸 截图工具</b> 配置（Snipaste 风格，即时生效）</p>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:4px 0">' +
        '<span style="width:96px">截图快捷键</span>' +
        '<input id="sysShotKey" type="text" readonly value="' + esc(shot) + '" ' +
          'style="width:140px;text-align:center;padding:5px 8px;border:1px solid var(--app-border);border-radius:6px;background:var(--app-surface);color:var(--app-text);cursor:pointer">' +
        '<span style="color:var(--app-text-muted);font-size:11px">全屏选区</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:4px 0">' +
        '<span style="width:96px">贴图快捷键</span>' +
        '<input id="sysPasteKey" type="text" readonly value="' + esc(paste) + '" ' +
          'style="width:140px;text-align:center;padding:5px 8px;border:1px solid var(--app-border);border-radius:6px;background:var(--app-surface);color:var(--app-text);cursor:pointer">' +
        '<span style="color:var(--app-text-muted);font-size:11px">置顶贴图</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:4px 0">' +
        '<span style="width:96px">收起主窗口</span>' +
        '<input id="sysHideMain" type="checkbox" ' + (hideMain ? 'checked' : '') + '>' +
        '<span style="color:var(--app-text-muted);font-size:11px">截图时自动收起应用窗口</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:4px 0">' +
        '<span style="width:96px">OCR 组件</span>' +
        '<span id="sysOcrStatus" style="font-size:12px">' + ocrText + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap">' +
        '<button id="sysSave" style="background:#3f8cff;color:#fff;border:none;border-radius:6px;padding:7px 18px;cursor:pointer;font-size:12.5px">保存配置</button>' +
        '<button id="sysInstall" style="background:#22c55e;color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12.5px">⚡ 一键安装 OCR</button>' +
        '<button id="sysOcrDir" style="background:transparent;color:var(--app-text);border:1px solid var(--app-border);border-radius:6px;padding:7px 12px;cursor:pointer;font-size:12.5px">打开模型目录</button>' +
        '<button id="sysCopyCmd" style="background:transparent;color:var(--app-text);border:1px solid var(--app-border);border-radius:6px;padding:7px 12px;cursor:pointer;font-size:12.5px">复制安装命令</button>' +
      '</div>' +
      '<div id="sysOcrMsg" style="margin-top:6px;font-size:12px;color:var(--app-text-secondary)"></div>' +
      '<p style="color:var(--app-text-muted);font-size:11px;margin-top:6px">标注 / GIF 录制 / 长截图将在后续版本提供。</p>' +
      '</div>';

    // 快捷键录制：点击输入框进入录制，window keydown 捕获
    document.getElementById('sysShotKey').addEventListener('click', function () { window.__recordSysKey('shot'); });
    document.getElementById('sysPasteKey').addEventListener('click', function () { window.__recordSysKey('paste'); });
    window.__recordSysKey = function (which) {
      recordingSysKey = which;
      const input = document.getElementById(which === 'paste' ? 'sysPasteKey' : 'sysShotKey');
      if (!input) return;
      input.value = '按下快捷键...';
      input.style.borderColor = '#3f8cff';
    };
    const keyHandler = function (e) {
      if (!recordingSysKey) return;
      e.preventDefault(); e.stopPropagation();
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const key = e.key;
      if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'Escape') return;
      // 功能键（F1-F12 等）直接保存；普通键必须配合修饰键，避免裸字母全局拦截
      const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key) || ['PrintScreen', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'Tab', 'CapsLock'].indexOf(key) >= 0;
      if (!isFunctionKey && parts.length === 0) {
        showToast('请同时按 Ctrl / Alt / Shift + 键，或直接按 F1-F12 功能键');
        return;
      }
      parts.push(key.length === 1 ? key.toUpperCase() : key);
      const input = document.getElementById(recordingSysKey === 'paste' ? 'sysPasteKey' : 'sysShotKey');
      if (input) { input.value = parts.join('+'); input.style.borderColor = ''; }
      recordingSysKey = null;
    };
    window.__sysKeyHandler = keyHandler;
    window.addEventListener('keydown', keyHandler);

    document.getElementById('sysSave').addEventListener('click', async function () {
      const payload = {
        screenshot: (document.getElementById('sysShotKey').value.trim() || 'F1'),
        paste: (document.getElementById('sysPasteKey').value.trim() || 'F2'),
        hideMain: document.getElementById('sysHideMain').checked
      };
      try {
        if (api && api.screenshotSetShortcuts) await api.screenshotSetShortcuts(payload);
        const st = document.createElement('span');
        st.textContent = '✅ 已保存并生效';
        st.style.cssText = 'color:#22c55e;font-size:12px;margin-left:8px';
        document.getElementById('sysSave').after(st);
      } catch (e) { showToast('保存失败: ' + e.message, 4000); }
    });
    document.getElementById('sysOcrDir').addEventListener('click', async function () {
      if (!api || !api.screenshotOpenOcrModelsDir) { showToast('当前环境不支持打开目录，请重启应用后重试（主进程需更新）', 4000); return; }
      try {
        const res = await api.screenshotOpenOcrModelsDir();
        showToast(res && res.status === 'ok' ? '已打开模型目录：' + res.dir : ('打开失败：' + (res && res.message || '')));
      } catch (e) { showToast('打开模型目录失败：' + e.message, 4000); }
    });
    document.getElementById('sysInstall').addEventListener('click', async function () {
      const btn = this;
      const msgEl = document.getElementById('sysOcrMsg');
      if (!api || !api.screenshotInstallOcr) { if (msgEl) msgEl.textContent = '当前环境不支持一键安装（需桌面应用）'; return; }
      btn.disabled = true; btn.textContent = '安装中...';
      if (msgEl) msgEl.textContent = '正在检测 OCR 组件并下载模型（约 16MB）...';
      try {
        const res = await api.screenshotInstallOcr();
        if (msgEl) { msgEl.style.color = res.status === 'error' ? '#ef4444' : '#22c55e'; msgEl.textContent = res.message || ''; }
        // 刷新 OCR 状态
        if (api.screenshotOcrStatus) {
          const s = await api.screenshotOcrStatus();
          const st = document.getElementById('sysOcrStatus');
          if (st) st.textContent = s.available ? '✅ 离线 OCR 可用' : ('⚠️ ' + (s.reason || '未就绪'));
        }
      } catch (e) {
        if (msgEl) { msgEl.style.color = '#ef4444'; msgEl.textContent = '安装失败: ' + e.message; }
      } finally {
        btn.disabled = false; btn.textContent = '⚡ 一键安装 OCR';
      }
    });
    document.getElementById('sysCopyCmd').addEventListener('click', function () {
      const cmd = 'npm i onnxruntime-node && npx electron-builder install-app-deps && powershell -ExecutionPolicy Bypass -File electron/screenshot/download-ocr-models.ps1';
      // 主进程写剪贴板（iframe 中 navigator.clipboard 常被拒）
      if (api && api.screenshotCopyText) { api.screenshotCopyText(cmd); showToast('安装命令已复制（在项目根目录执行）', 4000); }
      else { try { navigator.clipboard.writeText(cmd); showToast('安装命令已复制'); } catch (e) { showToast(cmd, 6000); } }
    });

    currentPromptId = null;
    $('promptModal').style.display = 'flex';
    const copyBtn = $('copyPromptBtn');
    if (copyBtn) copyBtn.style.display = 'none';
    // 面板关闭时清理录制监听
    const closeBtn = $('promptClose');
    if (closeBtn) {
      const orig = closeBtn.onclick;
      closeBtn.onclick = function (ev) {
        recordingSysKey = null;
        if (window.__sysKeyHandler) window.removeEventListener('keydown', window.__sysKeyHandler);
        if (orig) orig.call(closeBtn, ev); else $('promptModal').style.display = 'none';
      };
    }
  }

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
      if (!res.ok) { showToast(data.error || '操作失败', 4000); return; }
      loadTools();
    } catch (e) {
      showToast('操作失败: ' + e.message, 4000);
    }
  }

  // ── Confirm & delete（非内置）──
  function confirmDelete(t) {
    confirmAction('删除工具「' + t.name + '」？\n该操作不可恢复。', function () { deleteTool(t.id); });
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
      showToast('获取提示词失败: ' + e.message, 4000);
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

  // 返回工具列表：左上角返回按钮 + 右上角关闭按钮
  $('overlayBackBtn').addEventListener('click', closeOverlay);
  $('overlayCloseBtn').addEventListener('click', closeOverlay);

  // ── Delete tool ──
  async function deleteTool(id) {
    try {
      const res = await fetch(API_BASE + '/api/tools/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || '删除失败', 4000); return; }
      loadTools();
    } catch (e) {
      showToast('删除失败: ' + e.message, 4000);
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

  initDragSort();
  loadTools();
})();