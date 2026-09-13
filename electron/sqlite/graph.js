/**
 * graph.js - SQLite 本地索引层：图谱查询（节点 + 边）
 *
 * 对齐全量后端 GET /api/graph 的返回契约：
 *   { nodes: [{id,type,sourceId,title,summary,category,tags,linkedCount,sourceCount,phaseCount}],
 *     links: [{source,target,type}] }
 *
 * 节点来自 content 表（clip / knowledge / learning-plan）与 canvas_node 表
 * （note / link / image / ref），边来自 relation 表（语义关系）与 canvas_edge 表
 * （手动连线）。仅返回两端节点都存在的边。
 */

const canvasNode = require('./canvas-node');

/** 截断文本为单行短标题（画布节点无 title 时兜底）。 */
function shortText(text, maxLen) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= maxLen ? t : t.substring(0, maxLen) + '…';
}

/** 画布可写节点 → 图谱节点契约。 */
function canvasNodeToGraphNode(cn) {
  let title = cn.title != null ? cn.title : '';
  if (!title) {
    if (cn.kind === 'note') title = shortText(cn.text, 20) || '便签';
    else if (cn.kind === 'link') title = shortText(cn.text, 20) || '链接';
    else if (cn.kind === 'image') title = '图片';
    else title = '引用';
  }
  return {
    id: cn.id,
    type: cn.kind,
    sourceId: null,
    title,
    summary: cn.kind === 'note' ? (cn.text || '') : '',
    category: null,
    tags: [],
    linkedCount: 0,
    sourceCount: 0,
    text: cn.text,
    canvas: true
  };
}

/** 抽取节点元信息（含关系计数）。 */
function buildNodes(dbConn, includeTypes) {
  const contentRows = dbConn
    .prepare('SELECT id, type, source_id AS sourceId, title, summary, category, tags, content_ref AS contentRef, body_plain AS bodyPlain FROM content')
    .all();

  // 关系计数：linkedCount = 以该节点为 from 的出边数；sourceCount = 以该节点为 to 的入边数
  const outCount = new Map();
  const inCount = new Map();
  const relRows = dbConn.prepare('SELECT from_id AS f, to_id AS t FROM relation').all();
  for (const r of relRows) {
    outCount.set(r.f, (outCount.get(r.f) || 0) + 1);
    inCount.set(r.t, (inCount.get(r.t) || 0) + 1);
  }

  const nodes = [];
  const nodeIds = new Set();
  const bodies = new Map(); // 正文（clip/knowledge，供 wikilink 双链边解析；不进对外节点契约）
  for (const row of contentRows) {
    if (includeTypes && !includeTypes.has(row.type)) continue;
    let tagsArr = null;
    try { if (row.tags) tagsArr = JSON.parse(row.tags); } catch (e) { tagsArr = row.tags; }

    const node = {
      id: row.id,
      type: row.type,
      sourceId: row.sourceId,
      title: row.title,
      summary: row.summary,
      category: row.category,
      tags: tagsArr,
      linkedCount: outCount.get(row.id) || 0,
      sourceCount: inCount.get(row.id) || 0,
      contentRef: row.contentRef
    };
    if (row.type === 'learning-plan') {
      // 对齐后端：plan 节点额外给 phaseCount（从 content_ref 解析 phases 数量）
      let phaseCount = 0;
      try { const raw = JSON.parse(row.contentRef); if (raw && Array.isArray(raw.phases)) phaseCount = raw.phases.length; }
      catch (e) { /* ignore */ }
      node.phaseCount = phaseCount;
    }
    if ((row.type === 'clip' || row.type === 'knowledge') && row.bodyPlain && String(row.bodyPlain).trim()) {
      bodies.set(row.id, String(row.bodyPlain));
    }
    nodes.push(node);
    nodeIds.add(row.id);
  }
  return { nodes, nodeIds, bodies };
}

/**
 * 组装图谱。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {Set<string>|null} includeTypes 节点类型集合（如 clip/knowledge/learning-plan），null=全部
 * @returns {{nodes:Array, linkCount:number, links:Array}}
 */
function getGraph(dbConn, includeTypes) {
  const { nodes, nodeIds, bodies } = buildNodes(dbConn, includeTypes);

  // 画布可写节点：用户的视觉创作，不随 includeTypes 过滤（始终可见）
  for (const cn of canvasNode.listNodes(dbConn)) {
    const node = canvasNodeToGraphNode(cn);
    nodes.push(node);
    nodeIds.add(node.id);
  }

  const relRows = dbConn
    .prepare('SELECT from_id AS f, to_id AS t, relation_type AS type FROM relation ORDER BY id')
    .all();
  const links = [];
  for (const r of relRows) {
    if (!nodeIds.has(r.f) || !nodeIds.has(r.t)) continue;
    links.push({ source: r.f, target: r.t, type: r.type });
  }

  // 手动连线：两端节点存在则入图，type 标为 manual，便于前端区分与样式
  for (const e of canvasNode.listEdges(dbConn)) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    links.push({ source: e.source, target: e.target, type: 'manual', manualId: e.id });
  }

  // 正文 wikilink 双链入图：解析 clip/knowledge 正文里的 [[目标]]，命中节点则补一条
  // wikilink 边（与 relation 表已有的语义边去重）。目标匹配标题或文件名（忽略空白/大小写）。
  if (bodies.size > 0) {
    const linkKeys = new Set(links.map(l => l.source + '\u0000' + l.target + '\u0000' + (l.type || '')));
    const idx = buildWikilinkIndex(nodes);
    for (const [fromId, body] of bodies) {
      for (const target of extractWikilinkTargets(body)) {
        const toId = idx.resolve(target);
        if (!toId || toId === fromId) continue;
        const key = fromId + '\u0000' + toId + '\u0000' + 'linked_to';
        if (linkKeys.has(key)) continue;
        linkKeys.add(key);
        links.push({ source: fromId, target: toId, type: 'linked_to', wikilink: true });
      }
    }
  }

  return { nodes, links, linkCount: links.length };
}

/** 归一化匹配键：小写 + 去空白。 */
function normWikilinkKey(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
}

/** 构建 wikilink 目标 → 节点 id 索引（标题优先，其次文件名 basename）。 */
function buildWikilinkIndex(nodes) {
  const byTitle = new Map();
  const byBase = new Map();
  for (const n of nodes) {
    const t = normWikilinkKey(n.title);
    if (t && !byTitle.has(t)) byTitle.set(t, n.id);
    if (typeof n.contentRef === 'string' && n.contentRef) {
      const base = n.contentRef.replace(/\\/g, '/').split('/').pop().replace(/\.(md|json|txt)$/i, '');
      const b = normWikilinkKey(base);
      if (b && !byBase.has(b)) byBase.set(b, n.id);
    }
  }
  // 标题未命中时回退文件名匹配
  return {
    byTitle,
    byBase,
    resolve(target) {
      const k = normWikilinkKey(target);
      return byTitle.get(k) || byBase.get(k) || null;
    }
  };
}

/** 从正文提取 wikilink 目标列表：[[目标]] 或 [[目标|别名]]，目标可带 .md 后缀/目录前缀。 */
function extractWikilinkTargets(body) {
  const out = [];
  const re = /\[\[([^\[\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let target = m[1].split('|')[0].trim();
    if (!target) continue;
    if (target.endsWith('.md')) target = target.slice(0, -3);
    const seg = target.slice(target.lastIndexOf('/') + 1).trim();
    if (seg) out.push(seg);
  }
  return out;
}

/**
 * 查询某节点关系（出链 + 反链），供编辑器反链面板复用。
 * @returns {Array<{fromId,toId,relationType,source,confidence,createdAt}>}
 */
function relationsFor(dbConn, entityId) {
  return require('./relation-builder').findFor(dbConn, entityId);
}

module.exports = { getGraph, relationsFor };