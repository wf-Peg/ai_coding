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

  const canvasMenu = document.getElementById('canvasMenu');
  const nodeMenu = document.getElementById('nodeMenu');
  const edgeMenu = document.getElementById('edgeMenu');
  const groupMenu = document.getElementById('groupMenu');
  const groupAction = document.getElementById('groupAction');
  const snapBtn = document.getElementById('snapBtn');
  const canvasModalMask = document.getElementById('canvasModalMask');
  const canvasModalTitle = document.getElementById('canvasModalTitle');
  const canvasModalBody = document.getElementById('canvasModalBody');
  const canvasModalOk = document.getElementById('canvasModalOk');
  const canvasModalCancel = document.getElementById('canvasModalCancel');

  let allNodes = [];
  let allLinks = [];
  let nodeMap = {};
  let selectedNodeId = null;
  let currentView = 'all'; // 'all' | 'knowledge'
  let svg, g, simulation, linkElements, nodeElements, labelElements;

  // ---- 阶段三：框选 / 多选 / 分组 / 网格吸附 ----
  const GRID = 20;                       // 网格吸附间距
  let selectedNodeIds = new Set();       // 当前选中节点 id 集合
  let gridSnap = false;                  // 网格吸附开关
  let spacePressed = false;              // 空格键状态（空格拖动 = 平移画布）
  let boxSelect = null;                  // 框选状态 {rect, startX, startY, shift}
  let allGroups = [];                    // 分组数据 {id,name,members[]}
  let frameLayer = null;                // frame 图层元素选择器
  let selectionLayer = null;            // 选择层（框选矩形）
  let groupMove = null;                  // 分组整体拖动状态
  let batchMove = null;                   // 多选批量拖动状态
  let pendingGroup = null;               // 待确认的组成分组成员
  let suppressSvgClick = false;          // 框选后抑制本次 svg click

  let currentTransform = d3.zoomIdentity;
  let preservedTransform = d3.zoomIdentity;
  let tempLink = null;
  let linkSourceId = null;
  let canvasModalCtx = null;
  let pendingRefNodeId = null;
  let panelLinkNodeUrl = null;

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
    loadGroups();
  }

  async function loadGroups() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.listGroups !== 'function') return;
    try {
      const res = await bridge.listGroups();
      if (res && res.success) { allGroups = res.groups || []; }
    } catch (e) { allGroups = []; }
    if (typeof renderGroupFrames === 'function') renderGroupFrames();
  }

  function buildGraph(nodes, links) {
    allNodes = [];
    allLinks = [];
    nodeMap = {};
    const linkSet = new Set();

    nodes.forEach(function(n) {
      var node = {
        id: n.id,
        type: n.type || (String(n.id).indexOf('clip:') === 0 ? 'clip' : 'knowledge'),
        sourceId: n.sourceId,
        title: n.title || '未命名',
        summary: n.summary || '',
        category: n.category || '',
        tags: n.tags || [],
        linkedCount: n.linkedCount || 0,
        sourceCount: n.sourceCount || 0,
        text: n.text,
        canvas: !!n.canvas
      };
      // 后端带回的画布坐标：预先钉住节点，实现位置持久化（拖到哪、下次还在哪）
      if (typeof n.x === 'number' && typeof n.y === 'number' && isFinite(n.x) && isFinite(n.y)) {
        node.x = n.x;
        node.y = n.y;
        node.fx = n.x;
        node.fy = n.y;
      }
      nodeMap[n.id] = node;
      allNodes.push(node);
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
          type: link.type || (String(sourceId).indexOf('clip:') === 0 ? 'derived_from' : 'linked_to'),
          manualId: link.manualId
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
      .scaleExtent([0.05, 12])
      // 空白左键拖动留给「框选」；仅滚轮缩放 / 空格或中键拖动平移
      .filter(function(event) {
        var e = event.sourceEvent;
        if (!e) return true;
        if (e.type === 'wheel') return true;
        if (e.type === 'mousemove' && spacePressed) return true;
        if (e.type === 'mousedown' && (e.button === 1 || spacePressed)) return true;
        return false;
      })
      .on('zoom', function(event) {
        currentTransform = event.transform;
        preservedTransform = event.transform;
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    svg.on('click', function(event) {
      if (event.target !== svg.node()) return;
      if (suppressSvgClick) { suppressSvgClick = false; return; }
      resetSelection();
    });

    // 空格键：按住 + 拖动 = 平移画布
    ['keydown', 'keyup'].forEach(function(type) {
      window.addEventListener(type, function(e) {
        var isDown = type === 'keydown';
        if (e.key === ' ' || e.code === 'Space') {
          spacePressed = isDown;
          if (isDown) e.preventDefault();
        }
      });
    });

    // 空白画布右键：新建节点菜单
    svg.on('contextmenu', function(event) {
      if (event.target !== svg.node()) return;
      event.preventDefault();
      openCanvasMenu(event.clientX, event.clientY, screenToWorld(event));
    });

    // 图片缩略图圆角裁剪（固定尺寸 110x72）
    svg.append('defs').append('clipPath')
      .attr('id', 'canvasImgClip')
      .append('rect')
      .attr('x', -55).attr('y', -36).attr('width', 110).attr('height', 72).attr('rx', 8);

    g = svg.append('g');

    // 分组 frame 图层（最底层，环绕成员节点）
    frameLayer = g.append('g').attr('class', 'frames-layer');

    // 连线模式下的临时虚线
    tempLink = g.append('line')
      .attr('class', 'temp-link')
      .attr('display', 'none');

    // 空白拖动框选 / 连线模式跟随鼠标
    svg.on('mousemove', function(event) {
      if (boxSelect) { updateBoxSelect(event); return; }
      if (!linkSourceId) { if (tempLink) tempLink.attr('display', 'none'); return; }
      var src = nodeMap[linkSourceId];
      if (!src) return;
      var m = d3.pointer(event, container);
      tempLink
        .attr('x1', currentTransform.applyX(src.x))
        .attr('y1', currentTransform.applyY(src.y))
        .attr('x2', m[0])
        .attr('y2', m[1])
        .attr('display', null);
    });

    // 恢复上次视图（新建/删除节点后重绘不跳视角）
    if (preservedTransform && (preservedTransform.k !== 1 || preservedTransform.x || preservedTransform.y)) {
      svg.call(zoom.transform, preservedTransform);
    }

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
      .attr('class', function(d) {
        var suffix = d.type === 'derived_from' ? 'derived' : (d.type === 'plan_links' ? 'plan' : (d.type === 'manual' ? 'manual' : 'linked'));
        return 'link link-' + suffix;
      })
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
    var knoNodes = nodeElements.filter(function(d) { return !isClip(d) && !isLearningPlan(d) && !isCanvas(d); });
    var canvasNodes = nodeElements.filter(function(d) { return isCanvas(d); });

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

    // 画布可写节点：卡片式渲染（便签/链接/图片/引用）
    renderCanvasNodes(canvasNodes);

    // Node labels（画布节点文字已内嵌在卡片内，不再加下方标签）
    labelElements = nodeElements.filter(function(d) { return !isCanvas(d); }).append('text')
      .text(function(d) { return truncate(d.title, 14); })
      .attr('dy', function(d) { return getNodeRadius(d) + 14; });

    // Node click
    nodeElements.on('click', function(event, d) {
      event.stopPropagation();
      if (linkSourceId) { completeLink(String(d.id)); return; }
      // Ctrl/Cmd + 点击：多选切换
      if (event.ctrlKey || event.metaKey) {
        if (selectedNodeIds.has(String(d.id))) {
          selectedNodeIds.delete(String(d.id));
          selectedNodeId = null;
        } else {
          selectedNodeIds.add(String(d.id));
          selectedNodeId = String(d.id);
        }
        applySelectionHighlight();
        return;
      }
      selectNode(d);
    });

    // 双击编辑画布节点内容（便签/链接/图片）
    nodeElements.on('dblclick', function(event, d) {
      event.stopPropagation();
      if (isCanvas(d) && d.type !== 'ref') openEditModal(d);
    });

    // 节点右键菜单
    nodeElements.on('contextmenu', function(event, d) {
      event.stopPropagation();
      event.preventDefault();
      openNodeMenu(event.clientX, event.clientY, d);
    });

    // 手动连线右键菜单（可删除）
    linkElements.on('contextmenu', function(event, d) {
      if (d.type !== 'manual' || !d.manualId) return;
      event.stopPropagation();
      event.preventDefault();
      openEdgeMenu(event.clientX, event.clientY, d);
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

      // 分组 frame 随成员节点位置实时更新
      updateGroupFrames();
    });

    simulation.on('end', function() {
      // 自动布局稳定后写回位置，让首次布局也「记住」
      persistPositionsDebounced();
    });

    window.addEventListener('resize', function() {
      var w = container.clientWidth;
      var h = container.clientHeight;
      svg.attr('width', w).attr('height', h);
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    });

    // 选择层（绘制框选矩形，置顶显示）
    selectionLayer = g.append('g').attr('class', 'selection-layer');

    // 空白左键拖动 = 框选
    svg.on('mousedown', function(event) {
      if (event.target !== svg.node()) return;
      if (spacePressed || event.button !== 0) return;
      event.preventDefault();
      beginBoxSelect(event);
    });

    renderGroupFrames();
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

  function renderCanvasNodes(selection) {
    selection.each(function(d) {
      var gSel = d3.select(this);
      var s = canvasCardSize(d);
      var w = s.w, h = s.h, rx = 8, fill = getNodeColor(d);

      gSel.append('rect')
        .attr('x', -w / 2).attr('y', -h / 2)
        .attr('width', w).attr('height', h)
        .attr('rx', rx).attr('fill', fill);

      if (d.type === 'image') {
        // 兜底图标先画，图片加载成功会盖住它；失败则仍可见
        gSel.append('text').attr('class', 'canvas-card-text').attr('y', 4).text('🖼');
        if (d.text) {
          gSel.append('image')
            .attr('href', d.text)
            .attr('x', -w / 2).attr('y', -h / 2)
            .attr('width', w).attr('height', h)
            .attr('preserveAspectRatio', 'xMidYMid slice')
            .attr('clip-path', 'url(#canvasImgClip)');
        }
        return;
      }

      var label = '';
      if (d.type === 'note') label = d.text || d.title || '便签';
      else if (d.type === 'link') label = '🔗 ' + (d.title || d.text || '链接');
      else label = d.title || '引用';

      var lines = wrapLines(label, d.type === 'note' ? 12 : 13);
      var textSel = gSel.append('text')
        .attr('class', d.type === 'ref' ? 'canvas-card-text canvas-ref-text' : 'canvas-card-text');
      var lineHeight = 13;
      var startY = -((lines.length - 1) * lineHeight) / 2;
      for (var i = 0; i < lines.length; i++) {
        textSel.append('tspan').attr('x', 0).attr('y', startY + i * lineHeight).text(lines[i]);
      }
    });
  }

  function screenToWorld(event) {
    var m = d3.pointer(event, container);
    return currentTransform.invert(m);
  }

  // ---- Node Helpers ----

  function isClip(d) {
    return d.type === 'clip';
  }

  function isLearningPlan(d) {
    return d.type === 'learning-plan';
  }

  function isCanvas(d) {
    return d.type === 'note' || d.type === 'link' || d.type === 'image' || d.type === 'ref';
  }

  function canvasCardSize(d) {
    if (d.type === 'image') return { w: 110, h: 72 };
    if (d.type === 'note') return { w: 108, h: 60 };
    return { w: 108, h: 42 };
  }

  function wrapLines(text, maxChars) {
    text = String(text == null ? '' : text).trim();
    if (!text) return [];
    var words = text.split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var candidate = cur ? cur + ' ' + words[i] : words[i];
      if (candidate.length > maxChars && cur) { lines.push(cur); cur = words[i]; }
      else cur = candidate;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
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
    if (d.type === 'note') return '#fbbf24';
    if (d.type === 'link') return '#22d3ee';
    if (d.type === 'image') return '#a78bfa';
    if (d.type === 'ref') return '#14b8a6';
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
      .filter(function() { return !spacePressed; })
      .on('start', function(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        if (selectedNodeIds.size > 1 && selectedNodeIds.has(String(d.id))) {
          // 批量移动：记录所有选中成员的起始坐标
          startBatchMove(event);
          return;
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function(event, d) {
        if (batchMove) { moveSelection(event); return; }
        d.fx = snapVal(event.x);
        d.fy = snapVal(event.y);
      })
      .on('end', function(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        if (batchMove) { endBatchMove(); }
        else { d.fx = snapVal(d.x); d.fy = snapVal(d.y); }
        // 松手后保持当前位置（画布行为），并写回本地
        persistPositionsDebounced();
      });
  }

  function startBatchMove(event) {
    batchMove = { nodes: [], startX: event.x, startY: event.y };
    selectedNodeIds.forEach(function(id) {
      var n = nodeMap[id];
      if (!n) return;
      n._sx = n.x; n._sy = n.y;
      n.fx = n.x; n.fy = n.y;
      batchMove.nodes.push(n);
    });
  }

  function moveSelection(event) {
    var dx = event.x - batchMove.startX;
    var dy = event.y - batchMove.startY;
    batchMove.nodes.forEach(function(n) {
      n.fx = snapVal(n._sx + dx);
      n.fy = snapVal(n._sy + dy);
    });
  }

  function endBatchMove() {
    batchMove = null;
  }

  function snapVal(v) {
    if (!gridSnap) return v;
    return Math.round(v / GRID) * GRID;
  }

  // ---- Position Persistence ----

  var persistTimer = null;

  function persistPositions() {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.saveLayout !== 'function') return;
    var positions = [];
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
      if (!isFinite(n.x) || !isFinite(n.y)) continue;
      positions.push({ id: n.id, x: n.x, y: n.y });
    }
    if (!positions.length) return;
    try { bridge.saveLayout({ positions: positions }); } catch (e) {}
  }

  function persistPositionsDebounced() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistPositions, 300);
  }

  // ---- Selection & Highlighting ----

  function selectNode(d) {
    selectedNodeId = String(d.id);
    selectedNodeIds.clear();
    selectedNodeIds.add(String(d.id));
    applySelectionHighlight();

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

    showSidePanel(d);
  }

  function resetSelection() {
    selectedNodeId = null;
    selectedNodeIds.clear();
    applySelectionHighlight();
    nodeElements.classed('dimmed', false);
    linkElements.classed('dimmed', false);
    hideSidePanel();
  }

  function applySelectionHighlight() {
    if (!nodeElements) return;
    nodeElements.classed('selected-node', function(n) {
      return selectedNodeIds.has(String(n.id));
    });
  }

  // ---- 框选（Box Select）----

  function beginBoxSelect(event) {
    var pt = currentTransform.invert(d3.pointer(event, container));
    boxSelect = { startX: pt[0], startY: pt[1], shift: event.shiftKey || event.ctrlKey || event.metaKey };
    if (!selectionLayer) return;
    boxSelect.rect = selectionLayer.append('rect')
      .attr('class', 'box-select-rect')
      .attr('x', pt[0]).attr('y', pt[1]).attr('width', 0).attr('height', 0);

    var up = function(e) {
      window.removeEventListener('mouseup', up);
      endBoxSelect();
    };
    window.addEventListener('mouseup', up);
  }

  function updateBoxSelect(event) {
    if (!boxSelect || !boxSelect.rect) return;
    var pt = currentTransform.invert(d3.pointer(event, container));
    var x = Math.min(boxSelect.startX, pt[0]);
    var y = Math.min(boxSelect.startY, pt[1]);
    var w = Math.abs(pt[0] - boxSelect.startX);
    var h = Math.abs(pt[1] - boxSelect.startY);
    boxSelect.rect.attr('x', x).attr('y', y).attr('width', w).attr('height', h);

    // 实时高亮命中节点
    var sel = new Set();
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (n.x >= x && n.x <= x + w && n.y >= y && n.y <= y + h) sel.add(String(n.id));
    }
    if (boxSelect.shift) {
      nodeElements.classed('selected-node', function(n) {
        return selectedNodeIds.has(String(n.id)) || sel.has(String(n.id));
      });
    } else {
      nodeElements.classed('selected-node', function(n) { return sel.has(String(n.id)); });
    }
  }

  function endBoxSelect() {
    if (!boxSelect) return;
    // 拖了一段距离就算「拖选」，抑制随后的 svg click 以免清空选择
    if (boxSelect.rect) {
      var w = parseFloat(boxSelect.rect.attr('width'));
      var h = parseFloat(boxSelect.rect.attr('height'));
      if (w > 5 || h > 5) suppressSvgClick = true;
      boxSelect.rect.remove();
    }
    // 汇总最终选中集合
    var sel2 = new Set();
    nodeElements.each(function(n) {
      if (d3.select(this).classed('selected-node')) sel2.add(String(n.id));
    });
    selectedNodeIds = sel2;
    selectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    boxSelect = null;
  }

  // ---- 分组 frame ----

  function renderGroupFrames() {
    if (!frameLayer) return;
    frameLayer.selectAll('*').remove();
    frameLayer.selectAll('g.group-frame')
      .data(allGroups, function(d) { return d.id; })
      .join('g')
      .attr('class', 'group-frame')
      .each(function(gd) {
        var s = d3.select(this);
        s.append('rect').attr('class', 'group-frame-rect');
        s.append('text').attr('class', 'group-frame-title')
          .text(gd.name || '分组')
          .on('contextmenu', function(e) {
            e.stopPropagation();
            e.preventDefault();
            openGroupMenu(e.clientX, e.clientY, gd);
          })
          .call(groupDragBehavior());
      });
    updateGroupFrames();
  }

  function updateGroupFrames() {
    if (!frameLayer) return;
    frameLayer.selectAll('g.group-frame').each(function(gd) {
      var b = frameBounds(gd);
      var s = d3.select(this);
      s.select('rect.group-frame-rect')
        .attr('x', b.x).attr('y', b.y)
        .attr('width', Math.max(b.w, 1)).attr('height', Math.max(b.h, 1));
      s.select('text.group-frame-title')
        .attr('x', b.x + 8).attr('y', b.y + 12).text(gd.name || '分组');
    });
  }

  function frameBounds(gd) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, none = true;
    (gd.members || []).forEach(function(id) {
      var n = nodeMap[id];
      if (!n || !isFinite(n.x) || !isFinite(n.y)) return;
      none = false;
      var hw = nodeHalfW(n), hh = nodeHalfH(n);
      minX = Math.min(minX, n.x - hw); maxX = Math.max(maxX, n.x + hw);
      minY = Math.min(minY, n.y - hh); maxY = Math.max(maxY, n.y + hh);
    });
    if (none) return { x: 0, y: 0, w: 60, h: 40 };
    var pad = 20;
    var x = minX - pad, y = minY - pad;
    return { x: x, y: y, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2, nx: x, ny: y };
  }

  function nodeHalfW(n) {
    if (isCanvas(n)) return canvasCardSize(n).w / 2;
    return getNodeRadius(n);
  }

  function nodeHalfH(n) {
    if (isCanvas(n)) return canvasCardSize(n).h / 2;
    return getNodeRadius(n);
  }

  function groupDragBehavior() {
    return d3.drag()
      .filter(function() { return !spacePressed; })
      .on('start', function(event, gd) {
        if (!event.active) simulation.alphaTarget(0.15).restart();
        groupMove = { startX: event.x, startY: event.y, members: [] };
        (gd.members || []).forEach(function(id) {
          var n = nodeMap[id];
          if (!n) return;
          n._sx = n.x; n._sy = n.y;
          n.fx = n.x; n.fy = n.y;
          groupMove.members.push(n);
        });
      })
      .on('drag', function(event) {
        if (!groupMove) return;
        var dx = event.x - groupMove.startX;
        var dy = event.y - groupMove.startY;
        groupMove.members.forEach(function(n) {
          n.fx = snapVal(n._sx + dx);
          n.fy = snapVal(n._sy + dy);
        });
      })
      .on('end', function(event) {
        if (!event.active) simulation.alphaTarget(0);
        if (groupMove && groupMove.members.length) persistPositionsDebounced();
        groupMove = null;
      });
  }

  function getGroupOfNode(nodeId) {
    for (var i = 0; i < allGroups.length; i++) {
      if (allGroups[i].members && allGroups[i].members.indexOf(nodeId) !== -1) return allGroups[i];
    }
    return null;
  }

  // ---- 分组创建 / 命名弹窗 ----

  async function createGroupNamed(name) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createGroup !== 'function') return;
    try {
      await bridge.createGroup({ name: name, memberIds: Array.from(selectedNodeIds) });
    } catch (e) {}
    await loadGroups();
  }

  async function renameGroupId(id, name) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.renameGroup !== 'function') return;
    try { await bridge.renameGroup({ id: id, name: name }); } catch (e) {}
    await loadGroups();
  }

  async function dissolveGroupId(id) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.dissolveGroup !== 'function') return;
    try { await bridge.dissolveGroup({ id: id }); } catch (e) {}
    await loadGroups();
  }

  function openGroupNameModal(context) {
    closeMenus();
    pendingGroup = context; // { mode:'create' } 或 { mode:'rename', id, current }
    canvasModalCtx = null;
    canvasModalTitle.textContent = context.mode === 'rename' ? '重命名分组' : '创建分组';
    var val = context.mode === 'rename' ? (context.current || '') : '';
    canvasModalBody.innerHTML = '<input id="groupNameField" placeholder="分组名称（回车确认）" value="' + escapeHtml(val) + '">';
    canvasModalMask.style.display = 'flex';
    var el = canvasModalBody.querySelector('#groupNameField');
    if (el) { el.focus(); el.select(); }
  }

  // ---- 网格吸附开关 ----

  function toggleGridSnap() {
    gridSnap = !gridSnap;
    if (snapBtn) snapBtn.classList.toggle('active', gridSnap);
    try { localStorage.setItem('kg_grid_snap', gridSnap ? '1' : '0'); } catch (e) {}
  }

  function initGridSnap() {
    var saved = '0';
    try { saved = localStorage.getItem('kg_grid_snap') || '0'; } catch (e) {}
    gridSnap = saved === '1';
    if (snapBtn) snapBtn.classList.toggle('active', gridSnap);
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
    panelLinkNodeUrl = null;
    panelDetailLink.style.display = 'block';
    panelDetailLink.target = '';
    panelDetailLink.removeAttribute('rel');
    if (isCanvas(d)) { showCanvasPanel(d); return; }

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

  function showCanvasPanel(d) {
    var names = { note: '便签', link: '链接', image: '图片', ref: '引用节点' };
    panelTitle.textContent = names[d.type] || '画布节点';
    if (d.type === 'link') {
      panelMeta.textContent = '链接';
      panelSummary.textContent = d.text || '（无链接地址，双击编辑）';
      panelTags.innerHTML = '';
      panelDetailLink.style.display = 'block';
      panelDetailLink.textContent = '打开链接';
      panelDetailLink.href = d.text || '#';
      panelDetailLink.target = '_blank';
      panelDetailLink.rel = 'noopener';
      panelLinkNodeUrl = d.text || null;
    } else if (d.type === 'image') {
      panelMeta.textContent = '图片';
      panelSummary.textContent = d.text ? '双击可更换图源' : '（无图源，双击可设置）';
      panelTags.innerHTML = '';
      panelDetailLink.style.display = 'none';
    } else if (d.type === 'note') {
      panelMeta.textContent = '便签';
      panelSummary.textContent = d.text || '（空白便签，双击编辑）';
      panelTags.innerHTML = '';
      panelDetailLink.style.display = 'none';
    } else {
      panelMeta.textContent = '引用节点';
      panelSummary.textContent = '引用于：' + (d.title || d.text || '未知节点');
      panelTags.innerHTML = '';
      panelDetailLink.style.display = 'none';
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

    svg.selectAll('.node text:not(.canvas-card-text)')
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

  // ---- Canvas Context Menu & Modal ----

  function closeMenus() {
    canvasMenu.style.display = 'none';
    nodeMenu.style.display = 'none';
    edgeMenu.style.display = 'none';
    groupMenu.style.display = 'none';
  }

  function positionMenu(menu, x, y) {
    menu.style.display = 'flex';
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  }

  function openCanvasMenu(x, y, pt) {
    closeMenus();
    positionMenu(canvasMenu, x, y);
    canvasMenu._pt = pt || { x: 100, y: 100 };
  }

  function openNodeMenu(x, y, d) {
    closeMenus();
    if (groupAction) {
      groupAction.style.display = (selectedNodeIds.size > 1) ? 'flex' : 'none';
    }
    positionMenu(nodeMenu, x, y);
    nodeMenu._d = d;
  }

  function openEdgeMenu(x, y, d) {
    closeMenus();
    positionMenu(edgeMenu, x, y);
    edgeMenu._d = d;
  }

  function openGroupMenu(x, y, gd) {
    closeMenus();
    positionMenu(groupMenu, x, y);
    groupMenu._g = gd;
  }

  function closeModal() {
    canvasModalMask.style.display = 'none';
    canvasModalBody.innerHTML = '';
    canvasModalCtx = null;
    pendingRefNodeId = null;
    pendingGroup = null;
  }

  function openCreateModal(kind, pt) {
    closeMenus();
    canvasModalCtx = { mode: 'create', kind: kind, x: pt.x, y: pt.y };
    pendingRefNodeId = null;
    var titles = { note: '新建便签', link: '新建链接', image: '新建图片', ref: '引用已有节点' };
    canvasModalTitle.textContent = titles[kind] || '新建节点';

    if (kind === 'ref') {
      canvasModalBody.innerHTML =
        '<div class="field-label">选择一个已有内容节点</div>' +
        '<input id="refPickerSearch" placeholder="搜索标题 / 分类 / 标签..." style="margin-bottom:8px;">' +
        '<div class="ref-picker-list" id="refPickerList"></div>';
      renderRefPicker('');
      var input = canvasModalBody.querySelector('#refPickerSearch');
      input.addEventListener('input', function() { renderRefPicker(input.value); });
      var list = canvasModalBody.querySelector('#refPickerList');
      list.addEventListener('click', function(event) {
        var item = event.target.closest('.ref-picker-item');
        if (!item || !item.dataset.id) return;
        pendingRefNodeId = item.dataset.id;
        list.querySelectorAll('.ref-picker-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
      });
      input.focus();
    } else {
      var field = (kind === 'note')
        ? '<textarea id="canvasFieldValue" placeholder="写点什么..."></textarea>'
        : '<input id="canvasFieldValue" type="text" placeholder="' + (kind === 'link' ? 'https://example.com' : '图片 URL') + '">';
      canvasModalBody.innerHTML = field;
      var el = canvasModalBody.querySelector('#canvasFieldValue');
      if (el) el.focus();
    }
    canvasModalMask.style.display = 'flex';
  }

  function openEditModal(d) {
    closeMenus();
    canvasModalCtx = { mode: 'edit', kind: d.type, nodeId: d.id };
    pendingRefNodeId = null;
    var titles = { note: '编辑便签', link: '编辑链接', image: '编辑图片' };
    canvasModalTitle.textContent = titles[d.type] || '编辑节点';
    var field = (d.type === 'note')
      ? '<textarea id="canvasFieldValue"></textarea>'
      : '<input id="canvasFieldValue" type="text">';
    canvasModalBody.innerHTML = field;
    var el = canvasModalBody.querySelector('#canvasFieldValue');
    if (el) { el.value = d.text || ''; el.focus(); }
    canvasModalMask.style.display = 'flex';
  }

  function renderRefPicker(query) {
    var list = canvasModalBody.querySelector('#refPickerList');
    if (!list) return;
    query = (query || '').toLowerCase();
    var typeName = { clip: '剪藏', knowledge: '知识', 'learning-plan': '计划' };
    var html = '';
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (isCanvas(n)) continue;
      var hay = ((n.title || '') + ' ' + (n.category || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
      if (query && hay.indexOf(query) === -1) continue;
      html += '<div class="ref-picker-item" data-id="' + n.id + '">' +
        '<span class="rtitle">' + escapeHtml(n.title || n.id) + '</span>' +
        '<span class="rtype">' + (typeName[n.type] || n.type) + '</span></div>';
    }
    list.innerHTML = html || '<div class="ref-picker-item"><span class="rtitle">无匹配节点</span></div>';
  }

  async function createCanvasNode(kind, text, title, x, y) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createCanvasNode !== 'function') return false;
    try { await bridge.createCanvasNode({ kind: kind, text: text, title: title, x: x, y: y }); return true; }
    catch (e) { return false; }
  }

  async function updateCanvasNode(id, text) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.updateCanvasNode !== 'function') return;
    try { await bridge.updateCanvasNode({ id: id, text: text }); } catch (e) {}
  }

  async function deleteCanvasNode(id) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.deleteCanvasNode !== 'function') return;
    try { await bridge.deleteCanvasNode({ id: id }); } catch (e) {}
    await fetchData(currentView);
  }

  async function deleteCanvasEdge(id) {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.deleteCanvasEdge !== 'function') return;
    try { await bridge.deleteCanvasEdge({ id: id }); } catch (e) {}
    await fetchData(currentView);
  }

  async function commitModal() {
    // 分组创建 / 重命名
    if (pendingGroup) {
      var gnameField = canvasModalBody.querySelector('#groupNameField');
      var gname = gnameField ? gnameField.value.trim() : '';
      if (pendingGroup.mode === 'rename') {
        await renameGroupId(pendingGroup.id, gname || '分组');
      } else {
        if (selectedNodeIds.size < 1) { closeModal(); return; }
        await createGroupNamed(gname || '分组');
      }
      closeModal();
      return;
    }

    var ctx = canvasModalCtx;
    if (!ctx) return;
    if (ctx.mode === 'create') {
      if (ctx.kind === 'ref') {
        if (!pendingRefNodeId) { closeModal(); return; }
        var target = nodeMap[pendingRefNodeId];
        var refTitle = target ? (target.title || '') : '';
        await createCanvasNode('ref', pendingRefNodeId, refTitle, ctx.x, ctx.y);
      } else {
        var field = canvasModalBody.querySelector('#canvasFieldValue');
        var val = field ? field.value.trim() : '';
        if ((ctx.kind === 'link' || ctx.kind === 'image') && !val) { closeModal(); return; }
        await createCanvasNode(ctx.kind, val, '', ctx.x, ctx.y);
      }
    } else if (ctx.mode === 'edit') {
      var editField = canvasModalBody.querySelector('#canvasFieldValue');
      var editVal = editField ? editField.value : '';
      await updateCanvasNode(ctx.nodeId, editVal);
    }
    closeModal();
    await fetchData(currentView);
  }

  function startLink(sourceId) {
    linkSourceId = sourceId;
    nodeElements.classed('linking', function(n) { return String(n.id) === sourceId; });
  }

  function cancelLink() {
    linkSourceId = null;
    nodeElements.classed('linking', false);
    if (tempLink) tempLink.attr('display', 'none');
  }

  async function completeLink(targetId) {
    var fromId = linkSourceId;
    cancelLink();
    if (!fromId || fromId === targetId) return;
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createCanvasEdge !== 'function') return;
    try { await bridge.createCanvasEdge({ fromId: fromId, toId: targetId }); } catch (e) {}
    await fetchData(currentView);
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
      if (panelLinkNodeUrl) {
        e.preventDefault();
        var url = panelLinkNodeUrl;
        panelLinkNodeUrl = null;
        if (url && url.indexOf('http') === 0) window.open(url, '_blank');
        return;
      }
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

  // ---- Canvas menu / modal bindings ----

  canvasMenu.querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      event.stopPropagation();
      var action = btn.dataset.action;
      var pt = canvasMenu._pt || { x: 100, y: 100 };
      closeMenus();
      if (action === 'add-note') openCreateModal('note', pt);
      if (action === 'add-link') openCreateModal('link', pt);
      if (action === 'add-image') openCreateModal('image', pt);
      if (action === 'add-ref') openCreateModal('ref', pt);
    });
  });

  nodeMenu.querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      event.stopPropagation();
      var action = btn.dataset.action;
      var d = nodeMenu._d;
      closeMenus();
      if (action === 'group') {
        if (selectedNodeIds.size > 1) openGroupNameModal({ mode: 'create' });
        return;
      }
      if (!d) return;
      if (action === 'link-from') startLink(String(d.id));
      else if (action === 'edit-node') openEditModal(d);
      else if (action === 'delete-node') deleteCanvasNode(String(d.id));
    });
  });

  edgeMenu.querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      event.stopPropagation();
      var d = edgeMenu._d;
      closeMenus();
      if (d && d.manualId) deleteCanvasEdge(d.manualId);
    });
  });

  groupMenu.querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      event.stopPropagation();
      var action = btn.dataset.action;
      var gd = groupMenu._g;
      closeMenus();
      if (!gd) return;
      if (action === 'rename-group') openGroupNameModal({ mode: 'rename', id: gd.id, current: gd.name || '' });
      else if (action === 'dissolve-group') dissolveGroupId(gd.id);
    });
  });

  canvasModalOk.addEventListener('click', commitModal);
  canvasModalCancel.addEventListener('click', closeModal);
  canvasModalMask.addEventListener('click', function(event) {
    if (event.target === canvasModalMask) closeModal();
  });

  if (snapBtn) snapBtn.addEventListener('click', toggleGridSnap);
  initGridSnap();

  // 弹窗单行输入框回车 = 确认（textarea 保留换行）
  canvasModalBody.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    commitModal();
  });

  // 点击空白处关闭右键菜单；Esc 关闭弹窗/取消连线/关闭菜单/取消空格平移标记
  document.addEventListener('click', function() { closeMenus(); });
  document.addEventListener('keyup', function(e) {
    if (e.key === ' ' || e.code === 'Space') spacePressed = false;
  });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (canvasModalMask.style.display === 'flex') { closeModal(); return; }
    if (linkSourceId) { cancelLink(); return; }
    closeMenus();
  });

  // ---- Init ----

  document.addEventListener('DOMContentLoaded', function() {
    initGridSnap();
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