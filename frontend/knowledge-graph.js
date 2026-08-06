(function() {
  'use strict';

  const API_BASE = 'http://127.0.0.1:8081/api/knowledge';
  const container = document.getElementById('graphContainer');
  const loadingEl = document.getElementById('loadingEl');
  const emptyEl = document.getElementById('emptyEl');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  const sidePanel = document.getElementById('sidePanel');
  const panelTitle = document.getElementById('panelTitle');
  const panelSummary = document.getElementById('panelSummary');
  const panelTags = document.getElementById('panelTags');
  const panelDetailLink = document.getElementById('panelDetailLink');
  const panelCloseBtn = document.getElementById('panelCloseBtn');

  let allNodes = [];
  let allLinks = [];
  let nodeMap = {};
  let selectedNodeId = null;
  let svg, g, simulation, linkElements, nodeElements, labelElements;

  // ---- Data Fetching ----

  async function fetchData() {
    try {
      const response = await fetch(`${API_BASE}/list`);
      const entries = await response.json();

      if (!entries || entries.length === 0) {
        showEmpty('暂无知识条目', '请先创建知识条目并添加链接');
        return;
      }

      buildGraph(entries);
    } catch (error) {
      console.error('获取知识列表失败:', error);
      showEmpty('加载失败', '请检查后端服务是否正常运行');
    }
  }

  function buildGraph(entries) {
    allNodes = [];
    allLinks = [];
    nodeMap = {};
    const linkSet = new Set();

    entries.forEach(function(entry) {
      const linkedCount = (entry.linkedKnowledgeIds && entry.linkedKnowledgeIds.length) || 0;
      nodeMap[entry.id] = {
        id: entry.id,
        title: entry.title || '未命名',
        summary: entry.summary || '',
        tags: entry.tags || [],
        linkedCount: linkedCount,
        linkedKnowledgeIds: entry.linkedKnowledgeIds || []
      };
      allNodes.push(nodeMap[entry.id]);
    });

    // Build links from linkedKnowledgeIds (bidirectional, only create one link per pair)
    entries.forEach(function(entry) {
      var linkedIds = entry.linkedKnowledgeIds || [];
      linkedIds.forEach(function(targetId) {
        if (nodeMap[targetId]) {
          var pairKey = entry.id < targetId ? entry.id + '|' + targetId : targetId + '|' + entry.id;
          if (!linkSet.has(pairKey)) {
            linkSet.add(pairKey);
            allLinks.push({ source: entry.id, target: targetId });
          }
        }
      });
    });

    if (allLinks.length === 0) {
      showEmpty('暂无知识关联', '请先创建知识条目并添加链接');
      return;
    }

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
    // Remove any existing SVG
    var existing = container.querySelector('svg');
    if (existing) existing.remove();

    var width = container.clientWidth;
    var height = container.clientHeight;

    svg = d3.select('#graphContainer')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    // Zoom behavior
    var zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', function(event) {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Click on background to reset
    svg.on('click', function(event) {
      if (event.target === svg.node()) {
        resetSelection();
      }
    });

    g = svg.append('g');

    // Force simulation
    simulation = d3.forceSimulation(allNodes)
      .force('link', d3.forceLink(allLinks).id(function(d) { return d.id; }).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(function(d) { return getNodeRadius(d) + 8; }));

    // Render links
    linkElements = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(allLinks)
      .join('line')
      .attr('class', 'link');

    // Render nodes
    nodeElements = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(allNodes)
      .join('g')
      .attr('class', 'node')
      .call(dragBehavior());

    // Node circles
    nodeElements.append('circle')
      .attr('r', function(d) { return getNodeRadius(d); })
      .attr('fill', function(d) { return getNodeColor(d); });

    // Node labels
    labelElements = nodeElements.append('text')
      .text(function(d) { return truncate(d.title, 15); })
      .attr('dy', function(d) { return getNodeRadius(d) + 14; });

    // Node click
    nodeElements.on('click', function(event, d) {
      event.stopPropagation();
      selectNode(d);
    });

    // Node hover
    nodeElements.on('mouseenter', function(event, d) {
      d3.select(this).select('circle')
        .transition().duration(150)
        .attr('r', getNodeRadius(d) * 1.15);
    }).on('mouseleave', function(event, d) {
      if (selectedNodeId !== d.id) {
        d3.select(this).select('circle')
          .transition().duration(150)
          .attr('r', getNodeRadius(d));
      }
    });

    // Simulation tick
    simulation.on('tick', function() {
      linkElements
        .attr('x1', function(d) { return d.source.x; })
        .attr('y1', function(d) { return d.source.y; })
        .attr('x2', function(d) { return d.target.x; })
        .attr('y2', function(d) { return d.target.y; });

      nodeElements
        .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    // Handle window resize
    window.addEventListener('resize', function() {
      var w = container.clientWidth;
      var h = container.clientHeight;
      svg.attr('width', w).attr('height', h);
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    });

    applyThemeStyles();
  }

  // ---- Node Helpers ----

  function getNodeRadius(d) {
    if (!d.linkedCount || d.linkedCount === 0) return 8;
    var r = 8 + (d.linkedCount * 2);
    return Math.min(r, 25);
  }

  function getNodeColor(d) {
    var count = d.linkedCount || 0;
    if (count >= 10) return '#2f72d8';
    if (count >= 6) return '#3f8cff';
    if (count >= 3) return '#73b2ff';
    return '#a3cfff';
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
    selectedNodeId = d.id;

    // Get neighbor IDs
    var neighborIds = new Set();
    neighborIds.add(d.id);
    allLinks.forEach(function(link) {
      var sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      var targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === d.id) neighborIds.add(targetId);
      if (targetId === d.id) neighborIds.add(sourceId);
    });

    // Dim non-neighbors
    nodeElements.classed('dimmed', function(n) {
      return !neighborIds.has(n.id);
    });

    linkElements.classed('dimmed', function(l) {
      var sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      var targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return !(neighborIds.has(sourceId) && neighborIds.has(targetId));
    });

    // Highlight selected node
    nodeElements.select('circle')
      .attr('stroke', function(n) {
        return n.id === d.id ? '#ff9800' : null;
      })
      .attr('stroke-width', function(n) {
        return n.id === d.id ? 3 : 2;
      });

    // Show side panel
    showSidePanel(d);
  }

  function resetSelection() {
    selectedNodeId = null;
    nodeElements.classed('dimmed', false);
    linkElements.classed('dimmed', false);
    nodeElements.select('circle')
      .attr('stroke', null)
      .attr('stroke-width', 2);
    hideSidePanel();
  }

  // ---- Side Panel ----

  function showSidePanel(d) {
    panelTitle.textContent = d.title;
    panelSummary.textContent = d.summary || '暂无摘要';

    var tagsHtml = (d.tags || []).map(function(t) {
      return '<span class="tag-badge">' + escapeHtml(t) + '</span>';
    }).join('');
    panelTags.innerHTML = tagsHtml || '<span style="color:var(--text-muted);font-size:0.85rem;">暂无标签</span>';

    panelDetailLink.href = 'knowledge-detail.html?id=' + encodeURIComponent(d.id);

    sidePanel.classList.add('open');
  }

  function hideSidePanel() {
    sidePanel.classList.remove('open');
  }

  panelCloseBtn.addEventListener('click', function() {
    hideSidePanel();
    resetSelection();
  });

  // ---- Theme Support ----

  function applyThemeStyles() {
    if (!svg) return;
    var theme = document.documentElement.getAttribute('data-theme') || 'notion';
    var isDark = theme === 'dark';

    var textColor = isDark ? '#9a9a9a' : '#6b7280';
    var linkColor = isDark ? '#555' : '#ccc';
    var linkOpacity = isDark ? 0.4 : 0.3;
    var dimOpacity = isDark ? 0.08 : 0.15;
    var nodeStroke = isDark ? '#2d2d2d' : '#ffffff';

    svg.selectAll('.link')
      .attr('stroke', linkColor)
      .style('stroke-opacity', linkOpacity);

    svg.selectAll('.node circle')
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

  // ---- Init ----

  document.addEventListener('DOMContentLoaded', function() {
    fetchData();
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