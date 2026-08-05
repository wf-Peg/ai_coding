(function () {
  const $ = (id) => document.getElementById(id);
  const apiBase = '/api/data';

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

  function renderStats(overview, habits, insights) {
    const cards = [
      ['内容索引', overview.contentIndex.count, overview.contentIndex.exists ? '已建立' : '待建立'],
      ['关系记录', overview.relationIndex.count, '来源与反向关系'],
      ['项目', overview.projects.count, overview.memberships.count + ' 条成员关系'],
      ['行为事件', habits.eventCount, (insights.activeDays || 0) + ' 个活跃日'],
      ['最近活动', formatTime(insights.latestEventAt), '本地统计']
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

  function renderEvents(habits) {
    $('eventCount').textContent = habits.eventCount + ' 条本地事件';
    var events = habits.recentEvents || [];
    $('events').innerHTML = events.length ? events.map(function (event) {
      return '<div class="event"><span class="event-dot"></span><div><div class="event-type">' + (event.type || '未命名动作') + '</div><div class="event-detail">' + (event.contentId || '未关联内容') + '</div></div><div class="event-time">' + formatTime(event.createdAt) + '</div></div>';
    }).join('') : '<div class="empty">暂时没有行为事件。</div>';
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

  function renderWorkspaceStats(wsStats) {
    var panel = $('workspacePanel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.innerHTML = '<h2>工作台数据流 <small>内容来源分布</small></h2>' +
      '<div class="ws-summary">' +
      '<div class="ws-summary-item"><span class="ws-summary-label">工作台</span><span class="ws-summary-value">' + (wsStats.workspaceCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">活跃</span><span class="ws-summary-value">' + (wsStats.activeCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">已归档</span><span class="ws-summary-value">' + (wsStats.archivedCount || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">规则数</span><span class="ws-summary-value">' + (wsStats.totalRules || 0) + '</span></div>' +
      '<div class="ws-summary-item"><span class="ws-summary-label">排除数</span><span class="ws-summary-value">' + (wsStats.totalExclusions || 0) + '</span></div>' +
      '</div>' +
      '<div class="panel-section"><div class="section-title">成员来源</div><div id="membershipSourceDistribution"></div></div>';
    renderBars('membershipSourceDistribution', wsStats.membershipSourceDistribution);
  }

  function renderDiagnosis(diag) {
    var panel = $('diagnosisPanel');
    if (!panel) return;
    panel.innerHTML = '<h2>诊断摘要 <small>索引文件状态</small></h2>';
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
    panel.innerHTML += html;
    panel.innerHTML += '<div class="path">' + diag.indexDirectory + '</div>';
  }

  async function load() {
    $('status').textContent = '读取中…';
    try {
      var [overview, habits, insights, trends, wsStats, diag] = await Promise.all([
        request('/overview'), request('/habits'), request('/insights'),
        request('/trends'), request('/workspace-stats'), request('/export-diagnosis')
      ]);
      renderStats(overview, habits, insights);
      renderIndexes(overview);
      renderBars('categories', habits.categories);
      renderBars('tags', habits.tags);
      renderEvents(habits);
      renderTrends(trends);
      renderWorkspaceStats(wsStats);
      renderDiagnosis(diag);
      $('status').textContent = '更新于 ' + formatTime(insights.latestEventAt || overview.observedAt);
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

  $('pruneBtn').addEventListener('click', async function () {
    if (!confirm('确定清理 90 天前的事件数据？此操作不可撤销。')) return;
    var button = $('pruneBtn'); button.disabled = true; button.textContent = '清理中…';
    try { var result = await request('/prune?days=90', { method: 'POST' }); $('status').textContent = result.message; await load(); }
    catch (error) { $('status').textContent = error.message; }
    finally { button.disabled = false; button.textContent = '清理旧事件'; }
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.action === 'themeChange' && event.data.theme)
      document.documentElement.dataset.theme = event.data.theme;
  });
  try {
    var parentTheme = window.parent && window.parent.document && window.parent.document.documentElement.getAttribute('data-theme');
    if (parentTheme) document.documentElement.dataset.theme = parentTheme;
  } catch (_) {}
  load();
})();