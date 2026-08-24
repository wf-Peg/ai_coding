/**
 * graph.js - SQLite 本地索引层：图谱查询（节点 + 边）
 *
 * 对齐全量后端 GET /api/graph 的返回契约：
 *   { nodes: [{id,type,sourceId,title,summary,category,tags,linkedCount,sourceCount,phaseCount}],
 *     links: [{source,target,type}] }
 *
 * 节点来自 content 表（clip / knowledge / learning-plan），
 * 边来自 relation 表。仅返回两端节点都存在且在 includeTypes 内的边。
 */

/** 抽取节点元信息（含关系计数）。 */
function buildNodes(dbConn, includeTypes) {
  const contentRows = dbConn
    .prepare('SELECT id, type, source_id AS sourceId, title, summary, category, tags, content_ref AS contentRef FROM content')
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
      sourceCount: inCount.get(row.id) || 0
    };
    if (row.type === 'learning-plan') {
      // 对齐后端：plan 节点额外给 phaseCount（从 content_ref 解析 phases 数量）
      let phaseCount = 0;
      try { const raw = JSON.parse(row.contentRef); if (raw && Array.isArray(raw.phases)) phaseCount = raw.phases.length; }
      catch (e) { /* ignore */ }
      node.phaseCount = phaseCount;
    }
    nodes.push(node);
    nodeIds.add(row.id);
  }
  return { nodes, nodeIds };
}

/**
 * 组装图谱。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {Set<string>|null} includeTypes 节点类型集合（如 clip/knowledge/learning-plan），null=全部
 * @returns {{nodes:Array, linkCount:number, links:Array}}
 */
function getGraph(dbConn, includeTypes) {
  const { nodes, nodeIds } = buildNodes(dbConn, includeTypes);

  const relRows = dbConn
    .prepare('SELECT from_id AS f, to_id AS t, relation_type AS type FROM relation ORDER BY id')
    .all();
  const links = [];
  for (const r of relRows) {
    if (!nodeIds.has(r.f) || !nodeIds.has(r.t)) continue;
    links.push({ source: r.f, target: r.t, type: r.type });
  }
  return { nodes, links, linkCount: links.length };
}

/**
 * 查询某节点关系（出链 + 反链），供编辑器反链面板复用。
 * @returns {Array<{fromId,toId,relationType,source,confidence,createdAt}>}
 */
function relationsFor(dbConn, entityId) {
  return require('./relation-builder').findFor(dbConn, entityId);
}

module.exports = { getGraph, relationsFor };