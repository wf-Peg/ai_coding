(function() {
  'use strict';

  // ── State ──
  let todos = [];
  let currentFilter = 'all';
  let deleteTargetId = null;

  // ── DOM refs ──
  const inputTitle = document.getElementById('inputTitle');
  const inputPriority = document.getElementById('inputPriority');
  const inputDate = document.getElementById('inputDate');
  const btnAdd = document.getElementById('btnAdd');
  const fabAdd = document.getElementById('fabAdd');
  const addModal = document.getElementById('addModal');
  const modalClose = document.getElementById('modalClose');
  const timeline = document.getElementById('timeline');
  const toastContainer = document.getElementById('toastContainer');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');
  const btnConfirmCancel = document.getElementById('btnConfirmCancel');
  const statTotal = document.getElementById('statTotal');
  const statDone = document.getElementById('statDone');
  const statPending = document.getElementById('statPending');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const themeRegular = document.getElementById('themeRegular');
  const themeNotion = document.getElementById('themeNotion');

  // ── API ──
  const TODO_API_BASE_URL = 'http://127.0.0.1:8080/api/todo';
  const THEME_STORAGE_KEY = 'app_theme_v1';
  const THEMES = [
    { id: 'regular', name: '常规风格', link: themeRegular },
    { id: 'notion', name: 'Notion风格', link: themeNotion }
  ];
  const themeById = THEMES.reduce((acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  }, {});
  let currentTheme = THEMES[0].id;

  function getNextThemeId(themeId) {
    const index = THEMES.findIndex(theme => theme.id === themeId);
    const safeIndex = index >= 0 ? index : 0;
    return THEMES[(safeIndex + 1) % THEMES.length].id;
  }

  function updateThemeToggleLabel() {
    // Toggle入口已迁移到clip页面，此页仅做主题跟随。
  }

  function applyTheme(themeId, persist = true) {
    const resolvedThemeId = themeById[themeId] ? themeId : THEMES[0].id;
    currentTheme = resolvedThemeId;

    THEMES.forEach(theme => {
      theme.link.disabled = theme.id !== currentTheme;
    });

    document.documentElement.setAttribute('data-theme', currentTheme);
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    }
    updateThemeToggleLabel();
  }

  // ── Data ──
  async function fetchTodos() {
    try {
      const response = await axios.get(`${TODO_API_BASE_URL}/list`);
      todos = response.data.map(todo => {
        if (!todo.createdAt) {
          todo.createdAt = todo.createdAtTimestamp || Date.now();
        }
        return todo;
      });
      renderTimeline();
      updateStats();
    } catch (error) {
      console.error('获取待办事项失败，使用模拟数据:', error);
      // 使用模拟数据
      const now = Date.now();
      todos = [
        { id: now - 50000, title: '完成项目方案设计', priority: 'high', deadline: todayStr(), completed: false, createdAt: now - 50000, category: '工作' },
        { id: now - 30000, title: '阅读《设计心理学》第三章', priority: 'medium', deadline: futureDateStr(2), completed: false, createdAt: now - 30000, category: '学习' },
        { id: now - 10000, title: '整理本周会议纪要', priority: 'low', deadline: todayStr(), completed: true, createdAt: now - 10000, category: '工作' },
      ];
      renderTimeline();
      updateStats();
    }
  }

  // ── Helpers ──
  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }
  function futureDateStr(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
  function genId() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }
  function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + '小时前';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + '天前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }
  function formatDate(str) {
    if (!str) return '';
    const d = new Date(str + 'T00:00:00');
    const today = new Date();
    today.setHours(0,0,0,0);
    const diff = Math.floor((d - today) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
  function isOverdue(dateStr) {
    if (!dateStr) return false;
    return dateStr < todayStr();
  }

  // ── Modal ──
  function openModal() {
    inputDate.value = todayStr();
    inputPriority.value = 'medium';
    addModal.classList.add('active');
    setTimeout(() => inputTitle.focus(), 100);
  }
  function closeModal() {
    addModal.classList.remove('active');
    inputTitle.value = '';
  }

  // ── Toast ──
  function showToast(message, icon = '✓') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    }, 2000);
  }

  // ── Stats ──
  function updateStats() {
    const total = todos.length;
    const done = todos.filter(t => t.completed).length;
    statTotal.textContent = total;
    statDone.textContent = done;
    statPending.textContent = total - done;
  }

  // ── Render ──
  function getFilteredTodos() {
    let list = [...todos];
    switch(currentFilter) {
      case 'pending': list = list.filter(t => !t.completed); break;
      case 'completed': list = list.filter(t => t.completed); break;
      case 'high': list = list.filter(t => t.priority === 'high' && !t.completed); break;
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    list.sort((a, b) => {
      // 首先按完成状态排序（未完成的在前）
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      
      // 然后按截止日期升序排序（有截止日期的在前，截止日期早的在前）
      if (a.deadline && b.deadline) {
        return a.deadline.localeCompare(b.deadline);
      } else if (a.deadline) {
        return -1; // 有截止日期的排在前面
      } else if (b.deadline) {
        return 1; // 没有截止日期的排在后面
      }
      
      // 然后按优先级排序（高优先级在前）
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
      
      // 最后按创建时间排序（最新的在前）
      return b.createdAt - a.createdAt;
    });
    return list;
  }

  function renderTimeline() {
    const filtered = getFilteredTodos();
    if (filtered.length === 0) {
      timeline.innerHTML = `
        <div class="timeline-empty">
          <div class="empty-icon">📭</div>
          <p>${currentFilter === 'all' ? '暂无待办事项' : '该分类下暂无内容'}</p>
          <p class="hint">${currentFilter === 'all' ? '点击右下角 + 添加你的第一条待办' : '试试切换其他分类'}</p>
        </div>`;
      return;
    }

    timeline.innerHTML = filtered.map(todo => {
      const priorityLabels = { high: '高', medium: '中', low: '低' };
      const tagClass = { high: 'tag-high', medium: 'tag-medium', low: 'tag-low' };
      const overdue = !todo.completed && isOverdue(todo.deadline);
      const dateDisplay = todo.deadline ? formatDate(todo.deadline) : '';

      return `
        <div class="timeline-item priority-${todo.priority} ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
          <div class="timeline-dot"></div>
          <div class="todo-card">
            <div class="todo-top-row">
              <label class="todo-checkbox">
                <input type="checkbox" ${todo.completed ? 'checked' : ''} data-id="${todo.id}" class="todo-checkbox-input">
                <div class="checkmark">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </label>
              <div class="todo-content">
                <div class="todo-title">${escapeHtml(todo.title)}</div>
                <div class="todo-meta">
                  <span class="todo-tag ${tagClass[todo.priority]}">${priorityLabels[todo.priority]}</span>
                  ${todo.category ? `<span class="todo-tag tag-low" style="margin-left: 6px;">${escapeHtml(todo.category)}</span>` : ''}
                  ${dateDisplay ? `<span class="todo-date ${overdue ? 'overdue' : ''}">
                    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    ${dateDisplay}${overdue ? ' 已过期' : ''}
                  </span>` : ''}
                  <span style="font-size:0.6rem;color:var(--fg-muted);opacity:0.5;margin-left:auto">${formatRelativeTime(todo.createdAt)}</span>
                </div>
              </div>
              <div class="todo-actions">
                <button class="action-btn edit-btn" title="编辑" data-id="${todo.id}">
                  <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn delete delete-btn" title="删除" data-id="${todo.id}">
                  <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div class="edit-form" id="edit-${todo.id}">
              <input type="text" id="editTitle-${todo.id}" value="${escapeAttr(todo.title)}" maxlength="120" />
              <select id="editPriority-${todo.id}">
                <option value="high" ${todo.priority === 'high' ? 'selected' : ''}>🔴 高优先级</option>
                <option value="medium" ${todo.priority === 'medium' ? 'selected' : ''}>🟡 中优先级</option>
                <option value="low" ${todo.priority === 'low' ? 'selected' : ''}>🔵 低优先级</option>
              </select>
              <input type="date" id="editDate-${todo.id}" value="${todo.deadline || ''}" />
              <div class="edit-actions">
                <button class="btn-cancel cancel-edit-btn" data-id="${todo.id}">取消</button>
                <button class="btn-save save-edit-btn" data-id="${todo.id}">保存</button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    // 重新设置事件委托，确保新渲染的元素也能响应事件
    setupEventDelegation();
  }

  // 使用事件委托处理所有事件，避免重复添加监听器
  function setupEventDelegation() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    // 移除旧的事件监听器
    timeline.removeEventListener('change', handleTimelineEvents);
    timeline.removeEventListener('click', handleTimelineEvents);

    // 添加新的事件监听器
    timeline.addEventListener('change', handleTimelineEvents);
    timeline.addEventListener('click', handleTimelineEvents);
  }

  // 统一处理时间线事件
  function handleTimelineEvents(e) {
    // 处理复选框变更
    if (e.target.classList.contains('todo-checkbox-input')) {
      const id = parseInt(e.target.dataset.id);
      toggleComplete(id);
      return;
    }

    // 处理编辑按钮点击
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
      const id = parseInt(editBtn.dataset.id);
      startEdit(id);
      return;
    }

    // 处理删除按钮点击
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      const id = parseInt(deleteBtn.dataset.id);
      confirmDelete(id);
      return;
    }

    // 处理取消编辑按钮点击
    const cancelBtn = e.target.closest('.cancel-edit-btn');
    if (cancelBtn) {
      const id = parseInt(cancelBtn.dataset.id);
      cancelEdit(id);
      return;
    }

    // 处理保存编辑按钮点击
    const saveBtn = e.target.closest('.save-edit-btn');
    if (saveBtn) {
      const id = parseInt(saveBtn.dataset.id);
      saveEdit(id);
      return;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Actions ──
  async function addTodo() {
    const title = inputTitle.value.trim();
    if (!title) {
      inputTitle.focus();
      inputTitle.style.borderColor = 'var(--danger)';
      setTimeout(() => inputTitle.style.borderColor = '', 1500);
      showToast('请输入待办内容', '⚠️');
      return;
    }
    const todo = {
      title,
      priority: inputPriority.value,
      deadline: inputDate.value || '',
      completed: false,
      category: '默认'
    };

    try {
      const response = await axios.post(`${TODO_API_BASE_URL}/add`, todo);
      const savedTodo = response.data;
      // 使用后端返回的createdAtTimestamp
      if (!savedTodo.createdAt) {
        savedTodo.createdAt = savedTodo.createdAtTimestamp || Date.now();
      }
      todos.unshift(savedTodo);
      closeModal();
      renderTimeline();
      updateStats();
      showToast('待办已添加', '✨');
    } catch (error) {
      console.error('添加待办失败:', error);
      showToast('添加失败，请重试', '⚠️');
    }
  }

  async function toggleComplete(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.completed = !todo.completed;
    try {
      // 创建一个副本，避免发送不必要的字段
      const updateTodo = {
        id: todo.id,
        title: todo.title,
        priority: todo.priority,
        deadline: todo.deadline,
        completed: todo.completed,
        category: todo.category
      };
      await axios.put(`${TODO_API_BASE_URL}/update`, updateTodo);
      renderTimeline();
      updateStats();
      showToast(todo.completed ? '已标记完成' : '已恢复待办', todo.completed ? '🎉' : '↩️');
    } catch (error) {
      console.error('更新待办失败:', error);
      todo.completed = !todo.completed; // 回滚
      showToast('更新失败，请重试', '⚠️');
    }
  }

  function startEdit(id) {
    document.querySelectorAll('.edit-form.active').forEach(f => f.classList.remove('active'));
    const form = document.getElementById('edit-' + id);
    if (form) {
      form.classList.add('active');
      const titleInput = document.getElementById('editTitle-' + id);
      if (titleInput) {
        titleInput.focus();
        titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
      }
    }
  }

  function cancelEdit(id) {
    const form = document.getElementById('edit-' + id);
    if (form) form.classList.remove('active');
  }

  async function saveEdit(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newTitle = document.getElementById('editTitle-' + id).value.trim();
    if (!newTitle) {
      showToast('内容不能为空', '⚠️');
      return;
    }
    todo.title = newTitle;
    todo.priority = document.getElementById('editPriority-' + id).value;
    todo.deadline = document.getElementById('editDate-' + id).value;
    try {
      // 创建一个副本，避免发送不必要的字段
      const updateTodo = {
        id: todo.id,
        title: todo.title,
        priority: todo.priority,
        deadline: todo.deadline,
        completed: todo.completed,
        category: todo.category
      };
      await axios.put(`${TODO_API_BASE_URL}/update`, updateTodo);
      renderTimeline();
      updateStats();
      showToast('已保存修改', '✏️');
    } catch (error) {
      console.error('保存失败:', error);
      showToast('保存失败，请重试', '⚠️');
    }
  }

  function confirmDelete(id) {
    deleteTargetId = id;
    confirmOverlay.classList.add('active');
  }

  async function executeDelete() {
    if (deleteTargetId === null) return;
    const el = document.querySelector(`.timeline-item[data-id="${deleteTargetId}"]`);
    if (el) {
      el.style.animation = 'itemRemove 0.3s ease-in forwards';
      setTimeout(async () => {
        try {
          await axios.delete(`${TODO_API_BASE_URL}/${deleteTargetId}`);
          todos = todos.filter(t => t.id !== deleteTargetId);
          renderTimeline();
          updateStats();
          deleteTargetId = null;
          showToast('已删除待办', '🗑️');
        } catch (error) {
          console.error('删除失败:', error);
          showToast('删除失败，请重试', '⚠️');
        }
      }, 300);
    } else {
      try {
        await axios.delete(`${TODO_API_BASE_URL}/${deleteTargetId}`);
        todos = todos.filter(t => t.id !== deleteTargetId);
        renderTimeline();
        updateStats();
        deleteTargetId = null;
        showToast('已删除待办', '🗑️');
      } catch (error) {
        console.error('删除失败:', error);
        showToast('删除失败，请重试', '⚠️');
      }
    }
    confirmOverlay.classList.remove('active');
  }

  function cancelDelete() {
    deleteTargetId = null;
    confirmOverlay.classList.remove('active');
  }

  // ── Filter ──
  function setFilter(filter) {
    currentFilter = filter;
    filterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderTimeline();
  }

  // ── Event listeners ──
  fabAdd.addEventListener('click', openModal);
  modalClose.addEventListener('click', closeModal);
  addModal.addEventListener('click', e => {
    if (e.target === addModal) closeModal();
  });
  btnAdd.addEventListener('click', addTodo);
  inputTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter') addTodo();
  });
  btnConfirmDelete.addEventListener('click', executeDelete);
  btnConfirmCancel.addEventListener('click', cancelDelete);
  confirmOverlay.addEventListener('click', e => {
    if (e.target === confirmOverlay) cancelDelete();
  });
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY) {
      applyTheme(event.newValue, false);
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (addModal.classList.contains('active')) { closeModal(); return; }
      document.querySelectorAll('.edit-form.active').forEach(f => f.classList.remove('active'));
      if (confirmOverlay.classList.contains('active')) cancelDelete();
    }
  });

  // ── Init ──
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY));
  // 先设置事件委托，确保事件监听器只添加一次
  setupEventDelegation();
  fetchTodos();

})();