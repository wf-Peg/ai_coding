(function () {
  const $ = (id) => document.getElementById(id);
  const apiBase = 'http://127.0.0.1:8081/api/data';

  function formatTime(value) {
    if (!value) return '尚未生成';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN');
  }

  async function request(path, options) {
    const response = await fetch(apiBase + path, options);
    if (!response.ok) throw new Error('请求失败（' + response.status + '）');
    return response.json();
  }

  function renderStats(overview, trends) {
    const cards = [
      ['内容索引', overview.contentIndex.count, overview.contentIndex.exists ? '已建立' : '待建立'],
      ['工作台', overview.memberships ? overview.memberships.count + ' 条成员' : '-', '规则/排除/成员'],
      ['行为事件', trends.eventCount || 0, '近 30 天 ' + (trends.count30d || 0) + ' 条']
    ];
    $('stats').innerHTML = cards.map(function (card) {
      return '<div class="stat"><div class="stat-label">' + card[0] + '</div><div class="stat-value">' + card[1] + '</div><div class="stat-note">' + card[2] + '</div></div>';
    }).join('');
  }

  function renderIndexes(overview) {
    var items = [['contentIndex', '内容索引'], ['relationIndex', '关系索引'], ['projects', '项目'], ['memberships', '项目成员'], ['actionEvents', '行为事件']];
    $('indexList').innerHTML = items.map(function (pair) {
      var key = pair[0], label = pair[1];
      var item = overview[key];
      return '<div class="index-item"><div><div class="index-name">' + label + '</div><div class="index-meta">' + (item.exists ? '最近更新：' + formatTime(item.updatedAt) : '尚未生成') + '</div></div><div class="index-count">' + item.count + '</div></div>';
    }).join('');
    $('indexPath').textContent = overview.indexDirectory;
  }

  function renderBars(targetId, values) {
    var entries = Object.entries(values || {});
    if (!entries.length) { $(targetId).innerHTML = '<div class="empty">还没有足够数据，继续使用后会显示。</div>'; return; }
    var max = Math.max.apply(null, entries.map(function (e) { return e[1]; }), 1);
    $(targetId).innerHTML = entries.map(function (entry) {
      var label = entry[0], count = entry[1];
      return '<div class="bar-row"><div class="bar-label" title="' + label + '">' + label + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(count / max * 100) + '%"></div></div><div class="bar-count">' + count + '</div></div>';
    }).join('');
  }

  function renderTrendChart(targetId, dailyData, label) {
    var entries = Object.entries(dailyData || {});
    if (!entries.length) { $(targetId).innerHTML = '<div class="empty">暂无趋势数据。</div>'; return; }
    var max = Math.max.apply(null, entries.map(function (e) { return e[1]; }), 1);
    var html = '<div class="trend-chart">';
    for (var i = 0; i < entries.length; i++) {
      var day = entries[i][0], count = entries[i][1];
      var pct = Math.round(count / max * 100);
      var shortDay = day.slice(5);
      html += '<div class="trend-bar-wrap" title="' + day + ': ' + count + ' 条"><div class="trend-day">' + shortDay + '</div><div class="trend-track"><div class="trend-fill" style="height:' + pct + '%"></div></div><div class="trend-val">' + count + '</div></div>';
    }
    html += '</div>';
    $(targetId).innerHTML = html;
  }

  function renderTrends(trends) {
    if ($('trendsSection')) {
      $('trendsSection').innerHTML = '<div class="trends-stats">' +
        '<div class="trend-stat"><span class="trend-stat-label">近 7 天</span><span class="trend-stat-value">' + (trends.count7d || 0) + '</span></div>' +
        '<div class="trend-stat"><span class="trend-stat-label">近 30 天</span><span class="trend-stat-value">' + (trends.count30d || 0) + '</span></div>' +
        '<div class="trend-stat"><span class="trend-stat-label">跳过行</span><span class="trend-stat-value trend-warn">' + (trends.skippedLineCount || 0) + '</span></div>' +
        '</div>';
    }
    renderTrendChart('trendChart7d', trends.dailyCount7d, '7d');
    renderTrendChart('trendChart30d', trends.dailyCount30d, '30d');
    renderBars('typeDistribution', trends.typeDistribution);
    renderBars('sourceDistribution', trends.sourceDistribution);
  }

  function renderWorkspaceStats(wsStats, suggestionStats) {
    var panel = $('workspacePanel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.innerHTML = '<h2>工作台数据流 <small>内容来源分布 + 建议漏斗</small></h2>' +
      '<div class="ws-summary">' +
      '<div class="ws-summary-item"><span class="ws-summary-label">工作台</span><span class="ws-summary-value">' + (wsStats.workspaceCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">活跃</span><span class="ws-summary-value">' + (wsStats.activeCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">已归档</span><span class="ws-summary-value">' + (wsStats.archivedCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">规则数</span><span class="ws-summary-value">' + (wsStats.totalRules || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">排除数</span><span class="ws-summary-value">' + (wsStats.totalExclusions || 0) + '</span></div>' +
      '</div>' +
      '<div class="panel-section"><div class="section-title">成员来源</div><div id="membershipSourceDistribution"></div></div>' +
      '<div class="panel-section"><div class="section-title">建议漏斗</div><div id="suggestionFunnel"></div></div>';
    renderBars('membershipSourceDistribution', wsStats.membershipSourceDistribution);
    renderSuggestionFunnel(suggestionStats);
  }

  function renderSuggestionFunnel(stats) {
    if (!stats) return;
    var funnel = $('suggestionFunnel');
    if (!funnel) return;
    var accepted = stats.accepted || 0;
    var ignored = stats.ignored || 0;
    var rejected = stats.rejected || 0;
    var inCooldown = stats.inCooldown || 0;
    var rows = [
      ['已接受', accepted, 'var(--obs-good)'],
      ['已忽略', ignored, 'var(--obs-warn)'],
      ['已拒绝', rejected, '#e056a0'],
      ['冷却中', inCooldown, 'var(--obs-accent)']
    ].filter(function (r) { return r[1] > 0; });
    if (accepted === 0 && ignored === 0 && rejected === 0 && inCooldown === 0) {
      funnel.innerHTML = '<div class="empty">暂无建议记录</div>';
      return;
    }
    var total = accepted + ignored + rejected;
    var html = '<div class="funnel-summary"><span>共展示 ' + (stats.shown || 0) + ' 条</span><span>采纳率 ' + (stats.acceptanceRate || 0) + '%</span></div>' +
      '<div class="funnel-body">' +
      rows.map(function (r) {
        var pct = total > 0 ? Math.round(r[1] / total * 100) : 0;
        return '<div class="funnel-row">' +
          '<span class="funnel-label">' + r[0] + '</span>' +
          '<span class="funnel-track"><span class="funnel-fill" style="width:' + pct + '%;background:' + r[2] + '"></span></span>' +
          '<span class="funnel-count">' + r[1] + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
    funnel.innerHTML = html;
  }

  function renderDiagnosis(diag) {
    var content = $('diagnosisContent');
    if (!content) return;
    var files = diag.files || [];
    var html = '<div class="diag-list">';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var statusIcon = f.exists ? '&#10003;' : '&#10007;';
      var statusClass = f.exists ? 'diag-ok' : 'diag-missing';
      html += '<div class="diag-item"><span class="diag-icon ' + statusClass + '">' + statusIcon + '</span>' +
        '<div class="diag-info"><div class="diag-name">' + f.name + '</div><div class="diag-meta">' + f.count + ' 条, ' + (f.sizeBytes || 0) + ' B</div></div>' +
        '<div class="diag-time">' + formatTime(f.updatedAt) + '</div></div>';
    }
    html += '</div>';
    html += '<div class="path">' + diag.indexDirectory + '</div>';
    content.innerHTML = html;
  }

  async function load() {
    $('status').textContent = '读取中…';
    try {
      var [overview, trends, wsStats, diag, suggestionStats] = await Promise.all([
        request('/overview'), request('/trends'),
        request('/workspace-stats'), request('/export-diagnosis'),
        request('/workspace-suggestion-stats')
      ]);
      renderStats(overview, trends);
      renderIndexes(overview);
      renderTrends(trends);
      renderWorkspaceStats(wsStats, suggestionStats);
      renderDiagnosis(diag);
      $('status').textContent = '更新于 ' + formatTime(overview.observedAt);
      CutShelterScroll.restore('data-observability');
    } catch (error) {
      $('status').textContent = error.message;
    }
  }

  $('refreshBtn').addEventListener('click', load);
  $('rebuildBtn').addEventListener('click', async function () {
    var button = $('rebuildBtn'); button.disabled = true; button.textContent = '重建中…'; $('status').textContent = '正在扫描业务目录…';
    try { var result = await request('/rebuild', { method: 'POST' }); $('status').textContent = result.message + '，共 ' + result.count + ' 条'; await load(); }
    catch (error) { $('status').textContent = error.message; }
    finally { button.disabled = false; button.textContent = '重建内容索引'; }
  });

  $('pruneBtn').addEventListener('click', function () {
    showConfirmModal('确定清理 90 天前的事件数据？此操作不可撤销。', async function () {
      var button = $('pruneBtn'); button.disabled = true; button.textContent = '清理中…';
      try { var result = await request('/prune?days=90', { method: 'POST' }); $('status').textContent = result.message; await load(); }
      catch (error) { $('status').textContent = error.message; }
      finally { button.disabled = false; button.textContent = '清理旧事件'; }
    });
  });

  var confirmCallback = null;

  function showConfirmModal(message, callback) {
    $('confirmMessage').textContent = message;
    $('confirmModal').style.display = 'flex';
    confirmCallback = callback;
  }

  function closeConfirmModal() {
    $('confirmModal').style.display = 'none';
    confirmCallback = null;
  }

  $('confirmOkBtn').addEventListener('click', function () {
    var cb = confirmCallback;
    closeConfirmModal();
    if (cb) cb();
  });
  $('confirmCancelBtn').addEventListener('click', closeConfirmModal);
  $('confirmCloseBtn').addEventListener('click', closeConfirmModal);
  $('confirmModal').addEventListener('click', function (e) {
    if (e.target === this) closeConfirmModal();
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.action === 'themeChange' && event.data.theme)
      document.documentElement.dataset.theme = event.data.theme;
  });
  try {
    var parentTheme = window.parent && window.parent.document && window.parent.document.documentElement.getAttribute('data-theme');
    if (parentTheme) document.documentElement.dataset.theme = parentTheme;
  } catch (_) {}

  // ===== 异常日志模块 =====
  var exceptionState = {
    page: 1,
    size: 20,
    source: '',
    level: '',
    date: ''
  };

  function renderExceptionTrendChart(stats) {
    var chart = $('exceptionTrendChart');
    if (!chart) return;
    var daily = stats && stats.dailyCount7d ? stats.dailyCount7d : {};
    var entries = Object.entries(daily);
    if (!entries.length) { chart.innerHTML = '<div class="exception-empty">暂无趋势数据。</div>'; return; }
    var max = Math.max.apply(null, entries.map(function (e) { return e[1]; }), 1);
    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var day = entries[i][0], count = entries[i][1];
      var pct = Math.round(count / max * 100);
      var shortDay = day.slice(5);
      html += '<div class="exception-trend-bar" title="' + day + ': ' + count + ' 条"><div class="exception-trend-count">' + count + '</div><div class="exception-trend-track"><div class="exception-trend-fill" style="height:' + pct + '%"></div></div><div class="exception-trend-label">' + shortDay + '</div></div>';
    }
    chart.innerHTML = html;
  }

  function renderExceptionStats(stats) {
    if (!$('todayCount')) return;
    $('todayCount').textContent = stats ? (stats.todayCount || 0) : '-';
    var weekTotal = 0;
    if (stats && stats.dailyCount7d) {
      weekTotal = Object.values(stats.dailyCount7d).reduce(function (a, b) { return a + b; }, 0);
    }
    $('weekCount').textContent = stats ? weekTotal : '-';
    $('totalCount').textContent = stats ? (stats.totalCount || 0) : '-';
  }

  function formatExceptionTime(ts) {
    if (!ts) return '-';
    var parts = ts.split(' ');
    return parts.length > 1 ? parts[1].substring(0, 8) : ts;
  }

  function renderExceptionList(data) {
    var list = $('exceptionList');
    if (!list) return;
    var items = data && data.items ? data.items : [];
    if (!items.length) {
      list.innerHTML = '<div class="exception-empty">暂无匹配的异常日志。</div>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      var levelClass = 'exception-item-level-' + (item.level || 'ERROR');
      var sourceLabel = ({ backend: '后端', electron: 'Electron', frontend: '前端' })[item.source] || item.source;
      return '<div class="exception-item" data-id="' + (item.id || '') + '" onclick="showExceptionDetail(' + "'" + encodeURIComponent(JSON.stringify(item)) + "'" + ')">' +
        '<span class="exception-item-time">' + formatExceptionTime(item.timestamp) + '</span>' +
        '<span class="exception-item-source">' + sourceLabel + '</span>' +
        '<span class="exception-item-level ' + levelClass + '">' + (item.level || 'ERROR') + '</span>' +
        '<span class="exception-item-message" title="' + (item.message || '') + '">' + (item.message || '') + '</span>' +
        '</div>';
    }).join('');
  }

  // 异常详情弹窗（暴露到全局供 onclick 调用）
  window.showExceptionDetail = function (encoded) {
    var item;
    try { item = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    var content = $('exceptionDetailContent');
    if (!content) return;
    var sourceLabel = ({ backend: '后端', electron: 'Electron', frontend: '前端' })[item.source] || item.source;
    var stackHtml = item.stackTrace ? '<div class="exception-detail-field"><label>堆栈信息</label><div class="exception-detail-stack">' + escapeHtml(item.stackTrace) + '</div></div>' : '';
    content.innerHTML =
      '<div class="exception-detail-field"><label>ID</label><div class="value">' + (item.id || '-') + '</div></div>' +
      '<div class="exception-detail-field"><label>时间</label><div class="value">' + (item.timestamp || '-') + '</div></div>' +
      '<div class="exception-detail-field"><label>级别</label><div class="value">' + (item.level || '-') + '</div></div>' +
      '<div class="exception-detail-field"><label>来源</label><div class="value">' + sourceLabel + '</div></div>' +
      '<div class="exception-detail-field"><label>来源详情</label><div class="value">' + (item.sourceDetail || '-') + '</div></div>' +
      '<div class="exception-detail-field"><label>消息</label><div class="value">' + escapeHtml(item.message || '-') + '</div></div>' +
      '<div class="exception-detail-field"><label>线程</label><div class="value">' + (item.thread || '-') + '</div></div>' +
      (item.requestUri ? '<div class="exception-detail-field"><label>请求路径</label><div class="value">' + item.requestUri + '</div></div>' : '') +
      stackHtml;
    $('exceptionDetailModal').style.display = 'flex';
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderExceptionPagination(data) {
    var pagination = $('exceptionPagination');
    if (!pagination) return;
    var total = data.total || 0;
    var page = data.page || 1;
    var totalPages = data.totalPages || 0;
    if (totalPages <= 1) { pagination.innerHTML = ''; return; }
    pagination.innerHTML =
      '<button class="exception-page-btn" id="exceptionPrevPage" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>' +
      '<span class="exception-page-info">第 ' + page + ' / ' + totalPages + ' 页（共 ' + total + ' 条）</span>' +
      '<button class="exception-page-btn" id="exceptionNextPage" ' + (page >= totalPages ? 'disabled' : '') + '>下一页</button>';
    $('exceptionPrevPage').addEventListener('click', function () { exceptionState.page--; loadExceptionLogs(); });
    $('exceptionNextPage').addEventListener('click', function () { exceptionState.page++; loadExceptionLogs(); });
  }

  async function loadExceptionLogs() {
    try {
      // 加载统计
      var stats = await request('/exception-logs/stats');
      renderExceptionStats(stats);
      renderExceptionTrendChart(stats);

      // 加载列表
      var params = '?page=' + exceptionState.page + '&size=' + exceptionState.size;
      if (exceptionState.source) params += '&source=' + exceptionState.source;
      if (exceptionState.level) params += '&level=' + exceptionState.level;
      if (exceptionState.date) params += '&date=' + exceptionState.date;
      var data = await request('/exception-logs' + params);
      renderExceptionList(data);
      renderExceptionPagination(data);
    } catch (e) {
      if ($('exceptionList')) $('exceptionList').innerHTML = '<div class="exception-empty">加载异常日志失败: ' + e.message + '</div>';
    }
  }

  // 异常日志事件绑定
  if ($('exceptionRefreshBtn')) {
    $('exceptionRefreshBtn').addEventListener('click', function () {
      exceptionState.page = 1;
      loadExceptionLogs();
    });
  }
  if ($('filterSource')) {
    $('filterSource').addEventListener('change', function () {
      exceptionState.source = this.value;
      exceptionState.page = 1;
      loadExceptionLogs();
    });
  }
  if ($('filterLevel')) {
    $('filterLevel').addEventListener('change', function () {
      exceptionState.level = this.value;
      exceptionState.page = 1;
      loadExceptionLogs();
    });
  }
  if ($('filterDate')) {
    $('filterDate').addEventListener('change', function () {
      exceptionState.date = this.value;
      exceptionState.page = 1;
      loadExceptionLogs();
    });
  }
  if ($('exceptionPruneBtn')) {
    $('exceptionPruneBtn').addEventListener('click', function () {
      showConfirmModal('确定清理 90 天前的异常日志文件？此操作不可撤销。', async function () {
        var btn = $('exceptionPruneBtn'); btn.disabled = true; btn.textContent = '清理中…';
        try {
          var result = await request('/exception-logs?days=90', { method: 'DELETE' });
          $('exceptionList').innerHTML = '<div class="exception-empty">' + (result.message || '清理完成') + '</div>';
          loadExceptionLogs();
        } catch (e) {
          $('exceptionList').innerHTML = '<div class="exception-empty">清理失败: ' + e.message + '</div>';
        }
        finally { btn.disabled = false; btn.textContent = '清理旧日志'; }
      });
    });
  }
  // 异常详情弹窗关闭
  if ($('exceptionDetailCloseBtn')) {
    $('exceptionDetailCloseBtn').addEventListener('click', function () { $('exceptionDetailModal').style.display = 'none'; });
  }
  if ($('exceptionDetailCloseBtn2')) {
    $('exceptionDetailCloseBtn2').addEventListener('click', function () { $('exceptionDetailModal').style.display = 'none'; });
  }
  if ($('exceptionDetailModal')) {
    $('exceptionDetailModal').addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
  }

  // 诊断摘要折叠按钮
  var diagToggle = $('diagnosisToggle');
  if (diagToggle) {
    diagToggle.addEventListener('click', function () {
      var content = $('diagnosisContent');
      if (!content) return;
      var collapsed = content.style.display === 'none';
      content.style.display = collapsed ? '' : 'none';
      diagToggle.textContent = collapsed ? '收起诊断摘要' : '展开诊断摘要';
      diagToggle.dataset.collapsed = collapsed ? 'false' : 'true';
    });
  }

  load();
  // 延迟加载异常日志（不阻塞主数据加载）
  setTimeout(loadExceptionLogs, 500);
})();