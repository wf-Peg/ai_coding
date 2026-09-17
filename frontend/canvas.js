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
  const drawToolbar = document.getElementById('drawToolbar');
  const drawOverlayEl = document.getElementById('drawOverlay');

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
  let svg, g, nodeElements, linkElements, frameLayer, selectionLayer, inkLayer;
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

  // ---- 多画布文档 + 大纲视图状态（对标幕布） ----
  const VIEW_MODE_KEY = 'canvas_view_mode_v1';
  let currentDocId = null;     // 当前画布文档 id
  let docList = [];            // 文档列表（含 nodeCount）
  let viewMode = 'split';      // outline | split | canvas
  let refNodesLoaded = false;  // 语义内容节点候选是否已懒加载

  const GRID = 12;            // 网格吸附间距（px）
  let groupCollapsed = {};    // 分组折叠状态（内存态，刷新后重置）
  let collapseTimer = null;   // 折叠点击防抖（区分“单击折叠 / 双击重命名”）

  // ---- 手绘墨迹（临时擦写板：仅本次会话有效，刷新/重进即清空，不落库） ----
  const INK_COLORS = ['#222', '#6b7280', '#1a73e8', '#e5484d', '#30a46c', '#f76b15'];
  const INK_WIDTH = { thin: 2, bold: 6 };          // 细/粗 笔触基底宽度
  const ERASE_RADIUS = 8;                          // 橡皮擦命中半径（世界坐标 px）
  let drawTool = null;           // null | 'pen' | 'highlighter' | 'eraser'
  let inkSize = 'thin';          // 粗细档
  let inkColor = INK_COLORS[0];
  let strokes = [];              // 墨迹数据 [{id,color,width,opacity,points:[[x,y]...]}]
  let drawing = null;            // 进行中的墨迹 {el, points, color, width, opacity}

  // ---- 墨迹持久化（多文档隔离）：400ms 防抖落库，切换/卸载前立即 flush ----
  const INK_SAVE_DEBOUNCE = 400; // 与 canvasSync.schedulePush 的 400ms 呼应，避免逐笔往返 IPC
  let inkDirty = false;          // 有待落库的墨迹变更
  let inkTimer = null;           // 防抖定时器

  function newInkId() {
    var b36 = '0123456789abcdefghijklmnopqrstuvwxyz';
    var rnd = '';
    for (var i = 0; i < 6; i++) rnd += b36[Math.floor(Math.random() * 36)];
    return 'ink:' + Date.now().toString(36) + ':' + rnd;
  }

  function saveInkBridge() {
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    return bridge && typeof bridge.saveCanvasInk === 'function' ? bridge : null;
  }

  // 标记墨迹已变更：起 400ms 防抖，到点由 doSaveInk 落库
  function markInkDirty() {
    inkDirty = true;
    if (inkTimer) return;
    inkTimer = setTimeout(function () {
      inkTimer = null;
      doSaveInk();
    }, INK_SAVE_DEBOUNCE);
  }

  // 立即把当前文档墨迹写入本地索引（整文档全量替换）。失败保留 dirty，下次变更/切换再重试
  async function doSaveInk() {
    if (!inkDirty) return;
    var bridge = saveInkBridge();
    if (!bridge || !currentDocId) { inkDirty = false; return; }
    try {
      var res = await bridge.saveCanvasInk({ docId: currentDocId, strokes: strokes });
      if (res && res.success) inkDirty = false;
    } catch (e) { /* 静默：保留 dirty，不打断作画 */ }
  }

  // 强制落库（切换文档 / 清空 / 卸载前调用）；无变更时短路
  async function flushInk() {
    if (inkTimer) { clearTimeout(inkTimer); inkTimer = null; }
    if (inkDirty) await doSaveInk();
  }

  // 载入库中墨迹 → strokes（数据先行；渲染由调用方按是否有节点决定走 renderCanvas 或 ensureInkLayer）
  function loadInk(incoming) {
    strokes = Array.isArray(incoming) ? incoming.map(function (s) {
      return {
        id: (s && typeof s.id === 'string') ? s.id : null,
        color: s && s.color,
        width: s && s.width,
        opacity: s && s.opacity,
        points: Array.isArray(s && s.points) ? s.points : []
      };
    }) : [];
    inkDirty = false;
    if (inkTimer) { clearTimeout(inkTimer); inkTimer = null; }
    if (strokes.length) {
      // 有笔迹：确保擦写板层存在并渲染（空文档路径也显示墨迹）
      ensureInkLayer();
      inboxEmptyStateHide();
      renderInk();
    }
  }

  // ---- 数据加载 ----

  /**
   * 加载当前画布文档的完整状态。
   * 走 canvasState({docId}) 一次拿全（文档 / 节点 / 连线 / 分组 / 坐标），
   * 不再借用「图谱接口 + filter(n => n.canvas)」——多文档后该路径无法按文档隔离。
   */
  async function loadData() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    // 进图即拉后端最新画布快照（后端更新则恢复，本地更新则反向推送，失败不阻塞）
    if (bridge && typeof bridge.canvasSync === 'function') {
      try { await bridge.canvasSync(); } catch (e) {}
    }

    if (!bridge || typeof bridge.canvasState !== 'function') {
      await loadFromGraphFallback();
      return;
    }

    let res = null;
    try { res = await bridge.canvasState({ docId: currentDocId }); } catch (e) {}

    if (!res || !res.success) {
      clearCanvas();
      emptyEl.style.display = 'none';
      showEmpty('加载失败', res && res.message ? res.message : '本地索引尚未就绪，请稍后重试或重建索引');
      return;
    }

    currentDocId = res.doc.id;
    docList = res.docs || [];
    allGroups = res.groups || [];
    refNodes = [];
    refNodesLoaded = false;

    allNodes = (res.nodes || []).map(function(n) {
      var p = (res.layout || {})[n.id];
      return {
        id: n.id,
        type: n.kind || 'note',
        title: n.title || '',
        text: n.text,
        x: (p && typeof p.x === 'number' && isFinite(p.x)) ? p.x : 0,
        y: (p && typeof p.y === 'number' && isFinite(p.y)) ? p.y : 0,
        parentId: n.parentId || null,
        orderIndex: (typeof n.orderIndex === 'number') ? n.orderIndex : null,
        createdAt: n.createdAt || ''
      };
    });
    nodeMap = {};
    allNodes.forEach(function(n) { nodeMap[n.id] = n; });

    allEdges = (res.edges || []).map(function(e) {
      return { id: e.id, source: e.source, target: e.target, type: 'manual' };
    });

    loadingEl.style.display = 'none';
    updateDocSwitcher();
    updateScaleWarn();
    syncOutline();

    if (!allNodes.length) {
      clearCanvas();
      showEmpty('暂无画布节点', '在左侧大纲按 Enter 开始列第一条，或右键空白处新建便签 / 链接 / 图片');
      return;
    }
    emptyEl.style.display = 'none';
    // 仅大纲视图下画布容器尺寸为 0，不建 SVG；切到分栏/画布时再由 setViewMode 触发渲染
    if (viewMode === 'outline') return;
    renderCanvas();
  }

  /**
   * 兜底取数（无 Electron bridge，如浏览器调试）：仍走图谱接口 + filter(canvas)。
   * 该路径不参与多文档与大纲，仅保证画布可视化不空转。
   */
  async function loadFromGraphFallback() {
    let nodes = null;
    let links = [];
    const bridge = window.electronAPI && window.electronAPI.localIndex;
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

    const canvasNodes = (nodes || []).filter(function(n) { return n.canvas; });
    refNodes = (nodes || []).filter(function(n) { return !n.canvas; });
    refNodesLoaded = true;
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
      syncOutline();
      return;
    }

    allNodes = canvasNodes.map(function(n) {
      return {
        id: n.id,
        type: n.type || 'note',
        title: n.title || '',
        text: n.text,
        x: (typeof n.x === 'number' && isFinite(n.x)) ? n.x : 0,
        y: (typeof n.y === 'number' && isFinite(n.y)) ? n.y : 0,
        parentId: n.parentId || null,
        orderIndex: (typeof n.orderIndex === 'number') ? n.orderIndex : null,
        createdAt: n.createdAt || ''
      };
    });
    nodeMap = {};
    allNodes.forEach(function(n) { nodeMap[n.id] = n; });

    loadingEl.style.display = 'none';
    emptyEl.style.display = 'none';
    renderCanvas();
    syncOutline();
  }

  /** 引用选择器的语义节点候选：懒加载（第一次打开引用弹窗时才取，避免进图多一次 IPC）。 */
  async function ensureRefNodes() {
    if (refNodesLoaded) return;
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.graph === 'function') {
      try {
        const res = await bridge.graph({});
        if (res && res.success) {
          refNodes = (res.nodes || []).filter(function(n) { return !n.canvas; });
          refNodesLoaded = true;
          return;
        }
      } catch (e) {}
    }
    try {
      const response = await fetch(API_GRAPH);
      const data = await response.json();
      refNodes = (data.nodes || []).filter(function(n) { return !n.canvas; });
      refNodesLoaded = true;
    } catch (e) { refNodes = []; }
  }

  /** 当前文档标题（用于导出文件名）。 */
  function docTitle() {
    for (var i = 0; i < docList.length; i++) {
      if (docList[i].id === currentDocId) return docList[i].title || '我的画布';
    }
    return '我的画布';
  }

  /** 把当前节点集同步给大纲面板（全量，仅在换文档/重载时调用）。 */
  function syncOutline() {
    if (!window.CanvasOutline) return;
    window.CanvasOutline.setNodes(allNodes.map(function(n) {
      return {
        id: n.id, kind: n.type, text: n.text, title: n.title,
        parentId: n.parentId, orderIndex: n.orderIndex, createdAt: n.createdAt
      };
    }));
  }

  function updateScaleWarn() {
    var warn = document.getElementById('scaleWarn');
    if (!warn) return;
    if (allNodes.length > 300) {
      warn.style.display = 'inline';
      warn.textContent = '节点 ' + allNodes.length + ' 个，建议拆分为多个画布';
    } else {
      warn.style.display = 'none';
      warn.textContent = '';
    }
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
    // 禁用 d3.zoom 的默认双击缩放（其 stopImmediatePropagation 会截断空白双击事件，
    // 导致容器级「空白双击新建便签」监听收不到事件）
    svg.on('dblclick.zoom', null);

    svg.on('click', function(event) {
      if (event.target !== svg.node()) return;
      if (suppressSvgClick) { suppressSvgClick = false; return; }
      resetSelection();
    });

    // 图片缩略图圆角裁剪（固定尺寸 110x72）
    svg.append('defs').append('clipPath')
      .attr('id', 'canvasImgClip')
      .append('rect')
      .attr('x', -55).attr('y', -36).attr('width', 110).attr('height', 72).attr('rx', 8);

    // 连线箭头 marker（fill 走 CSS：var(--primary)，自动适配深浅主题）
    svg.append('defs').append('marker')
      .attr('id', 'canvasArrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', '1').attr('refY', '5')
      .attr('markerWidth', '6').attr('markerHeight', '6')
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,0 L10,5 L0,10 z')
      .attr('class', 'canvas-arrow-path');

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

    // 手动连线（带箭头，端点在卡片边缘）
    linkElements = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(allEdges)
      .join('line')
      .attr('class', 'link link-manual')
      .attr('marker-end', 'url(#canvasArrow)');

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

    // 手绘墨迹层（SVG 最顶层，随画布缩放平移；由 renderCanvas 重建后从 strokes 还原）
    inkLayer = g.append('g').attr('class', 'ink-layer');
    renderInk();

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

  // 锚点：中心连线方向与矩形四条边的首个交点（卡片边缘而非中心，纯渲染计算，不改数据模型）
  function edgeAnchorPoint(cx, cy, hw, hh, dx, dy) {
    if (dx === 0 && dy === 0) return [cx, cy];
    var tx = dx !== 0 ? Math.abs(hw / dx) : Infinity;
    var ty = dy !== 0 ? Math.abs(hh / dy) : Infinity;
    var t = Math.min(tx, ty);
    return [cx + t * dx, cy + t * dy];
  }

  function updateLinkPositions() {
    if (!linkElements) return;
    linkElements.each(function(d) {
      var s = nodeMap[d.source], t = nodeMap[d.target];
      if (!s || !t) return;
      var ss = canvasCardSize(s), ts = canvasCardSize(t);
      var dx = t.x - s.x, dy = t.y - s.y;
      var p1 = edgeAnchorPoint(s.x, s.y, ss.w / 2, ss.h / 2, dx, dy);
      var p2 = edgeAnchorPoint(t.x, t.y, ts.w / 2, ts.h / 2, -dx, -dy);
      d3.select(this)
        .attr('x1', p1[0]).attr('y1', p1[1])
        .attr('x2', p2[0]).attr('y2', p2[1]);
    });
  }

  function refreshNodePos(n) {
    if (n && n.__el) d3.select(n.__el).attr('transform', 'translate(' + n.x + ',' + n.y + ')');
  }

  /**
   * 局部刷新单张卡片的文本（大纲改文字时用，避免整画布重绘）。
   * 链接/图片卡版面不同（标题 + 域名 / 缩略图），仍交由整体重绘处理。
   */
  function refreshCardText(id) {
    var d = nodeMap[id];
    if (!d || !nodeElements) return false;
    if (d.type === 'link' || d.type === 'image') return false;
    var target = null;
    nodeElements.each(function(n) { if (String(n.id) === String(id)) target = this; });
    if (!target) return false;
    var textSel = d3.select(target).select('text.canvas-card-text');
    if (textSel.empty()) return false;
    var label = d.type === 'note' ? (d.text || d.title || '便签') : (d.title || '引用');
    var lines = wrapLines(label, d.type === 'note' ? 12 : 13);
    textSel.selectAll('tspan').remove();
    var lineHeight = 14;
    var startY = -((lines.length - 1) * lineHeight) / 2;
    for (var i = 0; i < lines.length; i++) {
      textSel.append('tspan').attr('x', 0).attr('y', startY + i * lineHeight).text(lines[i]);
    }
    return true;
  }

  // 内联 SVG 线框类型图标（16px，与编辑器工具栏图标风格一致）
  function typeIconMarkup(type) {
    var path = '';
    if (type === 'image') path = '<rect x="2.5" y="2.5" width="19" height="19" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-6-6L5 21"/>';
    else if (type === 'link') path = '<path d="M9.4 14.6a3.2 3.2 0 0 0 4.5 0l3-3a3.18 3.18 0 0 0-4.5-4.5l-1.3 1.3"/><path d="M14.6 9.4a3.2 3.2 0 0 0-4.5 0l-3 3a3.18 3.18 0 0 0 4.5 4.5l1.3-1.3"/>';
    else if (type === 'ref') path = '<path d="M7 3h10a1.5 1.5 0 0 1 1.5 1.5V21L15 18.5 12 21l-3-2.5L5.5 21V4.5A1.5 1.5 0 0 1 7 3z"/>';
    return '<svg class="canvas-card-badge" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }

  function addTypeIcon(gSel, type, x, y) {
    gSel.append('g')
      .attr('class', 'node-type-icon')
      .attr('transform', 'translate(' + x + ',' + y + ')')
      .html(typeIconMarkup(type));
  }

  function urlDomain(text) {
    try {
      var u = new URL(String(text == null ? '' : text).trim());
      return (u.hostname || '').replace(/^www\./, '');
    } catch (e) { return null; }
  }

  // 绘制单张画布卡片（便签/链接/图片/引用）
  function renderCanvasCard(gSel, d) {
    var s = canvasCardSize(d);
    var w = s.w, h = s.h, rx = 10, fill = nodeColor(d.type);

    // 选中外圈 focus ring（偏移 4px 的浅色描边，默认宽度 0 隐藏）
    gSel.append('rect')
      .attr('class', 'node-focus-ring')
      .attr('x', -w / 2 - 4).attr('y', -h / 2 - 4)
      .attr('width', w + 8).attr('height', h + 8)
      .attr('rx', rx + 4);

    gSel.append('rect')
      .attr('class', 'node-card-rect')
      .attr('x', -w / 2).attr('y', -h / 2)
      .attr('width', w).attr('height', h)
      .attr('rx', rx).attr('fill', fill);

    if (d.type === 'image') {
      if (d.text) {
        gSel.append('image')
          .attr('href', d.text)
          .attr('x', -w / 2).attr('y', -h / 2)
          .attr('width', w).attr('height', h)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', 'url(#canvasImgClip)');
        // 圆角描边覆盖，图片卡有精致边框感
        gSel.append('rect')
          .attr('class', 'node-image-frame')
          .attr('x', -w / 2).attr('y', -h / 2)
          .attr('width', w).attr('height', h)
          .attr('rx', rx).attr('fill', 'none');
      }
      addTypeIcon(gSel, 'image', -w / 2 + 15, -h / 2 + 15);
      return;
    }

    var textSel = gSel.append('text')
      .attr('class', 'canvas-card-text' + (d.type === 'ref' ? ' canvas-ref-text' : ''));

    if (d.type === 'link') {
      // 链接卡：角标图标 + 标题 + 域名灰字
      addTypeIcon(gSel, 'link', -w / 2 + 13, -h / 2 + 13);
      var linkTitle = wrapLines(d.title || '链接', 11)[0] || '链接';
      var domain = urlDomain(d.text || d.title);
      textSel.append('tspan').attr('x', 0).attr('y', -1).attr('class', 'node-card-title').text(linkTitle);
      textSel.append('tspan').attr('x', 0).attr('y', 13).attr('class', 'node-card-domain').text(domain || '链接');
      return;
    }

    if (d.type === 'ref') addTypeIcon(gSel, 'ref', -w / 2 + 13, -h / 2 + 13);

    var label = '';
    if (d.type === 'note') label = d.text || d.title || '便签';
    else label = d.title || '引用';

    var lines = wrapLines(label, d.type === 'note' ? 12 : 13);
    var lineHeight = 14;
    var startY = -((lines.length - 1) * lineHeight) / 2;
    for (var i = 0; i < lines.length; i++) {
      textSel.append('tspan').attr('x', 0).attr('y', startY + i * lineHeight).text(lines[i]);
    }
    // 引用卡有角标，正文略向左上偏移避免重叠
    if (d.type === 'ref') textSel.attr('transform', 'translate(3,2)');
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

  function selectNode(d) {
    selectedNodeId = String(d.id);
    selectedNodeIds.clear();
    selectedNodeIds.add(String(d.id));
    applySelectionHighlight();
    // 双向联动：画布选中 → 大纲对应行高亮并滚动到位
    if (window.CanvasOutline) window.CanvasOutline.highlight(String(d.id));
  }

  function resetSelection() {
    selectedNodeId = null;
    selectedNodeIds.clear();
    applySelectionHighlight();
    if (window.CanvasOutline) window.CanvasOutline.setSelected(null);
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
    // 小地图/图例等画布外层控件不算空白
    if (t.closest && t.closest('#minimap, .legend')) return false;
    // 手绘覆盖层视为画布空白：画板模式下右键仍可唤起空白菜单（新建/引用等）
    if (t === drawOverlayEl) return true;
    // 空态：svg 未创建，容器本身 / 空态提示层（pointer-events:none 穿透）即空白
    if (!svg || t === svg.node()) return true;
    if (t === container || t === emptyEl) return true;
    if (t instanceof SVGElement) {
      if (!t.closest('.node, .temp-link, line.link, .frame-title')) return true;
    }
    return false;
  }

  // ---- 拖拽（无 force：直接改 x/y 并写回布局） ----

  function dragBehavior() {
    return d3.drag()
      .filter(function() { return !spacePressed && !drawTool; })
      .on('start', function(event, d) {
        if (selectedNodeIds.size > 1 && selectedNodeIds.has(String(d.id))) {
          startBatchMove(event);
          return;
        }
      })
      .on('drag', function(event, d) {
        if (batchMove) { moveSelection(event); return; }
        d.x = Math.round(event.x / GRID) * GRID;
        d.y = Math.round(event.y / GRID) * GRID;
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
      n.x = Math.round((n._sx + dx) / GRID) * GRID;
      n.y = Math.round((n._sy + dy) / GRID) * GRID;
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
    if (drawTool) return;
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
        s.append('rect').attr('class', 'group-frame-chip');
        var title = s.append('text').attr('class', 'group-frame-title')
          .text(gd.name || '分组')
          // 单击标题折叠/展开（防抖，双击重命名时不触发折叠）
          .on('click', function(e) {
            e.stopPropagation();
            scheduleCollapseToggle(gd.id);
          })
          .on('dblclick', function(e) {
            e.stopPropagation();
            e.preventDefault();
            cancelCollapseToggle();
            openGroupNameModal({ mode: 'rename', id: gd.id, current: gd.name || '' });
          })
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
      var rect = s.select('rect.group-frame-rect');
      var chip = s.select('rect.group-frame-chip');
      var title = s.select('text.group-frame-title');
      var collapsed = !!groupCollapsed[gd.id];
      var label = (collapsed ? '▶ ' : '▼ ') + (gd.name || '分组');
      var tw = label.length * 6.6 + 18; // 标题 chip 宽（11px 字体近似字符宽）

      rect.attr('rx', 10);
      chip.attr('rx', 11);
      if (collapsed) {
        // 折叠：frame 收成标题条高度，成员节点与连线由 applyGroupCollapse 隐藏
        rect.attr('x', b.x).attr('y', b.y)
          .attr('width', Math.max(tw + 24, 80)).attr('height', 26);
        chip.attr('x', b.x + 4).attr('y', b.y + 3)
          .attr('width', tw).attr('height', 20);
        title.attr('x', b.x + 12).attr('y', b.y + 17).text(label);
      } else {
        rect.attr('x', b.x).attr('y', b.y)
          .attr('width', Math.max(b.w, 1)).attr('height', Math.max(b.h, 1));
        chip.attr('x', b.x + 4).attr('y', b.y + 2)
          .attr('width', tw).attr('height', 22);
        title.attr('x', b.x + 12).attr('y', b.y + 18).text(label);
      }
    });
    applyGroupCollapse();
  }

  function scheduleCollapseToggle(id) {
    cancelCollapseToggle();
    collapseTimer = setTimeout(function() {
      collapseTimer = null;
      toggleGroupCollapse(id);
    }, 250);
  }

  function cancelCollapseToggle() {
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
  }

  function toggleGroupCollapse(id) {
    groupCollapsed[id] = !groupCollapsed[id];
    updateGroupFrames();
  }

  // 折叠分组：隐藏成员节点及与之相连的连线（展开时恢复，display 置空）
  function applyGroupCollapse() {
    var hidden = new Set();
    allGroups.forEach(function(gd) {
      if (!groupCollapsed[gd.id]) return;
      (gd.members || []).forEach(function(id) { hidden.add(String(id)); });
    });
    if (nodeElements) {
      nodeElements.each(function(n) {
        d3.select(this).style('display', hidden.has(String(n.id)) ? 'none' : null);
      });
    }
    if (linkElements) {
      linkElements.each(function(d) {
        var hide = hidden.has(String(d.source)) || hidden.has(String(d.target));
        d3.select(this).style('display', hide ? 'none' : null);
      });
    }
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
      .filter(function() { return !spacePressed && !drawTool; })
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
          n.x = Math.round((n._sx + dx) / GRID) * GRID;
          n.y = Math.round((n._sy + dy) / GRID) * GRID;
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

  /** 重新拉取当前文档的分组（分组变更后刷新 frame）。 */
  async function loadGroups() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.listGroups !== 'function') return;
    try {
      const res = await bridge.listGroups({ docId: currentDocId || undefined });
      if (res && res.success) allGroups = res.groups || [];
    } catch (e) { allGroups = allGroups || []; }
    renderGroupFrames();
  }

  async function createGroupNamed(name) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createGroup !== 'function') return;
    try {
      await bridge.createGroup({ name: name, memberIds: Array.from(selectedNodeIds), docId: currentDocId || undefined });
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

  // 空白画布右键：新建节点菜单。
  // 绑定在容器层而非 svg —— 空态（无画布节点）时不创建 svg，若只绑 svg 则空态右键无入口。
  // 事件从 svg/节点等子元素冒泡到 container，由 isCanvasBackground 过滤空白与交互元素。
  container.addEventListener('contextmenu', function(event) {
    if (!isCanvasBackground(event)) return;
    event.preventDefault();
    var p = screenToWorld(event);
    openCanvasMenu(event.clientX, event.clientY, { x: p[0], y: p[1] });
  });

  // 空白画布双击：直接新建便签（NoteGen 式快速入口，复用右键「新建便签」的弹窗与落库链路）
  container.addEventListener('dblclick', function(event) {
    if (!isCanvasBackground(event)) return;
    event.preventDefault();
    var p = screenToWorld(event);
    openCreateModal('note', { x: p[0], y: p[1] });
  });

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
    if (canvasModalOk) canvasModalOk.style.display = '';
    canvasModalCancel.textContent = '取消';
  }

  /** 纯提示弹窗（仅「取消」按钮充当关闭），用于“至少保留一个画布”等不可继续的操作反馈。 */
  function openMessage(title, msg) {
    closeMenus();
    canvasModalCtx = { mode: 'message' };
    canvasModalTitle.textContent = title;
    canvasModalBody.innerHTML = '<div class="clear-all-tip">' + escapeHtml(msg) + '</div>';
    if (canvasModalOk) canvasModalOk.style.display = 'none';
    canvasModalCancel.textContent = '知道了';
    canvasModalMask.style.display = 'flex';
  }

  /** 打开重命名画布弹窗（复用画布弹窗，避免 iframe 内 window.prompt 受限）。 */
  function openRenameDocModal(id) {
    closeMenus();
    var cur = '';
    for (var i = 0; i < docList.length; i++) if (docList[i].id === id) cur = docList[i].title || '';
    canvasModalCtx = { mode: 'rename-doc', docId: id };
    canvasModalTitle.textContent = '重命名画布';
    canvasModalBody.innerHTML =
      '<div class="field-label">画布名称</div>' +
      '<input id="canvasFieldValue" type="text" value="' + escapeHtml(cur) + '">';
    canvasModalCancel.textContent = '取消';
    var el = canvasModalBody.querySelector('#canvasFieldValue');
    if (el) { el.focus(); el.select(); }
    canvasModalMask.style.display = 'flex';
  }

  /** 打开删除画布确认弹窗（至少保留一个）。 */
  function openDeleteDocModal(id) {
    closeMenus();
    var title = '';
    for (var i = 0; i < docList.length; i++) if (docList[i].id === id) title = docList[i].title || '未命名画布';
    if (docList.length <= 1) {
      openMessage('无法删除', '至少保留一个画布文档。可以先新建一个画布，再删除当前的。');
      return;
    }
    canvasModalCtx = { mode: 'confirm-delete-doc', docId: id };
    canvasModalTitle.textContent = '删除画布';
    canvasModalBody.innerHTML =
      '<div class="clear-all-tip">确定删除画布「<b>' + escapeHtml(title) + '</b>」吗？<br>' +
      '该画布下的全部节点、连线与分组都会一并删除，且不可恢复。</div>';
    canvasModalCancel.textContent = '取消';
    canvasModalMask.style.display = 'flex';
  }

  // 清空全部内容：危险操作，弹确认框（复用画布弹窗）
  function openClearAllConfirm() {
    closeMenus();
    canvasModalCtx = { mode: 'clear-all' };
    pendingGroup = null;
    pendingRefNodeId = null;
    canvasModalTitle.textContent = '清空全部内容';
    canvasModalBody.innerHTML =
      '<p class="clear-all-tip">将<b>永久删除</b>画布上所有节点、连线、分组，并清空手绘墨迹（临时擦写）。' +
      '此操作不可恢复，确认继续？</p>';
    canvasModalMask.style.display = 'flex';
  }

  async function clearCanvasAll() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    var i;
    // 连线
    for (i = 0; i < allEdges.length; i++) {
      if (bridge && typeof bridge.deleteCanvasEdge === 'function') {
        try { await bridge.deleteCanvasEdge({ id: allEdges[i].id }); } catch (e) {}
      }
    }
    allEdges = [];
    // 分组
    for (i = 0; i < allGroups.length; i++) {
      if (bridge && typeof bridge.dissolveGroup === 'function') {
        try { await bridge.dissolveGroup({ id: allGroups[i].id }); } catch (e) {}
      }
    }
    allGroups = [];
    // 节点
    var ids = allNodes.map(function(n) { return n.id; });
    for (i = 0; i < ids.length; i++) {
      if (bridge && typeof bridge.deleteCanvasNode === 'function') {
        try { await bridge.deleteCanvasNode({ id: ids[i] }); } catch (e) {}
      }
      delete nodeMap[ids[i]];
    }
    allNodes = [];
    selectedNodeIds.clear();
    selectedNodeId = null;
    // 墨迹一并清空
    strokes = [];
    if (window.CanvasOutline) window.CanvasOutline.reset();
    updateScaleWarn();
    renderCanvas(); // 空态（showEmpty）自动呈现
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
      renderRefPicker('');   // 先给即时反馈（可能是空列表）
      ensureRefNodes().then(function() { renderRefPicker(input ? input.value : ''); });
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

  async function createCanvasNode(kind, text, title, x, y, extra) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    const payload = Object.assign({
      kind: kind, text: text, title: title, x: x, y: y,
      docId: currentDocId || undefined
    }, extra || {});
    if (bridge && typeof bridge.createCanvasNode === 'function') {
      try {
        var res = await bridge.createCanvasNode(payload);
        return (res && res.node) ? res.node : null;
      } catch (e) { return null; }
    }
    // 无 Electron bridge（如浏览器调试）时：生成本地临时节点兜底，仍能在画布画出并拖动
    return {
      id: 'temp:' + Date.now() + ':' + Math.floor(Math.random() * 1e6),
      kind: kind, text: text, title: title, x: x, y: y,
      parentId: (extra && extra.parentId) || null
    };
  }

  async function updateCanvasNode(id, text) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.updateCanvasNode !== 'function') return;
    try { await bridge.updateCanvasNode({ id: id, text: text }); } catch (e) {}
  }

  /** 收集某节点及其全部后代 id（与后端 deleteNode 的子树连坐语义一致）。 */
  function collectSubtree(id) {
    var kids = {};
    allNodes.forEach(function(n) {
      var p = n.parentId || null;
      if (!p) return;
      if (!kids[p]) kids[p] = [];
      kids[p].push(n.id);
    });
    var out = [id];
    var stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      var cs = kids[cur];
      if (!cs) continue;
      for (var i = 0; i < cs.length; i++) {
        if (out.indexOf(cs[i]) >= 0) continue;
        out.push(cs[i]);
        stack.push(cs[i]);
      }
    }
    return out;
  }

  async function deleteCanvasNode(id) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.deleteCanvasNode === 'function') {
      try { await bridge.deleteCanvasNode({ id: id }); } catch (e) {}
    }
    // 本地移除节点及其子树、相关连线与分组关系，即时反馈
    var doomed = collectSubtree(String(id));
    doomed.forEach(function(x) {
      delete nodeMap[x];
      selectedNodeIds.delete(x);
      if (selectedNodeId === x) selectedNodeId = null;
    });
    allNodes = allNodes.filter(function(n) { return doomed.indexOf(n.id) < 0; });
    allEdges = allEdges.filter(function(e) { return doomed.indexOf(e.source) < 0 && doomed.indexOf(e.target) < 0; });
    allGroups.forEach(function(gd) { gd.members = (gd.members || []).filter(function(m) { return doomed.indexOf(m) < 0; }); });
    renderCanvas();
    if (window.CanvasOutline) window.CanvasOutline.removeNode(String(id));
    updateScaleWarn();
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
    if (ctx.mode === 'clear-all') {
      await clearCanvasAll();
      closeModal();
      return;
    }
    if (ctx.mode === 'rename-doc') {
      var docField = canvasModalBody.querySelector('#canvasFieldValue');
      var docVal = docField ? docField.value.trim() : '';
      closeModal();
      await renameDocById(ctx.docId, docVal);
      return;
    }
    if (ctx.mode === 'confirm-delete-doc') {
      var doomedDoc = ctx.docId;
      closeModal();
      await removeDocById(doomedDoc);
      return;
    }
    if (ctx.mode === 'message') {
      closeModal();
      return;
    }
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
      if (en) {
        en.text = editVal;
        en.title = editVal ? String(editVal).slice(0, 40) : en.title;
        // 双向一致：画布改文字 → 大纲对应行同步
        if (window.CanvasOutline) {
          window.CanvasOutline.upsertNode({ id: en.id, kind: en.type, text: en.text, title: en.title });
        }
      }
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
        y: (typeof createdNode.y === 'number' && isFinite(createdNode.y)) ? createdNode.y : ctx.y,
        parentId: createdNode.parentId || null,
        orderIndex: (typeof createdNode.orderIndex === 'number') ? createdNode.orderIndex : null,
        createdAt: createdNode.createdAt || ''
      };
      allNodes.push(node);
      nodeMap[node.id] = node;
      selectedNodeIds.clear();
      selectedNodeIds.add(node.id);
      selectedNodeId = node.id;
      if (window.CanvasOutline) {
        window.CanvasOutline.upsertNode({
          id: node.id, kind: node.type, text: node.text, title: node.title,
          parentId: node.parentId, orderIndex: node.orderIndex, createdAt: node.createdAt
        });
      }
      updateScaleWarn();
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
    if (nodeElements) nodeElements.classed('linking', false);
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
  // 节点描边/投影、连线与箭头颜色均走 CSS var(--...) 自动适配深浅主题，无需 JS 覆写。

  // ---- 手绘墨迹（临时擦写板） ----

  function setDrawTool(tool) {
    drawTool = tool;
    drawing = null;
    var overlay = document.getElementById('drawOverlay');
    if (overlay) overlay.classList.toggle('active', !!tool);
    // 工具条高亮
    if (drawToolbar) {
      drawToolbar.querySelectorAll('button[data-tool]').forEach(function(b) {
        b.classList.toggle('is-active', b.dataset.tool === tool);
      });
    }
    if (tool) { closeMenus(); cancelLink(); resetSelection(); ensureInkLayer(); }
  }

  // 空态（无画布节点）时保证可当临时擦写板使用：惰性创建最小 svg + 缩放组 + 墨迹层
  function ensureInkLayer() {
    if (inkLayer) return;
    var w = container.clientWidth, h = container.clientHeight;
    svg = d3.select('#graphContainer').append('svg').attr('width', w).attr('height', h);
    g = svg.append('g');
    var zoom = d3.zoom()
      .scaleExtent([0.1, 10])
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
    zoomBehavior = zoom;
    svg.on('dblclick.zoom', null);
    inkLayer = g.append('g').attr('class', 'ink-layer');
    inboxEmptyStateHide();
  }

  function inboxEmptyStateHide() {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
  }

  function renderInk() {
    if (!inkLayer) return;
    inkLayer.selectAll('*').remove();
    strokes.forEach(function(s) {
      if (!s.points || s.points.length < 1) return;
      inkLayer.append('path')
        .attr('d', s.points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]; }).join(' '))
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width)
        .attr('stroke-opacity', s.opacity)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('pointer-events', 'none');
    });
  }

  function strokeParams() {
    var bold = inkSize === 'bold';
    var opacity = drawTool === 'highlighter' ? 0.35 : 1;
    var width = (drawTool === 'highlighter' ? (bold ? 16 : 9) : INK_WIDTH[inkSize]);
    return { width: width, opacity: opacity, color: inkColor };
  }

  // 点到折线的最短距离（分段线性），用于橡皮擦命中判断
  function pointToPolylineDist(px, py, pts) {
    if (!pts || pts.length < 2) {
      if (!pts || !pts.length) return Infinity;
      return Math.hypot(px - pts[0][0], py - pts[0][1]);
    }
    var min = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var abx = b[0] - a[0], aby = b[1] - a[1];
      var t = ((px - a[0]) * abx + (py - a[1]) * aby) / (abx * abx + aby * aby);
      t = Math.max(0, Math.min(1, t));
      var cx = a[0] + t * abx, cy = a[1] + t * aby;
      var d = Math.hypot(px - cx, py - cy);
      if (d < min) min = d;
    }
    return min;
  }

  function handleDrawStart(event) {
    event.preventDefault();
    if (!drawTool || drawOverlayEl === null) return;
    // 仅左键绘制；右键保留给画布右键菜单
    if (event.button !== 0) return;
    ensureInkLayer();
    // 指针捕获：保证快速拖动越出覆盖层时仍连续绘制
    if (drawOverlayEl.setPointerCapture) {
      try { drawOverlayEl.setPointerCapture(event.pointerId); } catch (e) {}
    }
    var w = screenToWorld(event);
    if (drawTool === 'eraser') {
      // 橡皮：记录擦除进行态，左键按住连续擦
      drawing = { erasing: true, x: w[0], y: w[1] };
      eraseAt(w[0], w[1]);
      return;
    }
    var p = strokeParams();
    drawing = {
      points: [w],
      color: p.color,
      width: p.width,
      opacity: p.opacity,
      el: null
    };
    drawing.el = inkLayer.append('path')
      .attr('fill', 'none')
      .attr('stroke', p.color)
      .attr('stroke-width', p.width)
      .attr('stroke-opacity', p.opacity)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('pointer-events', 'none')
      .attr('d', 'M' + w[0] + ' ' + w[1]);
  }

  function handleDrawMove(event) {
    if (!drawTool || !drawing) return;
    event.preventDefault();
    var w = screenToWorld(event);
    if (drawing.erasing) {
      eraseAt(w[0], w[1]);
      return;
    }
    var pts = drawing.points;
    var last = pts[pts.length - 1];
    // 抽稀：与上点距离过近跳过，避免点过多拖慢渲染
    if (last && Math.hypot(w[0] - last[0], w[1] - last[1]) < 2) return;
    pts.push(w);
    drawing.el.attr('d', pts.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]; }).join(' '));
  }

  function handleDrawEnd() {
    if (!drawing) return;
    if (drawing.erasing) { drawing = null; return; }
    if (drawing.points.length > 0) {
      strokes.push({
        color: drawing.color,
        width: drawing.width,
        opacity: drawing.opacity,
        points: drawing.points
      });
    }
    drawing = null;
  }

  function eraseAt(wx, wy) {
    var hit = -1;
    for (var i = 0; i < strokes.length; i++) {
      if (pointToPolylineDist(wx, wy, strokes[i].points) < ERASE_RADIUS) { hit = i; break; }
    }
    if (hit >= 0) {
      strokes.splice(hit, 1);
      renderInk();
    }
  }

  // 导出画布（当前视口，含墨迹）为 PNG 图片
  async function exportCanvas() {
    var el = document.getElementById('graphContainer');
    if (!el || typeof html2canvas !== 'function') return;
    if (drawTool) setDrawTool(null); // 先退出画板，避免覆盖层/画笔残留

    // 临时隐藏浮层控件，避免进入导出画面
    var overlays = el.querySelectorAll('.draw-toolbar, .minimap, .legend, #drawOverlay');
    var vis = [];
    overlays.forEach(function(n, i) { vis[i] = n.style.visibility; n.style.visibility = 'hidden'; });

    try {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim() || '#fff';
      var canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: bg });
      var a = document.createElement('a');
      var d = new Date();
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      var safeTitle = docTitle().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '画布';
      a.download = safeTitle + '-画布-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Date.now() + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally {
      overlays.forEach(function(n, i) { n.style.visibility = vis[i]; });
    }
  }
  function applyThemeStyles() {
    // 保留钩子：主题切换时如需按需刷新可在此扩展
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
      if (action === 'clear-all') openClearAllConfirm();
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
    if (drawTool) { setDrawTool(null); return; }
    closeMenus();
  });

  // ---- Init ----

  // 手绘画笔：工具栏事件
  if (drawToolbar) {
    drawToolbar.addEventListener('click', function(event) {
      var btn = event.target.closest('button');
      if (!btn) return;
      event.stopPropagation();
      if (btn.dataset.tool) { setDrawTool(btn.dataset.tool === drawTool ? null : btn.dataset.tool); return; }
      if (btn.dataset.size) {
        inkSize = btn.dataset.size;
        drawToolbar.querySelectorAll('button[data-size]').forEach(function(b) {
          b.classList.toggle('is-active', b.dataset.size === inkSize);
        });
        return;
      }
      if (btn.classList.contains('swatch')) {
        inkColor = btn.dataset.color;
        drawToolbar.querySelectorAll('.swatch').forEach(function(s) { s.classList.toggle('selected', s === btn); });
        return;
      }
    });
    document.getElementById('undoBtn').addEventListener('click', function(e) {
      e.stopPropagation();
      if (strokes.length) { strokes.pop(); renderInk(); }
    });
    document.getElementById('clearBtn').addEventListener('click', function(e) {
      e.stopPropagation();
      if (!strokes.length) return;
      strokes = [];
      renderInk();
    });
    var exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        exportCanvas();
      });
    }
  }

  // 手绘画笔：覆盖层指针绘制（临时擦写板）
  if (drawOverlayEl) {
    drawOverlayEl.addEventListener('pointerdown', handleDrawStart);
    drawOverlayEl.addEventListener('pointermove', handleDrawMove);
    window.addEventListener('pointerup', handleDrawEnd);
    drawOverlayEl.addEventListener('pointerleave', handleDrawEnd);
  }

  // ---- 大纲面板 / 多画布文档 / 视图三态（对标幕布） ----

  function dispatchResize() {
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }

  /** 初始化大纲面板：把画布数据交给 CanvasOutline，并接管它的回写回调。 */
  function initOutline() {
    if (!window.CanvasOutline) return;
    window.CanvasOutline.init({
      getExportName: function() { return docTitle() + '.md'; },

      onEdit: function(id, text) {
        var n = nodeMap[id];
        if (n) { n.text = text; n.title = text ? String(text).slice(0, 40) : n.title; }
        updateCanvasNode(id, text);
        // 便签/引用卡可局部刷文本；链接/图片卡版面不同，退回整体重绘
        if (!refreshCardText(id)) renderCanvas();
      },

      onStructure: function(entries) {
        var changed = {};
        entries.forEach(function(e) { changed[e.id] = e; });
        allNodes.forEach(function(n) {
          var e = changed[n.id];
          if (e) { n.parentId = e.parentId; n.orderIndex = e.orderIndex; }
        });
        var bridge = window.electronAPI && window.electronAPI.localIndex;
        if (bridge && typeof bridge.saveCanvasStructure === 'function') {
          try { bridge.saveCanvasStructure({ docId: currentDocId, entries: entries }); } catch (e) {}
        }
      },

      onCreate: function(payload) {
        var anchor = payload.afterId ? nodeMap[payload.afterId] : null;
        var x = anchor ? anchor.x : 0;
        var y = anchor ? anchor.y + 84 : 0;
        return createCanvasNode('note', '', '', x, y, {
          docId: currentDocId || undefined,
          parentId: payload.parentId || null
        }).then(function(created) {
          if (!created || !created.id) return null;
          var node = {
            id: created.id,
            type: created.kind || 'note',
            title: created.title || '',
            text: created.text != null ? created.text : '',
            x: (typeof created.x === 'number' && isFinite(created.x)) ? created.x : x,
            y: (typeof created.y === 'number' && isFinite(created.y)) ? created.y : y,
            parentId: created.parentId || payload.parentId || null,
            orderIndex: (typeof created.orderIndex === 'number') ? created.orderIndex : null,
            createdAt: created.createdAt || ''
          };
          allNodes.push(node);
          nodeMap[node.id] = node;
          renderCanvas();
          updateScaleWarn();
          return created;
        });
      },

      onDelete: function(id) {
        deleteCanvasNode(id);
      },

      onSelect: function(id) {
        if (id) highlightCanvasNode(id);
        else resetSelection();
      },

      onScaleWarn: function(count) {
        var warn = document.getElementById('scaleWarn');
        if (!warn) return;
        warn.style.display = 'inline';
        warn.textContent = '节点 ' + count + ' 个，已默认折叠；建议拆分为多个画布';
      }
    });
  }

  /** 大纲选中 → 画布高亮并居中（不改变缩放级别）。 */
  function highlightCanvasNode(id) {
    var n = nodeMap[id];
    if (!n) return;
    selectedNodeId = String(id);
    selectedNodeIds.clear();
    selectedNodeIds.add(String(id));
    applySelectionHighlight();
    if (container.clientWidth) centerWorldOn(n.x, n.y);
  }

  function setViewMode(mode) {
    if (mode !== 'outline' && mode !== 'split' && mode !== 'canvas') mode = 'split';
    viewMode = mode;
    var body = document.getElementById('canvasBody');
    if (body) body.dataset.viewMode = mode;
    var sw = document.getElementById('viewSwitch');
    if (sw) {
      var btns = sw.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('is-active', btns[i].dataset.mode === mode);
    }
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (e) {}

    // 切视图会改变画布容器尺寸：让 d3 重新量一次（保留当前缩放/平移）
    setTimeout(function() {
      if (mode === 'outline') return;
      if (allNodes.length) renderCanvas(); else dispatchResize();
    }, 0);
  }

  function initViewSwitch() {
    var sw = document.getElementById('viewSwitch');
    if (sw) {
      sw.addEventListener('click', function(event) {
        var btn = event.target.closest ? event.target.closest('button[data-mode]') : null;
        if (!btn) return;
        setViewMode(btn.dataset.mode);
      });
    }
    var saved = 'split';
    try { saved = localStorage.getItem(VIEW_MODE_KEY) || 'split'; } catch (e) {}
    setViewMode(saved);
  }

  // ---- 文档切换器 ----

  function docTitleById(id) {
    for (var i = 0; i < docList.length; i++) if (docList[i].id === id) return docList[i].title || '未命名画布';
    return '未命名画布';
  }

  function renderDocSwitcherList() {
    var list = document.getElementById('docSwitcherList');
    if (!list) return;
    var html = '';
    for (var i = 0; i < docList.length; i++) {
      var d = docList[i];
      html += '<button class="doc-switcher-item' + (d.id === currentDocId ? ' is-active' : '') +
        '" data-doc-id="' + escapeHtml(d.id) + '">' +
        '<span class="doc-switcher-item-name">' + escapeHtml(d.title || '未命名画布') + '</span>' +
        '<span class="doc-switcher-item-count">' + (d.nodeCount || 0) + '</span>' +
        '</button>';
    }
    list.innerHTML = html || '<div class="outline-empty">暂无画布</div>';
  }

  function updateDocSwitcher() {
    var nameEl = document.getElementById('docSwitcherName');
    if (nameEl) nameEl.textContent = docTitle();
    renderDocSwitcherList();
  }

  function openDocSwitcherMenu() {
    var menu = document.getElementById('docSwitcherMenu');
    if (!menu) return;
    renderDocSwitcherList();
    menu.style.display = 'flex';
  }

  function closeDocSwitcherMenu() {
    var menu = document.getElementById('docSwitcherMenu');
    if (menu) menu.style.display = 'none';
  }

  function toggleDocSwitcherMenu() {
    var menu = document.getElementById('docSwitcherMenu');
    if (!menu) return;
    if (!menu.style.display || menu.style.display === 'none') openDocSwitcherMenu();
    else closeDocSwitcherMenu();
  }

  async function switchDoc(id) {
    closeDocSwitcherMenu();
    closeDocList();
    if (!id || id === currentDocId) return;
    currentDocId = id;

    allNodes = [];
    nodeMap = {};
    allEdges = [];
    allGroups = [];
    selectedNodeId = null;
    selectedNodeIds.clear();
    strokes = [];
    if (window.CanvasOutline) window.CanvasOutline.reset();
    clearCanvas();
    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';

    await loadData();
  }

  async function newDoc() {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.createCanvasDoc !== 'function') return;
    var res = null;
    try { res = await bridge.createCanvasDoc({ title: '未命名画布' }); } catch (e) {}
    var doc = res && res.doc;
    if (!doc) return;
    docList.push(doc);

    await switchDoc(doc.id);
    setViewMode('split');

    // 空文档首次进入：直接给一行，让用户「打开即可写」（对齐幕布）
    if (!allNodes.length) {
      var created = await createCanvasNode('note', '', '', 0, 0, { docId: doc.id, parentId: null });
      if (created && created.id) {
        var node = {
          id: created.id, type: 'note', title: '', text: created.text != null ? created.text : '',
          x: 0, y: 0, parentId: null,
          orderIndex: (typeof created.orderIndex === 'number') ? created.orderIndex : 0,
          createdAt: created.createdAt || ''
        };
        allNodes.push(node);
        nodeMap[node.id] = node;
        renderCanvas();
        updateScaleWarn();
        syncOutline();
        if (window.CanvasOutline) window.CanvasOutline.focusFirst();
      }
    }
  }

  async function renameDocById(id, title) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    var next = String(title == null ? '' : title).trim() || '未命名画布';
    if (bridge && typeof bridge.renameCanvasDoc === 'function') {
      try { await bridge.renameCanvasDoc({ id: id, title: next }); } catch (e) {}
    }
    for (var i = 0; i < docList.length; i++) if (docList[i].id === id) docList[i].title = next;
    updateDocSwitcher();
    renderDocList();
  }

  async function removeDocById(id) {
    const bridge = window.electronAPI && window.electronAPI.localIndex;
    if (!bridge || typeof bridge.deleteCanvasDoc !== 'function') return;
    var res = null;
    try { res = await bridge.deleteCanvasDoc({ id: id }); } catch (e) {}
    if (!res || !res.success) {
      openMessage('无法删除', (res && res.message) || '删除失败，请稍后重试');
      return;
    }
    var wasCurrent = (id === currentDocId);
    docList = docList.filter(function(d) { return d.id !== id; });
    updateDocSwitcher();
    renderDocList();
    if (wasCurrent && docList.length) await switchDoc(docList[0].id);
  }

  // ---- 文档列表视图 ----

  function renderDocList() {
    var grid = document.getElementById('docListGrid');
    if (!grid) return;
    var sub = document.getElementById('docListSub');
    if (sub) sub.textContent = '共 ' + docList.length + ' 个画布';
    var html = '';
    for (var i = 0; i < docList.length; i++) {
      var d = docList[i];
      var t = d.updatedAt ? String(d.updatedAt).replace('T', ' ').slice(0, 16) : '';
      html += '<div class="doc-card' + (d.id === currentDocId ? ' is-active' : '') +
        '" data-doc-id="' + escapeHtml(d.id) + '">' +
        '<div class="doc-card-title">' + escapeHtml(d.title || '未命名画布') + '</div>' +
        '<div class="doc-card-meta">' + (d.nodeCount || 0) + ' 个节点' + (t ? ' · ' + escapeHtml(t) : '') + '</div>' +
        '<div class="doc-card-actions">' +
        '<button class="modal-btn" data-doc-action="rename">重命名</button>' +
        '<button class="modal-btn" data-doc-action="delete">删除</button>' +
        '</div></div>';
    }
    grid.innerHTML = html || '<div class="outline-empty">还没有画布，点右上角「新建画布」开始</div>';
  }

  function openDocList() {
    closeDocSwitcherMenu();
    renderDocList();
    var mask = document.getElementById('docListMask');
    if (mask) mask.style.display = 'flex';
  }

  function closeDocList() {
    var mask = document.getElementById('docListMask');
    if (mask) mask.style.display = 'none';
  }

  function initDocSwitcher() {
    var btn = document.getElementById('docSwitcherBtn');
    if (btn) btn.addEventListener('click', function(e) { e.stopPropagation(); toggleDocSwitcherMenu(); });

    var menu = document.getElementById('docSwitcherMenu');
    if (menu) {
      menu.addEventListener('click', function(e) {
        var item = e.target.closest ? e.target.closest('[data-doc-id]') : null;
        if (item) { switchDoc(item.dataset.docId); return; }
        var action = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!action) return;
        var a = action.dataset.action;
        if (a === 'new-doc') newDoc();
        else if (a === 'rename-doc') { closeDocSwitcherMenu(); openRenameDocModal(currentDocId); }
        else if (a === 'open-doc-list') openDocList();
      });
    }

    var closeSwitcher = function(e) {
      var wrap = document.getElementById('docSwitcher');
      if (wrap && wrap.contains(e.target)) return;
      closeDocSwitcherMenu();
    };
    document.addEventListener('click', closeSwitcher);

    var newBtn = document.getElementById('docListNewBtn');
    if (newBtn) newBtn.addEventListener('click', function() { newDoc(); });
    var closeBtn = document.getElementById('docListCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeDocList);
    var mask = document.getElementById('docListMask');
    if (mask) {
      mask.addEventListener('click', function(e) { if (e.target === mask) closeDocList(); });
    }
    var grid = document.getElementById('docListGrid');
    if (grid) {
      grid.addEventListener('click', function(e) {
        var actionBtn = e.target.closest ? e.target.closest('[data-doc-action]') : null;
        var card = e.target.closest ? e.target.closest('[data-doc-id]') : null;
        if (!card) return;
        var id = card.dataset.docId;
        if (actionBtn && actionBtn.dataset.docAction === 'rename') { openRenameDocModal(id); return; }
        if (actionBtn && actionBtn.dataset.docAction === 'delete') { openDeleteDocModal(id); return; }
        switchDoc(id);
      });
    }
  }

  // ---- 一键「按大纲排版」：结构 → d3.tree 分层坐标 → 批量落库 ----

  /** 结构 → 分层坐标（Reingold–Tilford 整洁树，左→右）。无层级时按 order_index 竖排兜底。 */
  function computeOutlineLayout() {
    var hasHierarchy = allNodes.some(function(n) { return !!n.parentId && !!nodeMap[n.parentId]; });
    var positions = [];

    if (!hasHierarchy) {
      var flat = allNodes.slice().sort(function(a, b) {
        var oa = a.orderIndex == null ? 1e9 : a.orderIndex;
        var ob = b.orderIndex == null ? 1e9 : b.orderIndex;
        if (oa !== ob) return oa - ob;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      flat.forEach(function(n, i) { positions.push({ id: n.id, x: 0, y: i * 84 }); });
      return positions;
    }

    var wrap = {};
    allNodes.forEach(function(n) { wrap[n.id] = { id: n.id, children: [] }; });
    var roots = [];
    allNodes.forEach(function(n) {
      var p = n.parentId;
      if (p && wrap[p] && p !== n.id) wrap[p].children.push(wrap[n.id]);
      else roots.push(wrap[n.id]);
    });

    var byOrder = function(a, b) {
      var wa = a.data || a, wb = b.data || b;
      var na = nodeMap[wa.id] || {}, nb = nodeMap[wb.id] || {};
      var oa = na.orderIndex == null ? 1e9 : na.orderIndex;
      var ob = nb.orderIndex == null ? 1e9 : nb.orderIndex;
      if (oa !== ob) return oa - ob;
      return String(na.createdAt || '').localeCompare(String(nb.createdAt || ''));
    };
    roots.sort(byOrder);

    var V_GAP = 84;   // 兄弟间距（纵向）
    var H_GAP = 170;  // 层级间距（横向）
    var root = d3.hierarchy({ id: '__virtual_root__', children: roots }, function(d) { return d.children; });
    root.sort(byOrder);
    d3.tree().nodeSize([V_GAP, H_GAP])(root);

    root.each(function(nd) {
      if (nd.data.id === '__virtual_root__') return;
      positions.push({ id: nd.data.id, x: (nd.depth - 1) * H_GAP, y: nd.x });
    });
    return positions;
  }

  function fitToContent() {
    var b = minimapBounds();
    if (!b) return;
    var w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    var k = Math.max(0.1, Math.min(1.2, Math.min(w / b.w, h / b.h) * 0.9));
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var t = d3.zoomIdentity.translate(w / 2 - cx * k, h / 2 - cy * k).scale(k);
    currentTransform = t;
    preservedTransform = t;
    if (zoomBehavior && svg) {
      try { svg.call(zoomBehavior.transform, t); } catch (e) {}
      g.attr('transform', t);
      updateMinimapViewport();
    }
  }

  function layoutByOutline() {
    if (!allNodes.length) return;
    var positions = computeOutlineLayout();
    positions.forEach(function(p) {
      var n = nodeMap[p.id];
      if (n) { n.x = p.x; n.y = p.y; }
    });
    var bridge = window.electronAPI && window.electronAPI.localIndex;
    if (bridge && typeof bridge.saveLayout === 'function') {
      try { bridge.saveLayout({ positions: positions }); } catch (e) {}
    }
    if (viewMode === 'outline') setViewMode('split');
    renderCanvas();
    setTimeout(fitToContent, 0);
  }

  function initLayoutByOutline() {
    var btn = document.getElementById('layoutByOutlineBtn');
    if (btn) btn.addEventListener('click', layoutByOutline);
  }

  document.addEventListener('DOMContentLoaded', function() {
    initOutline();
    initDocSwitcher();
    initViewSwitch();
    initLayoutByOutline();
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
