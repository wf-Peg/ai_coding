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
  const layoutBtn = document.getElementById('layoutBtn');
  const aiModalMask = document.getElementById('aiModalMask');
  const aiModalTitle = document.getElementById('aiModalTitle');
  const aiModalBody = document.getElementById('aiModalBody');
  const aiModalClose = document.getElementById('aiModalClose');
  const aiModalApply = document.getElementById('aiModalApply');
  const minimapEl = document.getElementById('minimap');
  const minimapSvg = document.getElementById('minimapSvg');

  const API_AI_COMPLETE = 'http://127.0.0.1:8081/api/ai/complete';

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
  let zoomBehavior = null;   // d3.zoom 实例（模块级保存，供小地图跳转）
  let tempLink = null;
  let linkSourceId = null;
  let canvasModalCtx = null;
  let pendingRefNodeId = null;
  let panelLinkNodeUrl = null;
  let panelDetailClipId = null;      // 剪藏节点详情「前往剪藏模块」→ 用编辑器打开原文时携带的 clipId

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
        clearGraphCanvas();
        showEmpty('加载失败', '请检查后端服务或本地索引是否正常');
        return;
      }
    }

    if (!nodes || nodes.length === 0) {
      clearGraphCanvas();
      showEmpty('暂无图谱数据', '请先创建剪藏或知识条目并建立关联');
      return;
    }
    buildGraph(nodes, links);
    loadGroups();
  }

  // 清空主画布（切换视图图层时先移除旧 SVG/布局，避免与空态或新图层重叠）
  function clearGraphCanvas() {
    if (simulation) { simulation.stop(); simulation = null; }
    try { if (svg && svg.node) svg.selectAll('*').remove(); } catch (e) {}
    if (container) {
      var existing = container.querySelector('svg:not(#minimapSvg)');
      if (existing) existing.remove();
    }
    allNodes = [];
    allLinks = [];
    frameLayer = null;
    selectionLayer = null;
    tempLink = null;
    linkSourceId = null;
    if (typeof renderGroupFrames === 'function') { try { renderGroupFrames(); } catch (e) {} }
    if (typeof renderMinimap === 'function') { try { renderMinimap(); } catch (e) {} }
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
    // 只移除主画布 SVG，保留小地图 SVG（minimap 也在 graphContainer 内，不可误删）
    var existing = container.querySelector('svg:not(#minimapSvg)');
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
        updateMinimapViewport();
      });

    svg.call(zoom);
    zoomBehavior = zoom;

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

    // 空白画布右键：新建节点菜单（松判定：点中空白即弹，节点/连线等交互元素不受影响）
    svg.on('contextmenu', function(event) {
      if (!isCanvasBackground(event)) return;
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
      updateMinimapViewport();
    });

    simulation.on('end', function() {
      // 自动布局稳定后写回位置，让首次布局也「记住」
      persistPositionsDebounced();
      renderMinimap();
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
    renderMinimap();
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

  // 判断右键/左键点击是否落在“画布空白”（非节点/连线/便签等交互元素）
  function isCanvasBackground(event) {
    var t = event ? event.target : null;
    if (!t) return false;
    if (t === svg.node()) return true;
    // 允许 SVG 内不承载交互的壳元素（zoom g、各类 layer、defs 等）
    if (t instanceof SVGElement) {
      if (!t.closest('.node, .temp-link, line.link, .frame-title, .frame-handle')) return true;
    }
    return false;
  }

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
    // 即时反馈：说明生效语义（吸附发生在拖动节点时）
    showMiniToast(gridSnap ? '已开启格子吸附：拖动节点将对齐 20px 网格' : '已关闭格子吸附');
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
    panelDetailClipId = null;
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
      // 剪藏节点：源头数字 id 优先（本地索引 sourceId），否则从节点 id 中解析
      var clipNumId = d.sourceId != null ? d.sourceId : (function() { var m = String(d.id).match(/\d+$/); return m ? parseInt(m[1]) : null; })();
      panelDetailClipId = clipNumId != null ? clipNumId : null;
      panelDetailLink.textContent = panelDetailClipId != null ? '在编辑器中打开原文' : '前往剪藏模块';
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

  // ---- 小地图（Minimap）----

  let minimapMeta = null;        // {scale, srcW, srcH, ...} 世界→小地图映射
  let minimapViewportDrag = null;

  // 显示/隐藏小地图：有多个节点时才展示
  function updateMinimapVisibility() {
    if (!minimapEl) return;
    var show = allNodes && allNodes.length >= 2;
    minimapEl.style.display = show ? 'flex' : 'none';
  }

  // 世界坐标边界（含画布节点卡片尺寸），供小地图缩放
  function minimapBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(function(n) {
      if (!isFinite(n.x) || !isFinite(n.y)) return;
      var hw = nodeHalfW(n), hh = nodeHalfH(n);
      minX = Math.min(minX, n.x - hw); maxX = Math.max(maxX, n.x + hw);
      minY = Math.min(minY, n.y - hh); maxY = Math.max(maxY, n.y + hh);
    });
    if (minX === Infinity) return null;
    var pad = 30;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  function minimapSize() {
    var rect = minimapSvg ? minimapSvg.getBoundingClientRect() : null;
    var w = rect ? Math.max(rect.width, 40) : 180;
    var h = rect ? Math.max(rect.height, 40) : 110;
    return { w: w, h: h };
  }

  // 渲染小地图节点/连线 + 视口框
  function renderMinimap() {
    if (!minimapSvg || !minimapEl) return;
    updateMinimapVisibility();
    if (!minimapEl || minimapEl.style.display === 'none') return;
    var b = minimapBounds();
    if (!b) return;
    var m = minimapSize();
    var scale = Math.min(m.w / b.w, m.h / b.h);
    var ox = (m.w - b.w * scale) / 2;
    var oy = (m.h - b.h * scale) / 2;
    minimapMeta = { scale: scale, bx: b.x, by: b.y, ox: ox, oy: oy, mw: m.w, mh: m.h };

    var mmX = function(x) { return (x - minimapMeta.bx) * minimapMeta.scale + minimapMeta.ox; };
    var mmY = function(y) { return (y - minimapMeta.by) * minimapMeta.scale + minimapMeta.oy; };

    var svgSel = d3.select(minimapSvg);
    svgSel.selectAll('*').remove();

    // 连线
    svgSel.append('g').selectAll('line').data(allLinks).join('line')
      .attr('class', 'minimap-link')
      .attr('x1', function(d) { return mmX(d.source.x); })
      .attr('y1', function(d) { return mmY(d.source.y); })
      .attr('x2', function(d) { return mmX(d.target.x); })
      .attr('y2', function(d) { return mmY(d.target.y); });

    // 节点（等比例小圆点）
    svgSel.append('g').selectAll('circle').data(allNodes).join('circle')
      .attr('class', function(n) {
        var c = 'minimap-node';
        if (n.type === 'clip') c += ' clip-node';
        else if (n.type === 'note') c += ' note-node';
        else if (n.type === 'link') c += ' link-node';
        else if (n.type === 'image') c += ' image-node';
        else if (n.type === 'learning-plan') c += ' plan-node';
        return c;
      })
      .attr('cx', function(d) { return mmX(d.x); })
      .attr('cy', function(d) { return mmY(d.y); })
      .attr('r', function(d) { return Math.max(2, Math.min(nodeHalfW(d), nodeHalfH(d)) * minimapMeta.scale); });

    // 视口框
    svgSel.append('rect')
      .attr('class', 'minimap-viewport')
      .call(d3.drag()
        .on('start', function() { minimapViewportDrag = true; d3.select(this).classed('dragging', true); })
        .on('drag', function(event) { minimapJumpBy(event.x, event.y); })
        .on('end', function() { minimapViewportDrag = false; d3.select(this).classed('dragging', false); })
      );

    // 点击小地图空白 = 直接跳转
    svgSel.on('click', function(event) {
      if (event.target !== this) return;
      var pt = d3.pointer(event, minimapSvg);
      minimapJumpTo(pt[0], pt[1]);
    });

    updateMinimapViewport();
  }

  // 根据当前 viewport 计算屏幕上可见的世界范围，更新小地图视口框
  function updateMinimapViewport() {
    if (!minimapMeta || !minimapSvg || !minimapEl) return;
    if (minimapEl.style.display === 'none') return;
    var svgW = container.clientWidth, svgH = container.clientHeight;
    var c = currentTransform;
    // 屏幕四角 → 世界坐标
    var wTL = c.invert([0, 0]);
    var wBR = c.invert([svgW, svgH]);
    var mm = minimapMeta;
    var mmX = function(x) { return (x - mm.bx) * mm.scale + mm.ox; };
    var mmY = function(y) { return (y - mm.by) * mm.scale + mm.oy; };
    var rect = d3.select(minimapSvg).select('rect.minimap-viewport');
    if (rect.empty()) return;
    rect
      .attr('x', mmX(wTL[0]))
      .attr('y', mmY(wTL[1]))
      .attr('width', Math.max(10, (wBR[0] - wTL[0]) * mm.scale))
      .attr('height', Math.max(10, (wBR[1] - wTL[1]) * mm.scale));
  }

  // 点击小地图某点 → 让该处居中并保持缩放
  function minimapJumpTo(px, py) {
    if (!minimapMeta || !zoomBehavior || !svg) return;
    var mm = minimapMeta;
    var wx = (px - mm.ox) / mm.scale + mm.bx;
    var wy = (py - mm.oy) / mm.scale + mm.by;
    centerWorldOn(wx, wy);
  }

  // 拖拽视口框（deltaX/deltaY 相对小地图）→ 平移
  function minimapJumpBy(dx, dy) {
    if (!minimapMeta || !zoomBehavior || !svg) return;
    var mm = minimapMeta;
    var dWorldX = dx / mm.scale;
    var dWorldY = dy / mm.scale;
    var c = currentTransform;
    var cx = c.invertX(0) + dWorldX;
    var cy = c.invertY(0) + dWorldY;
    var k = c.k;
    var tx = -cx * k;
    var ty = -cy * k;
    try {
      svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      currentTransform = d3.zoomIdentity.translate(tx, ty).scale(k);
      g.attr('transform', currentTransform);
      updateMinimapViewport();
    } catch (e) {}
  }

  // 让世界坐标 (wx,wy) 居中到视口
  function centerWorldOn(wx, wy) {
    var w = container.clientWidth, h = container.clientHeight;
    var k = currentTransform.k;
    var tx = -wx * k + w / 2;
    var ty = -wy * k + h / 2;
    currentTransform = d3.zoomIdentity.translate(tx, ty).scale(k);
    preservedTransform = currentTransform;
    try {
      svg.call(zoomBehavior.transform, currentTransform);
      g.attr('transform', currentTransform);
      updateMinimapViewport();
    } catch (e) {}
  }

  // 自动布局元数据缓存（避免重复计算）
  let autoLayoutMeta = null;

  // 解析 Mermaid 流程图（仅解析 flowchart：节点 + 边；不支持子图/形状高级语法）
  function parseMermaidFlow(code) {
    var text = String(code || '').replace(/```/g, '');
    var lines = text.split('\n').map(function(l) { return l.trim(); });
    var nodes = {};   // id -> {id, label}
    var edges = [];   // {from, to}
    var order = [];
    var startIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^flowchart\s+((TB|TD|BT|LR|RL))$/i.test(lines[i])) { startIdx = i + 1; break; }
      if (/^graph\s+((TB|TD|BT|LR|RL))$/i.test(lines[i])) { startIdx = i + 1; break; }
    }
    if (startIdx < 0) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i] && !lines[i].startsWith('%%')) { startIdx = i; break; }
      }
    }
    for (var k = startIdx; k < lines.length; k++) {
      var line = lines[k];
      if (!line || line.startsWith('%%') || line.indexOf('-->') === -1) continue;
      line = line.replace(/;$/, '');
      // 按箭头切分，得到有序节点 token 序列（忽略边上的文字/子图声明）
      var arrowParts = line.split(/--[^>\-]*(?:>|--)/);
      var tokens = [];
      arrowParts.forEach(function(seg) {
        var t = extractNodeToken(seg);
        if (t) tokens.push(t);
      });
      for (var m = 0; m < tokens.length; m++) {
        var nid = tokens[m];
        var label = (nodes[nid] && nodes[nid].label) || nid;
        if (!nodes[nid]) { nodes[nid] = { id: nid, label: label }; order.push(nid); }
      }
      for (var e = 0; e < tokens.length - 1; e++) {
        edges.push({ from: label2(nodes, tokens[e]), to: label2(nodes, tokens[e + 1]) });
      }
    }
    if (order.length === 0) return { nodes: [], edges: [] };
    return {
      nodes: order.map(function(id) { return nodes[id]; }),
      edges: edges
    };
  }

  function extractNodeToken(seg) {
    seg = String(seg || '').trim();
    if (!seg) return null;
    // 去掉形状包裹：A["理解"]、A["理解", fn()]、A((提示)) → A
    var m = seg.match(/^\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)(?:\s*[\[({]|$)/);
    return m ? m[1] : null;
  }

  function label2(nodes, token) {
    return (nodes[token] && nodes[token].label) || token;
  }

  // 收集 Graph 图层布局中心点（供导入节点定位）
  function layoutOrigin() {
    var w = container.clientWidth, h = container.clientHeight;
    var c = currentTransform;
    var cx = c.invertX(w / 2), cy = c.invertY(h / 2);
    return { x: cx, y: cy };
  }

  async function callAiComplete(systemPrompt, userMessage) {
    if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 120000);
    try {
      var resp = await fetch(API_AI_COMPLETE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: systemPrompt, userMessage: userMessage, tier: 'strong' }),
        signal: ctrl.signal
      });
      var data = await resp.json();
      return data || null;
    } catch (e) {
      return { success: false, code: 'NETWORK', message: '无法连接后端 AI 服务' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- 自动布局（确定性 D3 算法）----

  function runAutoLayout() {
    if (!allNodes || !allNodes.length) return;
    closeMenus();
    layoutBtn.classList.add('loading');
    setTimeout(function() {
      doAutoLayout();
      layoutBtn.classList.remove('loading');
    }, 30);
  }

  function doAutoLayout() {
    if (!autoLayoutMeta || autoLayoutMeta.nodeIds !== etcIds(allNodes)) {
      autoLayoutMeta = { nodeIds: etcIds(allNodes), svc: computeLayout(allNodes, allLinks) };
    }
    var svc = autoLayoutMeta.svc;
    var w = container.clientWidth, h = container.clientHeight;
    var c = currentTransform;
    var cx = c.invertX(w / 2), cy = c.invertY(h / 2);
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (!svc.pos || !svc.pos[n.id]) continue;
      n.x = svc.pos[n.id][0] + cx - svc.cx;
      n.y = svc.pos[n.id][1] + cy - svc.cy;
      n.fx = n.x;
      n.fy = n.y;
    }
    simulation.alpha(0.05).restart();
    persistPositionsDebounced();
  }

  function etcIds(nodes) {
    return nodes.map(function(n) { return n.id; }).sort().join(',');
  }

  // 计算确定性布局：优先分层（基于链接层级），孤立点/无明显层级退化为环形
  function computeLayout(nodes, links) {
    var byId = {};
    nodes.forEach(function(n) { byId[n.id] = n; });
    var adj = {};
    nodes.forEach(function(n) { adj[n.id] = { in: 0, out: [], to: [] }; });
    links.forEach(function(l) {
      var s = typeof l.source === 'object' ? l.source.id : l.source;
      var t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!adj[s] || !adj[t]) return;
      adj[s].out.push(t);
      adj[s].to.push(t);
      adj[t].in++;
    });

    // Kahn 拓扑分层
    var depth = {};
    var queue = nodes.filter(function(n) { return adj[n.id].in === 0; }).map(function(n) { return n.id; });
    var visited = {};
    var layerOrder = [];
    queue.forEach(function(id) { depth[id] = 0; visited[id] = 1; });
    while (queue.length) {
      var id = queue.shift();
      layerOrder.push(id);
      adj[id].to.forEach(function(nid) {
        if (visited[nid]) return;
        visited[nid] = 1;
        depth[nid] = depth[id] + 1;
        queue.push(nid);
      });
    }
    // 循环残留（孤立 / 成环）放入 0 层
    nodes.forEach(function(n) {
      if (depth[n.id] === undefined) { depth[n.id] = 0; visited[n.id] = 1; layerOrder.push(n.id); }
    });

    var cols = {}, colArr = [];
    layerOrder.forEach(function(id) {
      var d = depth[id];
      if (!cols[d]) { cols[d] = []; colArr.push(d); }
      cols[d].push(id);
    });
    colArr.sort(function(a, b) { return a - b; });

    var H = 120, V = 110;
    var pos = {};
    var maxW = colArr.length;
    var maxH = 1;
    colArr.forEach(function(d) {
      maxH = Math.max(maxH, cols[d].length);
      cols[d].forEach(function(id, idx) {
        pos[id] = [
          (d - (colArr.length - 1) / 2) * H,
          (idx - (cols[d].length - 1) / 2) * V
        ];
      });
    });

    // 若高度为 1（连环式），改用环形；若图表重环，环形更稳
    var usingRing = false;
    if (colArr.reduce(function(a, d) { return a + cols[d].length; }, 0) === nodes.length && maxH === 1) {
      usingRing = true;
      pos = ringPositions(nodes);
    } else if (hasCycle(adj, nodes)) {
      usingRing = true;
      pos = ringPositions(nodes);
    }
    // 计算质心用于居中
    var sxs = 0, sys = 0, cnt = 0;
    nodes.forEach(function(n) { if (pos[n.id]) { sxs += pos[n.id][0]; sys += pos[n.id][1]; cnt++; } });
    return { pos: pos, cx: cnt ? sxs / cnt : 0, cy: cnt ? sys / cnt : 0, ring: usingRing };
  }

  function hasCycle(adj, nodes) {
    var WHITE = 0, GRAY = 1, BLACK = 2, color = {};
    nodes.forEach(function(n) { color[n.id] = WHITE; });
    var found = false;
    var dfs = function(id) {
      color[id] = GRAY;
      (adj[id].out || []).forEach(function(n) {
        if (color[n] === GRAY) { found = true; return; }
        if (color[n] === WHITE) dfs(n);
      });
      color[id] = BLACK;
    };
    nodes.forEach(function(n) { if (color[n.id] === WHITE) dfs(n.id); });
    return found;
  }

  function ringPositions(nodes) {
    var r = Math.max(100, 70 + nodes.length * 6);
    var pos = {};
    nodes.forEach(function(n, i) {
      var a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      pos[n.id] = [Math.cos(a) * r, Math.sin(a) * r];
    });
    return pos;
  }

  // ---- AI 流程：选节点 → 生成 Mermaid → 预览 → 导入 ----

  function selectionContent(ids) {
    var parts = [];
    (ids || []).forEach(function(id) {
      var n = nodeMap[id];
      if (!n) return;
      var label = n.title || (n.text || n.id);
      var ext = n.summary ? (' —— ' + n.summary) : '';
      parts.push((label || n.id) + ext);
    });
    return parts.join('\n');
  }

  function selectedIdsOr(d) {
    if (selectedNodeIds && selectedNodeIds.size > 1) return Array.from(selectedNodeIds);
    return [String((d && d.id) || selectedNodeId || '')];
  }

  async function generateFlowFromSelection() {
    var ids = selectedIdsOr(nodeMenu._d);
    if (!ids.length) return;
    closeMenus();
    var content = selectionContent(ids);
    var sys = '你是一个表达力强的知识可视化助手。根据用户给出的若干知识节点（编号行），' +
      '生成一个简洁的 Mermaid flowchart 流程图，把这些节点如何关联表达清楚。' +
      '要求：仅输出 Mermaid 代码本身，不要任何解释或代码围栏标记；' +
      '节点标签用中文且尽量简短；用 TD 方向；用 --> 表示关联。';
    showAiBusy('正在生成流程图...');
    var res = await callAiComplete(sys, content);
    if (!res || !res.success) { showAiError(res); return; }
    var flow = parseMermaidFlow(res.content);
    if (!flow.nodes.length) { showAiError({ message: 'AI 未能解析出流程图节点，请重试' }); return; }
    showAiFlowResult(res.content, flow);
  }

  async function expandNodesFromSelection() {
    var ids = selectedIdsOr(nodeMenu._d);
    if (!ids.length) return;
    closeMenus();
    var content = selectionContent(ids);
    var sys = '你是知识拓展助手。根据用户给出的几个节点内容，联想「还缺什么关键节点、缺什么关键关系」。' +
      '必须输出严格的 JSON（不要 markdown 围栏、不要解释）：' +
      '{"nodes":[{"label":"补充分支A","note":"一句话说明"},...],"edges":[{"from":0,"to":1,"note":"关系说明"}]}。' +
      'from/to 为节点数组下标，可用 0 表示待增补节点，或引用现有节点编号前的「原节点」。' +
      '若 from/to 引用原节点，请用负序号-1、-2...依此类推（-1 表示第一个选中节点）。';
    showAiBusy('AI 正在联想缺失节点...');
    var res = await callAiComplete(sys, content);
    if (!res || !res.success) { showAiError(res); return; }
    var parsed = tryParseExpandJson(res.content);
    if (!parsed || !parsed.nodes || !parsed.nodes.length) { showAiError({ message: 'AI 未能返回有效增补结果，请重试' }); return; }
    showAiExpandResult(parsed);
  }

  function tryParseExpandJson(raw) {
    var s = String(raw || '').trim();
    var m = s.match(/\{[\s\S]*\}/);
    if (m) s = m[0];
    try { var obj = JSON.parse(s); return obj; } catch (e) {
      try {
        // 容错：去掉 ```json 围栏
        s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(s);
      } catch (e2) { return null; }
    }
  }

  // ---- AI 结果弹出展示 ----

  function showAiBusy(text) {
    aiModalTitle.textContent = 'AI';
    aiModalBody.innerHTML = '<div class="ai-output-text">⏳ ' + escapeHtml(text) + '</div>';
    aiModalApply.style.display = 'none';
    aiModalApply._payload = null;
    aiModalApply._mode = 'busy';
    aiModalMask.style.display = 'flex';
  }

  function showAiError(res) {
    var msg = (res && res.message) ? res.message : 'AI 调用失败';
    aiModalTitle.textContent = 'AI';
    aiModalBody.innerHTML = '<div class="ai-output-text" style="color:#ef4444;">⚠️ ' + escapeHtml(msg) + '</div>';
    aiModalApply.style.display = 'none';
    aiModalApply._payload = null;
    aiModalApply._mode = null;
    aiModalMask.style.display = 'flex';
  }

  function showAiFlowResult(code, flow) {
    aiModalTitle.textContent = 'AI 生成的流程图';
    aiModalBody.innerHTML =
      '<div class="ai-result-box"><strong>概览：</strong>' + escapeHtml(flow.nodes.length + ' 个节点 · ' + flow.edges.length + ' 条连线') + '</div>' +
      '<div class="mermaid-preview" id="aiMermaidPreview" style="display:none;"></div>' +
      '<div class="ai-output-text ai-modal-code" id="aiMermaidCode">' + escapeHtml(code) + '</div>' +
      '<div class="field-label" style="margin-top:6px;">提示：可「导入画布」，将流程图转为画布节点。</div>';
    aiModalApply.style.display = 'inline-block';
    aiModalApply._mode = 'flow';
    aiModalApply._payload = flow;
    aiModalMask.style.display = 'flex';
    renderMermaidPreview(code);
  }

  function renderMermaidPreview(code) {
    if (!window.mermaid) return;
    try {
      window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      var codeClean = String(code).replace(/```mermaid/gi, '').replace(/```/g, '').trim();
      var target = document.getElementById('aiMermaidPreview');
      window.mermaid.render('graph-ai-mmd', codeClean).then(function(res) {
        if (!target) return;
        target.innerHTML = res.svg;
        target.style.display = 'block';
        var codeEl = document.getElementById('aiMermaidCode');
        if (codeEl) codeEl.style.display = 'none';
      }).catch(function(e) {
        // 渲染失败时保留源码展示
        var codeEl = document.getElementById('aiMermaidCode');
        if (codeEl) codeEl.style.display = '';
      });
    } catch (e) {}
  }

  function showAiExpandResult(parsed) {
    var nodes = parsed.nodes || [], edges = parsed.edges || [];
    aiModalTitle.textContent = 'AI 增补建议';
    var li = nodes.map(function(nd, idx) {
      return '<div class="ref-picker-item"><span class="rtitle">' + escapeHtml(nd.label || ('节点' + (idx + 1))) + '</span>' +
        '<span class="rtype">' + escapeHtml(nd.note || '新增节点') + '</span></div>';
    }).join('');
    aiModalBody.innerHTML =
      '<div class="ai-result-box"><strong>建议新增 ' + escapeHtml(String(nodes.length)) + ' 个节点、' + escapeHtml(String(edges.length)) + ' 条关联：</strong></div>' +
      '<div class="ref-picker-list" style="max-height:280px;">' + (li || '<div class="ref-picker-item"><span class="rtitle">无建议</span></div>') + '</div>' +
      '<div class="field-label" style="margin-top:8px;">确认后将以便签节点+手动连线形式加入画布。</div>';
    aiModalApply.style.display = 'inline-block';
    aiModalApply._mode = 'expand';
    aiModalApply._payload = parsed;
    aiModalMask.style.display = 'flex';
  }

  async function applyAiModalImport() {
    var payload = aiModalApply._payload;
    var mode = aiModalApply._mode;
    if (!payload) return;
    if (mode === 'flow') {
      await importFlowToCanvas(payload);
    } else if (mode === 'expand') {
      await importExpandToCanvas(payload);
    }
    aiModalClose.click();
    await fetchData(currentView);
  }

  // 把 Mermaid 流程节点作为画布便签节点 + 手动连线导入
  async function importFlowToCanvas(flow) {
    var origin = layoutOrigin();
    var created = {};
    for (var i = 0; i < flow.nodes.length; i++) {
      var nd = flow.nodes[i];
      var x = origin.x + (i - (flow.nodes.length - 1) / 2) * 130;
      var y = origin.y - 100 + Math.floor(i / 5) * 110;
      var ok = await createCanvasNode('note', nd.label || nd.id, '', x, y);
      created[nd.id] = { ok: ok, label: nd.label || nd.id };
      await sleepMs(40);
    }
    // 节点 id 由后端生成，需先刷新 nodeMap 再按标签匹配连线
    await sleepMs(150);
    await fetchData(currentView);
    await connectFlowEdgesByLabel(created, flow.edges);
  }

  async function connectFlowEdgesByLabel(created, edges) {
    // 等待 fetchData 后按 label 在 nodeMap 中匹配
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var from = findNodeByLabel(e.from);
      var to = findNodeByLabel(e.to);
      if (from && to && from.id !== to.id) {
        var bridge = window.electronAPI && window.electronAPI.localIndex;
        if (bridge && typeof bridge.createCanvasEdge === 'function') {
          try { await bridge.createCanvasEdge({ fromId: String(from.id), toId: String(to.id) }); } catch (err) {}
        }
        await sleepMs(30);
      }
    }
  }

  function findNodeByLabel(target) {
    var label = String(target == null ? '' : target);
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (n.type !== 'note') continue;
      if ((n.title || n.text || '') === label) return n;
    }
    return null;
  }

  async function importExpandToCanvas(parsed) {
    var origin = layoutOrigin();
    var ids = []; // 新节点所属本次增补
    var createdLocal = [];
    var nodes = parsed.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var x = origin.x + (i - (nodes.length - 1) / 2) * 130;
      var y = origin.y - 100 + Math.floor(i / 5) * 110;
      var ok = await createCanvasNode('note', nd.label || nd.note || '增补节点', '', x, y);
      createdLocal.push({ ok: ok, label: nd.label || nd.note || '增补节点', pos: i });
      ids.push(i);
      await sleepMs(40);
    }
    await sleepMs(120);
    await fetchData(currentView);
    // 等 nodeMap 刷新后建立关系
    var edges = parsed.edges || [];
    for (var j = 0; j < edges.length; j++) {
      var e = edges[j];
      var fromNode = resolveExpandEndpoint(e.from, nodes, createdLocal);
      var toNode = resolveExpandEndpoint(e.to, nodes, createdLocal);
      if (fromNode && toNode && fromNode.id !== toNode.id) {
        var bridge = window.electronAPI && window.electronAPI.localIndex;
        if (bridge && typeof bridge.createCanvasEdge === 'function') {
          try { await bridge.createCanvasEdge({ fromId: String(fromNode.id), toId: String(toNode.id) }); } catch (err) {}
        }
        await sleepMs(30);
      }
    }
  }

  function resolveExpandEndpoint(idx, nodes, createdLocal) {
    var n = parseInt(idx, 10);
    if (isFinite(n)) {
      if (n >= 0) {
        // 本次新增的第 n 个节点（需要在 nodeMap 里按 label 找）
        var target = createdLocal[n];
        if (target) return findNodeByLabel(target.label);
        return null;
      }
      // 负序号 = 选中的原始节点（-1 → 第 1 个选中）
      var sel = Array.from(selectedNodeIds);
      var oid = sel[Math.abs(n + 1)];
      if (oid) return nodeMap[oid] || null;
      return null;
    }
    return null;
  }

  // ---- 工具 ----

  function sleepMs(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // 轻量自包含 toast（不依赖 ui-common.js，用于操作即时反馈）
  function showMiniToast(message) {
    try {
      var old = document.querySelector('#kgMiniToast');
      if (old) old.remove();
      var t = document.createElement('div');
      t.id = 'kgMiniToast';
      t.textContent = message;
      t.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);' +
        'background:var(--surface);color:var(--text);border:1px solid var(--border);' +
        'padding:8px 16px;border-radius:20px;font-size:0.85rem;z-index:200;' +
        'box-shadow:0 6px 24px rgba(0,0,0,0.18);opacity:0;transition:opacity .25s;';
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.style.opacity = '1'; });
      setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2200);
    } catch (e) {}
  }

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
      // 剪藏节点：改为在编辑器打开原文（不整页跳转 clip.html，避免 iframe 污染与回退变剪藏页）
      if (href.indexOf('clip.html') === 0 && panelDetailClipId != null) {
        e.preventDefault();
        var cid = panelDetailClipId;
        panelDetailClipId = null;
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'openClipInNewTab', clipId: cid }, '*');
        }
        return;
      }
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
      else if (action === 'ai-flow') { generateFlowFromSelection(); }
      else if (action === 'ai-expand') { expandNodesFromSelection(); }
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
  if (layoutBtn) layoutBtn.addEventListener('click', runAutoLayout);
  initGridSnap();

  // AI 结果弹窗绑定
  if (aiModalClose) aiModalClose.addEventListener('click', function() {
    aiModalMask.style.display = 'none';
    aiModalApply.style.display = 'none';
    aiModalApply._payload = null;
    aiModalApply._mode = null;
  });
  if (aiModalApply) aiModalApply.addEventListener('click', applyAiModalImport);
  if (aiModalMask) aiModalMask.addEventListener('click', function(event) {
    if (event.target === aiModalMask && aiModalClose) aiModalClose.click();
  });

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