(function() {
  'use strict';

  // 自由画布（NoteGen 式）：绝对坐标自由摆放的卡片画布。
  // 不依赖 force 自动布局：节点坐标来自 canvas_layout，拖到哪就停在哪；
  // 数据/持久化复用本地索引层（canvas_node / canvas_edge / canvas_layout / canvas_group）。

  const API_GRAPH = 'http://127.0.0.1:8081/api/graph';

  const container = document.getElementById('graphContainer');
  const loadingEl = document.getElementById('loadingEl');
  const emptyEl = document.getElementById('emptyEl');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');

  const canvasMenu = document.getElementById('canvasMenu');
  const nodeMenu = document.getElementById('nodeMenu');
  const edgeMenu = document.getElementById('edgeMenu');
  const groupMenu = document.getElementById('groupMenu');
  const groupAction = document.getElementById('groupAction');
  const canvasModalMask = document.getElementById('canvasModalMask');
  const canvasModalTitle = document.getElementById('canvasModalTitle');
  const canvasModalBody = document.getElementById('canvasModalBody');
  const canvasModalOk = document.getElementById('canvasModalOk');
  const canvasModalCancel = document.getElementById('canvasModalCancel');
  const minimapEl = document.getElementById('minimap');
  const minimapSvg = document.getElementById('minimapSvg');

  let allNodes = [];          // 画布卡片节点 {id,type,title,text,x,y}
  let allEdges = [];          // 手动连线 {id,source,target,type:'manual'}
  let nodeMap = {};           // id -> node
  let refNodes = [];          // 语义内容节点（引用选择器用）
  let allGroups = [];         // {id,name,members[]}
  let selectedNodeIds = new Set();
  let selectedNodeId = null;
  let spacePressed = false;
  let boxSelect = null;
  let suppressSvgClick = false;
  let svg, g, nodeElements, linkElements, frameLayer, selectionLayer;
  let currentTransform = d3.zoomIdentity;
  let preservedTransform = d3.zoomIdentity;
  let zoomBehavior = null;
  let tempLink = null;
  let linkSourceId = null;
  let canvasModalCtx = null;
  let pendingRefNodeId = null;
  let pendingGroup = null;
  let batchMove = null;
  let groupMove = null;
  let minimapMeta = null;
  let minimapViewportDrag = null;
  let resizeBound = false;

  // ---- 数据加载 ----

  async function loadData() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    // 进图即拉后端最新画布快照（后端更新则恢复，本地更新则反向推送，失败不阻塞）
    if (bridge && typeof bridge.canvasSync === 'function') {
      try { await bridge.canvasSync(); } catch (e) {}
    }

    let nodes = null;
    let links = [];
    if (bridge && typeof bridge.graph === 'function') {
      try {
        const res = await bridge.graph({});
        if (res && res.success) { nodes = res.nodes; links = res.links || []; }
      } catch (e) {}
    }
    if (nodes === null) {
      try {
        const response = await fetch(API_GRAPH);
        const data = await response.json();
        nodes = data.nodes; links = data.links || [];
      } catch (error) {
        console.error('获取画布数据失败:', error);
        clearCanvas();
        showEmpty('加载失败', '请检查本地索引或后端服务是否正常');
        return;
      }
    }

    // 只取「画布卡片」与「手动连线」；语义节点仅作为「引用」候选
    const canvasNodes = (nodes || []).filter(function(n) { return n.canvas; });
    refNodes = (nodes || []).filter(function(n) { return !n.canvas; });
    allEdges = (links || []).filter(function(l) { return l.type === 'manual'; }).map(function(l) {
      return {
        id: l.manualId || l.id,
        source: typeof l.source === 'object' ? l.source.id : l.source,
        target: typeof l.target === 'object' ? l.target.id : l.target,
        type: 'manual'
      };
    });

    if (!canvasNodes.length) {
      allNodes = [];
      allEdges = [];
      clearCanvas();
      showEmpty('暂无画布节点', '右键空白处新建便签 / 链接 / 图片，或引用已有内容节点');
      return;
    }

    allNodes = canvasNodes.map(function(n) {
      return {
        id: n.id,
        type: n.type || 'note',
        title: n.title || '',
        text: n.text,
        x: (typeof n.x === 'number' && isFinite(n.x)) ? n.x : 0,
        y: (typeof n.y === 'number' && isFinite(n.y)) ? n.y : 0
      };
    });
    nodeMap = {};
    allNodes.forEach(function(n) { nodeMap[n.id] = n; });

    loadingEl.style.display = 'none';
    emptyEl.style.display = 'none';
    renderCanvas();
    loadGroups();
  }

  function loadGroups() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.listGroups !== 'function') return;
    bridge.listGroups().then(function(res) {
      if (res && res.success) allGroups = res.groups || [];
      renderGroupFrames();
    }).catch(function() { allGroups = []; });
  }

  function clearCanvas() {
    var existing = container.querySelector('svg:not(#minimapSvg)');
    if (existing) existing.remove();
    frameLayer = null;
    selectionLayer = null;
    tempLink = null;
    linkSourceId = null;
  }

  function showEmpty(title, desc) {
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyTitle.textContent = title;
    emptyDesc.textContent = desc;
    if (minimapEl) minimapEl.style.display = 'none';
  }

  // ---- 渲染（无 force，节点按 x/y 绝对摆放） ----

  function renderCanvas() {
    clearCanvas();
    if (!allNodes.length) {
      showEmpty('暂无画布节点', '右键空白处新建便签 / 链接 / 图片，或引用已有内容节点');
      return;
    }
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'none';
    initGraph();
  }

  function initGraph() {
    var width = container.clientWidth;
    var height = container.clientHeight;

    svg = d3.select('#graphContainer')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    var zoom = d3.zoom()
      .scaleExtent([0.1, 10])
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

    // 空白画布右键：新建节点菜单
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

    // 恢复上次视图
    if (preservedTransform && (preservedTransform.k !== 1 || preservedTransform.x || preservedTransform.y)) {
      svg.call(zoom.transform, preservedTransform);
    }

    // 手动连线（直线，按节点坐标绘制）
    linkElements = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(allEdges)
      .join('line')
      .attr('class', 'link link-manual');

    // 节点卡片
    nodeElements = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(allNodes)
      .join('g')
      .attr('class', 'node')
      .call(dragBehavior());

    nodeElements.each(function(d) {
      d.__el = this;
      renderCanvasCard(d3.select(this), d);
    });

    nodeElements.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

    nodeElements.on('click', onNodeClick);
    nodeElements.on('dblclick', onNodeDblClick);
    nodeElements.on('contextmenu', onNodeContextMenu);
    nodeElements.on('mouseenter', onNodeEnter).on('mouseleave', onNodeLeave);

    // 手动连线右键菜单（删除）
    linkElements.on('contextmenu', function(event, d) {
      event.stopPropagation();
      event.preventDefault();
      openEdgeMenu(event.clientX, event.clientY, d);
    });

    updateLinkPositions();

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', function() {
        if (!svg) return;
        svg.attr('width', container.clientWidth).attr('height', container.clientHeight);
      });
    }

    // 选择层（框选矩形）
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

  function updateLinkPositions() {
    if (!linkElements) return;
    linkElements
      .attr('x1', function(d) { var s = nodeMap[d.source]; return s ? s.x : 0; })
      .attr('y1', function(d) { var s = nodeMap[d.source]; return s ? s.y : 0; })
      .attr('x2', function(d) { var t = nodeMap[d.target]; return t ? t.x : 0; })
      .attr('y2', function(d) { var t = nodeMap[d.target]; return t ? t.y : 0; });
  }

  function refreshNodePos(n) {
    if (n && n.__el) d3.select(n.__el).attr('transform', 'translate(' + n.x + ',' + n.y + ')');
  }

  // 绘制单张画布卡片（便签/链接/图片/引用）
  function renderCanvasCard(gSel, d) {
    var s = canvasCardSize(d);
    var w = s.w, h = s.h, rx = 8, fill = nodeColor(d.type);

    gSel.append('rect')
      .attr('x', -w / 2).attr('y', -h / 2)
      .attr('width', w).attr('height', h)
      .attr('rx', rx).attr('fill', fill);

    if (d.type === 'image') {
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

  function nodeColor(type) {
    if (type === 'note') return '#fbbf24';
    if (type === 'link') return '#22d3ee';
    if (type === 'image') return '#a78bfa';
    return '#14b8a6'; // ref
  }

  // ---- 节点交互 ----

  function onNodeClick(event, d) {
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
  }

  function onNodeDblClick(event, d) {
    event.stopPropagation();
    if (d.type !== 'ref') openEditModal(d);
  }

  function onNodeContextMenu(event, d) {
    event.stopPropagation();
    event.preventDefault();
    openNodeMenu(event.clientX, event.clientY, d);
  }

  function onNodeEnter(event) {
    d3.select(this).select('rect').transition().duration(150).attr('stroke-width', 3);
  }

  function onNodeLeave(event, d) {
    if (selectedNodeId !== String(d.id)) {
      d3.select(this).select('rect').transition().duration(150).attr('stroke-width', 2);
    }
  }

  function selectNode(d) {
    selectedNodeId = String(d.id);
    selectedNodeIds.clear();
    selectedNodeIds.add(String(d.id));
    applySelectionHighlight();
  }

  function resetSelection() {
    selectedNodeId = null;
    selectedNodeIds.clear();
    applySelectionHighlight();
  }

  function applySelectionHighlight() {
    if (!nodeElements) return;
    nodeElements.classed('selected-node', function(n) {
      return selectedNodeIds.has(String(n.id));
    });
  }

  function screenToWorld(event) {
    var m = d3.pointer(event, container);
    return currentTransform.invert(m);
  }

  // 判断右键/左键点击是否落在“画布空白”（非节点/连线/分组等交互元素）
  function isCanvasBackground(event) {
    var t = event ? event.target : null;
    if (!t) return false;
    if (t === svg.node()) return true;
    if (t instanceof SVGElement) {
      if (!t.closest('.node, .temp-link, line.link, .frame-title')) return true;
    }
    return false;
  }

  // ---- 拖拽（无 force：直接改 x/y 并写回布局） ----

  function dragBehavior() {
    return d3.drag()
      .filter(function() { return !spacePressed; })
      .on('start', function(event, d) {
        if (selectedNodeIds.size > 1 && selectedNodeIds.has(String(d.id))) {
          startBatchMove(event);
          return;
        }
      })
      .on('drag', function(event, d) {
        if (batchMove) { moveSelection(event); return; }
        d.x = event.x;
        d.y = event.y;
        refreshNodePos(d);
        updateLinkPositions();
        updateGroupFrames();
        updateMinimapViewport();
      })
      .on('end', function() {
        if (batchMove) endBatchMove();
        persistPositionsDebounced();
      });
  }

  function startBatchMove(event) {
    batchMove = { nodes: [], startX: event.x, startY: event.y };
    selectedNodeIds.forEach(function(id) {
      var n = nodeMap[id];
      if (!n) return;
      n._sx = n.x; n._sy = n.y;
      batchMove.nodes.push(n);
    });
  }

  function moveSelection(event) {
    var dx = event.x - batchMove.startX;
    var dy = event.y - batchMove.startY;
    batchMove.nodes.forEach(function(n) {
      n.x = n._sx + dx;
      n.y = n._sy + dy;
      refreshNodePos(n);
    });
    updateLinkPositions();
    updateGroupFrames();
    updateMinimapViewport();
  }

  function endBatchMove() {
    batchMove = null;
  }

  // ---- 位置持久化（防抖写回 canvas_layout） ----

  var persistTimer = null;

  function persistPositions() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
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

  // ---- 框选（Box Select）----

  function beginBoxSelect(event) {
    var pt = currentTransform.invert(d3.pointer(event, container));
    boxSelect = { startX: pt[0], startY: pt[1], shift: event.shiftKey || event.ctrlKey || event.metaKey };
    if (!selectionLayer) return;
    boxSelect.rect = selectionLayer.append('rect')
      .attr('class', 'box-select-rect')
      .attr('x', pt[0]).attr('y', pt[1]).attr('width', 0).attr('height', 0);

    var up = function() {
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
    if (boxSelect.rect) {
      var w = parseFloat(boxSelect.rect.attr('width'));
      var h = parseFloat(boxSelect.rect.attr('height'));
      if (w > 5 || h > 5) suppressSvgClick = true;
      boxSelect.rect.remove();
    }
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
      var s = canvasCardSize(n);
      minX = Math.min(minX, n.x - s.w / 2); maxX = Math.max(maxX, n.x + s.w / 2);
      minY = Math.min(minY, n.y - s.h / 2); maxY = Math.max(maxY, n.y + s.h / 2);
    });
    if (none) return { x: 0, y: 0, w: 60, h: 40 };
    var pad = 20;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  function groupDragBehavior() {
    return d3.drag()
      .filter(function() { return !spacePressed; })
      .on('start', function(event, gd) {
        groupMove = { startX: event.x, startY: event.y, members: [] };
        (gd.members || []).forEach(function(id) {
          var n = nodeMap[id];
          if (!n) return;
          n._sx = n.x; n._sy = n.y;
          groupMove.members.push(n);
        });
      })
      .on('drag', function(event) {
        if (!groupMove) return;
        var dx = event.x - groupMove.startX;
        var dy = event.y - groupMove.startY;
        groupMove.members.forEach(function(n) {
          n.x = n._sx + dx;
          n.y = n._sy + dy;
          refreshNodePos(n);
        });
        updateLinkPositions();
        updateGroupFrames();
        updateMinimapViewport();
      })
      .on('end', function() {
        if (groupMove && groupMove.members.length) persistPositionsDebounced();
        groupMove = null;
      });
  }

  async function createGroupNamed(name) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createGroup !== 'function') return;
    try {
      await bridge.createGroup({ name: name, memberIds: Array.from(selectedNodeIds) });
    } catch (e) {}
    await loadGroups();
  }

  async function renameGroupId(id, name) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.renameGroup !== 'function') return;
    try { await bridge.renameGroup({ id: id, name: name }); } catch (e) {}
    await loadGroups();
  }

  async function dissolveGroupId(id) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
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

  // ---- 右键菜单 & 弹窗 ----

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
    for (var i = 0; i < refNodes.length; i++) {
      var n = refNodes[i];
      var hay = ((n.title || '') + ' ' + (n.category || '') + ' ' + (n.tags || []).join(' ')).toLowerCase();
      if (query && hay.indexOf(query) === -1) continue;
      html += '<div class="ref-picker-item" data-id="' + n.id + '">' +
        '<span class="rtitle">' + escapeHtml(n.title || n.id) + '</span>' +
        '<span class="rtype">' + (typeName[n.type] || n.type) + '</span></div>';
    }
    list.innerHTML = html || '<div class="ref-picker-item"><span class="rtitle">无匹配节点</span></div>';
  }

  // ---- 画布节点增删改（复用本地索引桥；成功即本地插入/更新，不整页刷新） ----

  async function createCanvasNode(kind, text, title, x, y) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.createCanvasNode === 'function') {
      try {
        var res = await bridge.createCanvasNode({ kind: kind, text: text, title: title, x: x, y: y });
        return (res && res.node) ? res.node : null;
      } catch (e) { return null; }
    }
    // 无 Electron bridge（如浏览器调试）时：生成本地临时节点兜底，仍能在画布画出并拖动
    return {
      id: 'temp:' + Date.now() + ':' + Math.floor(Math.random() * 1e6),
      kind: kind, text: text, title: title, x: x, y: y
    };
  }

  async function updateCanvasNode(id, text) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.updateCanvasNode !== 'function') return;
    try { await bridge.updateCanvasNode({ id: id, text: text }); } catch (e) {}
  }

  async function deleteCanvasNode(id) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.deleteCanvasNode === 'function') {
      try { await bridge.deleteCanvasNode({ id: id }); } catch (e) {}
    }
    // 本地移除节点及其连线/分组关系，即时反馈
    delete nodeMap[id];
    allNodes = allNodes.filter(function(n) { return n.id !== id; });
    allEdges = allEdges.filter(function(e) { return e.source !== id && e.target !== id; });
    allGroups.forEach(function(gd) { gd.members = (gd.members || []).filter(function(m) { return m !== id; }); });
    selectedNodeIds.delete(id);
    if (selectedNodeId === id) selectedNodeId = null;
    renderCanvas();
  }

  async function deleteCanvasEdge(id) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.deleteCanvasEdge === 'function') {
      try { await bridge.deleteCanvasEdge({ id: id }); } catch (e) {}
    }
    allEdges = allEdges.filter(function(e) { return e.id !== id; });
    renderCanvas();
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
    var createdNode = null;
    if (ctx.mode === 'create') {
      if (ctx.kind === 'ref') {
        if (!pendingRefNodeId) { closeModal(); return; }
        var refTarget = null;
        for (var ri = 0; ri < refNodes.length; ri++) {
          if (refNodes[ri].id === pendingRefNodeId) { refTarget = refNodes[ri]; break; }
        }
        var refTitle = refTarget ? (refTarget.title || '') : '';
        createdNode = await createCanvasNode('ref', pendingRefNodeId, refTitle, ctx.x, ctx.y);
      } else {
        var field = canvasModalBody.querySelector('#canvasFieldValue');
        var val = field ? field.value.trim() : '';
        if ((ctx.kind === 'link' || ctx.kind === 'image') && !val) { closeModal(); return; }
        createdNode = await createCanvasNode(ctx.kind, val, '', ctx.x, ctx.y);
      }
    } else if (ctx.mode === 'edit') {
      var editField = canvasModalBody.querySelector('#canvasFieldValue');
      var editVal = editField ? editField.value : '';
      await updateCanvasNode(ctx.nodeId, editVal);
      var en = nodeMap[ctx.nodeId];
      if (en) { en.text = editVal; en.title = editVal ? String(editVal).slice(0, 40) : en.title; }
    }
    closeModal();

    if (ctx.mode === 'create' && createdNode && createdNode.id) {
      // 坐标已由 bridge 落库 canvas_layout，此处纯前端插入即可
      var node = {
        id: createdNode.id,
        type: createdNode.kind || ctx.kind,
        title: createdNode.title || (createdNode.text ? String(createdNode.text).slice(0, 40) : '便签'),
        text: createdNode.text,
        x: (typeof createdNode.x === 'number' && isFinite(createdNode.x)) ? createdNode.x : ctx.x,
        y: (typeof createdNode.y === 'number' && isFinite(createdNode.y)) ? createdNode.y : ctx.y
      };
      allNodes.push(node);
      nodeMap[node.id] = node;
      selectedNodeIds.clear();
      selectedNodeIds.add(node.id);
      selectedNodeId = node.id;
    }
    renderCanvas();
  }

  // ---- 手动连线 ----

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
    // 已存在同向/反向连线时不重复添加
    var exists = allEdges.some(function(e) {
      return (e.source === fromId && e.target === targetId) || (e.source === targetId && e.target === fromId);
    });
    if (exists) return;
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    var edge = null;
    if (bridge && typeof bridge.createCanvasEdge === 'function') {
      try {
        var res = await bridge.createCanvasEdge({ fromId: fromId, toId: targetId });
        if (res && res.edge) edge = res.edge;
      } catch (e) {}
    }
    if (edge && edge.id) {
      allEdges.push({ id: edge.id, source: fromId, target: targetId, type: 'manual' });
    }
    renderCanvas();
  }

  // ---- 小地图（Minimap）----

  function updateMinimapVisibility() {
    if (!minimapEl) return;
    var show = allNodes && allNodes.length >= 2;
    minimapEl.style.display = show ? 'flex' : 'none';
  }

  function minimapBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(function(n) {
      if (!isFinite(n.x) || !isFinite(n.y)) return;
      var s = canvasCardSize(n);
      minX = Math.min(minX, n.x - s.w / 2); maxX = Math.max(maxX, n.x + s.w / 2);
      minY = Math.min(minY, n.y - s.h / 2); maxY = Math.max(maxY, n.y + s.h / 2);
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
    svgSel.append('g').selectAll('line').data(allEdges).join('line')
      .attr('class', 'minimap-link')
      .attr('x1', function(d) { var s = nodeMap[d.source]; return s ? mmX(s.x) : 0; })
      .attr('y1', function(d) { var s = nodeMap[d.source]; return s ? mmY(s.y) : 0; })
      .attr('x2', function(d) { var t = nodeMap[d.target]; return t ? mmX(t.x) : 0; })
      .attr('y2', function(d) { var t = nodeMap[d.target]; return t ? mmY(t.y) : 0; });

    // 节点
    svgSel.append('g').selectAll('rect').data(allNodes).join('rect')
      .attr('class', function(n) {
        var c = 'minimap-node';
        if (n.type === 'note') c += ' note-node';
        else if (n.type === 'link') c += ' link-node';
        else if (n.type === 'image') c += ' image-node';
        else if (n.type === 'ref') c += ' ref-node';
        return c;
      })
      .attr('x', function(d) { return mmX(d.x) - 2; })
      .attr('y', function(d) { return mmY(d.y) - 2; })
      .attr('width', 4)
      .attr('height', 4);

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

  function updateMinimapViewport() {
    if (!minimapMeta || !minimapSvg || !minimapEl) return;
    if (minimapEl.style.display === 'none') return;
    var svgW = container.clientWidth, svgH = container.clientHeight;
    var c = currentTransform;
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

  function minimapJumpTo(px, py) {
    if (!minimapMeta || !zoomBehavior || !svg) return;
    var mm = minimapMeta;
    var wx = (px - mm.ox) / mm.scale + mm.bx;
    var wy = (py - mm.oy) / mm.scale + mm.by;
    centerWorldOn(wx, wy);
  }

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

  // ---- 主题 ----

  function applyThemeStyles() {
    if (!svg) return;
    var theme = document.documentElement.getAttribute('data-theme') || 'notion';
    var isDark = theme === 'dark';
    var nodeStroke = isDark ? '#2d2d2d' : '#ffffff';
    svg.selectAll('.node rect').attr('stroke', nodeStroke);
  }

  window.onThemeChange = function() {
    applyThemeStyles();
  };

  // ---- 工具 ----

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---- 事件绑定 ----

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
      if (d) deleteCanvasEdge(d.id || d.manualId);
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

  // 弹窗单行输入框回车 = 确认（textarea 保留换行）
  canvasModalBody.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    commitModal();
  });

  // 点击空白处关闭右键菜单；Esc 关闭弹窗/取消连线/关闭菜单
  document.addEventListener('click', function() { closeMenus(); });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (canvasModalMask.style.display === 'flex') { closeModal(); return; }
    if (linkSourceId) { cancelLink(); return; }
    closeMenus();
  });

  // ---- Init ----

  document.addEventListener('DOMContentLoaded', function() {
    loadData();
  });

  // ---- PostMessage listener for parent frame ----

  window.addEventListener('message', function(e) {
    if (e.data.action === 'themeChange') {
      if (typeof window.applyTheme === 'function') window.applyTheme();
    } else if (e.data.action === 'refresh') {
      loadData();
    }
  });
})();
