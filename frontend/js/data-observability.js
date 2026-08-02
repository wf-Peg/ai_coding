(function () {
  const $ = (id) => document.getElementById(id);
  const apiBase = '/api/data';

  function formatTime(value) {
    if (!value) return '尚未生成';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
  }

  async function request(path, options) {
    const response = await fetch(apiBase + path, options);
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    return response.json();
  }

  function renderStats(overview, habits, insights) {
    const cards = [
      ['内容索引', overview.contentIndex.count, overview.contentIndex.exists ? '已建立' : '待建立'],
      ['关系记录', overview.relationIndex.count, '来源与反向关系'],
      ['项目', overview.projects.count, `${overview.memberships.count} 条成员关系`],
      ['行为事件', habits.eventCount, `${insights.activeDays || 0} 个活跃日`],
      ['最近活动', formatTime(insights.latestEventAt), '本地统计']
    ];
    $('stats').innerHTML = cards.map(card => `<div class="stat"><div class="stat-label">${card[0]}</div><div class="stat-value">${card[1]}</div><div class="stat-note">${card[2]}</div></div>`).join('');
  }

  function renderIndexes(overview) {
    const items = [['contentIndex', '内容索引'], ['relationIndex', '关系索引'], ['projects', '项目'], ['memberships', '项目成员'], ['actionEvents', '行为事件']];
    $('indexList').innerHTML = items.map(([key, label]) => {
      const item = overview[key];
      return `<div class="index-item"><div><div class="index-name">${label}</div><div class="index-meta">${item.exists ? `最近更新：${formatTime(item.updatedAt)}` : '尚未生成'}</div></div><div class="index-count">${item.count}</div></div>`;
    }).join('');
    $('indexPath').textContent = overview.indexDirectory;
  }

  function renderBars(targetId, values) {
    const entries = Object.entries(values || {});
    if (!entries.length) { $(targetId).innerHTML = '<div class="empty">还没有足够数据，继续使用后会显示。</div>'; return; }
    const max = Math.max(...entries.map(([, count]) => count), 1);
    $(targetId).innerHTML = entries.map(([label, count]) => `<div class="bar-row"><div class="bar-label" title="${label}">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(count / max * 100)}%"></div></div><div class="bar-count">${count}</div></div>`).join('');
  }

  function renderEvents(habits) {
    $('eventCount').textContent = `${habits.eventCount} 条本地事件`;
    const events = habits.recentEvents || [];
    $('events').innerHTML = events.length ? events.map(event => `<div class="event"><span class="event-dot"></span><div><div class="event-type">${event.type || '未命名动作'}</div><div class="event-detail">${event.contentId || '未关联内容'}</div></div><div class="event-time">${formatTime(event.createdAt)}</div></div>`).join('') : '<div class="empty">暂时没有行为事件。</div>';
  }

  async function load() {
    $('status').textContent = '读取中…';
    try {
      const [overview, habits, insights] = await Promise.all([request('/overview'), request('/habits'), request('/insights')]);
      renderStats(overview, habits, insights); renderIndexes(overview); renderBars('categories', habits.categories); renderBars('tags', habits.tags); renderEvents(habits);
      $('status').textContent = `更新于 ${formatTime(insights.latestEventAt || overview.observedAt)}`;
    } catch (error) { $('status').textContent = error.message; }
  }

  $('refreshBtn').addEventListener('click', load);
  $('rebuildBtn').addEventListener('click', async () => {
    const button = $('rebuildBtn'); button.disabled = true; button.textContent = '重建中…'; $('status').textContent = '正在扫描业务目录…';
    try { const result = await request('/rebuild', { method: 'POST' }); $('status').textContent = `${result.message}，共 ${result.count} 条`; await load(); }
    catch (error) { $('status').textContent = error.message; }
    finally { button.disabled = false; button.textContent = '重建内容索引'; }
  });
  window.addEventListener('message', event => { if (event.data?.action === 'themeChange' && event.data.theme) document.documentElement.dataset.theme = event.data.theme; });
  try {
    const parentTheme = window.parent?.document?.documentElement?.getAttribute('data-theme');
    if (parentTheme) document.documentElement.dataset.theme = parentTheme;
  } catch (_) {}
  load();
})();
