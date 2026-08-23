(function() {
  'use strict';

  const API_GRAPH = 'http://127.0.0.1:8081/api/graph';
  const API_SYNC = 'http://127.0.0.1:8081/api/relations/sync';

  const container = document.getElementById('graphContainer');
  const loadingEl = document.getElementById('loadingEl');
  const emptyEl = document.getElementById('emptyEl');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  const sidePanel = document.getElementById('sidePanel');
  const panelTitle = document.getElementById('panelTitle');
  const panelMeta = document.getElementById('panelMeta');
  const panelSummary = document.getElementById('panelSummary');
  const panelTags = document.getElementById('panelTags');
  const panelDetailLink = document.getElementById('panelDetailLink');
  const panelCloseBtn = document.getElementById('panelCloseBtn');

  const searchInput = document.getElementById('searchInput');
  const viewButtons = document.querySelectorAll('.view-toggle .seg-btn');
  const syncBtn = document.getElementById('syncBtn');

  let allNodes = [];
  let allLinks = [];
  let nodeMap = {};
  let selectedNodeId = null;
  let currentView = 'all'; // 'all' | 'knowledge'
  let svg, g, simulation, linkElements, nodeElements, labelElements;

  // ---- Data Fetching ----

  async function fetchData(view) {
    view = view || 'all';
    const includeTypes = view === 'knowledge' ? 'knowledge' : undefined;
    let nodes = null;
    let links = [];

    // 优先走本地索引 IPC（无需 Java 后端），失败回退 REST /api/graph
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.graph === 'function') {
      try {
        const res = await bridge.graph({ includeTypes });
        if (res && res.success) { nodes = res.nodes; links = res.links || []; }
      } catch (e) {}
    }
    if (nodes === null) {
      try {
        const url = includeTypes
          ? API_GRAPH + '?includeTypes=knowledge'
          : API_GRAPH;
        const response = await fetch(url);
        const data = await response.json();
        nodes = data.nodes; links = data.links || [];
      } catch (error) {
        console.error('获取图谱数据失败:', error);
        showEmpty('加载失败', '请检查后端服务或本地索引是否正常');
        return;
      }
    }

    if (!nodes || nodes.length === 0) {
      showEmpty('暂无图谱数据', '请先创建剪藏或知识条目并建立关联');
      return;
    }
    buildGraph(nodes, links);
  }

  function buildGraph(nodes, links) {
    allNodes = [];
    allLinks = [];
    nodeMap = {};
    const linkSet = new Set();

    nodes.forEach(function(n) {
      nodeMap[n.id] = {
        id: n.id,
        type: n.type || (String(n.id).indexOf('clip:') === 0 ? 'clip' : 'knowledge'),
        sourceId: n.sourceId,
        title: n.title || '未命名',
        summary: n.summary || '',
        category: n.category || '',
        tags: n.tags || [],
        linkedCount: n.linkedCount || 0,
        sourceCount: n.sourceCount || 0
      };
      allNodes.push(nodeMap[n.id]);
    });

    links.forEach(function(link) {
      var sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      var targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (!nodeMap[sourceId] || !nodeMap[targetId]) return;
      var pairKey = sourceId < targetId ? sourceId + '|' + targetId : targetId + '|' + sourceId;
      if (!linkSet.has(pairKey)) {
        linkSet.add(pairKey);
        allLinks.push({
          source: sourceId,
          target: targetId,
          type: link.type || (String(sourceId).indexOf('clip:') === 0 ? 'derived_from' : 'linked_to')
        });
      }
    });

    // If no links but there are nodes, still render the nodes (isolated)
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'none';
    initGraph();
  }

  function showEmpty(title, desc) {
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyTitle.textContent = title;
    emptyDesc.textContent = desc;
  }

  // ---- Graph Initialization ----

  function initGraph() {
    var existing = container.querySelector('svg');
    if (existing) existing.remove();

    var width = container.clientWidth;
    var height = container.clientHeight;

    svg = d3.select('#graphContainer')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    var zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', function(event) {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    svg.on('click', function(event) {
      if (event.target === svg.node()) {
        resetSelection();
      }
    });

    g = svg.append('g');

    simulation = d3.forceSimulation(allNodes)
      .force('link', d3.forceLink(allLinks).id(function(d) { return d.id; }).distance(fnLinkDistance).strength(fnLinkStrength))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(function(d) { return getNodeRadius(d) + 10; }));

    // Render links with type-based styling
    linkElements = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(allLinks)
      .join('line')
      .attr('class', function(d) { return 'link link-' + (d.type === 'derived_from' ? 'derived' : (d.type === 'plan_links' ? 'plan' : 'linked')); })
      .attr('stroke-dasharray', function(d) { return d.type === 'derived_from' ? '5 4' : null; });

    // Render nodes
    nodeElements = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(allNodes)
      .join('g')
      .attr('class', 'node')
      .call(dragBehavior());

    // Node shapes: clip = square, knowledge = circle, learning-plan = triangle
    var clipNodes = nodeElements.filter(function(d) { return isClip(d); });
    var planNodes = nodeElements.filter(function(d) { return isLearningPlan(d); });
    var knoNodes = nodeElements.filter(function(d) { return !isClip(d) && !isLearningPlan(d); });

    clipNodes.append('rect')
      .attr('x', function(d) { return -getNodeRadius(d); })
      .attr('y', function(d) { return -getNodeRadius(d); })
      .attr('width', function(d) { return getNodeRadius(d) * 2; })
      .attr('height', function(d) { return getNodeRadius(d) * 2; })
      .attr('rx', 3)
      .attr('fill', function(d) { return getNodeColor(d); });

    planNodes.append('polygon')
      .attr('points', function(d) { var r = getNodeRadius(d) + 3; return '0,' + (-r) + ' ' + (r * 0.87) + ',' + (r * 0.5) + ' ' + (-r * 0.87) + ',' + (r * 0.5); })
      .attr('fill', function(d) { return getNodeColor(d); });

    knoNodes.append('circle')
      .attr('r', function(d) { return getNodeRadius(d); })
      .attr('fill', function(d) { return getNodeColor(d); });

    // Node labels
    labelElements = nodeElements.append('text')
      .text(function(d) { return truncate(d.title, 14); })
      .attr('dy', function(d) { return getNodeRadius(d) + 14; });

    // Node click
    nodeElements.on('click', function(event, d) {
      event.stopPropagation();
      selectNode(d);
    });

    // Node hover
    nodeElements.on('mouseenter', function(event, d) {
      var sel = d3.select(this).select(shapeSelector(d));
      sel.transition().duration(150)
        .call(scaleShape, d, 1.15);
    }).on('mouseleave', function(event, d) {
      if (selectedNodeId !== String(d.id)) {
        var sel = d3.select(this).select(shapeSelector(d));
        sel.transition().duration(150)
          .call(scaleShape, d, 1);
      }
    });

    simulation.on('tick', function() {
      linkElements
        .attr('x1', function(d) { return d.source.x; })
        .attr('y1', function(d) { return d.source.y; })
        .attr('x2', function(d) { return d.target.x; })
        .attr('y2', function(d) { return d.target.y; });

      nodeElements
        .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    window.addEventListener('resize', function() {
      var w = container.clientWidth;
      var h = container.clientHeight;
      svg.attr('width', w).attr('height', h);
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    });

    applyThemeStyles();
  }

  function scaleShape(selection, d, factor) {
    var r = getNodeRadius(d) * factor;
    if (isLearningPlan(d)) {
      var rr = r + 3;
      selection.attr('points', '0,' + (-rr) + ' ' + (rr * 0.87) + ',' + (rr * 0.5) + ' ' + (-rr * 0.87) + ',' + (rr * 0.5));
    } else if (isClip(d)) {
      selection.attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2);
    } else {
      selection.attr('r', r);
    }
  }

  function shapeSelector(d) {
    if (isLearningPlan(d)) return 'polygon';
    return isClip(d) ? 'rect' : 'circle';
  }

  // ---- Node Helpers ----

  function isClip(d) {
    return d.type === 'clip';
  }

  function isLearningPlan(d) {
    return d.type === 'learning-plan';
  }

  function getNodeRadius(d) {
    if (isClip(d)) return 8;
    if (isLearningPlan(d)) return 10;
    var degree = (d.linkedCount || 0) + (d.sourceCount || 0);
    if (!degree) return d.linkedCount ? 10 : 9;
    var r = 9 + (degree * 1.6);
    return Math.min(r, 26);
  }

  function getNodeColor(d) {
    if (isLearningPlan(d)) return '#22c55e';
    if (isClip(d)) return '#f59e0b';
    var degree = (d.linkedCount || 0) + (d.sourceCount || 0);
    if (degree >= 10) return '#2f72d8';
    if (degree >= 6) return '#3f8cff';
    if (degree >= 3) return '#569cff';
    return '#8fc0ff';
  }

  function getNodeDegree(d) {
    return (d.linkedCount || 0) + (d.sourceCount || 0);
  }

  function fnLinkDistance(d) {
    if (d.type === 'derived_from') return 90;
    if (d.type === 'plan_links') return 120;
    return 130;
  }

  function fnLinkStrength() {
    return 0.5;
  }

  function truncate(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  }

  // ---- Drag Behavior ----

  function dragBehavior() {
    return d3.drag()
      .on('start', function(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function(event, d) {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  // ---- Selection & Highlighting ----

  function selectNode(d) {
    selectedNodeId = String(d.id);

    var neighborIds = new Set();
    neighborIds.add(String(d.id));
    allLinks.forEach(function(link) {
      var sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source);
      var targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target);
      if (sourceId === String(d.id)) neighborIds.add(targetId);
      if (targetId === String(d.id)) neighborIds.add(sourceId);
    });

    nodeElements.classed('dimmed', function(n) {
      return !neighborIds.has(String(n.id));
    });

    linkElements.classed('dimmed', function(l) {
      var sourceId = typeof l.source === 'object' ? String(l.source.id) : String(l.source);
      var targetId = typeof l.target === 'object' ? String(l.target.id) : String(l.target);
      return !(neighborIds.has(sourceId) && neighborIds.has(targetId));
    });

    nodeElements.select('circle, rect, polygon')
      .attr('stroke', function(n) {
        return String(n.id) === String(d.id) ? '#ff9800' : null;
      })
      .attr('stroke-width', function(n) {
        return String(n.id) === String(d.id) ? 3 : 2;
      });

    showSidePanel(d);
  }

  function resetSelection() {
    selectedNodeId = null;
    nodeElements.classed('dimmed', false);
    linkElements.classed('dimmed', false);
    nodeElements.select('circle, rect, polygon')
      .attr('stroke', null)
      .attr('stroke-width', 2);
    hideSidePanel();
  }

  // ---- Search ----

  function applySearch() {
    var query = (searchInput && searchInput.value ? searchInput.value.trim() : '').toLowerCase();
    if (!query) {
      nodeElements.classed('dimmed', false);
      nodeElements.select('circle, rect').attr('stroke', null);
      linkElements.classed('dimmed', false);
      return;
    }

    var matched = new Set();
    allNodes.forEach(function(n) {
      var hay = ((n.title || '') + ' ' + (n.category || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
      if (hay.indexOf(query) !== -1) matched.add(String(n.id));
    });

    // Include neighbors of matches for clustering
    var cluster = new Set(matched);
    allLinks.forEach(function(l) {
      var sourceId = typeof l.source === 'object' ? String(l.source.id) : String(l.source);
      var targetId = typeof l.target === 'object' ? String(l.target.id) : String(l.target);
      if (matched.has(sourceId)) cluster.add(targetId);
      if (matched.has(targetId)) cluster.add(sourceId);
    });

    nodeElements.classed('dimmed', function(n) {
      return !cluster.has(String(n.id));
    });
    linkElements.classed('dimmed', function(l) {
      var sourceId = typeof l.source === 'object' ? String(l.source.id) : String(l.source);
      var targetId = typeof l.target === 'object' ? String(l.target.id) : String(l.target);
      return !(cluster.has(sourceId) && cluster.has(targetId));
    });

    nodeElements.select('circle, rect, polygon').attr('stroke', function(n) {
      return matched.has(String(n.id)) ? '#ff9800' : null;
    });
  }

  // ---- View Toggle ----

  function setView(view) {
    currentView = view;
    viewButtons.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    hideSidePanel();
    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';
    fetchData(view);
  }

  // ---- Sync ----

  async function syncRelations() {
    if (!syncBtn) return;
    syncBtn.classList.add('loading');
    syncBtn.textContent = '同步中...';
    try {
      await fetch(API_SYNC, { method: 'POST' });
      await fetchData(currentView);
    } catch (error) {
      console.error('同步关系失败:', error);
    } finally {
      syncBtn.classList.remove('loading');
      syncBtn.textContent = '刷新关系';
    }
  }

  // ---- Side Panel ----

  function showSidePanel(d) {
    panelTitle.textContent = d.title;
    panelSummary.textContent = d.summary || '暂无摘要';

    if (isLearningPlan(d)) {
      panelMeta.textContent = '学习计划 · ' + (d.linkedCount || 0) + ' 个关联 · ' + (d.sourceCount || 0) + ' 个来源';
    } else if (isClip(d)) {
      panelMeta.textContent = '来源剪藏' + (d.category ? ' · ' + d.category : '');
    } else {
      panelMeta.textContent = '知识条目 · ' + (d.linkedCount || 0) + ' 个关联 · ' + (d.sourceCount || 0) + ' 个来源';
    }

    var tagsHtml = (d.tags || []).map(function(t) {
      return '<span class="tag-badge">' + escapeHtml(t) + '</span>';
    }).join('');
    panelTags.innerHTML = tagsHtml || '<span style="color:var(--text-muted);font-size:0.85rem;">暂无标签</span>';

    if (isLearningPlan(d)) {
      panelDetailLink.textContent = '前往学习计划';
      panelDetailLink.href = 'learning-plan.html?planId=' + encodeURIComponent(d.sourceId != null ? d.sourceId : d.id);
    } else if (isClip(d)) {
      panelDetailLink.textContent = '前往剪藏模块';
      panelDetailLink.href = 'clip.html';
    } else {
      panelDetailLink.textContent = '查看详情';
      panelDetailLink.href = 'knowledge-detail.html?id=' + encodeURIComponent(d.sourceId != null ? d.sourceId : d.id);
    }

    sidePanel.classList.add('open');
  }

  function hideSidePanel() {
    sidePanel.classList.remove('open');
  }

  // ---- Theme Support ----

  function applyThemeStyles() {
    if (!svg) return;
    var theme = document.documentElement.getAttribute('data-theme') || 'notion';
    var isDark = theme === 'dark';

    var textColor = isDark ? '#9a9a9a' : '#6b7280';
    var nodeStroke = isDark ? '#2d2d2d' : '#ffffff';

    svg.selectAll('.link-linked')
      .attr('stroke', isDark ? '#569cff' : '#3f8cff')
      .attr('stroke-opacity', 0.45);
    svg.selectAll('.link-derived')
      .attr('stroke', isDark ? '#f59e0b' : '#fb923c')
      .attr('stroke-opacity', 0.55);
    svg.selectAll('.link-plan')
      .attr('stroke', isDark ? '#22c55e' : '#22c55e')
      .attr('stroke-opacity', 0.6);

    svg.selectAll('.node circle, .node rect, .node polygon')
      .attr('stroke', nodeStroke);

    svg.selectAll('.node text')
      .attr('fill', textColor);
  }

  window.onThemeChange = function() {
    applyThemeStyles();
  };

  // ---- Utilities ----

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---- Event Bindings ----

  if (searchInput) {
    searchInput.addEventListener('input', applySearch);
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        applySearch();
      }
    });
  }

  viewButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      setView(btn.dataset.view);
    });
  });

  syncBtn.addEventListener('click', syncRelations);

  panelCloseBtn.addEventListener('click', function() {
    hideSidePanel();
    resetSelection();
  });

  if (panelDetailLink) {
    panelDetailLink.addEventListener('click', function(e) {
      var href = panelDetailLink.getAttribute('href') || '';
      if (href.indexOf('learning-plan.html') === 0) {
        e.preventDefault();
        var m = href.match(/planId=(\d+)/);
        var planId = m ? parseInt(m[1]) : null;
        if (planId && window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'navigateLearningPlan', planId: planId }, '*');
        }
      }
    });
  }

  // ---- Init ----

  document.addEventListener('DOMContentLoaded', function() {
    fetchData('all');
  });

  // ---- PostMessage listener for parent frame ----

  window.addEventListener('message', function(e) {
    if (e.data.action === 'themeChange') {
      if (typeof window.applyTheme === 'function') window.applyTheme();
    } else if (e.data.action === 'refresh') {
      location.reload();
    }
  });

})();