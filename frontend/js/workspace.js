
    (() => {
      'use strict';

      /* ── Constants ── */
      const LABELS = { clip: '剪藏', knowledge: '知识', todo: '待办', 'learning-plan': '学习' };
      const INITIALS = { clip: '剪', knowledge: '知', todo: '待', 'learning-plan': '学' };
      const FIELD_LABELS = { type: '类型', category: '分类', tag: '标签', sourcePath: '来源路径', workflowStatus: '工作流状态', updatedAt: '更新时间', workspace: '所属工作台' };
      const OPERATOR_LABELS = { equals: '等于', contains: '包含', in: '属于', before: '早于', after: '晚于' };
      const TYPE_LABELS = { general: '通用', project: '项目', learning: '学习' };
      const FIELD_OPERATORS = { type: ['equals', 'in'], category: ['equals', 'contains', 'in'], tag: ['equals', 'contains', 'in'], sourcePath: ['equals', 'contains', 'in'], workflowStatus: ['equals', 'in'], updatedAt: ['before', 'after'], workspace: ['equals', 'in'] };

      /* ── DOM refs ── */
      const $ = id => document.getElementById(id);
      const sidebar = $('sidebar');
      const sidebarBackdrop = $('sidebarBackdrop');
      const sidebarToggle = $('sidebarToggle');
      const sidebarToggle2 = $('sidebarToggle2');
      const sidebarCollapse = $('sidebarCollapse');
      const wsList = $('wsList');
      const overviewView = $('overviewView');
      const detailView = $('detailView');
      const productDevView = $('productDevView');
      const detailHeader = $('detailHeader');
      const detailContent = $('detailContent');
      const detailContentList = $('detailContentList');
      const detailResultCount = $('detailResultCount');
      const detailSearchInput = $('detailSearchInput');
      const detailError = $('detailError');
      const detailRules = $('detailRules');
      const rulesList = $('rulesList');
      const rulesError = $('rulesError');
      const detailExclusions = $('detailExclusions');
      const exclusionsList = $('exclusionsList');
      const exclusionsError = $('exclusionsError');
      const newWsModal = $('newWsModal');
      // 编辑工作台时复用新建弹窗：null 表示新建，非 null 表示正在编辑的工作台 ID
      let editingWsId = null;
      const ruleModal = $('ruleModal');
      const confirmModal = $('confirmModal');
      const columnInputModal = $('columnInputModal');
      // Overview tab refs
      const detailOverview = $('detailOverview');
      const overviewSummaryCards = $('overviewSummaryCards');
      const overviewTypeFilters = $('overviewTypeFilters');
      const overviewProjectList = $('overviewProjectList');
      const overviewResultCount = $('overviewResultCount');
      const refreshButton = $('refreshButton');

      /* ─── Overview state ─── */
      let overviewWorkspaceId = null;
      let overviewRequestId = 0;

      /* ─── Workspace state ─── */
      let workspaces = [];
      let activeWsId = null;
      let wsLoading = false;
      let currentExpression = null;

      /* ── Rule state ── */
      let editingRuleId = null;
      let fieldValuesCache = null;
      let selectedTags = [];
      let calendarDate = new Date();
      let selectedCalDate = null;

      /* ─── Helpers ─── */
      function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
      }
      function formatDate(value) {
        if (!value) return '时间未知';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      function formatDateTime(value) {
        if (!value) return '时间未知';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      function showModal(modal) { modal.classList.add('show'); }
      function hideModal(modal) { modal.classList.remove('show'); }
      function getWsName(id) {
        const ws = workspaces.find(w => w.id === id);
        return ws ? ws.name : '未知工作台';
      }
      function showDetailError(msg) {
        detailError.textContent = msg;
        detailError.style.display = 'block';
        setTimeout(function() { detailError.style.display = 'none'; }, 5000);
      }

      /* ── Sidebar ── */
      function openSidebar() {
        sidebar.classList.add('open');
        sidebarBackdrop.classList.add('show');
      }
      function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarBackdrop.classList.remove('show');
      }
      sidebarToggle?.addEventListener('click', openSidebar);
      sidebarToggle2.addEventListener('click', openSidebar);
      var pdSidebarToggle = $('pdSidebarToggle');
      if (pdSidebarToggle) pdSidebarToggle.addEventListener('click', openSidebar);
      sidebarCollapse.addEventListener('click', closeSidebar);
      sidebarBackdrop.addEventListener('click', closeSidebar);

      /* ── Sidebar Navigation View Switching ── */
      const navOverview = document.querySelector('.sidebar-nav-item[data-view="overview"]');
      const navProductDev = document.querySelector('.sidebar-nav-item[data-view="product-dev"]');

      function hideAllViews() {
        overviewView.classList.add('hidden');
        detailView.classList.remove('visible');
        productDevView.classList.remove('visible');
        document.querySelectorAll('.sidebar-nav-item').forEach(function(item) {
          item.classList.remove('active');
        });
      }

      function showView(view) {
        hideAllViews();
        if (view === 'overview') {
          overviewWorkspaceId = null;
          activeWsId = null;
          navOverview.classList.add('active');
          renderWsList();
          overviewView.classList.remove('hidden');
          loadOverview();
          localStorage.setItem('active_workspace_id', '');
          try { window.parent.postMessage({ type: 'workspaceChanged', workspaceId: '' }, '*'); } catch(e) {}
        } else if (view === 'product-dev') {
          overviewWorkspaceId = null;
          activeWsId = null;
          navProductDev.classList.add('active');
          renderWsList();
          productDevView.classList.add('visible');
          loadProductDev();
          localStorage.setItem('active_workspace_id', '');
          try { window.parent.postMessage({ type: 'workspaceChanged', workspaceId: '' }, '*'); } catch(e) {}
        } else if (view === 'detail') {
          if (!activeWsId) return;
          navOverview.classList.add('active');
          renderWsList();
          detailView.classList.add('visible');
        }
        closeSidebar();
      }

      navOverview.addEventListener('click', () => showView('overview'));
      navProductDev.addEventListener('click', () => showView('product-dev'));

      /* ── Breadcrumb navigation ── */
      var breadcrumbBack = $('breadcrumbBack');
      if (breadcrumbBack) {
        breadcrumbBack.addEventListener('click', function() {
          showView('overview');
        });
      }

      /* ── Overview View Functions ── */

      function renderOverviewDashboard(stats) {
        var el = $('ovDashboardCards');
        if (!stats) {
          el.innerHTML = '<div class="ov-dash-card"><div class="ov-dash-card-value">--</div><div class="ov-dash-card-label">加载中...</div></div>';
          return;
        }
        var cards = [
          { value: stats.total || 0, label: '总记录数', sub: '全部类型' },
          { value: stats.clip || 0, label: '剪藏', sub: '内容剪辑' },
          { value: stats.knowledge || 0, label: '知识', sub: '知识条目' },
          { value: stats.todo || 0, label: '待办', sub: '待办事项' },
          { value: stats['learning-plan'] || 0, label: '学习', sub: '学习计划' }
        ];
        el.innerHTML = cards.map(function(c) {
          return '<div class="ov-dash-card"><div class="ov-dash-card-value">' + c.value + '</div><div class="ov-dash-card-label">' + escapeHtml(c.label) + '</div>' + (c.sub ? '<div class="ov-dash-card-sub">' + escapeHtml(c.sub) + '</div>' : '') + '</div>';
        }).join('');
      }

      function renderOverviewCharts(typeDistribution, contents, workspaceSummary) {
        var ctxType = document.getElementById('ovTypeChart');
        var ctxTrend = document.getElementById('ovTrendChart');
        var ctxCoverage = document.getElementById('ovCoverageChart');
        if (!ctxType || !ctxTrend || !ctxCoverage) return;

        if (typeof Chart === 'undefined') {
          [ctxType, ctxTrend, ctxCoverage].forEach(function(c) {
            var parent = c.parentElement;
            parent.innerHTML = '<div class="empty-state" style="height:180px;display:flex;align-items:center;justify-content:center">图表库加载中...</div>';
          });
          return;
        }

        // Destroy existing chart instances
        if (overviewChartInstances) {
          Object.values(overviewChartInstances).forEach(function(c) { if (c) c.destroy(); });
        }

        var typeLabels = { clip: '剪藏', knowledge: '知识', todo: '待办', 'learning-plan': '学习' };
        var typeColors = { clip: '#2383e2', knowledge: '#f59e0b', todo: '#10b981', 'learning-plan': '#876de2' };
        var dist = typeDistribution || {};
        var types = Object.keys(typeLabels).filter(function(t) { return t in dist; });
        var labels = types.map(function(t) { return typeLabels[t]; });
        var values = types.map(function(t) { return dist[t]; });
        var colors = types.map(function(t) { return typeColors[t] || '#888'; });

        // 类型分布 - 环形图
        overviewChartInstances.typeChart = new Chart(ctxType, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { padding: 12, boxWidth: 12, font: { size: 11 } } } }
          }
        });

        // 近期活跃趋势 - 折线图（按最近 7 天内容更新时间统计，真实数据）
        var now = new Date();
        var days = [];
        var dayValues = [];
        var dayKeys = [];
        for (var i = 6; i >= 0; i--) {
          var d = new Date(now);
          d.setDate(d.getDate() - i);
          dayKeys.push(d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate());
          days.push((d.getMonth() + 1) + '/' + d.getDate());
          dayValues.push(0);
        }
        (contents || []).forEach(function(c) {
          var ts = c.updatedAt || c.createdAt;
          if (!ts) return;
          var dd = new Date(ts);
          if (Number.isNaN(dd.getTime())) return;
          var k = dd.getFullYear() + '-' + (dd.getMonth() + 1) + '-' + dd.getDate();
          var idx = dayKeys.indexOf(k);
          if (idx >= 0) dayValues[idx]++;
        });
        var hasTrendData = dayValues.some(function(v) { return v > 0; });
        overviewChartInstances.trendChart = new Chart(ctxTrend, {
          type: 'line',
          data: {
            labels: days,
            datasets: [{ label: '活跃内容数', data: dayValues, borderColor: '#2383e2', backgroundColor: 'rgba(35,131,226,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2383e2' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, title: hasTrendData ? undefined : { display: true, text: '近 7 天无活跃记录', color: 'var(--ws-faint)', font: { size: 11 }, padding: { top: 50 } } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
          }
        });

        // 工作台内容覆盖 - 柱状图（工作台类型分布，真实数据）
        var wsTypes = Object.entries((workspaceSummary && workspaceSummary.types) || {});
        var wsTypeLabels = { general: '通用', project: '项目', learning: '学习' };
        var coverageLabels = wsTypes.map(function(e) { return wsTypeLabels[e[0]] || e[0]; });
        var coverageValues = wsTypes.map(function(e) { return e[1]; });
        var coverageColors = ['#2383e2', '#876de2', '#f59e0b', '#10b981', '#e74c3c'];
        overviewChartInstances.coverageChart = new Chart(ctxCoverage, {
          type: 'bar',
          data: {
            labels: coverageLabels,
            datasets: [{ label: '工作台数量', data: coverageValues, backgroundColor: coverageColors, borderRadius: 4, borderSkipped: false }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, title: coverageValues.length ? undefined : { display: true, text: '暂无工作台数据', color: 'var(--ws-faint)', font: { size: 11 }, padding: { top: 50 } } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
          }
        });
      }

      function renderRecentActivities(contents) {
        var el = $('contentList');
        if (!contents || !contents.length) {
          el.innerHTML = '<div class="empty-state" style="padding:30px 20px;color:var(--ws-muted);text-align:center">近七天无活动数据</div>';
          return;
        }
        var sorted = contents.slice().sort(function(a, b) {
          return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
        });
        var items = sorted.slice(0, 8).map(function(c) {
          var typeLabel = ({ clip: '剪藏', knowledge: '知识', todo: '待办', 'learning-plan': '学习' })[c.type] || c.type || '内容';
          var dotColor = ({ clip: '#2383e2', knowledge: '#f59e0b', todo: '#10b981', 'learning-plan': '#876de2' })[c.type] || '#888';
          return '<div style="padding:12px 22px;border-bottom:1px solid var(--ws-border);display:flex;align-items:center;gap:10px">' +
            '<span style="width:8px;height:8px;border-radius:50%;flex:none;background:' + dotColor + '"></span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(c.title || '无标题') + ' — ' + typeLabel + '</span>' +
            '<span style="flex:none;color:var(--ws-faint);font-size:11px;white-space:nowrap">' + escapeHtml(formatDateTime(c.updatedAt || c.createdAt)) + '</span></div>';
        }).join('');
        el.innerHTML = items;
      }

      var overviewChartInstances = {};
      var overviewDetailChartInstance = null;

      async function loadOverview() {
        const requestId = ++overviewRequestId;
        $('refreshButton').disabled = true;
        renderOverviewDashboard(null);
        try {
          const r = await fetch('/api/workspace/overview', { headers: { Accept: 'application/json' } });
          if (!r.ok) throw new Error('请求失败（' + r.status + '）');
          if (requestId !== overviewRequestId) return;
          const data = await r.json();
          const summary = data.workspaceSummary || {};
          var typeDist = summary.typeDistribution || {};
          var dashboardStats = { total: 0, clip: 0, knowledge: 0, todo: 0, 'learning-plan': 0 };
          Object.keys(typeDist).forEach(function(t) { dashboardStats[t] = typeDist[t]; dashboardStats.total += typeDist[t]; });
          if (!Object.keys(typeDist).length && data.contents) {
            data.contents.forEach(function(c) {
              var t = c.type;
              if (t in dashboardStats) dashboardStats[t]++;
              dashboardStats.total++;
            });
          }
          renderOverviewDashboard(dashboardStats);
          renderOverviewCharts(typeDist, data.contents || [], summary);
          renderRecentActivities(data.contents || []);
        } catch (e) {
          if (requestId !== overviewRequestId) return;
          renderOverviewDashboard({ total: 0, clip: 0, knowledge: 0, todo: 0, 'learning-plan': 0 });
          var listEl = $('contentList');
          if (listEl) listEl.innerHTML = '<div class="error-message" style="margin:16px">加载失败：' + escapeHtml(e.message || '后端服务不可用') + '</div>';
        } finally {
          if (requestId !== overviewRequestId) return;
          $('refreshButton').disabled = false;
        }
      }

      /* ── Detail Overview Tab Functions ── */
      async function loadDetailOverview() {
        const wsId = activeWsId ? activeWsId : null;
        overviewSummaryCards.innerHTML = '<div class="loading" style="grid-column:1/-1;padding:20px"><div class="spinner"></div> 加载中...</div>';
        overviewProjectList.innerHTML = '';
        if (overviewResultCount) overviewResultCount.textContent = '';
        try {
          const params = wsId ? '?workspaceId=' + encodeURIComponent(wsId) : '';
          const r = await fetch('/api/workspace/overview' + params, { headers: { Accept: 'application/json' } });
          if (!r.ok) throw new Error('请求失败（' + r.status + '）');
          const data = await r.json();
          // Summary cards — 区分内容维度统计与工作台维度统计
          const summary = data.workspaceSummary || {};
          if (summary.typeDistribution) {
            // 内容维度统计：基于工作台筛选后的可见内容
            const typeCards = Object.entries(summary.typeDistribution || {}).map(([k, v]) => `<div class="ws-summary-card"><span class="ws-card-value">${v}</span><span class="ws-card-label">${escapeHtml(LABELS[k] || k)}</span></div>`).join('');
            const sourceCards = Object.entries(summary.sourceDistribution || {}).map(([k, v]) => {
              const label = ({ rule: '规则命中', manual: '手动加入', manual_input: '工作台输入', relation: '关系带入' })[k] || k;
              return `<div class="ws-summary-card"><span class="ws-card-value">${v}</span><span class="ws-card-label">${label}</span></div>`;
            }).join('');
            overviewSummaryCards.innerHTML = `<div class="ws-summary-card primary"><span class="ws-card-value">${summary.total || 0}</span><span class="ws-card-label">可见内容</span></div>${typeCards}${sourceCards}`;
          } else {
            // 工作台维度统计：全部视图
            const types = Object.entries(summary.types || {}).map(([k, v]) => `<div class="ws-summary-card"><span class="ws-card-value">${v}</span><span class="ws-card-label">${escapeHtml(k)}</span></div>`).join('');
            overviewSummaryCards.innerHTML = `<div class="ws-summary-card"><span class="ws-card-value">${summary.total || 0}</span><span class="ws-card-label">总计</span></div>
              <div class="ws-summary-card"><span class="ws-card-value">${summary.active || 0}</span><span class="ws-card-label">活跃</span></div>
              <div class="ws-summary-card archived"><span class="ws-card-value">${summary.archived || 0}</span><span class="ws-card-label">已归档</span></div>${types}`;
          }
          if (overviewResultCount) overviewResultCount.textContent = '共 ' + (summary.total || 0) + ' 项';
          // 内容来源分布图（规则命中/手动加入/工作台输入/关系带入）
          renderOverviewSourceChart(summary);
          // Type filters (read-only distribution)
          const contentTypes = data.contentTypes || Object.keys(LABELS);
          overviewTypeFilters.innerHTML = contentTypes.map(t => `<span class="filter" style="cursor:default;opacity:.8">${escapeHtml(LABELS[t] || t)}</span>`).join('');
          // Projects
          const projects = data.projects || [];
          overviewProjectList.innerHTML = projects.length
            ? projects.map(p => `<article class="project"><h3 class="project-name"><i class="project-dot" style="--project-color:${escapeHtml(p.color || '')}"></i>${escapeHtml(p.name || '未命名项目')}</h3>${p.description ? `<p class="project-description">${escapeHtml(p.description)}</p>` : ''}<p class="project-status">${escapeHtml(p.status || '未标记状态')}</p></article>`).join('')
            : '<div class="project-empty">暂无可读取的项目摘要</div>';
        } catch (e) {
          overviewSummaryCards.innerHTML = `<div class="ws-summary-card" style="grid-column:1/-1;color:var(--ws-danger)"><span class="ws-card-value">!</span><span class="ws-card-label">加载失败</span></div>`;
          overviewProjectList.innerHTML = '<div class="project-empty">加载失败：' + escapeHtml(e.message || '后端服务不可用') + '</div>';
        }
      }

      /* ── 内容来源分布图（工作台详情概览 Tab） ── */
      function renderOverviewSourceChart(summary) {
        var chartEl = $('overviewSourceChart');
        var emptyEl = $('overviewSourceEmpty');
        var legendEl = $('overviewSourceLegend');
        if (!chartEl) return;
        var sourceDist = (summary && summary.sourceDistribution) || {};
        var hasData = Object.keys(sourceDist).length > 0;
        chartEl.style.display = hasData ? 'block' : 'none';
        if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';
        if (legendEl) legendEl.innerHTML = '';
        if (!hasData) return;
        if (typeof Chart === 'undefined') {
          if (emptyEl) { emptyEl.style.display = 'flex'; emptyEl.textContent = '图表库加载中...'; }
          return;
        }
        if (overviewDetailChartInstance) { overviewDetailChartInstance.destroy(); overviewDetailChartInstance = null; }
        var sourceLabels = { rule: '规则命中', manual: '手动加入', manual_input: '工作台输入', relation: '关系带入' };
        var sourceColors = { rule: '#2383e2', manual: '#10b981', manual_input: '#f59e0b', relation: '#876de2' };
        var entries = Object.entries(sourceDist);
        overviewDetailChartInstance = new Chart(chartEl, {
          type: 'doughnut',
          data: {
            labels: entries.map(function(e) { return sourceLabels[e[0]] || e[0]; }),
            datasets: [{ data: entries.map(function(e) { return e[1]; }), backgroundColor: entries.map(function(e) { return sourceColors[e[0]] || '#999'; }), borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } } } }
        });
        // 附加关键数字：规则命中 / 手动加入 / 排除
        var extras = [
          ['规则命中', summary.ruleMatched],
          ['手动加入', summary.manualAdded],
          ['排除', summary.excluded]
        ].filter(function(x) { return typeof x[1] === 'number'; }).map(function(x) {
          return '<span><strong style="color:var(--ws-text)">' + x[1] + '</strong> ' + x[0] + '</span>';
        }).join('');
        if (legendEl && extras) legendEl.innerHTML = extras;
      }

      /* ── Workspace List ── */
      async function loadWorkspaces() {
        try {
          const r = await fetch('/api/workspace/list', { headers: { Accept: 'application/json' } });
          if (!r.ok) return;
          workspaces = await r.json();
          const savedWsId = localStorage.getItem('active_workspace_id');
          if (savedWsId && savedWsId !== 'pd-builtin' && workspaces.some(w => w.id === savedWsId)) {
            activeWsId = savedWsId;
            overviewWorkspaceId = null;
          } else {
            activeWsId = null;
            overviewWorkspaceId = null;
          }
          renderWsList();
        } catch (_) { /* ignore sidebar errors */ }
      }
      function renderWsList() {
        if (!workspaces.length) {
          wsList.innerHTML = '<div class="empty-state" style="padding:20px 12px;text-align:left">暂无工作台，点击下方新建。</div>';
          return;
        }
        const isDefaultActive = !overviewView.classList.contains('hidden') || !activeWsId;
        const defaultHtml = '<button class="sidebar-item ' + (isDefaultActive ? 'active' : '') + '" data-wsid="" type="button"><i class="ws-dot" style="background:#888"></i><span class="ws-name">全部</span><span class="ws-type-tag">全部工作台</span></button>';
        const activeList = workspaces.filter(function(ws) { return ws.id !== 'pd-builtin' && ws.status !== 'archived'; });
        const archivedList = workspaces.filter(function(ws) { return ws.id !== 'pd-builtin' && ws.status === 'archived'; });
        const itemHtml = function(ws, isArchived) {
          const isActive = activeWsId === ws.id;
          return '<button class="sidebar-item ' + (isActive ? 'active' : '') + (isArchived ? ' archived' : '') + '" data-wsid="' + escapeHtml(ws.id) + '" type="button" draggable="true"><i class="ws-dot" style="background:' + escapeHtml(ws.color || '#2383e2') + '"></i><span class="ws-name">' + escapeHtml(ws.name) + '</span>' + (ws.isDefault ? '<span style="margin-left:auto;font-size:10px;color:var(--app-success)">●</span>' : '') + '<span class="ws-type-tag">' + escapeHtml(TYPE_LABELS[ws.type || 'general'] || '通用') + '</span></button>';
        };
        let html = defaultHtml + activeList.map(ws => itemHtml(ws, false)).join('');
        if (archivedList.length) {
          html += '<div class="sidebar-group-label">已归档</div>' + archivedList.map(ws => itemHtml(ws, true)).join('');
        }
        wsList.innerHTML = html;
        wsList.querySelectorAll('.sidebar-item').forEach(function(btn) { btn.addEventListener('click', function() { selectWorkspace(btn.dataset.wsid); }); });
      }

      /* ── View Switching ── */
      function selectWorkspace(id) {
        if (!id) {
          // "全部" — 显示 overview 视图
          overviewWorkspaceId = null;
          activeWsId = null;
          showView('overview');
          localStorage.setItem('active_workspace_id', '');
          try { window.parent.postMessage({ type: 'workspaceChanged', workspaceId: '' }, '*'); } catch(e) {}
          return;
        }
        // 始终进入 detail 视图（概览/内容/规则/排除/建议）
        activeWsId = id;
        overviewWorkspaceId = null;
        showView('detail');
        updateTabVisibility();
        renderWsList();
        switchToTab('overview');
        loadDetailOverview();
        loadDetail();
        localStorage.setItem('active_workspace_id', id);
        try { window.parent.postMessage({ type: 'workspaceChanged', workspaceId: id }, '*'); } catch(e) {}
      }

      /* ── 右键菜单：设为默认工作台 ── */
      var ctxMenu = $('wsContextMenu');
      var ctxTargetWsId = null;
      // 右键点击工作台列表项显示菜单
      wsList.addEventListener('contextmenu', function(e) {
        var btn = e.target.closest('.sidebar-item[data-wsid]');
        if (!btn) return;
        e.preventDefault();
        ctxTargetWsId = btn.dataset.wsid;
        var ws = workspaces.find(function(w) { return w.id === ctxTargetWsId; });
        var ctxItem = $('ctxSetDefault');
        if (ws && ws.isDefault) {
          ctxItem.classList.add('disabled');
          ctxItem.textContent = '★ 已是默认工作台';
          ctxItem.disabled = true;
        } else {
          ctxItem.classList.remove('disabled');
          ctxItem.textContent = '★ 设为默认工作台';
          ctxItem.disabled = false;
        }
        var ctxArchiveItem = $('ctxArchive');
        if (ws && ws.status === 'archived') {
          ctxArchiveItem.textContent = '↺ 恢复工作台';
        } else {
          ctxArchiveItem.textContent = '🗄 归档工作台';
        }
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.add('show');
      });
      // 点击菜单项
      $('ctxSetDefault').addEventListener('click', async function() {
        if (!ctxTargetWsId || this.disabled) return;
        ctxMenu.classList.remove('show');
        var btn = this;
        btn.disabled = true;
        btn.textContent = '⏳ 设置中...';
        try {
          var r = await fetch('/api/workspace/' + encodeURIComponent(ctxTargetWsId) + '/set-default', { method: 'PUT' });
          if (!r.ok) throw new Error('设置失败');
          await loadWorkspaces();
          // 如果当前 detail 页正好是同一个工作台，刷新 detail 页头部按钮状态
          if (activeWsId === ctxTargetWsId) loadDetail();
        } catch (e) {
          showDetailError('设置默认工作台失败：' + (e.message || '后端服务不可用'));
        } finally {
          btn.disabled = false;
          btn.textContent = '★ 设为默认工作台';
          ctxTargetWsId = null;
        }
      });
      // 点击菜单项：编辑工作台
      $('ctxEdit').addEventListener('click', function() {
        const target = ctxTargetWsId || activeWsId;
        ctxMenu.classList.remove('show');
        this.disabled = true;
        try { openEditWorkspace(target); } finally { this.disabled = false; }
      });
      // 点击菜单项：归档 / 恢复工作台
      $('ctxArchive').addEventListener('click', async function() {
        const target = ctxTargetWsId || activeWsId;
        ctxMenu.classList.remove('show');
        const ws = workspaces.find(function(w) { return w.id === target; });
        const nextStatus = ws && ws.status === 'archived' ? 'active' : 'archived';
        this.disabled = true;
        try {
          const r = await fetch('/api/workspace/' + encodeURIComponent(target) + (nextStatus === 'archived' ? '/archive' : '/restore'), { method: 'PUT' });
          if (!r.ok) throw new Error('操作失败');
          await loadWorkspaces();
          if (activeWsId === target) loadDetail();
          showDetailError(nextStatus === 'archived' ? '✓ 已归档工作台' : '✓ 已恢复工作台');
        } catch (e) {
          showDetailError('操作失败：' + (e.message || '后端服务不可用'));
        } finally {
          this.disabled = false;
        }
      });
      // 点击其他地方关闭菜单
      document.addEventListener('click', function(e) {
        if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove('show');
      });
      document.addEventListener('contextmenu', function(e) {
        if (!ctxMenu.contains(e.target)) ctxMenu.classList.remove('show');
      });

      /** "全部"（无活动工作台）时隐藏规则/排除 Tab，具体工作台恢复显示 */
      function updateTabVisibility() {
        const isAll = !activeWsId || activeWsId === 'all';
        document.querySelectorAll('.detail-tab[data-tab="rules"], .detail-tab[data-tab="exclusions"]')
          .forEach(t => { t.style.display = isAll ? 'none' : ''; });
      }

      function switchToTab(tabName) {
        updateTabVisibility();
        // "全部"（无活动工作台）没有规则/排除数据，强制回到概览
        if ((!activeWsId || activeWsId === 'all') && (tabName === 'rules' || tabName === 'exclusions')) {
          tabName = 'overview';
        }
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('visible'));
        const tab = document.querySelector('.detail-tab[data-tab="' + tabName + '"]');
        const content = document.querySelector('.detail-tab-content[data-tab="' + tabName + '"]');
        if (tab) tab.classList.add('active');
        if (content) content.classList.add('visible');
        if (tabName === 'suggestions' && activeWsId) {
          loadSuggestions(activeWsId);
        }
      }

      /* ── Detail View ── */
      let detailState = { contents: [], filtered: [], query: '' };
      async function loadDetail() {
        if (!activeWsId) return;
        // Reset view to list
        currentView = 'list';
        viewToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        viewToggle.querySelector('[data-view="list"]').classList.add('active');
        $('detailContentList').style.display = 'grid';
        kanbanBoard.classList.remove('visible');
        detailColumns = [];
        wsLoading = true;
        detailHeader.innerHTML = '<div class="loading" style="padding:30px"><div class="spinner"></div> 加载中...</div>';
        detailContentList.innerHTML = '<div class="empty-state">加载中...</div>';
        rulesList.innerHTML = '<div class="empty-state">加载中...</div>';
        exclusionsList.innerHTML = '<div class="empty-state">加载中...</div>';
        try {
          const ws = workspaces.find(w => w.id === activeWsId);
          if (ws) {
            detailHeader.innerHTML =
              `<div class="detail-header-left"><i class="detail-color" style="background:${escapeHtml(ws.color || '#2383e2')}"></i><div class="detail-info"><h2>${escapeHtml(ws.name)}</h2><span class="detail-type">${escapeHtml(TYPE_LABELS[ws.type || 'general'] || '通用')}</span>${ws.description ? `<p class="detail-desc">${escapeHtml(ws.description)}</p>` : ''}</div></div><div class="detail-stats" id="detailStats"></div><div class="detail-header-actions"><button class="edit-ws-btn" id="editWsBtn" type="button" title="编辑工作台名称、描述与颜色">&#9998; 编辑</button><button class="default-ws-btn${ws.isDefault ? ' is-default' : ''}" id="setDefaultWsBtn" type="button" title="${ws.isDefault ? '已是默认工作台' : '设为默认工作台，打开应用时自动进入此工作台'}">${ws.isDefault ? '&#9733; 默认工作台' : '&#9733; 设为默认'}</button><button class="archive-ws-btn" id="archiveWsBtn" type="button" title="${ws.status === 'archived' ? '恢复工作台到可用状态' : '归档工作台（保留数据，暂不出现在列表）'}">${ws.status === 'archived' ? '&#8634; 恢复' : '&#128190; 归档'}</button><button class="delete-ws-btn" id="deleteWsBtn" type="button" title="删除工作台">&#128465; 删除</button></div>`;
            // Update breadcrumb
            var bc = $('breadcrumbCurrent');
            if (bc) bc.textContent = ws.name;
          }
          // Bind delete workspace handler
          const deleteBtn = $('deleteWsBtn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
              $('confirmTitle').textContent = '删除工作台';
              $('confirmMessage').textContent = ws ? `确定要删除工作台"${ws.name}"吗？此操作将同时删除该工作台的所有规则、排除项和看板列，不可恢复。` : '确定要删除此工作台吗？此操作不可恢复。';
              const confirmActionBtn = $('confirmAction');
              confirmActionBtn.onclick = async () => {
                hideModal(confirmModal);
                // Show loading state on delete button
                deleteBtn.disabled = true;
                deleteBtn.innerHTML = '⏳ 删除中...';
                try {
                  const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}`, { method: 'DELETE' });
                  const data = r.ok ? { message: '工作台已删除' } : await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(data.message || '删除失败，请稍后重试');
                  showDetailError('✓ ' + data.message);
                  // Navigate back to overview
                  overviewWorkspaceId = null;
                  activeWsId = null;
                  navOverview.classList.add('active');
                  overviewView.classList.remove('hidden');
                  detailView.classList.remove('visible');
                  await loadWorkspaces();
                  await loadOverview();
                } catch (e) {
                  showDetailError('删除失败：' + (e.message || '后端服务不可用，请稍后重试'));
                  deleteBtn.disabled = false;
                  deleteBtn.innerHTML = '&#128465; 删除';
                }
              };
              showModal(confirmModal);
            });
          }
          // Bind set default workspace handler
          const setDefaultBtn = $('setDefaultWsBtn');
          if (setDefaultBtn && !ws.isDefault) {
            setDefaultBtn.addEventListener('click', async function() {
              setDefaultBtn.disabled = true;
              setDefaultBtn.textContent = '⏳ 设置中...';
              try {
                const r = await fetch('/api/workspace/' + encodeURIComponent(activeWsId) + '/set-default', { method: 'PUT' });
                if (!r.ok) throw new Error('设置失败');
                await loadWorkspaces();
                showDetailError('✓ 已设为默认工作台');
                loadDetail();
              } catch (e) {
                showDetailError('设置默认工作台失败：' + (e.message || '后端服务不可用'));
                setDefaultBtn.disabled = false;
                setDefaultBtn.innerHTML = '&#9733; 设为默认';
              }
            });
          }
          // Bind edit workspace handler
          const editBtn = $('editWsBtn');
          if (editBtn) editBtn.addEventListener('click', () => openEditWorkspace(activeWsId));
          // Bind archive / restore handler
          const archiveBtn = $('archiveWsBtn');
          if (archiveBtn) {
            archiveBtn.addEventListener('click', async function() {
              const nextStatus = ws.status === 'archived' ? 'active' : 'archived';
              archiveBtn.disabled = true;
              archiveBtn.textContent = '⏳ 处理中...';
              try {
                const url = nextStatus === 'archived'
                  ? `/api/workspace/${encodeURIComponent(activeWsId)}/archive`
                  : `/api/workspace/${encodeURIComponent(activeWsId)}/restore`;
                const r = await fetch(url, { method: 'PUT' });
                if (!r.ok) throw new Error('操作失败');
                showDetailError(nextStatus === 'archived' ? '✓ 已归档工作台' : '✓ 已恢复工作台');
                await loadWorkspaces();
                loadDetail();
              } catch (e) {
                showDetailError('操作失败：' + (e.message || '后端服务不可用'));
                archiveBtn.disabled = false;
                archiveBtn.innerHTML = ws.status === 'archived' ? '&#8634; 恢复' : '&#128190; 归档';
              }
            });
          }
          const [resData, rulesData, exclusionsData] = await Promise.all([
            fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/resolution`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject()),
            fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rules`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject()),
            fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/exclusions`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject())
          ]);
          // Stats
          const stats = $('detailStats');
          stats.innerHTML =
            `<span class="stat-badge primary"><strong>${resData.visibleCount || 0}</strong> 可见内容</span>` +
            `<span class="stat-badge"><strong>${resData.ruleMatchedCount || 0}</strong> 规则命中</span>` +
            `<span class="stat-badge"><strong>${resData.manualCount || 0}</strong> 手动</span>` +
            `<span class="stat-badge"><strong>${resData.relationCount || 0}</strong> 关系</span>` +
            `<span class="stat-badge"><strong>${resData.excludedCount || 0}</strong> 排除</span>`;
          // Columns
          detailColumns = resData.columns || [];
          // Contents
          detailState.contents = resData.contents || [];
          detailState.filtered = [...detailState.contents];
          renderDetailContents();
          // If kanban view is active, re-render
          if (currentView === 'kanban') renderKanbanBoard();
          // Expression
          const exprResp = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, { headers: { Accept: 'application/json' } });
          currentExpression = exprResp.ok ? await exprResp.json() : { workspaceId: activeWsId, relation: 'OR', groups: [] };
          // Rules
          renderExpression(rulesData);
          renderRootRelation();
          // Exclusions
          renderExclusions(exclusionsData);
        } catch (e) {
          detailHeader.innerHTML = '<div class="error-message" style="margin:0">加载失败：' + escapeHtml(e.message || '后端服务不可用') + ' <button class="retry" style="margin:0 0 0 10px;display:inline-block;padding:4px 12px" id="retryLoadDetail">重试</button></div>';
          const retryBtn = $('retryLoadDetail');
          if (retryBtn) retryBtn.addEventListener('click', function() { loadDetail(); });
        } finally {
          wsLoading = false;
        }
      }

      function renderDetailContents() {
        const q = detailState.query.toLowerCase();
        detailState.filtered = detailState.contents.filter(item => {
          if (!q) return true;
          return (item.title && item.title.toLowerCase().includes(q)) ||
                 (item.category && item.category.toLowerCase().includes(q)) ||
                 (item.tags || []).some(t => t.toLowerCase().includes(q));
        });
        detailResultCount.textContent = '共 ' + detailState.filtered.length + ' 项';
        if (!detailState.filtered.length) {
          detailContentList.innerHTML = '<div class="empty-state">' + (q ? '没有匹配的内容' : '暂无可展示的可见内容') + '</div>';
          return;
        }
        const SOURCE_LABELS = { rule: '规则命中', manual: '手动加入', relation: '关系带入' };
        detailContentList.innerHTML = detailState.filtered.map(item => {
          const meta = [item.category, ...(item.tags || []).map(t => '#' + t), item.sourcePath].filter(Boolean).map(v => `<span class="tag">${escapeHtml(v)}</span>`).join('');
          const sourceBadge = item.source ? `<span class="source-marker ${escapeHtml(item.source)}">${escapeHtml(SOURCE_LABELS[item.source] || item.source)}</span>` : '';
          const isManualMember = item.source === 'manual';
          const memberAction = isManualMember
            ? `<button class="member-remove-btn" data-content-id="${escapeHtml(item.id)}" data-content-title="${escapeHtml(item.title || '')}" type="button" title="从当前工作台移除成员（内容保留在原始位置）">移除</button>`
            : `<button class="member-add-btn" data-content-id="${escapeHtml(item.id)}" data-content-title="${escapeHtml(item.title || '')}" type="button" title="手动加入当前工作台（放入默认列）">加入</button>`;
          return `<article class="item"><div class="type-mark" data-type="${escapeHtml(item.type)}">${escapeHtml(INITIALS[item.type] || '内')}</div><div class="item-body"><h3 class="item-title" title="${escapeHtml(item.title || '无标题')}">${escapeHtml(item.title || '无标题')}</h3><div class="item-meta"><span>${escapeHtml(LABELS[item.type] || item.type || '内容')}</span>${sourceBadge}${meta}</div></div><div class="item-actions">${memberAction}<button class="exclude-btn" data-content-id="${escapeHtml(item.id)}" data-content-title="${escapeHtml(item.title || '')}" type="button" title="将内容从当前工作台排除">排除</button></div></article>`;
        }).join('');
        detailContentList.querySelectorAll('.exclude-btn').forEach(btn => btn.addEventListener('click', () => excludeContent(btn.dataset.contentId, btn.dataset.contentTitle)));
        detailContentList.querySelectorAll('.member-add-btn').forEach(btn => btn.addEventListener('click', () => addManualMember(btn.dataset.contentId)));
        detailContentList.querySelectorAll('.member-remove-btn').forEach(btn => btn.addEventListener('click', () => removeManualMember(btn.dataset.contentId)));
      }

      /* ── Exclude / Restore ── */
      async function excludeContent(contentId, title) {
        if (!activeWsId) return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/exclusions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentId, reason: '手动排除' })
          });
          if (!r.ok) { showDetailError('排除失败'); return; }
          loadDetail();
        } catch (e) {
          showDetailError('排除失败：' + (e.message || '后端服务不可用'));
        }
      }
      async function restoreExclusion(contentId) {
        if (!activeWsId) return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/exclusions/${encodeURIComponent(contentId)}`, { method: 'DELETE' });
          if (!r.ok) { showDetailError('恢复失败'); return; }
          loadDetail();
        } catch (e) {
          showDetailError('恢复失败：' + (e.message || '后端服务不可用'));
        }
      }

      /* ── Rules（分组渲染）── */
      function renderExpression(rulesData) {
        const rules = rulesData || [];
        const rulesById = {};
        rules.forEach(r => { rulesById[r.id] = r; });
        const container = $('rulesList');
        if (!currentExpression || !currentExpression.groups || !currentExpression.groups.length) {
          container.innerHTML = '<div class="empty-state">暂无规则，点击上方添加。</div>';
          return;
        }
        container.innerHTML = currentExpression.groups.map((group, gi) => {
          const rows = (group.ruleIds || [])
            .map(rid => rulesById[rid])
            .filter(Boolean)
            .map((r, ri) => `
              <div class="rule-row">
                <span class="rule-field">${escapeHtml(FIELD_LABELS[r.field] || r.field)}</span>
                ${r.negate ? '<span class="rule-negate-badge" title="否定条件（NOT）：不满足时命中">NOT</span>' : ''}
                <span class="rule-operator">${escapeHtml((r.negate ? '不' : '') + (OPERATOR_LABELS[r.operator] || r.operator))}</span>
                <span class="rule-value" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</span>
                <button class="toggle-switch ${r.enabled ? 'on' : ''}" data-rule-id="${escapeHtml(r.id)}" data-enabled="${r.enabled}" type="button" aria-label="切换启用状态" data-func-tag="功能:规则开关" title="启用/禁用规则"></button>
                <button class="rule-edit-btn" data-rule-id="${escapeHtml(r.id)}" data-group-id="${escapeHtml(group.id)}" type="button" title="编辑" data-func-tag="功能:编辑规则">&#9998;</button>
                <button class="rule-del-btn" data-rule-id="${escapeHtml(r.id)}" type="button" title="删除" data-func-tag="功能:删除规则">&times;</button>
              </div>`)
            .join('');
          return `
            <div class="rule-group">
              <div class="rule-group-header">
                <span class="rule-group-title">分组 ${gi + 1}</span>
                <select class="rule-group-relation" data-group-id="${escapeHtml(group.id)}">
                  <option value="OR" ${group.relation === 'OR' ? 'selected' : ''}>组内任一命中（OR）</option>
                  <option value="AND" ${group.relation === 'AND' ? 'selected' : ''}>组内全部命中（AND）</option>
                </select>
                <button class="rule-group-del" data-group-id="${escapeHtml(group.id)}" data-count="${(group.ruleIds || []).length}" type="button" title="删除分组（连同组内规则）" data-func-tag="功能:删除分组">删除分组</button>
                <button class="rule-group-add" data-group-id="${escapeHtml(group.id)}" type="button" title="向此分组添加规则" data-func-tag="功能:添加规则到分组">+ 添加规则</button>
              </div>
              <div class="rule-group-list">${rows || '<span class="rule-group-empty">空分组（不参与匹配）</span>'}</div>
            </div>`;
        }).join('');

        container.querySelectorAll('.toggle-switch').forEach(btn => btn.addEventListener('click', () => toggleRule(btn.dataset.ruleId, btn.dataset.enabled === 'true')));
        container.querySelectorAll('.rule-edit-btn').forEach(btn => btn.addEventListener('click', () => openRuleModal(btn.dataset.ruleId, btn.dataset.groupId)));
        container.querySelectorAll('.rule-del-btn').forEach(btn => btn.addEventListener('click', () => deleteRule(btn.dataset.ruleId)));
        container.querySelectorAll('.rule-group-relation').forEach(sel => sel.addEventListener('change', () => updateGroupRelation(sel.dataset.groupId, sel.value)));
        container.querySelectorAll('.rule-group-add').forEach(btn => btn.addEventListener('click', () => openRuleModal(null, btn.dataset.groupId)));
        container.querySelectorAll('.rule-group-del').forEach(btn => btn.addEventListener('click', () => deleteGroup(btn.dataset.groupId, parseInt(btn.dataset.count || '0'))));
      }

      async function updateGroupRelation(groupId, relation) {
        if (!currentExpression) return;
        const groups = currentExpression.groups.map(g =>
          g.id === groupId ? { id: g.id, relation, ruleIds: g.ruleIds } : g);
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relation: currentExpression.relation, groups })
          });
          if (!r.ok) throw new Error('保存失败');
          currentExpression = await r.json();
          await loadDetail();
        } catch (e) {
          showDetailError('保存分组关系失败：' + (e.message || '后端服务不可用'));
        }
      }

      /* ── Root relation（组间关系）── */
      function renderRootRelation() {
        const el = $('rulesRootRelation');
        if (!el) return;
        const rel = (currentExpression && currentExpression.relation) || 'OR';
        el.innerHTML = `
          <span class="root-label">匹配模式</span>
          <button class="root-rel-btn ${rel === 'AND' ? 'active' : ''}" data-rel="AND" type="button" data-func-tag="功能:组间AND" title="所有分组必须全部命中">所有条件满足（AND）</button>
          <button class="root-rel-btn ${rel === 'OR' ? 'active' : ''}" data-rel="OR" type="button" data-func-tag="功能:组间OR" title="任一分组命中即可">任一条件满足（OR）</button>
          <span class="root-label" style="margin-left:auto">分组间关系：分组可增删，组内可独立设置 AND/OR，等价于 SQL 的 (A OR B) AND (C OR D)</span>`;
        el.querySelectorAll('.root-rel-btn').forEach(btn => btn.addEventListener('click', () => updateRootRelation(btn.dataset.rel)));
      }

      async function updateRootRelation(newRelation) {
        if (!currentExpression) return;
        if (currentExpression.relation === newRelation) return;
        const groups = (currentExpression.groups) || [];
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relation: newRelation, groups })
          });
          if (!r.ok) throw new Error('保存失败');
          currentExpression = await r.json();
          await loadDetail();
        } catch (e) {
          showDetailError('保存分组间关系失败：' + (e.message || '后端服务不可用'));
        }
      }

      /* ── Group CRUD（添加/删除分组）── */
      async function addGroup() {
        if (!activeWsId || activeWsId === 'all') return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression/groups`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relation: 'OR' })
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.message || '创建分组失败');
          }
          currentExpression = await r.json();
          await loadDetail();
        } catch (e) {
          showDetailError('创建分组失败：' + (e.message || '后端服务不可用'));
        }
      }

      function deleteGroup(groupId, count) {
        if (!activeWsId || activeWsId === 'all') return;
        $('confirmTitle').textContent = '删除分组';
        $('confirmMessage').textContent = count > 0
          ? `确定删除此分组吗？将同时删除组内 ${count} 条规则，不可恢复。`
          : '确定删除此分组吗？删除后不可恢复。';
        const confirmActionBtn = $('confirmAction');
        confirmActionBtn.onclick = async () => {
          hideModal(confirmModal);
          rulesError.style.display = 'none';
          confirmActionBtn.disabled = true;
          confirmActionBtn.classList.add('btn-loading');
          try {
            const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
            if (!r.ok) throw new Error('删除失败');
            currentExpression = await r.json();
            await loadDetail();
          } catch (e) {
            rulesError.textContent = '删除分组失败：' + (e.message || '后端服务不可用');
            rulesError.style.display = 'block';
          } finally {
            confirmActionBtn.disabled = false;
            confirmActionBtn.classList.remove('btn-loading');
          }
        };
        showModal(confirmModal);
      }

      async function toggleRule(ruleId, currentEnabled) {
        rulesError.style.display = 'none';
        try {
          const rules = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rules`, { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : []);
          const rule = rules.find(r => r.id === ruleId);
          if (!rule) throw new Error('规则不存在');
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rules/${encodeURIComponent(ruleId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: rule.field, operator: rule.operator, value: rule.value, enabled: !currentEnabled })
          });
          if (!r.ok) throw new Error('更新失败');
          loadDetail();
        } catch (e) {
          rulesError.textContent = '操作失败：' + (e.message || '后端服务不可用');
          rulesError.style.display = 'block';
        }
      }
      function updateOperatorPills(field) {
        const container = $('ruleOperatorPills');
        const operators = FIELD_OPERATORS[field] || ['equals'];
        const currentOp = container.querySelector('.active')?.dataset?.operator;
        container.innerHTML = operators.map(op =>
          `<button class="operator-pill ${op === (currentOp || operators[0]) ? 'active' : ''}" data-operator="${op}" type="button">${OPERATOR_LABELS[op] || op}</button>`
        ).join('');
        container.querySelectorAll('.operator-pill').forEach(pill => {
          pill.addEventListener('click', function() {
            container.querySelectorAll('.operator-pill').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
          });
        });
      }

      function getSelectedOperator() {
        const active = $('ruleOperatorPills')?.querySelector('.active');
        return active ? active.dataset.operator : 'equals';
      }

      /* ── Tag Multi-Select ── */
      function addTag(tag) {
        tag = tag.trim();
        if (!tag || selectedTags.includes(tag)) return;
        selectedTags.push(tag);
        renderTagChips();
        $('tagInput').value = '';
        $('tagSuggestions').style.display = 'none';
      }
      function removeTag(tag) {
        selectedTags = selectedTags.filter(t => t !== tag);
        renderTagChips();
        $('tagInput').focus();
      }
      function renderTagChips() {
        const list = $('tagList');
        if (!selectedTags.length) { list.innerHTML = ''; return; }
        list.innerHTML = selectedTags.map(t =>
          `<span class="tag-chip">${escapeHtml(t)}<button class="tag-chip-remove" data-tag="${escapeHtml(t)}" type="button">&times;</button></span>`
        ).join('');
        list.querySelectorAll('.tag-chip-remove').forEach(btn => {
          btn.addEventListener('click', function(e) { e.stopPropagation(); removeTag(this.dataset.tag); });
        });
      }
      function renderTagSuggestions(query) {
        const suggestions = $('tagSuggestions');
        if (!query || !fieldValuesCache?.tag?.length) { suggestions.style.display = 'none'; return; }
        const q = query.toLowerCase();
        const matches = fieldValuesCache.tag.filter(t => t.toLowerCase().includes(q) && !selectedTags.includes(t));
        if (!matches.length) { suggestions.style.display = 'none'; return; }
        suggestions.innerHTML = matches.map(t =>
          `<div class="tag-suggestion-item" data-tag="${escapeHtml(t)}"><span>${escapeHtml(t)}</span></div>`
        ).join('');
        suggestions.style.display = '';
        suggestions.querySelectorAll('.tag-suggestion-item').forEach(item => {
          item.addEventListener('click', function() { addTag(this.dataset.tag); });
        });
      }

      /* ── Notion-style Calendar ── */
      function renderCalendar(year, month) {
        const cal = $('dateCalendar');
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const today = new Date();
        const todayStr = today.getFullYear() + '-' + today.getMonth() + '-' + today.getDate();
        const selStr = selectedCalDate ? selectedCalDate.getFullYear() + '-' + selectedCalDate.getMonth() + '-' + selectedCalDate.getDate() : '';
        const currentTime = $('timeInput').value || '';

        let html = `<div class="cal-header">
          <span class="cal-month-year">${year}年 ${month + 1}月</span>
          <div class="cal-nav">
            <button class="cal-nav-btn" data-cal-action="prev-month" type="button">&lsaquo;</button>
            <button class="cal-nav-btn" data-cal-action="next-month" type="button">&rsaquo;</button>
          </div>
        </div>
        <table class="cal-grid"><thead><tr>${weekDays.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody><tr>`;

        // Previous month padding
        let col = 0;
        for (let i = startDay - 1; i >= 0; i--) {
          const d = prevMonthDays - i;
          html += `<td><span class="cal-day other-month">${d}</span></td>`;
          col++;
        }
        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
          if (col > 0 && col % 7 === 0) html += '</tr><tr>';
          const dateStr = year + '-' + month + '-' + d;
          const cls = ['cal-day'];
          if (dateStr === todayStr) cls.push('today');
          if (dateStr === selStr) cls.push('selected');
          html += `<td><span class="${cls.join(' ')}" data-cal-day="${d}">${d}</span></td>`;
          col++;
        }
        // Next month padding
        let nextDay = 1;
        while (col % 7 !== 0) {
          html += `<td><span class="cal-day other-month">${nextDay}</span></td>`;
          nextDay++; col++;
        }
        html += '</tr></tbody></table>';

        // Footer with quick time picker
        html += `<div class="cal-footer">
          <div class="cal-footer-row">
            <button class="cal-footer-btn" data-cal-action="today" type="button">今天</button>
            <button class="cal-footer-btn" data-cal-action="clear" type="button">清除</button>
          </div>
          <div class="cal-time-quick">
            <button class="cal-time-btn${!currentTime ? ' active' : ''}" data-cal-time="" type="button">现在</button>
            <button class="cal-time-btn${currentTime === '00:00' ? ' active' : ''}" data-cal-time="00:00" type="button">00:00</button>
            <button class="cal-time-btn${currentTime === '06:00' ? ' active' : ''}" data-cal-time="06:00" type="button">06:00</button>
            <button class="cal-time-btn${currentTime === '12:00' ? ' active' : ''}" data-cal-time="12:00" type="button">12:00</button>
            <button class="cal-time-btn${currentTime === '18:00' ? ' active' : ''}" data-cal-time="18:00" type="button">18:00</button>
            <button class="cal-time-btn${currentTime === '23:59' ? ' active' : ''}" data-cal-time="23:59" type="button">23:59</button>
          </div>
        </div>`;

        cal.innerHTML = html;

        // Event handlers
        cal.querySelectorAll('[data-cal-action]').forEach(btn => btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const action = this.dataset.calAction;
          if (action === 'prev-month') { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth()); }
          else if (action === 'next-month') { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth()); }
          else if (action === 'today') { selectCalDate(new Date()); }
          else if (action === 'clear') { selectCalDate(null); }
        }));
        cal.querySelectorAll('[data-cal-day]').forEach(span => span.addEventListener('click', function() {
          const day = parseInt(this.dataset.calDay);
          const d = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day);
          selectCalDate(d);
        }));
        cal.querySelectorAll('[data-cal-time]').forEach(btn => btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const time = this.dataset.calTime;
          if (time) {
            $('timeInput').value = time;
          } else {
            // "现在" - set to current time
            const now = new Date();
            $('timeInput').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
          }
          // Update active state
          cal.querySelectorAll('.cal-time-btn').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
        }));
      }

      function selectCalDate(date) {
        selectedCalDate = date;
        const input = $('dateInput');
        if (date) {
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          input.value = `${y}-${m}-${d}`;
        } else {
          input.value = '';
          $('dateCalendar').style.display = 'none';
        }
        // Re-render calendar to update selected highlight, keep open for time selection
        if ($('dateCalendar').style.display !== 'none') {
          renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        }
      }

      function openCalendar() {
        const cal = $('dateCalendar');
        cal.style.display = cal.style.display === 'none' ? '' : 'none';
        if (cal.style.display !== 'none') {
          calendarDate = selectedCalDate ? new Date(selectedCalDate) : new Date();
          renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
        }
      }

      function closeCalendar() { $('dateCalendar').style.display = 'none'; }

      function switchRuleValueInput(field) {
        const select = $('ruleValueSelect');
        const input = $('ruleValueInput');
        const tags = $('ruleValueTags');
        const date = $('ruleValueDate');
        const hint = $('ruleValueHint');
        [select, input, tags, date].forEach(el => { if (el) el.style.display = 'none'; });
        hint.style.display = 'none';

        // Update operator pills
        updateOperatorPills(field);

        if (field === 'sourcePath') {
          input.style.display = '';
          input.placeholder = '输入来源路径';
          hint.style.display = '';
          hint.textContent = '支持路径片段匹配，如 /clips/notes/';
        } else if (field === 'updatedAt') {
          date.style.display = '';
          hint.style.display = '';
          hint.textContent = '选择日期时间，用于比较早于/晚于';
        } else if (field === 'tag') {
          tags.style.display = '';
          hint.style.display = '';
          hint.textContent = '输入标签名称搜索，点击或回车添加多个标签';
        } else {
          select.style.display = '';
          // Populate with values from cache
          if (fieldValuesCache && fieldValuesCache[field]) {
            const values = fieldValuesCache[field];
            select.innerHTML = values.length ? values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('') : '<option value="">（无可用值）</option>';
          } else {
            select.innerHTML = '<option value="">加载中...</option>';
            loadFieldValues().then(() => {
              if (fieldValuesCache && fieldValuesCache[field]) {
                select.innerHTML = fieldValuesCache[field].map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
              }
            }).catch(() => {});
          }
        }
      }

      async function loadFieldValues() {
        if (fieldValuesCache) return fieldValuesCache;
        try {
          const r = await fetch('/api/workspace/field-values', { headers: { Accept: 'application/json' } });
          if (r.ok) fieldValuesCache = await r.json();
        } catch (_) { fieldValuesCache = {}; }
        return fieldValuesCache;
      }

      function openRuleModal(ruleId, groupId) {
        editingRuleId = ruleId;
        $('ruleModalTitle').textContent = ruleId ? '编辑规则' : '添加规则';
        $('confirmRule').textContent = '保存';
        // Reset tag state
        selectedTags = [];
        selectedCalDate = null;
        // Populate target group dropdown
        const groupSelect = $('ruleModalGroup');
        if (groupSelect && currentExpression && currentExpression.groups && currentExpression.groups.length) {
          groupSelect.innerHTML = currentExpression.groups.map((g, i) =>
            `<option value="${escapeHtml(g.id)}">分组 ${i + 1}（${g.relation === 'AND' ? 'AND' : 'OR'}，${(g.ruleIds || []).length} 条）</option>`).join('');
          groupSelect.value = groupId || currentExpression.groups[0].id || '';
        } else if (groupSelect) {
          groupSelect.innerHTML = '<option value="">（自动创建分组）</option>';
          groupSelect.value = '';
        }
        // Pre-load field values
        loadFieldValues();
        if (ruleId) {
          fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rules`, { headers: { Accept: 'application/json' } })
            .then(r => r.ok ? r.json() : [])
            .then(rules => {
              const rule = rules.find(r => r.id === ruleId);
              if (rule) {
                $('ruleField').value = rule.field;
                $('ruleEnabled').checked = rule.enabled;
                $('ruleNegate').checked = rule.negate === true;
                switchRuleValueInput(rule.field);
                // Set the correct operator pill active
                const pills = $('ruleOperatorPills');
                pills.querySelectorAll('.operator-pill').forEach(p => {
                  p.classList.toggle('active', p.dataset.operator === rule.operator);
                });
                // Set the value in the correct input
                if (rule.field === 'updatedAt') {
                  // Parse date/time from value
                  const parts = rule.value.replace('T', ' ').split(' ');
                  if (parts[0]) {
                    const d = new Date(parts[0]);
                    if (!isNaN(d.getTime())) {
                      selectCalDate(d);
                    } else {
                      $('dateInput').value = parts[0];
                    }
                  }
                  if (parts[1] && parts[1].length >= 5) {
                    $('timeInput').value = parts[1].substring(0, 5);
                  }
                } else if (rule.field === 'sourcePath') {
                  $('ruleValueInput').value = rule.value;
                } else if (rule.field === 'tag') {
                  selectedTags = rule.value ? rule.value.split(',').map(t => t.trim()).filter(Boolean) : [];
                  renderTagChips();
                } else {
                  $('ruleValueSelect').value = rule.value;
                }
              }
            }).catch(() => {});
        } else {
          $('ruleField').value = 'type';
          $('ruleValueInput').value = '';
          $('dateInput').value = '';
          $('timeInput').value = '';
          selectedTags = [];
          renderTagChips();
          switchRuleValueInput('type');
          $('ruleEnabled').checked = true;
          $('ruleNegate').checked = false;
        }
        showModal(ruleModal);
      }
      $('addRuleBtn').addEventListener('click', () => openRuleModal(null));
      const addGroupBtn = $('addGroupBtn');
      if (addGroupBtn) addGroupBtn.addEventListener('click', addGroup);
      // Field change toggles value input type and operators
      $('ruleField').addEventListener('change', function() {
        switchRuleValueInput(this.value);
      });
      // Tag input events
      $('tagInput').addEventListener('input', function() {
        renderTagSuggestions(this.value);
      });
      $('tagInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTag(this.value);
        } else if (e.key === 'Backspace' && !this.value && selectedTags.length) {
          removeTag(selectedTags[selectedTags.length - 1]);
        } else if (e.key === 'Escape') {
          $('tagSuggestions').style.display = 'none';
        }
      });
      $('tagInput').addEventListener('blur', function() {
        setTimeout(() => { $('tagSuggestions').style.display = 'none'; }, 200);
      });
      // Date input events
      $('dateInput').addEventListener('click', function(e) {
        e.stopPropagation();
        openCalendar();
      });
      $('timeInput').addEventListener('input', function() {
        let v = this.value.replace(/[^0-9:]/g, '');
        if (v.length === 2 && !v.includes(':') && this.value.length > 2) {
          v = v.substring(0, 2) + ':' + v.substring(2);
        }
        this.value = v;
      });
      $('timeInput').addEventListener('blur', function() {
        const m = this.value.match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
          const h = String(Math.min(23, parseInt(m[1]))).padStart(2, '0');
          const min = String(Math.min(59, parseInt(m[2]))).padStart(2, '0');
          this.value = h + ':' + min;
        } else if (this.value) {
          this.value = '';
        }
      });
      $('confirmRule').addEventListener('click', async () => {
        const field = $('ruleField').value;
        const operator = getSelectedOperator();
        // Read value from the currently visible input
        let value;
        if (field === 'sourcePath') {
          value = $('ruleValueInput').value.trim();
        } else if (field === 'updatedAt') {
          const dateVal = $('dateInput').value;
          const timeVal = $('timeInput').value;
          if (dateVal) {
            value = timeVal ? dateVal + 'T' + timeVal + ':00' : dateVal + 'T00:00:00';
          } else {
            value = '';
          }
        } else if (field === 'tag') {
          value = selectedTags.join(',');
        } else {
          value = $('ruleValueSelect').value;
        }
        const enabled = $('ruleEnabled').checked;
        const negate = $('ruleNegate').checked;
        if (!value) { showDetailError('请输入规则值'); return; }
        rulesError.style.display = 'none';
        const confirmBtn = $('confirmRule');
        confirmBtn.disabled = true;
        confirmBtn.classList.add('btn-loading');
        try {
          const url = editingRuleId
            ? `/api/workspace/${encodeURIComponent(activeWsId)}/rules/${encodeURIComponent(editingRuleId)}`
            : `/api/workspace/${encodeURIComponent(activeWsId)}/rules`;
          const method = editingRuleId ? 'PUT' : 'POST';
          const body = { field, operator, value, enabled, negate };
          if (!editingRuleId && $('ruleModalGroup')) {
            body.groupId = $('ruleModalGroup').value;
          }
          const r = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.message || '保存失败');
          }
          hideModal(ruleModal);
          loadDetail();
        } catch (e) {
          rulesError.textContent = '保存失败：' + (e.message || '后端服务不可用');
          rulesError.style.display = 'block';
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('btn-loading');
        }
      });
      function deleteRule(ruleId) {
        $('confirmTitle').textContent = '删除规则';
        $('confirmMessage').textContent = '确定要删除此规则吗？删除后不可恢复。';
        const confirmActionBtn = $('confirmAction');
        confirmActionBtn.onclick = async () => {
          hideModal(confirmModal);
          rulesError.style.display = 'none';
          confirmActionBtn.disabled = true;
          confirmActionBtn.classList.add('btn-loading');
          try {
            const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
            if (!r.ok) throw new Error('删除失败');
            loadDetail();
          } catch (e) {
            rulesError.textContent = '删除失败：' + (e.message || '后端服务不可用');
            rulesError.style.display = 'block';
          } finally {
            confirmActionBtn.disabled = false;
            confirmActionBtn.classList.remove('btn-loading');
          }
        };
        showModal(confirmModal);
      }

      /* ── Exclusions ── */
      function renderExclusions(exclusions) {
        if (!exclusions?.length) {
          exclusionsList.innerHTML = '<div class="empty-state">暂无已排除的内容。</div>';
          return;
        }
        exclusionsList.innerHTML = exclusions.map(e =>
          `<div class="exclusion-card"><span class="exclusion-id" title="${escapeHtml(e.contentId)}">${escapeHtml(e.contentId)}</span>${e.reason ? `<span class="exclusion-reason">${escapeHtml(e.reason)}</span>` : ''}<span class="exclusion-date">${escapeHtml(formatDateTime(e.updatedAt || e.createdAt))}</span><button class="restore-btn" data-content-id="${escapeHtml(e.contentId)}" type="button" data-func-tag="功能:恢复排除" title="将内容恢复回工作台">恢复</button></div>`
        ).join('');
        exclusionsList.querySelectorAll('.restore-btn').forEach(btn => btn.addEventListener('click', () => restoreExclusion(btn.dataset.contentId)));
      }

      /* ── Suggestions ── */
      const suggestionBadge = $('suggestionBadge');
      const suggestionsList = $('suggestionsList');
      const suggestionsError = $('suggestionsError');
      const suggestionCount = $('suggestionCount');
      const cooldownHeader = $('cooldownHeader');
      const cooldownCount = $('cooldownCount');
      const cooldownList = $('cooldownList');

      const REASON_LABELS = { 'category-match': '分类匹配', 'tag-match': '标签匹配', 'directory-match': '目录匹配', 'member-pattern': '成员模式', 'habit-category': '习惯分类' };

      async function loadSuggestions(wsId) {
        if (!wsId) return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(wsId)}/suggestions`);
          if (!r.ok) throw new Error('加载建议失败');
          const suggestions = await r.json();
          renderSuggestions(suggestions);
        } catch (err) {
          suggestionsError.textContent = err.message;
          suggestionsError.style.display = '';
        }
        try {
          const rc = await fetch(`/api/workspace/suggestions/cooldown/${encodeURIComponent(wsId)}`);
          if (rc.ok) renderCooldown(await rc.json());
        } catch (_) { /* 冷却区加载失败不阻塞主列表 */ }
      }

      function renderCooldown(cooldowns) {
        const has = Array.isArray(cooldowns) && cooldowns.length > 0;
        cooldownHeader.style.display = has ? 'flex' : 'none';
        if (!has) { cooldownList.innerHTML = ''; return; }
        cooldownCount.textContent = cooldowns.length;
        cooldownList.innerHTML = cooldowns.map(s => {
          const isRule = s.type === 'rule-suggestion';
          const title = s.title || s.contentId || '（无标题）';
          return `<div class="cooldown-card">
            <div class="cooldown-info">
              <div class="cooldown-title">${escapeHtml(title)}</div>
              <div class="cooldown-meta">${isRule ? '规则建议' : '内容建议'} · 忽略后已进入冷却</div>
            </div>
            <button class="restore-suggestion-btn" data-id="${escapeHtml(s.id)}" type="button" data-func-tag="功能:恢复建议" title="撤销忽略，立即重新推荐">恢复推荐</button>
          </div>`;
        }).join('');
        cooldownList.querySelectorAll('.restore-suggestion-btn').forEach(btn =>
          btn.addEventListener('click', () => restoreSuggestion(btn.dataset.id)));
      }

      async function restoreSuggestion(suggestionId) {
        try {
          const r = await fetch(`/api/workspace/suggestions/${encodeURIComponent(suggestionId)}/restore`, { method: 'PUT' });
          if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || '恢复失败'); }
          showSuccessToast('已恢复该建议，重新推荐');
          if (activeWsId) loadSuggestions(activeWsId);
        } catch (err) { showDetailError(err.message); }
      }

      function renderSuggestions(suggestions) {
        suggestionBadge.style.display = suggestions?.length ? 'inline-flex' : 'none';
        if (suggestionBadge.style.display !== 'none') suggestionBadge.textContent = suggestions.length;
        suggestionCount.textContent = suggestions?.length || 0;
        if (!suggestions?.length) {
          suggestionsList.innerHTML = '<div class="empty-state">暂无候选推荐。继续使用内容整理后，系统会根据你的习惯生成建议。</div>';
          return;
        }
        suggestionsList.innerHTML = suggestions.map(s => {
          const reasons = (s.reasons || []).map(r => REASON_LABELS[r] || r).join(', ');
          const isRule = s.type === 'rule-suggestion';
          const title = s.title || s.contentId || '（无标题）';
          const scoreDisplay = isRule ? '⚙' : Math.round(s.score * 100) + '%';
          const scoreLabel = isRule ? '规则建议' : '匹配度';
          return `<div class="suggestion-card${isRule ? ' rule-suggestion' : ''}" data-id="${escapeHtml(s.id)}" onclick="openSuggestionDetail('${escapeHtml(s.id)}')">
            <div class="suggestion-score">
              <span class="score-value">${scoreDisplay}</span>
              <span class="score-label">${scoreLabel}</span>
            </div>
            <div class="suggestion-info">
              <div class="suggestion-title">${escapeHtml(title)}</div>
              <div class="suggestion-meta">${escapeHtml(reasons)}</div>
              <div class="suggestion-reasons">${(s.reasons || []).map(r => `<span class="suggestion-reason">${REASON_LABELS[r] || r}</span>`).join('')}</div>
            </div>
            <div class="suggestion-actions">
              <button class="accept-btn" data-id="${escapeHtml(s.id)}" type="button" data-func-tag="功能:接受建议" title="采纳该建议">接受</button>
              <button class="ignore-btn" data-id="${escapeHtml(s.id)}" type="button" data-func-tag="功能:忽略建议" title="忽略该建议">忽略</button>
              <button class="reject-btn" data-id="${escapeHtml(s.id)}" type="button" data-func-tag="功能:拒绝建议" title="拒绝该建议">拒绝</button>
            </div>
          </div>`;
        }).join('');
        // 阻止卡片点击事件冒泡到操作按钮
        suggestionsList.querySelectorAll('.suggestion-card .accept-btn, .suggestion-card .ignore-btn, .suggestion-card .reject-btn').forEach(btn => {
          btn.addEventListener('click', function(e) { e.stopPropagation(); });
        });
        suggestionsList.querySelectorAll('.accept-btn').forEach(btn => btn.addEventListener('click', () => acceptSuggestion(btn.dataset.id)));
        suggestionsList.querySelectorAll('.ignore-btn').forEach(btn => btn.addEventListener('click', () => ignoreSuggestion(btn.dataset.id)));
        suggestionsList.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', () => rejectSuggestion(btn.dataset.id)));
      }

      function showSuccessToast(msg) {
        if (window.UI && UI.toast) {
          UI.toast(msg, { type: 'success', duration: 3000 });
          return;
        }
        const toast = $('successToast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
      }

      async function openSuggestionDetail(suggestionId) {
        try {
          // 先尝试加载详情
          const r = await fetch(`/api/workspace/suggestions/${encodeURIComponent(suggestionId)}/detail`);
          if (!r.ok) throw new Error('加载详情失败');
          const detail = await r.json();
          // 填充弹窗内容
          $('sdTitle').textContent = detail.contentTitle || detail.title || '（无标题）';
          $('sdCategory').textContent = detail.category || '（无分类）';
          $('sdTags').textContent = detail.tags?.length ? detail.tags.join(', ') : '（无标签）';
          $('sdSummary').textContent = detail.summary || '（无内容摘要）';
          $('sdScore').textContent = Math.round(detail.score * 100) + '%';
          $('sdReasons').innerHTML = (detail.reasons || [])
            .map(r => `<span class="suggestion-reason">${REASON_LABELS[r] || r}</span>`).join('');
          // 绑定操作按钮
          $('sdAcceptBtn').onclick = async function() { closeSuggestionDetail(); await acceptSuggestion(suggestionId); };
          $('sdIgnoreBtn').onclick = async function() { closeSuggestionDetail(); await ignoreSuggestion(suggestionId); };
          $('sdRejectBtn').onclick = async function() { closeSuggestionDetail(); await rejectSuggestion(suggestionId); };
          $('suggestionDetailOverlay').style.display = 'flex';
        } catch (err) {
          showDetailError(err.message);
        }
      }
      function closeSuggestionDetail() {
        $('suggestionDetailOverlay').style.display = 'none';
      }

      async function acceptSuggestion(suggestionId) {
        try {
          const r = await fetch(`/api/workspace/suggestions/${encodeURIComponent(suggestionId)}/accept`, { method: 'PUT' });
          if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || '接受失败'); }
          showSuccessToast('✓ 已接受建议');
          if (activeWsId) { loadSuggestions(activeWsId); loadDetail(); }
        } catch (err) { showDetailError(err.message); }
      }

      async function ignoreSuggestion(suggestionId) {
        try {
          const r = await fetch(`/api/workspace/suggestions/${encodeURIComponent(suggestionId)}/ignore`, { method: 'PUT' });
          if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || '忽略失败'); }
          showSuccessToast('已忽略，7 天内不再推荐该建议');
          if (activeWsId) loadSuggestions(activeWsId);
        } catch (err) { showDetailError(err.message); }
      }

      async function rejectSuggestion(suggestionId) {
        try {
          const r = await fetch(`/api/workspace/suggestions/${encodeURIComponent(suggestionId)}/reject`, { method: 'PUT' });
          if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || '拒绝失败'); }
          showSuccessToast('已拒绝建议');
          if (activeWsId) loadSuggestions(activeWsId);
        } catch (err) { showDetailError(err.message); }
      }

      /* ── New Workspace ── */
      $('newWsBtn').addEventListener('click', () => {
        editingWsId = null;
        $('wsName').value = '';
        $('wsDesc').value = '';
        $('wsType').value = 'general';
        $('wsColor').value = '#2383e2';
        $('wsType').closest('.form-group').parentElement.style.display = ''; // 显示类型行
        newWsModal.querySelector('.modal-header h3').textContent = '新建工作台';
        $('confirmNewWs').textContent = '创建';
        showModal(newWsModal);
      });
      // 打开编辑弹窗（复用新建弹窗字段）
      function openEditWorkspace(wsId) {
        const ws = workspaces.find(w => w.id === wsId);
        if (!ws) return;
        editingWsId = wsId;
        $('wsName').value = ws.name || '';
        $('wsDesc').value = ws.description || '';
        $('wsType').value = ws.type || 'general';
        $('wsColor').value = ws.color || '#2383e2';
        // 编辑时不修改类型
        $('wsType').closest('.form-group').parentElement.style.display = 'none';
        newWsModal.querySelector('.modal-header h3').textContent = '编辑工作台';
        $('confirmNewWs').textContent = '保存';
        showModal(newWsModal);
      }
      $('confirmNewWs').addEventListener('click', async () => {
        const name = $('wsName').value.trim();
        if (!name) { showDetailError('请输入工作台名称'); return; }
        try {
          if (editingWsId) {
            const r = await fetch('/api/workspace/' + encodeURIComponent(editingWsId) + '/settings', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, description: $('wsDesc').value.trim(), color: $('wsColor').value })
            });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              throw new Error(err.message || '保存失败');
            }
            hideModal(newWsModal);
            editingWsId = null;
            await loadWorkspaces();
            if (activeWsId) loadDetail();
            showDetailError('✓ 已保存工作台');
            return;
          }
          const r = await fetch('/api/workspace', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: $('wsDesc').value.trim(), type: $('wsType').value, color: $('wsColor').value })
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.message || '创建失败');
          }
          const ws = await r.json();
          hideModal(newWsModal);
          // Reload workspace list and select new one
          await loadWorkspaces();
          selectWorkspace(ws.id);
        } catch (e) {
          showDetailError('创建失败：' + (e.message || '后端服务不可用'));
        }
      });

      /* ── Modal close handlers ── */
      document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
          const modal = $(btn.dataset.close);
          if (modal) hideModal(modal);
        });
      });
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
          if (e.target === overlay) hideModal(overlay);
        });
      });

      // Close calendar on outside click
      document.addEventListener('click', function(e) {
        const cal = $('dateCalendar');
        if (cal && cal.style.display !== 'none' && !e.target.closest('.date-picker-field')) {
          cal.style.display = 'none';
        }
      });

      // Tag multi-input container click -> focus input
      const tagContainer = $('ruleValueTags');
      if (tagContainer) {
        tagContainer.addEventListener('click', function(e) {
          if (!e.target.closest('.tag-chip') && !e.target.closest('.tag-suggestions')) {
            $('tagInput').focus();
          }
        });
      }

      /* ── Tab switching ── */
      document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          switchToTab(tab.dataset.tab);
        });
      });

      /* ── View toggle & Kanban ── */
      let currentView = 'list';
      const viewToggle = $('viewToggle');
      const kanbanBoard = $('kanbanBoard');
      let detailColumns = [];

      viewToggle.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn || !btn.dataset.view) return;
        const view = btn.dataset.view;
        if (view === currentView) return;
        currentView = view;
        viewToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (view === 'kanban') {
          renderKanbanBoard();
        }
        $('detailContentList').style.display = view === 'list' ? 'grid' : 'none';
        kanbanBoard.classList.toggle('visible', view === 'kanban');
      });

      function renderKanbanBoard() {
        const cols = detailColumns;
        if (!cols.length) {
          kanbanBoard.innerHTML = '<div class="empty-state" style="width:100%;padding:50px 20px">暂无看板列数据</div>';
          return;
        }
        // Group contents by boardColumnId
        const grouped = {};
        cols.forEach(c => { grouped[c.id] = []; });
        const noCol = []; // contents without a column assignment
        detailState.filtered.forEach(item => {
          const colId = item.boardColumnId;
          if (colId && grouped[colId] !== undefined) {
            grouped[colId].push(item);
          } else {
            noCol.push(item);
          }
        });
        // Put unassigned items in the first column
        if (noCol.length && cols.length) {
          grouped[cols[0].id] = [...noCol, ...grouped[cols[0].id]];
        }

        // Build columns HTML with action buttons
        kanbanBoard.innerHTML = cols.map(col => {
          const items = grouped[col.id] || [];
          const delDisabled = col.isDefault ? ' disabled title="默认列不能删除"' : '';
          return `<div class="kanban-col" data-col-id="${escapeHtml(col.id)}">
            <div class="kanban-col-header">
              <h3>${escapeHtml(col.name)} <span class="kanban-col-count">${items.length}</span></h3>
              <div class="col-actions">
                <button class="col-action-btn rename" data-col-id="${escapeHtml(col.id)}" title="重命名" type="button" data-func-tag="功能:重命名看板列">&#9998;</button>
                <button class="col-action-btn delete${col.isDefault ? ' disabled' : ''}" data-col-id="${escapeHtml(col.id)}" title="${col.isDefault ? '默认列不能删除' : '删除'}" type="button"${delDisabled} data-func-tag="功能:删除看板列">&times;</button>
              </div>
            </div>
            <div class="kanban-col-body" data-col-id="${escapeHtml(col.id)}">
              ${items.length ? items.map(item => renderKanbanCard(item)).join('') : '<div class="empty-state" style="padding:20px 10px;font-size:12px">拖拽内容到此列</div>'}
            </div>
          </div>`;
        }).join('') + '<div class="kanban-add-col" id="kanbanAddCol" title="添加看板列" data-func-tag="功能:添加看板列">+</div>';

        // Attach column action handlers
        kanbanBoard.querySelectorAll('.col-action-btn.rename').forEach(btn => {
          btn.addEventListener('click', () => {
            const colId = btn.dataset.colId;
            const col = detailColumns.find(c => c.id === colId);
            if (!col) return;
            $('columnInputTitle').textContent = '重命名看板列';
            $('columnInputValue').value = col.name;
            $('columnInputValue').placeholder = '输入新名称';
            $('confirmColumnInput').onclick = function() {
              const newName = $('columnInputValue').value.trim();
              if (newName && newName !== col.name) {
                renameColumn(colId, newName);
              }
              hideModal(columnInputModal);
            };
            showModal(columnInputModal);
            setTimeout(function() { $('columnInputValue').focus(); }, 100);
          });
        });
        kanbanBoard.querySelectorAll('.col-action-btn.delete:not(.disabled)').forEach(btn => {
          btn.addEventListener('click', () => deleteColumn(btn.dataset.colId));
        });
        const addColBtn = kanbanBoard.querySelector('#kanbanAddCol');
        if (addColBtn) {
          addColBtn.addEventListener('click', () => {
            $('columnInputTitle').textContent = '添加看板列';
            $('columnInputValue').value = '';
            $('columnInputValue').placeholder = '输入看板列名称';
            $('confirmColumnInput').onclick = function() {
              const name = $('columnInputValue').value.trim();
              if (name) addColumn(name);
              hideModal(columnInputModal);
            };
            showModal(columnInputModal);
            setTimeout(function() { $('columnInputValue').focus(); }, 100);
          });
        }

        // Attach drag events
        kanbanBoard.querySelectorAll('.kanban-card').forEach(card => {
          card.addEventListener('dragstart', onDragStart);
          card.addEventListener('dragend', onDragEnd);
        });
        kanbanBoard.querySelectorAll('.kanban-col-body').forEach(body => {
          body.addEventListener('dragover', onDragOver);
          body.addEventListener('dragleave', onDragLeave);
          body.addEventListener('drop', onDrop);
        });
        // Attach exclude button handlers
        kanbanBoard.querySelectorAll('.exclude-btn').forEach(btn => {
          btn.addEventListener('click', () => excludeContent(btn.dataset.contentId, btn.dataset.contentTitle));
        });
      }

      function renderKanbanCard(item) {
        const meta = [item.category, ...(item.tags || []).map(t => '#' + t)].filter(Boolean).join(' · ');
        return `<div class="kanban-card" draggable="true" data-content-id="${escapeHtml(item.id)}" data-board-col-id="${escapeHtml(item.boardColumnId || '')}">
          <div class="card-header">
            <span class="type-mark" data-type="${escapeHtml(item.type)}">${escapeHtml(INITIALS[item.type] || '内')}</span>
            <h4 class="card-title" title="${escapeHtml(item.title || '无标题')}">${escapeHtml(item.title || '无标题')}</h4>
          </div>
          ${meta ? `<div class="card-meta"><span class="tag">${escapeHtml(meta)}</span></div>` : ''}
          <div class="card-actions">
            <button class="exclude-btn" data-content-id="${escapeHtml(item.id)}" data-content-title="${escapeHtml(item.title || '')}" type="button" data-func-tag="功能:排除内容" title="将内容从当前工作台排除">排除</button>
          </div>
        </div>`;
      }

      /* ── Drag-and-drop ── */
      let dragContentId = null;

      function onDragStart(e) {
        const card = e.target.closest('.kanban-card');
        if (!card) return;
        dragContentId = card.dataset.contentId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragContentId);
      }

      function onDragEnd(e) {
        const card = e.target.closest('.kanban-card');
        if (card) card.classList.remove('dragging');
        kanbanBoard.querySelectorAll('.kanban-col-body').forEach(b => b.classList.remove('drag-over'));
        dragContentId = null;
      }

      function onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const body = e.currentTarget;
        body.classList.add('drag-over');
      }

      function onDragLeave(e) {
        const body = e.currentTarget;
        // relatedTarget 可为 null（拖拽离开浏览器窗口时）
        if (!e.relatedTarget || !body.contains(e.relatedTarget)) {
          body.classList.remove('drag-over');
        }
      }

      async function onDrop(e) {
        e.preventDefault();
        const body = e.currentTarget;
        body.classList.remove('drag-over');
        const targetColId = body.dataset.colId;
        const contentId = e.dataTransfer.getData('text/plain') || dragContentId;
        if (!contentId || !targetColId) return;
        // Check if actually changed column
        const card = kanbanBoard.querySelector(`.kanban-card[data-content-id="${contentId}"]`);
        const currentColId = card ? card.dataset.boardColId : '';
        if (currentColId === targetColId) return;
        if (!activeWsId) return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/members/${encodeURIComponent(contentId)}/move`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardColumnId: targetColId, position: 0 })
          });
          if (!r.ok) throw new Error('移动失败');
          // Update local state
          const item = detailState.contents.find(i => i.id === contentId);
          if (item) item.boardColumnId = targetColId;
          // Re-render kanban
          renderKanbanBoard();
        } catch (err) {
          showDetailError('移动失败：' + (err.message || '后端服务不可用'));
        }
      }

      /* ── Column Management ── */

      async function addColumn(name) {
        if (!activeWsId) return;
        try {
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/columns`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          if (!r.ok) throw new Error('创建失败');
          const col = await r.json();
          detailColumns.push(col);
          detailColumns.sort((a, b) => a.position - b.position);
          renderKanbanBoard();
        } catch (err) {
          alert('创建看板列失败：' + (err.message || '后端服务不可用'));
        }
      }

      async function renameColumn(columnId, newName) {
        if (!activeWsId) return;
        try {
          const col = detailColumns.find(c => c.id === columnId);
          if (!col) return;
          const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/columns/${encodeURIComponent(columnId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: col.key, name: newName })
          });
          if (!r.ok) throw new Error('重命名失败');
          const updated = await r.json();
          const idx = detailColumns.findIndex(c => c.id === columnId);
          if (idx >= 0) detailColumns[idx] = updated;
          renderKanbanBoard();
        } catch (err) {
          showDetailError('重命名失败：' + (err.message || '后端服务不可用'));
        }
      }

      async function deleteColumn(columnId) {
        if (!activeWsId) return;
        const col = detailColumns.find(c => c.id === columnId);
        if (!col || col.isDefault) return;
        $('confirmTitle').textContent = '删除看板列';
        $('confirmMessage').textContent = `确定要删除看板列"${col.name}"吗？该列中的内容将移至第一列。`;
        $('confirmAction').onclick = async () => {
          hideModal(confirmModal);
          try {
            const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/columns/${encodeURIComponent(columnId)}`, {
              method: 'DELETE'
            });
            if (!r.ok) throw new Error('删除失败');
            detailColumns = detailColumns.filter(c => c.id !== columnId);
            // Reset boardColumnId for members in this column
            detailState.contents.forEach(item => {
              if (item.boardColumnId === columnId) item.boardColumnId = null;
            });
            renderKanbanBoard();
          } catch (err) {
            showDetailError('删除失败：' + (err.message || '后端服务不可用'));
          }
        };
        showModal(confirmModal);
      }

      /* ── Detail search ── */
      let detailSearchTimer;
      detailSearchInput.addEventListener('input', () => {
        clearTimeout(detailSearchTimer);
        detailSearchTimer = setTimeout(() => {
          detailState.query = detailSearchInput.value.trim();
          renderDetailContents();
          if (currentView === 'kanban') renderKanbanBoard();
        }, 260);
      });

      /* ── Theme / 父窗口消息（置顶、刷新） ── */
      function scrollWorkspaceToTop(behavior) {
        try { window.scrollTo({ top: 0, behavior: behavior || 'auto' }); } catch (e) { window.scrollTo(0, 0); }
        const main = document.querySelector('.main-area');
        if (main) { try { main.scrollTo({ top: 0, behavior: behavior || 'auto' }); } catch (e) { main.scrollTop = 0; } }
      }
      window.addEventListener('message', event => {
        const action = event.data?.action;
        if (action === 'themeChange') document.documentElement.setAttribute('data-theme', event.data.theme);
        if (action === 'refresh') {
          if (overviewView.classList.contains('hidden')) {
            loadDetailOverview();
            if (activeWsId) {
              loadDetail();
            }
          } else {
            loadOverview();
          }
          loadWorkspaces();
          if (productDevView && productDevView.classList.contains('visible')) loadProductDev();
          // 刷新数据后回到顶部，让内容更新可见（避免"只对图标有效"的观感）
          scrollWorkspaceToTop('auto');
        }
        if (action === 'scrollToTop') {
          scrollWorkspaceToTop('smooth');
        }
      });
      document.documentElement.setAttribute('data-theme', localStorage.getItem('app_theme_v1') || 'notion');

      /* ── Refresh button handler ── */
      if (refreshButton) {
        refreshButton.addEventListener('click', async function() {
          const btn = this;
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;flex:none"></span> 重建索引中...';
          const info = $('refreshInfo');
          if (info) { info.textContent = '索引重建中...'; info.className = 'refresh-info show'; }
          try {
            const r = await fetch('/api/data/rebuild', { method: 'POST' });
            if (!r.ok) throw new Error('请求失败（' + r.status + '）');
            const data = await r.json();
            btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引 ✓';
            if (info) { info.textContent = '✓ ' + (data.message || '索引已重建'); info.className = 'refresh-info show success'; }
            await loadOverview();
          } catch (e) {
            btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引 ✗';
            if (info) { info.textContent = '✗ ' + (e.message || '重建失败'); info.className = 'refresh-info show error'; }
          } finally {
            setTimeout(function() { btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引'; btn.disabled = false; if (info) { info.className = 'refresh-info'; } }, 1500);
          }
        });
      }
      // Detail view refresh button
      const detailRefreshBtn = $('detailRefreshButton');
      if (detailRefreshBtn) {
        detailRefreshBtn.addEventListener('click', async function() {
          const btn = this;
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;flex:none"></span> 重建索引中...';
          try {
            const r = await fetch('/api/data/rebuild', { method: 'POST' });
            if (!r.ok) throw new Error('请求失败（' + r.status + '）');
            const data = await r.json();
            btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引 ✓';
            await loadDetailOverview();
            if (activeWsId) {
              await loadDetail();
            }
          } catch (e) {
            btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引 ✗';
          } finally {
            setTimeout(function() { btn.innerHTML = '<span aria-hidden="true">↻</span> 刷新索引'; btn.disabled = false; }, 1500);
          }
        });
      }

      /* ── 产品概览 ── */
      document.querySelectorAll('.pd-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.pd-tab').forEach(function(t) { t.classList.remove('active'); });
          document.querySelectorAll('.pd-tab-content').forEach(function(c) { c.classList.remove('visible'); });
          tab.classList.add('active');
          var content = document.querySelector('.pd-tab-content[data-pd-content="' + tab.dataset.pdTab + '"]');
          if (content) content.classList.add('visible');
        });
      });

      var pdChartInstances = {};
      var activePdTag = '';

      function pdUrl(path) {
        return activePdTag ? path + '?tag=' + encodeURIComponent(activePdTag) : path;
      }

      function renderPdTagFilter(tags) {
        var el = $('pdTagFilter');
        if (!el) return;
        if (!tags || !tags.length) {
          el.innerHTML = '';
          return;
        }
        var pills = ['<span class="pd-tag-filter-label">标签筛选：</span>'];
        pills.push('<button class="pd-tag-pill' + (activePdTag ? '' : ' active') + '" data-tag="" type="button">全部</button>');
        tags.forEach(function(t) {
          pills.push('<button class="pd-tag-pill' + (activePdTag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '" type="button">' + escapeHtml(t) + '</button>');
        });
        el.innerHTML = pills.join('');
      }

      // 标签筛选条点击（本地过滤，无需重新请求）
      document.addEventListener('click', function(e) {
        var pill = e.target.closest && e.target.closest('#pdTagFilter .pd-tag-pill');
        if (!pill) return;
        activePdTag = pill.dataset.tag || '';
        loadProductDev();
      });

      function monthLabelOf(value) {
        if (!value) return '';
        var d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      }

      async function loadProductDev() {
        // Reset chart instances
        Object.values(pdChartInstances).forEach(function(c) { if (c) c.destroy(); });
        pdChartInstances = {};
        try {
          // 数据源：FeaturePointsService 读取 TODO/{需求名称}/feature-points.json
          // 迭代记录：FeaturePointIterationService 读取 feature-point-iterations.json
          const [fpRes, iterRes] = await Promise.all([
            fetch('/api/workspace/feature-points'),
            fetch('/api/workspace/feature-points/iterations').catch(function() { return { ok: false }; })
          ]);
          if (!fpRes.ok) {
            var errBody = await fpRes.json().catch(function() { return {}; });
            throw new Error(errBody.error || '产品概览数据获取失败');
          }
          const data = await fpRes.json();
          const projects = data.projects || [];

          // 迭代记录缓存（全部加载，前端本地过滤）
          pdIterations = iterRes && iterRes.ok ? (await iterRes.json().catch(function() { return []; })) : [];

          // 缓存所有 feature point 供详情弹窗使用（key 为 项目::功能点ID，避免跨项目 ID 冲突）
          pdRequirementsCache = {};
          projects.forEach(function(proj) {
            var dirName = proj.dirName || '未知项目';
            var req = proj.requirement || {};
            (proj.featurePoints || []).forEach(function(fp) {
              var key = dirName + '::' + fp.id;
              pdRequirementsCache[key] = {
                id: fp.id,
                key: key,
                title: fp.name,
                description: fp.description,
                tags: fp.tags || [],
                phase: req.phase || 'analysis',
                status: 'done',
                createdAt: req.createdAt || '',
                updatedAt: fp.updatedAt || req.completedAt || '',
                completedAt: req.completedAt || '',
                source: 'archive',
                projectName: dirName,
                requirementTitle: req.title || '',
                layer: fp.layer || '',
                tasks: fp.tasks || [],
                verifications: fp.verifications || [],
                designSections: fp.designSections || [],
                filePath: 'TODO/' + dirName + '/feature-points.json'
              };
            });
            (proj.knowledgePoints || []).forEach(function(kp) {
              var key = 'kp::' + dirName + '::' + (kp.title || kp.id);
              pdRequirementsCache[key] = {
                id: 'kp_' + (kp.title || kp.id),
                key: key,
                title: kp.title,
                description: kp.content || kp.description || '',
                tags: kp.tags || [],
                phase: 'completed',
                status: 'done',
                createdAt: req.createdAt || '',
                updatedAt: '',
                completedAt: req.completedAt || '',
                source: 'archive',
                projectName: dirName,
                requirementTitle: req.title || '',
                layer: 'knowledge',
                tasks: [],
                verifications: [],
                designSections: [],
                filePath: 'TODO/' + dirName + '/feature-points.json'
              };
            });
          });

          // 标签筛选：收集所有项目中的 feature point 和 knowledge point 标签
          const tagSet = {};
          projects.forEach(function(proj) {
            (proj.featurePoints || []).forEach(function(fp) {
              (fp.tags || []).forEach(function(t) { if (t) tagSet[t] = 1; });
            });
            (proj.knowledgePoints || []).forEach(function(kp) {
              (kp.tags || []).forEach(function(t) { if (t) tagSet[t] = 1; });
            });
          });
          renderPdTagFilter(Object.keys(tagSet).sort());

          // 本地标签过滤：筛选匹配标签的项目
          var filteredProjects = activePdTag
            ? projects.filter(function(proj) {
                var hasTag = false;
                (proj.featurePoints || []).forEach(function(fp) {
                  if ((fp.tags || []).indexOf(activePdTag) >= 0) hasTag = true;
                });
                (proj.knowledgePoints || []).forEach(function(kp) {
                  if ((kp.tags || []).indexOf(activePdTag) >= 0) hasTag = true;
                });
                return hasTag;
              })
            : projects;

          // ── 实用性数据统计 ──
          var filteredFp = 0;
          var filteredKp = 0;
          var taskDone = 0;
          var taskTotal = 0;
          var designSectionCount = 0;
          var iterCount = 0;
          var phaseDist = {};
          var layerDist = {};
          var tagCounts = {};
          var kpByMonth = {};
          var fpByMonth = {};
          var allTasks = [];
          filteredProjects.forEach(function(proj) {
            // 按 requirement.phase 统计项目阶段
            var phase = proj.requirement && proj.requirement.phase ? proj.requirement.phase : 'unknown';
            phaseDist[phase] = (phaseDist[phase] || 0) + 1;
            var reqDate = proj.requirement && (proj.requirement.completedAt || proj.requirement.createdAt);
            var monthKey = monthLabelOf(reqDate);
            (proj.featurePoints || []).forEach(function(fp) {
              filteredFp++;
              layerDist[fp.layer || 'unknown'] = (layerDist[fp.layer || 'unknown'] || 0) + 1;
              (fp.tags || []).forEach(function(t) { if (t) tagCounts[t] = (tagCounts[t] || 0) + 1; });
              (fp.designSections || []).forEach(function(s) {
                if (typeof s === 'string' || (s && s.section)) designSectionCount++;
              });
              if (monthKey) fpByMonth[monthKey] = (fpByMonth[monthKey] || 0) + 1;
              (fp.tasks || []).forEach(function(task) {
                var s = task.status || 'todo';
                taskTotal++;
                if (s === 'done') taskDone++;
                allTasks.push({
                  title: task.title,
                  status: s,
                  fpName: fp.name,
                  fpId: fp.id,
                  fpKey: proj.dirName + '::' + fp.id,
                  projectName: proj.dirName
                });
              });
            });
            (proj.knowledgePoints || []).forEach(function(kp) {
              filteredKp++;
              (kp.tags || []).forEach(function(t) { if (t) tagCounts[t] = (tagCounts[t] || 0) + 1; });
              if (monthKey) kpByMonth[monthKey] = (kpByMonth[monthKey] || 0) + 1;
            });
            // 迭代记录计数（当前筛选范围内项目的功能点迭代）
            pdIterations.forEach(function(rec) {
              if (rec.project === proj.dirName) iterCount++;
            });
          });

          var phaseDistArray = Object.keys(phaseDist).map(function(k) {
            return { phase: k, count: phaseDist[k] };
          });
          var taskRate = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0;
          var layerDistArray = Object.keys(layerDist).map(function(k) {
            return { layer: k, count: layerDist[k] };
          });
          var tagCountsArray = Object.keys(tagCounts).map(function(k) {
            return { tag: k, count: tagCounts[k] };
          }).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
          // 知识积累趋势：按月份累计（知识 + 功能点）
          var monthSet = {};
          Object.keys(kpByMonth).forEach(function(m) { monthSet[m] = 1; });
          Object.keys(fpByMonth).forEach(function(m) { monthSet[m] = 1; });
          var knowledgeTrend = [];
          var cum = 0;
          Object.keys(monthSet).sort().forEach(function(m) {
            cum += (kpByMonth[m] || 0) + (fpByMonth[m] || 0);
            knowledgeTrend.push({ month: m, count: cum });
          });

          // 统计卡片
          renderPdDashboard({
            total: filteredProjects.length,
            totalProj: filteredProjects.length,
            totalFp: filteredFp,
            totalKp: filteredKp,
            taskDone: taskDone,
            taskTotal: taskTotal,
            taskRate: taskRate,
            designSectionCount: designSectionCount,
            iterCount: iterCount,
            reqCompleted: filteredProjects.filter(function(p) {
              return p.requirement && p.requirement.phase === 'completed';
            }).length,
            reqDesign: filteredProjects.filter(function(p) {
              return p.requirement && (p.requirement.phase === 'design' || p.requirement.phase === 'analysis');
            }).length
          });

          // 图表：阶段分布 / 任务完成率 / 知识趋势 / 模块分布 / 热门标签
          renderPdCharts(phaseDistArray, { completed: taskDone, total: Math.max(taskTotal, 1) }, knowledgeTrend, layerDistArray, tagCountsArray);

          // 渲染任务状态列表
          renderPdTaskList(allTasks);

          // 最近活动：按真实时间（updatedAt / completedAt / createdAt / 迭代记录时间）倒序
          var allFps = [];
          filteredProjects.forEach(function(proj) {
            var req = proj.requirement || {};
            (proj.featurePoints || []).forEach(function(fp) {
              var time = fp.updatedAt || req.completedAt || req.createdAt || '';
              allFps.push({
                action: 'archived',
                title: fp.name,
                description: proj.dirName,
                fpId: fp.id,
                fpKey: proj.dirName + '::' + fp.id,
                time: time
              });
            });
          });
          // 迭代记录也进入最近活动（最新迭代优先展示）
          var filteredDirs = {};
          filteredProjects.forEach(function(p) { filteredDirs[p.dirName] = 1; });
          (pdIterations || []).forEach(function(rec) {
            if (!filteredDirs[rec.project]) return;
            allFps.push({
              action: 'iterated',
              title: (rec.fpName || '功能点') + (rec.version ? ' · ' + rec.version : ''),
              description: '迭代记录 · ' + rec.project,
              fpId: rec.fpId,
              fpKey: rec.project + '::' + rec.fpId,
              time: rec.createdAt || ''
            });
          });
          allFps.sort(function(a, b) { return (b.time || '').localeCompare(a.time || ''); });
          renderPdActivities(allFps.slice(0, 8));

          // 看板：按项目/按阶段分组展示 feature points（含任务进度与迭代徽标）
          renderPdKanban(filteredProjects);

          // 二期功能：知识图谱 / 甘特图隐藏，空数据占位
          renderPdGraph({ nodes: [], edges: [] });
          renderPdTimeline([]);

          // 归档列表：展示所有项目（含 fpCount / phase / firstFpId）
          renderPdArchives(filteredProjects.map(function(proj) {
            var fps = proj.featurePoints || [];
            var firstFp = fps.length > 0 ? fps[0] : null;
            return {
              type: 'requirement',
              title: proj.requirement && proj.requirement.title ? proj.requirement.title : proj.dirName,
              source: 'migrate',
              phase: proj.requirement && proj.requirement.phase ? proj.requirement.phase : 'completed',
              createdAt: proj.requirement && proj.requirement.createdAt ? proj.requirement.createdAt : '',
              fpCount: fps.length,
              firstFpId: firstFp ? (proj.dirName + '::' + firstFp.id) : ''
            };
          }));
        } catch (e) {
          console.error('产品概览加载失败:', e);
          $('pdDashboardCards').innerHTML = '<div class="state" style="grid-column:1/-1"><div class="state-inner"><div class="state-icon">!</div><h3>加载失败</h3><p>' + escapeHtml(e.message || '后端服务不可用') + '</p></div></div>';
        }
      }

      function renderPdDashboard(stats) {
        var el = $('pdDashboardCards');
        if (!stats || (!stats.totalProj && stats.totalProj !== 0)) {
          el.innerHTML = '<div class="state" style="grid-column:1/-1;min-height:100px"><div class="state-inner"><h3>暂无数据</h3><p>暂无产品概览数据，Agent 归档后将自动生成。</p></div></div>';
          return;
        }
        var taskRate = stats.taskRate;
        var cards = [
          { value: stats.totalProj || 0, label: '需求项目数', sub: '归档需求项目' },
          { value: stats.totalFp || 0, label: '功能点', sub: 'Feature Points' },
          { value: (stats.taskTotal || 0) + ' 项', label: '任务总量', sub: '完成 ' + (stats.taskDone || 0) + ' 项' },
          { value: (typeof taskRate === 'number' ? taskRate : 0) + '%', label: '任务完成率', sub: stats.taskTotal ? ('已完成 ' + (stats.taskDone || 0) + '/' + stats.taskTotal) : '暂无任务' },
          { value: stats.totalKp || 0, label: '知识积累', sub: 'Knowledge Points' },
          { value: stats.designSectionCount || 0, label: '设计章节', sub: 'Design Sections' },
          { value: stats.iterCount || 0, label: '迭代记录', sub: '历史迭代' },
          { value: stats.reqCompleted || 0, label: '已完成项目', sub: '开发完成' },
          { value: stats.reqDesign || 0, label: '设计中', sub: '分析/设计阶段' }
        ];
        el.innerHTML = cards.map(function(c) {
          return '<div class="pd-dash-card"><div class="pd-dash-card-value">' + c.value + '</div><div class="pd-dash-card-label">' + escapeHtml(c.label) + '</div>' + (c.sub ? '<div class="pd-dash-card-sub">' + escapeHtml(c.sub) + '</div>' : '') + '</div>';
        }).join('');
      }

      function renderPdCharts(phaseDist, todoCompletion, knowledgeTrend, layerDist, tagCounts) {
        var ctxPhase = document.getElementById('pdPhaseChart');
        var ctxTodo = document.getElementById('pdTodoChart');
        var ctxKnowledge = document.getElementById('pdKnowledgeChart');
        var ctxLayer = document.getElementById('pdLayerChart');
        var ctxTags = document.getElementById('pdTagsChart');
        if (!ctxPhase || !ctxTodo || !ctxKnowledge) return;

        var phaseLabels = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成' };
        var phaseColors = { analysis: '#2383e2', design: '#876de2', implementation: '#f59e0b', testing: '#e74c3c', completed: '#10b981' };

        if (typeof Chart === 'undefined') {
          [ctxPhase, ctxTodo, ctxKnowledge, ctxLayer, ctxTags].forEach(function(c) {
            if (!c) return;
            var parent = c.parentElement;
            parent.innerHTML = '<div class="empty-state" style="height:180px;display:flex;align-items:center;justify-content:center">图表库加载中...</div>';
          });
          return;
        }

        // 阶段分布 - 饼图
        var phaseData = phaseDist && phaseDist.length ? phaseDist : [];
        pdChartInstances.phaseChart = new Chart(ctxPhase, {
          type: 'doughnut',
          data: {
            labels: phaseData.map(function(p) { return phaseLabels[p.phase] || p.phase; }),
            datasets: [{ data: phaseData.map(function(p) { return p.count; }), backgroundColor: phaseData.map(function(p) { return phaseColors[p.phase] || '#ccc'; }), borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } } }
        });

        // 任务完成率 - 进度环图（中心显示百分比）
        var done = todoCompletion && (todoCompletion.completed || todoCompletion.done) ? (todoCompletion.completed || todoCompletion.done) : 0;
        var total = todoCompletion && todoCompletion.total ? todoCompletion.total : 1;
        var percent = total > 0 ? Math.round(done / total * 100) : 0;
        var centerEl = document.getElementById('pdTodoChartCenter');
        if (centerEl) centerEl.textContent = percent + '%';
        pdChartInstances.todoChart = new Chart(ctxTodo, {
          type: 'doughnut',
          data: {
            labels: ['已完成', '未完成'],
            datasets: [{ data: [done, total - done], backgroundColor: ['#10b981', '#e5e7eb'], borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } } }
        });

        // 知识积累趋势 - 折线图（按月累计，真实数据）
        var trendData = knowledgeTrend && knowledgeTrend.length ? knowledgeTrend : [];
        pdChartInstances.knowledgeChart = new Chart(ctxKnowledge, {
          type: 'line',
          data: {
            labels: trendData.map(function(t) { return t.month || ''; }),
            datasets: [{ label: '知识/功能点累计', data: trendData.map(function(t) { return t.count; }), borderColor: '#2383e2', backgroundColor: 'rgba(35,131,226,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2383e2' }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, stepSize: 1 } } } }
        });

        // 模块分布 - 横向柱状图（backend/frontend/fullstack）
        if (ctxLayer) {
          var layerLabels = { backend: '后端', frontend: '前端', fullstack: '全栈', unknown: '未标注' };
          var layerColors = { backend: '#4338ca', frontend: '#047857', fullstack: '#92400e', unknown: '#9ca3af' };
          var layerData = layerDist && layerDist.length ? layerDist : [];
          pdChartInstances.layerChart = new Chart(ctxLayer, {
            type: 'bar',
            data: {
              labels: layerData.map(function(l) { return layerLabels[l.layer] || l.layer; }),
              datasets: [{ label: '功能点数', data: layerData.map(function(l) { return l.count; }), backgroundColor: layerData.map(function(l) { return layerColors[l.layer] || '#2383e2'; }), borderRadius: 4, barThickness: 18 }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } }
          });
        }

        // 热门标签 - 横向柱状图（Top 10）
        if (ctxTags) {
          var tagData = tagCounts && tagCounts.length ? tagCounts : [];
          pdChartInstances.tagsChart = new Chart(ctxTags, {
            type: 'bar',
            data: {
              labels: tagData.map(function(t) { return t.tag; }),
              datasets: [{ label: '出现次数', data: tagData.map(function(t) { return t.count; }), backgroundColor: '#2383e2', borderRadius: 4, barThickness: 18 }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
          });
        }
      }

      function renderPdTaskList(tasks) {
        var el = $('pdTaskList');
        if (!tasks || !tasks.length) {
          el.innerHTML = '<div class="empty-state">暂无任务数据</div>';
          return;
        }
        // 按功能点分组
        var grouped = {};
        tasks.forEach(function(t) {
          var key = t.fpKey || t.fpId || t.projectName || 'other';
          if (!grouped[key]) grouped[key] = { fpName: t.fpName, projectName: t.projectName, fpId: t.fpId, items: [] };
          grouped[key].items.push(t);
        });
        var activeFilter = document.querySelector('.pd-task-list-filter.active');
        var filterValue = activeFilter ? activeFilter.dataset.taskFilter : 'all';
        var groupKeys = Object.keys(grouped);
        var totalDisplay = 0;
        var html = groupKeys.map(function(key) {
          var g = grouped[key];
          var filtered = g.items.filter(function(t) {
            if (filterValue === 'all') return true;
            return t.status === filterValue;
          });
          if (!filtered.length) return '';
          totalDisplay += filtered.length;
          var itemsHtml = filtered.map(function(t) {
            var statusLabel = t.status === 'done' ? '已完成' : t.status === 'in-progress' ? '进行中' : '待完成';
            var statusClass = t.status === 'done' ? 'done' : t.status === 'in-progress' ? 'in-progress' : 'todo';
          return '<div class="pd-task-item" data-req-id="' + escapeHtml(t.fpKey || t.fpId || '') + '"><span class="pd-task-status ' + statusClass + '"></span><span class="pd-task-name">' + escapeHtml(t.title) + '</span><span class="pd-task-meta">' + escapeHtml(g.fpName || '') + '</span><span class="pd-task-status-badge ' + statusClass + '">' + statusLabel + '</span></div>';
          }).join('');
          return '<div style="margin-bottom:4px;font-size:11px;color:var(--ws-faint);padding:2px 14px">' + escapeHtml(g.projectName || '') + '</div>' + itemsHtml;
        }).join('');
        if (!totalDisplay) {
          el.innerHTML = '<div class="empty-state">暂无匹配的任务</div>';
          return;
        }
        el.innerHTML = html;
        // 任务项点击查看详情
        el.querySelectorAll('.pd-task-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var reqId = this.getAttribute('data-req-id');
            if (reqId) showPdRequirementDetail(reqId);
          });
        });
      }

      function renderPdActivities(activities) {
        var el = $('pdActivityList');
        if (!activities || !activities.length) {
          el.innerHTML = '<div class="empty-state">暂无活动记录</div>';
          return;
        }
        var dotColors = { archived: '#10b981', created: '#2383e2', migrated: '#f59e0b', completed: '#876de2', iterated: '#0ea5e9' };
        el.innerHTML = activities.slice(0, 8).map(function(a) {
          var dot = dotColors[a.action] || '#2383e2';
          return '<div class="pd-activity-item" data-req-id="' + escapeHtml(a.fpKey || a.fpId || '') + '"><span class="pd-activity-dot" style="background:' + dot + '"></span><span class="pd-activity-text">' + escapeHtml(a.title || '') + ' — ' + escapeHtml(a.description || '') + '</span><span class="pd-activity-time">' + escapeHtml(formatDateTime(a.time || a.createdAt)) + '</span></div>';
        }).join('');
        // 活动项点击查看详情
        el.querySelectorAll('.pd-activity-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var reqId = this.getAttribute('data-req-id');
            if (reqId) showPdRequirementDetail(reqId);
          });
        });
      }

      function pdIterationCountFor(projDir, fpId) {
        var n = 0;
        (pdIterations || []).forEach(function(rec) {
          if (rec.project === projDir && (!fpId || rec.fpId === fpId)) n++;
        });
        return n;
      }

      function pdKanbanCardHtml(proj, fp) {
        var tags = (fp.tags || []).map(function(t) { return '<span class="pd-tag">' + escapeHtml(t) + '</span>'; }).join('');
        var layerClass = fp.layer === 'backend' ? 'backend' : fp.layer === 'frontend' ? 'frontend' : fp.layer === 'fullstack' ? 'fullstack' : '';
        var layerLabel = fp.layer === 'backend' ? '后端' : fp.layer === 'frontend' ? '前端' : fp.layer === 'fullstack' ? '全栈' : (fp.layer || '');
        // 任务进度
        var tasks = fp.tasks || [];
        var doneCount = tasks.filter(function(t) { return t.status === 'done'; }).length;
        var totalCount = tasks.length;
        var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;
        var progressHtml = totalCount > 0
          ? '<div class="pd-kanban-card-progress"><div class="pd-kanban-card-progress-bar"><div class="pd-kanban-card-progress-fill" style="width:' + pct + '%"></div></div><div class="pd-kanban-card-progress-text"><span>任务 ' + doneCount + '/' + totalCount + '</span><span>' + pct + '%</span></div></div>'
          : '';
        // 迭代徽标（当前项目记录数 + 跨项目同名功能点定位）
        var iterCount = pdIterationCountFor(proj.dirName, fp.id);
        var relatedCount = 0;
        (pdRequirementsCache && Object.keys(pdRequirementsCache)).forEach(function(k) {
          var it = pdRequirementsCache[k];
          if (it && it.title === fp.name && it.projectName !== proj.dirName) relatedCount++;
        });
        var iterBadge = (iterCount + relatedCount) > 0
          ? '<span class="pd-kanban-card-iter" title="历史迭代：当前项目 ' + iterCount + ' 条记录，跨项目相关 ' + relatedCount + ' 处">&#128337; ' + (iterCount + relatedCount) + '</span>'
          : '';
        var layerHtml = layerLabel ? '<span class="pd-kanban-card-layer ' + layerClass + '">' + escapeHtml(layerLabel) + '</span>' : '';
        return '<div class="pd-kanban-card" data-req-id="' + escapeHtml(proj.dirName + '::' + fp.id) + '" data-phase="' + escapeHtml(proj.dirName) + '"><div class="pd-kanban-card-title">' + escapeHtml(fp.name) + iterBadge + '</div><div class="pd-kanban-card-meta">' + layerHtml + tags + '</div>' + progressHtml + '</div>';
      }

      function renderPdKanban(projects) {
        var el = $('pdKanbanBoard');
        // projects 为 FeaturePointsService 返回的项目列表，每个项目包含 featurePoints
        if (!projects || !projects.length) {
          el.innerHTML = '<div class="empty-state" style="width:100%;padding:50px 20px">暂无数据，Agent 归档后将自动展示。</div>';
          return;
        }
        var searchQ = ($('pdKanbanSearch')?.value || '').trim().toLowerCase();
        var groupMode = pdKanbanGroup || 'project';
        var phaseLabels = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成', planning: '规划', unknown: '未标注' };
        var phaseColors = { analysis: '#2383e2', design: '#876de2', implementation: '#f59e0b', testing: '#e74c3c', completed: '#10b981', planning: '#6b7280', unknown: '#9ca3af' };
        // 项目颜色数组
        var projColors = ['#2383e2', '#876de2', '#f59e0b', '#10b981', '#e74c3c', '#6b7280'];

        function matchSearch(fp) {
          if (!searchQ) return true;
          return (fp.name && fp.name.toLowerCase().includes(searchQ)) ||
                 (fp.tags || []).some(function(t) { return t.toLowerCase().includes(searchQ); });
        }

        if (groupMode === 'phase') {
          // ── 按阶段分组：列 = 需求分析/设计/实现/测试/已完成 ──
          var order = ['analysis', 'design', 'implementation', 'testing', 'completed', 'planning', 'unknown'];
          var cols = order.map(function(phase) {
            var fps = [];
            projects.forEach(function(proj) {
              var p = proj.requirement && proj.requirement.phase ? proj.requirement.phase : 'unknown';
              if (p !== phase) return;
              (proj.featurePoints || []).forEach(function(fp) {
                if (matchSearch(fp)) fps.push({ proj: proj, fp: fp });
              });
            });
            return { phase: phase, fps: fps };
          }).filter(function(c) { return c.fps.length > 0; });
          if (!cols.length) {
            el.innerHTML = '<div class="empty-state" style="width:100%;padding:50px 20px">暂无匹配内容</div>';
            return;
          }
          el.innerHTML = cols.map(function(col) {
            var color = phaseColors[col.phase] || '#6b7280';
            return '<div class="pd-kanban-col"><div class="pd-kanban-col-header"><h3 style="color:' + color + '">' + escapeHtml(phaseLabels[col.phase] || col.phase) + '</h3><span class="pd-kanban-col-count">' + col.fps.length + '</span></div><div class="pd-kanban-col-body" data-phase="' + escapeHtml(col.phase) + '">' +
              col.fps.map(function(item) { return pdKanbanCardHtml(item.proj, item.fp); }).join('') +
              '</div></div>';
          }).join('');
          return;
        }

        // ── 按项目分组（默认） ──
        el.innerHTML = projects.map(function(proj, idx) {
          var color = projColors[idx % projColors.length];
          var fps = (proj.featurePoints || []).filter(matchSearch);
          return '<div class="pd-kanban-col"><div class="pd-kanban-col-header"><h3 style="color:' + color + '">' + escapeHtml(proj.dirName) + '</h3><span class="pd-kanban-col-count">' + fps.length + '</span></div><div class="pd-kanban-col-body" data-phase="' + escapeHtml(proj.dirName) + '">' +
            (fps.length ? fps.map(function(fp) { return pdKanbanCardHtml(proj, fp); }).join('') : '<div class="empty-state" style="padding:20px 10px;font-size:12px">暂无内容</div>') +
            '</div></div>';
        }).join('');
      }

      /* ── pd-kanban 卡片点击详情弹窗 ── */
      var pdRequirementsCache = {};
      var pdIterations = [];
      var pdKanbanGroup = 'project';

      // 看板分组切换（按项目 / 按阶段）
      var pdKanbanGroupEl = $('pdKanbanGroup');
      if (pdKanbanGroupEl) {
        pdKanbanGroupEl.addEventListener('click', function(e) {
          var btn = e.target.closest && e.target.closest('.pd-kanban-group-btn');
          if (!btn) return;
          pdKanbanGroupEl.querySelectorAll('.pd-kanban-group-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          pdKanbanGroup = btn.dataset.group;
          loadProductDev();
        });
      }

      function onPdCardClick(e) {
        var card = e.target.closest('.pd-kanban-card');
        if (!card) return;
        var reqId = card.dataset.reqId;
        if (!reqId) return;
        showPdRequirementDetail(reqId);
      }

      var currentPdReqId = '';
      // 全局委托：删除迭代记录 / 跨项目相关迭代点击（只注册一次，避免重复监听）
      document.addEventListener('click', function(e) {
        var delBtn = e.target.closest && e.target.closest('[data-iter-delete]');
        if (delBtn) {
          var delId = delBtn.getAttribute('data-iter-delete');
          if (!delId || !currentPdReqId) return;
          (async function() {
            try {
              var r = await fetch('/api/workspace/feature-points/iterations/' + encodeURIComponent(delId), { method: 'DELETE' });
              if (!r.ok) return;
              var iterRes = await fetch('/api/workspace/feature-points/iterations').catch(function() { return { ok: false }; });
              pdIterations = iterRes && iterRes.ok ? (await iterRes.json().catch(function() { return []; })) : [];
              showPdRequirementDetail(currentPdReqId);
              loadProductDev();
            } catch (err) { /* 静默 */ }
          })();
          return;
        }
        var compareBtn = e.target.closest && e.target.closest('.pd-iter-compare');
        if (compareBtn) {
          var cKey = compareBtn.getAttribute('data-compare-key');
          var curKey = currentPdReqId;
          if (cKey && curKey && pdRequirementsCache[curKey] && pdRequirementsCache[cKey]) {
            showPdRequirementDiff(pdRequirementsCache[curKey], pdRequirementsCache[cKey], curKey);
          }
          return;
        }
        var relEl = e.target.closest && e.target.closest('.pd-iter-related-item');
        if (relEl) {
          var key = relEl.getAttribute('data-req-key');
          if (key && pdRequirementsCache[key]) showPdRequirementDetail(key);
        }
      });

      function showPdRequirementDetail(reqId) {
        var item = pdRequirementsCache[reqId];
        var bodyEl = $('pdReqModalBody');
        if (!item) {
          bodyEl.innerHTML = '<div class="empty-state" style="padding:30px">未找到需求数据</div>';
          showModal($('pdRequirementModal'));
          return;
        }
        currentPdReqId = reqId;
        var phaseLabels = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成', planning: '规划', unknown: '未标注' };
        var phaseColors = { analysis: '#2383e2', design: '#876de2', implementation: '#f59e0b', testing: '#e74c3c', completed: '#10b981', planning: '#6b7280', unknown: '#9ca3af' };
        var phase = item.phase || 'analysis';
        var phaseLabel = phaseLabels[phase] || phase;
        var phaseColor = phaseColors[phase] || '#999';
        var tags = (item.tags || []).map(function(t) { return '<span class="pd-req-detail-tag">' + escapeHtml(t) + '</span>'; }).join('');
        var layerLabels = { backend: '后端', frontend: '前端', fullstack: '全栈', knowledge: '知识', unknown: '未标注' };
        var layerLabel = layerLabels[item.layer] || item.layer || '未标注';
        var status = item.status || 'todo';
        var statusLabels = { todo: '待开始', 'in-progress': '进行中', done: '已完成' };
        var statusLabel = statusLabels[status] || status;
        var source = item.source || 'manual';
        var sourceLabels = { manual: '手动创建', archive: '归档', migrate: '历史迁移' };
        var sourceLabel = sourceLabels[source] || source;
        var createdAt = formatDateTime(item.createdAt);
        var updatedAt = formatDateTime(item.updatedAt);
        var completedAt = formatDateTime(item.completedAt);

        $('pdReqModalTitle').textContent = item.title || '功能点详情';

        // ── 任务 / 验收 / 设计章节 ──
        var tasksHtml = (item.tasks && item.tasks.length)
          ? item.tasks.map(function(t) {
              var s = t.status || 'todo';
              var sLabel = s === 'done' ? '已完成' : s === 'in-progress' ? '进行中' : '待开始';
              var sClass = s === 'done' ? 'done' : s === 'in-progress' ? 'in-progress' : 'todo';
              return '<div class="pd-task-item" style="padding:8px 10px"><span class="pd-task-status ' + sClass + '"></span><span class="pd-task-name">' + escapeHtml(t.title || '') + '</span><span class="pd-task-status-badge ' + sClass + '">' + sLabel + '</span></div>';
            }).join('')
          : '<div class="pd-req-detail-value" style="color:var(--ws-faint)">暂无任务</div>';
        var verificationsHtml = (item.verifications && item.verifications.length)
          ? '<ul style="margin:0;padding-left:18px">' + item.verifications.map(function(v) {
              var label = (typeof v === 'string') ? v : (v && (v.title || v.description)) || '';
              return '<li style="margin-bottom:4px;font-size:12px;color:var(--ws-text)">' + escapeHtml(label) + '</li>';
            }).join('') + '</ul>'
          : '<div class="pd-req-detail-value" style="color:var(--ws-faint)">暂无验收标准</div>';
        var designSectionsHtml = (item.designSections && item.designSections.length)
          ? '<ul style="margin:0;padding-left:18px">' + item.designSections.map(function(s) {
              if (typeof s === 'string') return '<li style="margin-bottom:4px;font-size:12px">' + escapeHtml(s) + '</li>';
              var doc = s.document || '';
              var sec = s.section || '';
              return '<li style="margin-bottom:4px;font-size:12px">' + (doc ? escapeHtml(doc) + ' → ' : '') + escapeHtml(sec || s.title || '') + '</li>';
            }).join('') + '</ul>'
          : '<div class="pd-req-detail-value" style="color:var(--ws-faint)">暂无设计章节</div>';

        // ── 历史迭代记录（当前项目 + 当前功能点） ──
        var myIters = (pdIterations || []).filter(function(r) {
          return (!item.projectName || r.project === item.projectName) && r.fpId === item.id;
        }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        var itersHtml = myIters.length
          ? myIters.map(function(r) {
              var st = r.status || 'in-progress';
              var stLabel = st === 'done' ? '已完成' : st === 'todo' ? '待开始' : st === 'pending' ? '待定' : '进行中';
              var rTags = (r.tags || []).map(function(t) { return '<span class="pd-iter-tag">' + escapeHtml(t) + '</span>'; }).join('');
              return '<div class="pd-iter-item" data-iter-id="' + escapeHtml(r.id) + '">' +
                '<div class="pd-iter-marker"><span class="pd-iter-dot"></span><span class="pd-iter-line"></span></div>' +
                '<div class="pd-iter-body">' +
                  '<div class="pd-iter-head"><span class="pd-iter-version">' + escapeHtml(r.version || 'v1') + '</span><span class="pd-iter-badge ' + st + '">' + stLabel + '</span><span class="pd-iter-time">' + escapeHtml(formatDateTime(r.createdAt)) + '</span></div>' +
                  (r.note ? '<div class="pd-iter-note">' + escapeHtml(r.note) + '</div>' : '') +
                  (rTags ? '<div class="pd-iter-tags">' + rTags + '</div>' : '') +
                  '<div class="pd-iter-actions"><button class="pd-iter-delete" type="button" data-iter-delete="' + escapeHtml(r.id) + '">删除</button></div>' +
                '</div></div>';
            }).join('')
          : '<div class="pd-req-iter-empty">暂无迭代记录。可在下方记录一次迭代（版本、说明、状态），追踪该功能点的演进历史。</div>';

        // ── 跨项目相关迭代定位（同名功能点） ──
        var related = [];
        Object.keys(pdRequirementsCache).forEach(function(k) {
          var it = pdRequirementsCache[k];
          if (!it || it === item) return;
          if (it.title && item.title && it.title === item.title && it.projectName !== item.projectName) {
            related.push(it);
          }
        });
        related = related.slice(0, 8);
        var relatedHtml = related.length
          ? related.map(function(r) {
              var rp = r.phase || 'unknown';
              return '<div class="pd-iter-related-item" data-req-key="' + escapeHtml(r.key) + '"><span class="rel-dot" style="background:' + (phaseColors[rp] || '#999') + '"></span><span>' + escapeHtml(r.projectName) + ' · ' + escapeHtml(r.id) + '</span><span class="rel-project">' + escapeHtml(phaseLabels[rp] || rp) + '</span><button class="pd-iter-compare" type="button" data-compare-key="' + escapeHtml(r.key) + '" title="自动对比当前功能点与该版本的功能点字段差异">对比</button></div>';
            }).join('')
          : '<div class="pd-req-detail-value" style="color:var(--ws-faint);font-size:12px">未发现其他项目中同名功能点，跨项目迭代定位为空。</div>';

        bodyEl.innerHTML =
          // ── 定位信息 ──
          '<div class="pd-req-detail-label" style="margin-bottom:8px">功能点定位</div>' +
          '<div class="pd-req-locate">' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">所属项目</div><div class="pd-req-locate-value" style="font-weight:600">' + escapeHtml(item.projectName || '') + '</div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">功能点 ID</div><div class="pd-req-locate-value code">' + escapeHtml(item.id || '') + '</div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">来源文件</div><div class="pd-req-locate-value code">' + escapeHtml(item.filePath || '') + '</div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">阶段</div><div class="pd-req-locate-value"><span class="pd-req-detail-phase-badge" style="background:' + phaseColor + '">' + escapeHtml(phaseLabel) + '</span></div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">模块层</div><div class="pd-req-locate-value">' + escapeHtml(layerLabel) + '</div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">需求标题</div><div class="pd-req-locate-value">' + escapeHtml(item.requirementTitle || '') + '</div></div>' +
            '<div class="pd-req-locate-item"><div class="pd-req-locate-label">创建 / 完成</div><div class="pd-req-locate-value">' + escapeHtml(createdAt) + (item.completedAt ? '<br>' + escapeHtml(completedAt) : '') + '</div></div>' +
          '</div>' +
          // ── 描述 / 标签 ──
          '<div class="pd-req-detail-section"><div class="pd-req-detail-label">描述</div><div class="pd-req-detail-value">' + escapeHtml(item.description || '暂无描述') + '</div></div>' +
          (tags ? '<div class="pd-req-detail-section"><div class="pd-req-detail-label">标签</div><div class="pd-req-detail-tags">' + tags + '</div></div>' : '') +
          '<div class="pd-req-detail-divider"></div>' +
          // ── 任务 / 验收 / 设计章节 ──
          '<div class="pd-req-detail-section"><div class="pd-req-detail-label">任务清单</div>' + tasksHtml + '</div>' +
          '<div class="pd-req-detail-section"><div class="pd-req-detail-label">验收标准</div>' + verificationsHtml + '</div>' +
          '<div class="pd-req-detail-section"><div class="pd-req-detail-label">设计章节</div>' + designSectionsHtml + '</div>' +
          '<div class="pd-req-detail-divider"></div>' +
          '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
            '<div><div class="pd-req-detail-label">状态</div><div class="pd-req-detail-value">' + escapeHtml(statusLabel) + '</div></div>' +
            '<div><div class="pd-req-detail-label">来源</div><div class="pd-req-detail-value">' + escapeHtml(sourceLabel) + '</div></div>' +
            '<div><div class="pd-req-detail-label">更新时间</div><div class="pd-req-detail-value">' + escapeHtml(updatedAt) + '</div></div>' +
          '</div>' +
          // ── 历史迭代 ──
          '<div class="pd-req-iter-section">' +
            '<div class="pd-req-iter-header"><span class="pd-section-title">历史迭代<span class="pd-req-iter-count">' + myIters.length + ' 条记录</span></span></div>' +
            itersHtml +
            // 记录表单
            '<div class="pd-iter-form">' +
              '<div class="pd-iter-form-title">&#9998; 记录一次迭代</div>' +
              '<div class="pd-iter-form-row">' +
                '<div class="form-group"><label class="form-label">版本</label><input class="form-input" id="pdIterVersion" type="text" placeholder="如 v2 / 2026-08" autocomplete="off"></div>' +
                '<div class="form-group"><label class="form-label">状态</label><select class="form-select" id="pdIterStatus"><option value="in-progress">进行中</option><option value="done">已完成</option><option value="todo">待开始</option><option value="pending">待定</option></select></div>' +
                '<div class="form-group"><label class="form-label">标签</label><input class="form-input" id="pdIterTags" type="text" placeholder="逗号分隔，可选" autocomplete="off"></div>' +
              '</div>' +
              '<div class="form-group"><label class="form-label">本次迭代说明</label><textarea class="form-textarea" id="pdIterNote" rows="3" placeholder="记录本次迭代做了什么、改了哪些内容、结论如何..."></textarea></div>' +
              '<div class="pd-iter-form-actions"><button class="btn btn-primary" id="pdIterSubmit" type="button" data-func-tag="功能:记录功能点迭代" title="保存一条功能点历史迭代记录">保存迭代记录</button></div>' +
            '</div>' +
            // 跨项目定位
            '<div style="margin-top:16px"><div class="pd-req-detail-label">跨项目相关迭代定位</div>' +
            '<div class="pd-iter-related">' + relatedHtml + '</div></div>' +
          '</div>';

        showModal($('pdRequirementModal'));

        // 绑定记录表单提交（按钮每次渲染重建，直接绑定即可）
        var submitBtn = $('pdIterSubmit');
        if (submitBtn) {
          submitBtn.addEventListener('click', async function() {
            var version = ($('pdIterVersion')?.value || '').trim();
            var note = ($('pdIterNote')?.value || '').trim();
            if (!version && !note) {
              submitBtn.closest('.pd-iter-form').insertAdjacentHTML('beforeend', '<div class="error-message" style="margin-top:10px">请至少填写版本或说明</div>');
              return;
            }
            var tags = ($('pdIterTags')?.value || '').split(/[,，]/).map(function(t) { return t.trim(); }).filter(Boolean);
            var existingCount = (pdIterations || []).filter(function(x) { return x.fpId === item.id && x.project === item.projectName; }).length;
            submitBtn.disabled = true;
            submitBtn.textContent = '保存中...';
            try {
              var r = await fetch('/api/workspace/feature-points/iterations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  project: item.projectName || '',
                  fpId: item.id || '',
                  fpName: item.title || '',
                  version: version || ('v' + (existingCount + 1)),
                  note: note,
                  tags: tags,
                  status: ($('pdIterStatus')?.value || 'in-progress')
                })
              });
              if (!r.ok) {
                var eb = await r.json().catch(function() { return {}; });
                throw new Error(eb.error || '保存失败');
              }
              var iterRes = await fetch('/api/workspace/feature-points/iterations').catch(function() { return { ok: false }; });
              pdIterations = iterRes && iterRes.ok ? (await iterRes.json().catch(function() { return []; })) : [];
              showPdRequirementDetail(reqId);
              loadProductDev();
            } catch (e) {
              submitBtn.disabled = false;
              submitBtn.textContent = '保存迭代记录';
              var errBox = document.createElement('div');
              errBox.className = 'error-message';
              errBox.style.marginTop = '10px';
              errBox.textContent = '保存失败：' + (e.message || '后端服务不可用');
              submitBtn.closest('.pd-iter-form').appendChild(errBox);
            }
          });
        }
      }

      /* ── 功能点演进对比（台账化：自动 diff 跨需求同名功能点） ── */
      function pdSectionText(s) {
        if (typeof s === 'string') return s;
        if (!s) return '';
        var doc = s.document || '';
        var sec = s.section || s.title || '';
        return (doc ? doc + ' → ' : '') + sec;
      }

      function pdVerifyText(v) {
        if (typeof v === 'string') return v;
        if (!v) return '';
        return v.title || v.description || String(v);
      }

      function pdArrDiff(baseArr, otherArr) {
        var a = (baseArr || []).map(String);
        var b = (otherArr || []).map(String);
        var setA = new Set(a);
        var setB = new Set(b);
        return {
          added: b.filter(function(x) { return !setA.has(x); }),
          removed: a.filter(function(x) { return !setB.has(x); }),
          same: a.filter(function(x) { return setB.has(x); })
        };
      }

      function pdDiffListHtml(diff) {
        var html = '<ul class="pd-diff-list">';
        diff.added.forEach(function(x) { html += '<li class="pd-diff-added">+ ' + escapeHtml(x) + '</li>'; });
        diff.removed.forEach(function(x) { html += '<li class="pd-diff-removed">- ' + escapeHtml(x) + '</li>'; });
        if (diff.same.length) html += '<li class="pd-diff-same">= 相同 ' + diff.same.length + ' 项（省略）</li>';
        html += '</ul>';
        return html;
      }

      function showPdRequirementDiff(base, other, backReqId) {
        var bodyEl = $('pdReqModalBody');
        if (!bodyEl) return;
        $('pdReqModalTitle').textContent = '功能点演进对比';
        var phaseLabelMap = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成', planning: '规划' };
        var changedCount = 0;
        var blocks = [];

        function twoCol(label, baseHtml, otherHtml, changed) {
          if (changed) changedCount++;
          return '<div class="pd-req-detail-section">' +
            '<div class="pd-req-detail-label">' + label + (changed ? ' <span class="pd-diff-badge changed">有变更</span>' : ' <span class="pd-diff-badge added">无变更</span>') + '</div>' +
            '<div class="pd-diff-row">' +
              '<div class="pd-diff-side"><div class="pd-diff-side-label">' + escapeHtml(base.projectName) + '（当前）</div><div class="pd-diff-side-value' + (changed ? '' : ' same') + '">' + baseHtml + '</div></div>' +
              '<div class="pd-diff-arrow">&#8594;</div>' +
              '<div class="pd-diff-side"><div class="pd-diff-side-label">' + escapeHtml(other.projectName) + '（对比）</div><div class="pd-diff-side-value' + (changed ? '' : ' same') + '">' + otherHtml + '</div></div>' +
            '</div></div>';
        }

        function listBlock(label, diff, totalInfo) {
          if (diff.added.length || diff.removed.length) changedCount++;
          return '<div class="pd-req-detail-section"><div class="pd-req-detail-label">' + label + '（' + totalInfo + '）' + (diff.added.length || diff.removed.length ? ' <span class="pd-diff-badge changed">有变更</span>' : ' <span class="pd-diff-badge added">无变更</span>') + '</div>' + pdDiffListHtml(diff) + '</div>';
        }

        // 描述
        blocks.push(twoCol('描述',
          escapeHtml(base.description || '（空）'),
          escapeHtml(other.description || '（空）'),
          (base.description || '') !== (other.description || '')));
        // 模块层
        blocks.push(twoCol('模块层',
          escapeHtml(base.layer || '未标注'),
          escapeHtml(other.layer || '未标注'),
          (base.layer || '') !== (other.layer || '')));
        // 阶段
        blocks.push(twoCol('阶段',
          escapeHtml(phaseLabelMap[base.phase] || base.phase || '未标注'),
          escapeHtml(phaseLabelMap[other.phase] || other.phase || '未标注'),
          (base.phase || '') !== (other.phase || '')));
        // 标签
        var tagDiff = pdArrDiff(base.tags, other.tags);
        blocks.push(twoCol('标签',
          (base.tags || []).map(escapeHtml).join('、') || '（空）',
          (other.tags || []).map(escapeHtml).join('、') || '（空）',
          tagDiff.added.length > 0 || tagDiff.removed.length > 0));
        // 任务
        var taskDiff = pdArrDiff(
          (base.tasks || []).map(function(t) { return t.title; }),
          (other.tasks || []).map(function(t) { return t.title; }));
        blocks.push(listBlock('任务', taskDiff, (base.tasks || []).length + ' → ' + (other.tasks || []).length + ' 项'));
        // 验收标准（兼容字符串与 {title,status} 对象，skill v2.0）
        var verifyDiff = pdArrDiff(
          (base.verifications || []).map(pdVerifyText),
          (other.verifications || []).map(pdVerifyText));
        blocks.push(listBlock('验收标准', verifyDiff, (base.verifications || []).length + ' → ' + (other.verifications || []).length + ' 项'));
        // 设计章节
        var secDiff = pdArrDiff(
          (base.designSections || []).map(pdSectionText),
          (other.designSections || []).map(pdSectionText));
        blocks.push(listBlock('设计章节', secDiff, (base.designSections || []).length + ' → ' + (other.designSections || []).length + ' 项'));

        bodyEl.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
            '<button class="pd-iter-back" id="pdDiffBack" type="button">&#8592; 返回功能点详情</button>' +
            '<span style="font-size:12px;color:var(--ws-muted)">' + escapeHtml(base.projectName) + ' · ' + escapeHtml(base.id) + ' &harr; ' + escapeHtml(other.projectName) + ' · ' + escapeHtml(other.id) + '</span>' +
            (changedCount ? '<span class="pd-diff-badge changed">' + changedCount + ' 处字段变更</span>' : '<span class="pd-diff-badge added">字段内容一致</span>') +
          '</div>' +
          '<div class="pd-diff-empty" style="margin-bottom:16px">自动对比说明：以当前项目功能点为基准，列出与 ' + escapeHtml(other.projectName) + ' 中同名功能点「' + escapeHtml(other.title) + '」的字段差异。+ 表示对比版本新增，- 表示对比版本移除。</div>' +
          blocks.join('') +
          (changedCount === 0 ? '<div class="pd-diff-empty">两个版本字段内容完全一致（可能仅归档时间不同）。</div>' : '');

        var backBtn = $('pdDiffBack');
        if (backBtn) backBtn.addEventListener('click', function() { showPdRequirementDetail(backReqId); });
        showModal($('pdRequirementModal'));
      }

      function renderPdGraph(graph) {
        var container = $('pdGraphContainer');
        if (!container) return;
        var nodes = (graph.nodes || []).slice(0, 50);
        var edges = (graph.edges || []).slice(0, 100);
        if (!nodes.length) {
          container.innerHTML = '<div class="empty-state" style="height:100%;display:flex;align-items:center;justify-content:center">暂无关联数据，完成需求归档后将生成知识图谱。</div>';
          return;
        }
        // 清空容器，保留 tooltip
        var existingTooltip = container.querySelector('.pd-graph-tooltip');
        container.innerHTML = '';
        if (existingTooltip) container.appendChild(existingTooltip);

        var tooltip = document.createElement('div');
        tooltip.className = 'pd-graph-tooltip';
        container.appendChild(tooltip);

        var w = container.clientWidth || 600;
        var h = container.clientHeight || 450;
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.style.width = '100%';
        svg.style.height = '100%';
        container.appendChild(svg);

        var nodeColors = { requirement: '#2383e2', knowledge: '#10b981', todo: '#f59e0b', archive: '#876de2' };
        var nodeTypeLabels = { requirement: '需求', knowledge: '知识', todo: '待办', archive: '归档' };

        // 如果 D3 不可用，降级为简单 SVG
        if (typeof d3 === 'undefined') {
          var cx = w / 2, cy = h / 2;
          var radius = Math.min(w, h) * 0.35;
          var ns = 'http://www.w3.org/2000/svg';
          var g = document.createElementNS(ns, 'g');
          g.setAttribute('transform', 'translate(' + cx + ',' + cy + ')');
          edges.forEach(function(e) {
            var srcIdx = nodes.findIndex(function(n) { return n.id === e.source; });
            var tgtIdx = nodes.findIndex(function(n) { return n.id === e.target; });
            if (srcIdx < 0 || tgtIdx < 0) return;
            var a1 = (srcIdx / nodes.length) * 2 * Math.PI - Math.PI / 2;
            var a2 = (tgtIdx / nodes.length) * 2 * Math.PI - Math.PI / 2;
            var line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', radius * Math.cos(a1));
            line.setAttribute('y1', radius * Math.sin(a1));
            line.setAttribute('x2', radius * Math.cos(a2));
            line.setAttribute('y2', radius * Math.sin(a2));
            line.setAttribute('stroke', 'rgba(0,0,0,0.08)');
            line.setAttribute('stroke-width', '1.5');
            g.appendChild(line);
          });
          nodes.forEach(function(n, i) {
            var a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
            var x = radius * Math.cos(a), y = radius * Math.sin(a);
            var color = nodeColors[n.type] || '#999';
            var size = (n.type === 'requirement') ? 10 : (n.type === 'knowledge' ? 8 : 6);
            var circle = document.createElementNS(ns, 'circle');
            circle.setAttribute('cx', x); circle.setAttribute('cy', y);
            circle.setAttribute('r', size); circle.setAttribute('fill', color);
            circle.setAttribute('opacity', '0.85');
            circle.addEventListener('mouseenter', function(ev) { showGraphTooltip(ev, n, tooltip, nodeTypeLabels, nodeColors); });
            circle.addEventListener('mouseleave', function() { hideGraphTooltip(tooltip); });
            g.appendChild(circle);
            var text = document.createElementNS(ns, 'text');
            text.setAttribute('x', x + 12); text.setAttribute('y', y + 4);
            text.setAttribute('font-size', '10');
            text.setAttribute('fill', 'var(--ws-muted)');
            text.textContent = (n.label || n.title || '').substring(0, 12);
            g.appendChild(text);
          });
          svg.appendChild(g);
          return;
        }

        // D3 力导向图
        var width = w, height = h;
        var color = function(type) { return nodeColors[type] || '#999'; };

        var simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(edges).id(function(d) { return d.id; }).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(function(d) { return (d.type === 'requirement' ? 14 : 10); }));

        var defs = d3.select(svg).append('defs');
        // 箭头标记
        edges.forEach(function(e, i) {
          defs.append('marker')
            .attr('id', 'arrow-' + i)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', 'rgba(0,0,0,0.12)');
        });

        var link = d3.select(svg).append('g')
            .selectAll('line')
            .data(edges)
            .join('line')
            .attr('stroke', 'rgba(0,0,0,0.08)')
            .attr('stroke-width', 1.5)
            .attr('marker-end', function(_, i) { return 'url(#arrow-' + i + ')'; });

        var node = d3.select(svg).append('g')
            .selectAll('circle')
            .data(nodes)
            .join('circle')
            .attr('r', function(d) { return d.type === 'requirement' ? 10 : d.type === 'knowledge' ? 8 : 6; })
            .attr('fill', function(d) { return color(d.type); })
            .attr('opacity', 0.85)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .on('mouseenter', function(ev, d) { showGraphTooltip(ev, d, tooltip, nodeTypeLabels, nodeColors); })
            .on('mouseleave', function() { hideGraphTooltip(tooltip); })
            .call(d3.drag()
              .on('start', function(ev, d) {
                if (!ev.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
              })
              .on('drag', function(ev, d) {
                d.fx = ev.x; d.fy = ev.y;
              })
              .on('end', function(ev, d) {
                if (!ev.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
              })
            );

        var label = d3.select(svg).append('g')
            .selectAll('text')
            .data(nodes)
            .join('text')
            .attr('font-size', 10)
            .attr('fill', 'var(--ws-muted)')
            .attr('dx', 14)
            .attr('dy', 4)
            .text(function(d) { return (d.label || d.title || '').substring(0, 14); });

        simulation.on('tick', function() {
          link
            .attr('x1', function(d) { return d.source.x; })
            .attr('y1', function(d) { return d.source.y; })
            .attr('x2', function(d) { return d.target.x; })
            .attr('y2', function(d) { return d.target.y; });
          node
            .attr('cx', function(d) { return d.x; })
            .attr('cy', function(d) { return d.y; });
          label
            .attr('x', function(d) { return d.x; })
            .attr('y', function(d) { return d.y; });
        });

        // 保存 simulation 引用以便后续清理
        container._simulation = simulation;
      }

      function showGraphTooltip(ev, d, tooltip, labels, colors) {
        var type = d.type || 'unknown';
        var typeLabel = labels[type] || type;
        var typeColor = colors[type] || '#999';
        tooltip.innerHTML = '<div class="tt-title">' + escapeHtml(d.label || d.title || '') + '</div>' +
          '<div class="tt-meta">' + escapeHtml(typeLabel) + (d.phase ? ' · ' + escapeHtml(d.phase) : '') + '</div>' +
          '<span class="tt-type" style="background:' + typeColor + '">' + escapeHtml(typeLabel) + '</span>';
        tooltip.classList.add('visible');
        var rect = container.getBoundingClientRect();
        var tx = ev.clientX - rect.left + 12;
        var ty = ev.clientY - rect.top - 10;
        if (tx + 260 > rect.width) tx = ev.clientX - rect.left - 260;
        if (ty < 0) ty = 10;
        tooltip.style.left = tx + 'px';
        tooltip.style.top = ty + 'px';
      }

      function hideGraphTooltip(tooltip) {
        tooltip.classList.remove('visible');
      }

      function renderPdTimeline(timeline) {
        var el = $('pdGanttContainer');
        if (!timeline || !timeline.length) {
          el.innerHTML = '<div class="empty-state">暂无时间线数据，完成需求归档后将自动生成。</div>';
          return;
        }

        // 解析数据，为每个 item 确定 start/end
        var phaseDuration = { analysis: 3, design: 3, implementation: 5, testing: 3, completed: 1 };
        var phaseColors = { analysis: '#2383e2', design: '#876de2', implementation: '#f59e0b', testing: '#e74c3c', completed: '#10b981', archived: '#6b7280' };
        var phaseLabels = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成' };

        var items = [];
        var minDate = null, maxDate = null;

        timeline.forEach(function(item) {
          var start = item.createdAt ? new Date(item.createdAt) : new Date();
          if (isNaN(start.getTime())) start = new Date();
          // 计算结束日期：如果有 updatedAt 且不同于 createdAt，用 updatedAt；否则按阶段估算
          var end = null;
          if (item.updatedAt && item.updatedAt !== item.createdAt) {
            end = new Date(item.updatedAt);
            if (isNaN(end.getTime())) end = null;
          }
          if (!end) {
            end = new Date(start);
            var days = phaseDuration[item.phase] || 3;
            end.setDate(end.getDate() + days);
          }
          if (end < start) end = new Date(start);

          // 用阶段颜色
          var color = phaseColors[item.phase] || '#2383e2';
          var label = phaseLabels[item.phase] || item.phase;

          items.push({
            id: item.id,
            title: item.title || '未命名',
            type: item.type || '',
            phase: item.phase || '',
            phaseLabel: label,
            phaseColor: color,
            start: start,
            end: end,
            status: item.status || '',
            source: item.source || ''
          });

          if (!minDate || start < minDate) minDate = new Date(start);
          if (!maxDate || end > maxDate) maxDate = new Date(end);
        });

        // 给一些 padding
        if (minDate) {
          minDate.setDate(minDate.getDate() - 2);
          minDate.setHours(0, 0, 0, 0);
        }
        if (maxDate) {
          maxDate.setDate(maxDate.getDate() + 2);
          maxDate.setHours(23, 59, 59, 999);
        }

        // 获取当前 zoom 级别
        var zoomLevel = pdGanttZoom || 'day';
        renderGanttChart(el, items, minDate, maxDate, zoomLevel, phaseColors, phaseLabels);
      }

      /* ── 甘特图渲染 ── */
      var pdGanttZoom = 'day';
      var pdGanttTooltip = null;

      function renderGanttChart(container, items, minDate, maxDate, zoom, phaseColors, phaseLabels) {
        // 生成时间列
        var columns = [];
        var cursor = new Date(minDate);
        var colWidth = zoom === 'day' ? 60 : zoom === 'week' ? 120 : 200;
        var dateFormat = zoom === 'day' ? 'MM/dd' : zoom === 'week' ? 'MM/dd' : 'yyyy/MM';
        var dayFormat = zoom === 'day' ? 'dd' : '';

        while (cursor <= maxDate) {
          var col = { date: new Date(cursor), label: '', isWeekend: false };
          if (zoom === 'day') {
            var day = cursor.getDay();
            col.isWeekend = (day === 0 || day === 6);
            col.label = (cursor.getMonth() + 1) + '/' + cursor.getDate();
          } else if (zoom === 'week') {
            var weekStart = new Date(cursor);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            var weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            col.label = (weekStart.getMonth() + 1) + '/' + weekStart.getDate() + '-' + (weekEnd.getMonth() + 1) + '/' + weekEnd.getDate();
            cursor.setDate(cursor.getDate() + 6);
          } else { // month
            col.label = (cursor.getFullYear()) + '/' + (cursor.getMonth() + 1);
            cursor.setMonth(cursor.getMonth() + 1);
          }
          columns.push(col);
          if (zoom !== 'day') continue;
          cursor.setDate(cursor.getDate() + 1);
        }

        var totalWidth = columns.length * colWidth;

        // 构建 HTML
        var html = '<div class="pd-gantt-chart">';

        // Header
        html += '<div class="pd-gantt-header"><div class="pd-gantt-header-row">';
        html += '<div class="pd-gantt-label-col">任务名称</div>';
        columns.forEach(function(col) {
          html += '<div class="pd-gantt-grid-col' + (col.isWeekend ? ' weekend' : '') + '" style="width:' + colWidth + 'px;min-width:' + colWidth + 'px">' + escapeHtml(col.label) + '</div>';
        });
        html += '</div></div>';

        // Body
        html += '<div class="pd-gantt-body">';
        items.forEach(function(item) {
          html += '<div class="pd-gantt-row">';
          html += '<div class="pd-gantt-row-label" title="' + escapeHtml(item.title) + '"><span class="pd-gantt-phase-dot" style="background:' + item.phaseColor + '"></span>' + escapeHtml(item.title) + '</div>';
          html += '<div class="pd-gantt-row-cells" style="position:relative">';

          // 绘制时间格背景
          columns.forEach(function(col) {
            html += '<div class="pd-gantt-cell' + (col.isWeekend ? ' weekend' : '') + '" style="width:' + colWidth + 'px;min-width:' + colWidth + 'px"></div>';
          });

          // 计算 bar 位置
          var chartStart = minDate.getTime();
          var chartEnd = maxDate.getTime();
          var chartRange = chartEnd - chartStart;
          var itemStart = item.start.getTime();
          var itemEnd = item.end.getTime();
          var leftPct = Math.max(0, (itemStart - chartStart) / chartRange * 100);
          var rightPct = Math.min(100, (itemEnd - chartStart) / chartRange * 100);
          var widthPct = Math.max(2, rightPct - leftPct);

          // 计算 tooltip 内容
          var phaseLabel = phaseLabels[item.phase] || item.phase || '';
          var startStr = formatDate(item.start);
          var endStr = formatDate(item.end);

          html += '<div class="pd-gantt-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + item.phaseColor + '" data-title="' + escapeHtml(item.title) + '" data-phase="' + escapeHtml(phaseLabel) + '" data-start="' + escapeHtml(startStr) + '" data-end="' + escapeHtml(endStr) + '" data-type="' + escapeHtml(item.type) + '" data-status="' + escapeHtml(item.status) + '">' + escapeHtml(item.title.substring(0, Math.floor(widthPct / 8))) + '</div>';

          html += '</div></div>';
        });
        html += '</div></div>';

        container.innerHTML = html;

        // Tooltip logic
        if (!pdGanttTooltip) {
          pdGanttTooltip = document.createElement('div');
          pdGanttTooltip.className = 'pd-gantt-bar-tooltip';
          document.body.appendChild(pdGanttTooltip);
        }

        container.querySelectorAll('.pd-gantt-bar').forEach(function(bar) {
          bar.addEventListener('mouseenter', function(e) {
            var title = bar.dataset.title || '';
            var phase = bar.dataset.phase || '';
            var start = bar.dataset.start || '';
            var end = bar.dataset.end || '';
            var type = bar.dataset.type || '';
            var status = bar.dataset.status || '';
            var statusLabels = { todo: '待开始', 'in-progress': '进行中', done: '已完成' };
            var statusLabel = statusLabels[status] || status;
            var typeLabels = { requirement: '需求', knowledge: '知识', todo: '待办', archive: '归档' };
            var typeLabel = typeLabels[type] || type;

            pdGanttTooltip.innerHTML =
              '<div style="font-weight:650;font-size:13px;margin-bottom:2px">' + escapeHtml(title) + '</div>' +
              '<div style="font-size:11px;color:var(--ws-muted)">' +
              '阶段: ' + escapeHtml(phase) + '<br>' +
              '类型: ' + escapeHtml(typeLabel) + '<br>' +
              '状态: ' + escapeHtml(statusLabel) + '<br>' +
              '周期: ' + escapeHtml(start) + ' ~ ' + escapeHtml(end) +
              '</div>';
            pdGanttTooltip.classList.add('visible');
            positionGanttTooltip(e);
          });
          bar.addEventListener('mousemove', function(e) { positionGanttTooltip(e); });
          bar.addEventListener('mouseleave', function() {
            pdGanttTooltip.classList.remove('visible');
          });
        });
      }

      function positionGanttTooltip(e) {
        if (!pdGanttTooltip) return;
        var x = e.clientX + 12;
        var y = e.clientY - 10;
        var tw = pdGanttTooltip.offsetWidth || 200;
        var th = pdGanttTooltip.offsetHeight || 100;
        if (x + tw > window.innerWidth - 10) x = e.clientX - tw - 12;
        if (y < 10) y = 10;
        if (y + th > window.innerHeight - 10) y = window.innerHeight - th - 10;
        pdGanttTooltip.style.left = x + 'px';
        pdGanttTooltip.style.top = y + 'px';
      }

      function renderPdArchives(archives) {
        var el = $('pdArchiveList');
        if (!archives || !archives.length) {
          el.innerHTML = '<div class="empty-state">暂无归档记录</div>';
          return;
        }
        var phaseColors = { analysis: '#2383e2', design: '#876de2', implementation: '#f59e0b', testing: '#e74c3c', completed: '#10b981' };
        var phaseLabels = { analysis: '需求分析', design: '设计', implementation: '实现', testing: '测试', completed: '已完成' };
        el.innerHTML = archives.map(function(a) {
          var sourceLabel = a.source === 'archive' ? '自动归档' : a.source === 'migrate' ? '历史迁移' : '手动创建';
          var sourceClass = a.source === 'archive' ? 'archive' : a.source === 'migrate' ? 'migrate' : '';
          var phaseColor = phaseColors[a.phase] || '#6b7280';
          var phaseLabel = phaseLabels[a.phase] || a.phase || '';
          var fpCount = a.fpCount ? ' (' + a.fpCount + ' 功能点)' : '';
          return '<div class="pd-archive-item" data-req-id="' + escapeHtml(a.firstFpId || '') + '"><span class="pd-archive-icon">' + (a.type === 'requirement' ? '&#128196;' : a.type === 'knowledge' ? '&#128214;' : a.type === 'todo' ? '&#9745;' : '&#128451;') + '</span>' +
            '<div class="pd-archive-info"><div class="pd-archive-title">' + escapeHtml(a.title || '') + '</div>' +
            '<div class="pd-archive-meta">' + escapeHtml(formatDateTime(a.createdAt)) + (phaseLabel ? '<span class="pd-archive-phase-tag" style="background:' + phaseColor + '">' + phaseLabel + '</span>' : '') + '<span class="pd-archive-source ' + sourceClass + '">' + sourceLabel + '</span>' + escapeHtml(fpCount) + '</div></div></div>';
        }).join('');
        // 归档项点击查看详情
        el.querySelectorAll('.pd-archive-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var reqId = this.getAttribute('data-req-id');
            if (reqId) showPdRequirementDetail(reqId);
          });
        });
      }

      // 需求看板搜索（本地过滤解析结果）
      var pdKanbanSearch = $('pdKanbanSearch');
      if (pdKanbanSearch) {
        pdKanbanSearch.addEventListener('input', function() {
          loadProductDev();
        });
      }

      // 任务列表筛选按钮
      var pdTaskFilters = $('pdTaskFilters');
      if (pdTaskFilters) {
        pdTaskFilters.addEventListener('click', function(e) {
          var btn = e.target.closest && e.target.closest('.pd-task-list-filter');
          if (!btn) return;
          pdTaskFilters.querySelectorAll('.pd-task-list-filter').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          loadProductDev();
        });
      }

      // 甘特图缩放按钮（二期功能，tab 已隐藏，禁用旧接口调用）
      document.querySelectorAll('.pd-gantt-zoom-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.pd-gantt-zoom-btn').forEach(function(b) { b.classList.remove('active'); });
          this.classList.add('active');
          pdGanttZoom = this.dataset.zoom;
        });
      });

      // 立即扫描按钮（触发 TODO 目录扫描落库）
      var pdHistoryMigrateBtn = $('pdHistoryMigrateBtn');
      if (pdHistoryMigrateBtn) {
        pdHistoryMigrateBtn.addEventListener('click', async function() {
          var btn = this;
          btn.disabled = true;
          btn.innerHTML = '⏳ 扫描中...';
          try {
            var r = await fetch('/api/todo-scan', { method: 'POST' });
            var data = r.ok ? await r.json() : { message: '扫描失败' };
            alert(data.message || '扫描完成');
            loadProductDev();
          } catch (e) {
            alert('扫描失败：' + (e.message || '后端服务不可用'));
          } finally {
            btn.disabled = false;
            btn.innerHTML = '&#128194; 立即扫描';
          }
        });
      }

      // 新建需求按钮（MVP：提示通过归档流程产生，不再调用旧接口）
      var pdNewRequirementBtn = $('pdNewRequirementBtn');
      if (pdNewRequirementBtn) {
        pdNewRequirementBtn.addEventListener('click', function() {
          alert('MVP 阶段需求由 Agent 完成编码任务后自动归档产生。如需手工录入，请在剪藏/待办模块创建并打上 product-dev 标签。');
        });
      }

      /* ── Init ── */
      (async function init() {
        await loadWorkspaces();
        showView('overview');
      })();
    })();
  