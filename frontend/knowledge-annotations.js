(function() {
  'use strict';

  const API_ANN_ALL = 'http://127.0.0.1:8081/api/clip/annotations/all';

  const countHint = document.getElementById('countHint');
  const loadingBox = document.getElementById('loadingBox');
  const errorBox = document.getElementById('errorBox');
  const emptyBox = document.getElementById('emptyBox');
  const emptyFilterBox = document.getElementById('emptyFilterBox');
  const annoList = document.getElementById('annoList');
  const sourceSelect = document.getElementById('sourceSelect');
  const timeSelect = document.getElementById('timeSelect');
  const retryBtn = document.getElementById('retryBtn');

  let allAnnotations = [];
  const filters = { color: '', source: '', days: 0 };

  // ---- 数据加载 ----

  async function fetchAnnotations() {
    showBox('loading');
    try {
      const response = await fetch(API_ANN_ALL);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      allAnnotations = await response.json();
      if (!Array.isArray(allAnnotations)) allAnnotations = [];
      buildSourceOptions();
      applyFilters(true);
    } catch (error) {
      console.error('获取标注失败:', error);
      showBox('error');
    }
  }

  function showBox(name) {
    loadingBox.style.display = name === 'loading' ? '' : 'none';
    errorBox.style.display = name === 'error' ? '' : 'none';
    emptyBox.style.display = name === 'empty' ? '' : 'none';
    emptyFilterBox.style.display = name === 'emptyFilter' ? '' : 'none';
    annoList.style.display = name === 'list' ? '' : 'none';
  }

  // 来源选项：由 sourceUrl 派生站点名（hostname 去 www），无 url 退回 sourceTitle，去重排序
  function deriveSource(ann) {
    if (ann.sourceUrl) {
      try {
        let host = new URL(ann.sourceUrl).hostname || '';
        host = host.replace(/^www\./, '');
        if (host) return host;
      } catch (e) { /* 非法 URL 忽略 */ }
    }
    return (ann.sourceTitle || '').trim() || '未知来源';
  }

  function buildSourceOptions() {
    const names = [];
    const seen = new Set();
    allAnnotations.forEach((ann) => {
      const name = deriveSource(ann);
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    });
    names.sort((a, b) => a.localeCompare(b, 'zh'));
    const current = sourceSelect.value;
    sourceSelect.innerHTML = '<option value="">全部来源</option>' +
      names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
    sourceSelect.value = current;
  }

  // ---- 筛选与渲染 ----

  function applyFilters() {
    const color = filters.color;
    const source = filters.source;
    const days = filters.days;

    const now = Date.now();
    const cutoff = days > 0 ? now - days * 24 * 60 * 60 * 1000 : null;

    const list = allAnnotations.filter((ann) => {
      if (color && (ann.color || 'yellow') !== color) return false;
      if (source && deriveSource(ann) !== source) return false;
      if (cutoff) {
        const t = ann.createdAt ? new Date(ann.createdAt).getTime() : NaN;
        if (isNaN(t) || t < cutoff) return false;
      }
      return true;
    });

    countHint.textContent = `共 ${allAnnotations.length} 条标注 · 当前 ${list.length} 条`;

    if (allAnnotations.length === 0) {
      showBox('empty');
      return;
    }
    if (list.length === 0) {
      showBox('emptyFilter');
      return;
    }
    renderList(list);
  }

  function renderList(list) {
    showBox('list');
    annoList.innerHTML = list.map(renderCard).join('');
    // 事件委托：展开/收起原文、想法、跳转
    bindListEvents();
  }

  function renderCard(ann) {
    const color = ann.color || 'yellow';
    const quote = ann.text || '';
    const note = ann.note || '';
    const source = deriveSource(ann);
    const srcTitle = ann.sourceTitle || source;
    const clipTitle = ann.clipTitle || '未命名剪藏';
    const createdAt = formatTime(ann.createdAt);
    const hasUrl = !!ann.sourceUrl;
    const notePreview = note.length > 120;
    const quoteLong = quote.length > 160;

    return `
      <div class="anno-card a-${escapeAttr(color)}" data-quote-long="${quoteLong}">
        <div class="anno-quote${quoteLong ? ' clamped' : ''}" data-role="quote">${escapeHtml(quote)}</div>
        ${quoteLong ? '<button type="button" class="quote-toggle" data-role="quoteToggle">展开 ▼</button>' : ''}
        ${note ? `
          <div class="anno-note">
            <span class="note-label">💡 想法</span><span class="note-text">${escapeHtml(notePreview ? note.slice(0, 120) : note)}</span>
            ${notePreview ? `<button type="button" class="note-toggle" data-role="noteToggle">展开 ▼</button><span class="note-full" style="display:none;">${escapeHtml(note)}</span>` : ''}
          </div>` : ''}
        <div class="anno-meta">
          <span class="src-title" title="${escapeAttr(srcTitle)}">${escapeHtml(srcTitle)}</span>
          <span class="dot-sep">·</span>
          <span>${escapeHtml(createdAt)}</span>
          <span class="dot-sep">·</span>
          <span>📄 <span class="clip-title" title="${escapeAttr(clipTitle)}">${escapeHtml(clipTitle)}</span></span>
        </div>
        <div class="anno-actions">
          <button type="button" class="action-btn" data-role="viewDetail" data-clip-id="${escapeAttr(String(ann.clipId != null ? ann.clipId : ''))}">看详情</button>
          <button type="button" class="action-btn" data-role="backSource" data-url="${escapeAttr(hasUrl ? ann.sourceUrl : '')}" ${hasUrl ? '' : 'disabled'}>回原文</button>
        </div>
      </div>`;
  }

  function bindListEvents() {
    annoList.querySelectorAll('.quote-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.anno-card');
        const quote = card.querySelector('[data-role="quote"]');
        const isClamped = quote.classList.toggle('clamped');
        btn.textContent = isClamped ? '展开 ▼' : '收起 ▲';
      });
    });
    annoList.querySelectorAll('.note-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.anno-card');
        const preview = card.querySelector('.note-text');
        const full = card.querySelector('.note-full');
        const expanding = full.style.display === 'none';
        full.style.display = expanding ? 'inline' : 'none';
        preview.style.display = expanding ? 'none' : 'inline';
        btn.textContent = expanding ? '收起 ▲' : '展开 ▼';
      });
    });
  }

  function bindActionEvents() {
    annoList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-role]');
      if (!btn) return;
      if (btn.dataset.role === 'viewDetail') {
        const clipId = btn.dataset.clipId;
        if (clipId === '' || clipId === 'null') {
          showToast('该标注缺少剪藏信息');
          return;
        }
        location.href = 'clip.html?id=' + encodeURIComponent(clipId);
      } else if (btn.dataset.role === 'backSource') {
        const url = btn.dataset.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }

  // ---- 工具 ----

  function formatTime(value) {
    if (!value) return '未知时间';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '未知时间';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  let toastTimer = null;
  function showToast(msg) {
    let toast = document.getElementById('annoToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'annoToast';
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--app-surface);color:var(--app-text);padding:10px 20px;border-radius:10px;border:1px solid var(--app-border);z-index:3000;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.15);';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2500);
  }

  function clearFilters() {
    filters.color = '';
    filters.source = '';
    filters.days = 0;
    document.querySelectorAll('.color-chip').forEach((c) => c.classList.toggle('active', c.dataset.color === ''));
    sourceSelect.value = '';
    timeSelect.value = '';
    applyFilters();
  }

  // ---- 初始化 ----

  function init() {
    // 颜色 chips
    document.getElementById('colorGroup').addEventListener('click', (e) => {
      const chip = e.target.closest('.color-chip');
      if (!chip) return;
      document.querySelectorAll('.color-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      filters.color = chip.dataset.color;
      applyFilters();
    });
    sourceSelect.addEventListener('change', () => {
      filters.source = sourceSelect.value;
      applyFilters();
    });
    timeSelect.addEventListener('change', () => {
      filters.days = parseInt(timeSelect.value, 10) || 0;
      applyFilters();
    });
    document.getElementById('clearFilterBtn').addEventListener('click', clearFilters);
    document.getElementById('clearFilterBtn2').addEventListener('click', clearFilters);
    retryBtn.addEventListener('click', fetchAnnotations);
    bindActionEvents();

    fetchAnnotations();
  }

  document.addEventListener('DOMContentLoaded', init);
})();