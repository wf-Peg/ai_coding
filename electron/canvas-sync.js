/**
 * canvas-sync.js - 无限画布·后端持久化 + 双向自动同步
 *
 * 把「手动画布层」的表（canvas_doc / canvas_node / canvas_edge / canvas_layout /
 * canvas_group / canvas_group_member）以全量快照 JSON 的形式同步到后端
 * GraphController 提供的 /api/canvas（存于 clip.storage.path/graph/canvas-state.json）。
 *
 * v3 快照：新增 ink（手绘墨迹，每笔带 docId），updatedAt 纳入墨迹时间戳。
 * v2 快照（无 docs/docId）仍可恢复：全部归入默认文档 doc:default，
 *          order_index 按原顺序补号，保证老用户跨端数据不丢、大纲可用。
 * v3 快照（无 ink / 非法笔迹）仍可恢复：墨迹视为空数组，整笔跳过而非整批失败。
 *
 * 合并策略：last-write-wins，以快照 updatedAt 时间戳为基准（更大的覆盖旧的）。
 * 同步失败不阻塞本地：push 失败仅记日志，后续变更/进图会再补。
 *
 * 依赖 fetch（Electron 主进程 Node 18+ 全局可用）。
 */

const canvasNode = require('./sqlite/canvas-node');
const canvasLayout = require('./sqlite/canvas-layout');
const canvasGroup = require('./sqlite/canvas-group');
const canvasDoc = require('./sqlite/canvas-doc');
const canvasInk = require('./sqlite/canvas-ink');

const SNAPSHOT_VERSION = 3;

/** 把本地画布各表组装为全量快照。 */
function buildSnapshot(dbConn) {
  const docs = canvasDoc.listDocs(dbConn).map((d) => ({
    id: d.id,
    title: d.title,
    sortIndex: d.sortIndex,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  }));
  const nodes = canvasNode.listNodes(dbConn);
  const edges = canvasNode.listEdges(dbConn);
  const groups = canvasGroup.listGroups(dbConn);
  const ink = canvasInk.listInk(dbConn); // 全量（每笔带 docId，供按文档恢复隔离）

  const layoutMap = canvasLayout.positions(dbConn); // Map<id, {x,y}>
  const layout = {};
  for (const [id, p] of layoutMap) layout[id] = { x: p.x, y: p.y };

  // updatedAt 取各表最大 updated_at（含墨迹：只画笔迹时快照时间戳也必须前进）；
  // 全空则用当前时间，保证快照带可比较时间戳
  let updatedAt = '';
  for (const d of docs) if (d.updatedAt && d.updatedAt > updatedAt) updatedAt = d.updatedAt;
  for (const n of nodes) if (n.updatedAt && n.updatedAt > updatedAt) updatedAt = n.updatedAt;
  for (const g of groups) if (g.updatedAt && g.updatedAt > updatedAt) updatedAt = g.updatedAt;
  for (const k of ink) if (k.updatedAt && k.updatedAt > updatedAt) updatedAt = k.updatedAt;
  if (!updatedAt) updatedAt = new Date().toISOString();

  return { docs, nodes, edges, layout, groups, ink, updatedAt, version: SNAPSHOT_VERSION };
}

/**
 * 清空本地画布内容表（节点/连线/坐标/分组/墨迹）。
 * 刻意保留 canvas_doc：文档列表由 restoreSnapshot 按快照对齐，避免中间态丢失默认文档。
 * 墨迹必须与画布内容一起清空：否则 pull 覆盖本地时，快照里没有的旧墨迹会残留成"幽灵墨迹"。
 */
function wipe(dbConn) {
  canvasNode.clearAll(dbConn);
  canvasGroup.clearAll(dbConn);
  canvasInk.clearAll(dbConn);
}

/**
 * 把后端快照恢复到本地画布层（整库一致替换）。
 * v1 快照（无 docs/docId）向后兼容：全部归入 doc:default，order_index 顺序补号。
 */
function restoreSnapshot(dbConn, snapshot) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const nodes = Array.isArray(s.nodes) ? s.nodes : [];
  const edges = Array.isArray(s.edges) ? s.edges : [];
  const layout = s.layout && typeof s.layout === 'object' ? s.layout : {};
  const groups = Array.isArray(s.groups) ? s.groups : [];
  const ink = Array.isArray(s.ink) ? s.ink : []; // v2 快照无 ink → 空数组，可正常恢复
  const stamp = s.updatedAt || new Date().toISOString();

  // 文档清单：v1 快照无 docs → 兜底为仅默认文档
  const docs = (Array.isArray(s.docs) ? s.docs : [])
    .filter((d) => d && typeof d.id === 'string' && d.id)
    .map((d, i) => ({
      id: d.id,
      title: d.title != null ? String(d.title) : canvasDoc.DEFAULT_DOC_TITLE,
      sortIndex: Number.isFinite(d.sortIndex) ? d.sortIndex : i,
      createdAt: d.createdAt || d.created_at || stamp,
      updatedAt: d.updatedAt || d.updated_at || stamp
    }));
  if (!docs.length) {
    docs.push({
      id: canvasDoc.DEFAULT_DOC_ID,
      title: canvasDoc.DEFAULT_DOC_TITLE,
      sortIndex: 0,
      createdAt: stamp,
      updatedAt: stamp
    });
  }
  const docIds = new Set(docs.map((d) => d.id));

  // 节点→文档映射：显式 docId 优先，否则归默认文档；供连线/分组归属推导与父节点校验
  const nodeDoc = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string') continue;
    const docId = n.docId && docIds.has(n.docId) ? n.docId : canvasDoc.DEFAULT_DOC_ID;
    nodeDoc.set(n.id, docId);
  }

  dbConn.exec('BEGIN');
  try {
    wipe(dbConn);

    // 文档：本地严格对齐快照（删除快照中不存在的文档；内容表已在上一步清空，不留孤儿）
    dbConn
      .prepare(`DELETE FROM canvas_doc WHERE id NOT IN (${docs.map(() => '?').join(', ')})`)
      .run(...docs.map((d) => d.id));
    const insDoc = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_doc (id, title, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const d of docs) insDoc.run(d.id, d.title, d.sortIndex, d.createdAt, d.updatedAt);

    const insNode = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_node (id, kind, text, title, doc_id, parent_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const counters = new Map(); // docId → 已用 order_index 上界
    for (const n of nodes) {
      if (!n || typeof n.id !== 'string') continue;
      const docId = nodeDoc.get(n.id) || canvasDoc.DEFAULT_DOC_ID;
      let orderIndex = Number.isFinite(n.orderIndex) ? n.orderIndex : null;
      if (orderIndex == null) {
        orderIndex = counters.get(docId) || 0;
        counters.set(docId, orderIndex + 1);
      } else {
        counters.set(docId, Math.max(counters.get(docId) || 0, orderIndex + 1));
      }
      const rawParent = n.parentId != null ? String(n.parentId) : null;
      const parentId = rawParent && nodeDoc.get(rawParent) === docId ? rawParent : null;
      insNode.run(n.id, n.kind || 'note', n.text != null ? n.text : null, n.title != null ? n.title : null,
        docId, parentId, orderIndex, n.createdAt || n.created_at || stamp, n.updatedAt || n.updated_at || stamp);
    }

    const insEdge = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_edge (id, from_id, to_id, doc_id, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const e of edges) {
      if (!e) continue;
      const from = typeof e.source === 'object' && e.source ? e.source.id : e.source;
      const to = typeof e.target === 'object' && e.target ? e.target.id : e.target;
      if (!from || !to || from === to) continue;
      const docId = (e.docId && docIds.has(e.docId))
        ? e.docId
        : (nodeDoc.get(from) || nodeDoc.get(to) || canvasDoc.DEFAULT_DOC_ID);
      insEdge.run(e.id && String(e.id).startsWith('edge:') ? e.id : 'edge:' + (e.id || `${from}->${to}`),
        from, to, docId, e.createdAt || e.created_at || stamp);
    }

    const insLayout = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_layout (node_id, x, y, updated_at) VALUES (?, ?, ?, ?)'
    );
    for (const id of Object.keys(layout)) {
      const p = layout[id];
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      insLayout.run(id, x, y, stamp);
    }

    const insGroup = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_group (id, name, doc_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insMember = dbConn.prepare(
      'INSERT OR IGNORE INTO canvas_group_member (group_id, node_id) VALUES (?, ?)'
    );
    for (const g of groups) {
      if (!g || typeof g.id !== 'string') continue;
      const members = Array.isArray(g.members) ? g.members : [];
      const docId = (g.docId && docIds.has(g.docId))
        ? g.docId
        : (members.map((m) => nodeDoc.get(m)).find(Boolean) || canvasDoc.DEFAULT_DOC_ID);
      insGroup.run(g.id, g.name != null ? String(g.name) : '未命名分组', docId,
        g.createdAt || g.created_at || stamp, g.updatedAt || g.updated_at || stamp);
      for (const nid of members) {
        if (nid && typeof nid === 'string') insMember.run(g.id, nid);
      }
    }

    // 墨迹：docId 不在快照 docs 内 → 归默认文档；points 非法则跳过该笔（而非整批失败）
    const insInk = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_ink (id, doc_id, color, width, opacity, points, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let inkCount = 0;
    for (const k of ink) {
      if (!k || typeof k.id !== 'string' || !k.id) continue;
      if (!canvasInk.validPoints(k.points)) continue;
      const docId = (k.docId && docIds.has(k.docId)) ? k.docId : canvasDoc.DEFAULT_DOC_ID;
      insInk.run(k.id, docId,
        k.color != null ? String(k.color) : null,
        k.width != null ? Number(k.width) : null,
        k.opacity != null ? Number(k.opacity) : null,
        JSON.stringify(k.points),
        Number.isFinite(k.sortIndex) ? k.sortIndex : inkCount,
        k.createdAt || k.created_at || stamp,
        k.updatedAt || k.updated_at || stamp);
      inkCount++;
    }

    dbConn.exec('COMMIT');
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
  return {
    docs: docs.length,
    nodes: nodes.length,
    edges: edges.length,
    layout: Object.keys(layout).length,
    groups: groups.length,
    ink: inkCount
  };
}

/** 组装并初始化同步器。@returns {{schedulePush, pullSnapshot, buildSnapshot, restoreSnapshot}} */
function initCanvasSync(opts) {
  const { dbConn, baseUrl, log } = opts || {};
  const logger = log || console;

  const apiUrl = (baseUrl || 'http://127.0.0.1:8081').replace(/\/+$/, '') + '/api/canvas';

  let timer = null;

  function schedulePush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pushSnapshot().catch(() => {});
    }, 400);
  }

  async function pushSnapshot() {
    const db = typeof dbConn === 'function' ? dbConn() : dbConn;
    if (!db) return { success: false, message: 'local index not ready' };
    let snapshot;
    try {
      snapshot = buildSnapshot(db);
    } catch (e) {
      logger.warn('[canvas-sync] buildSnapshot failed:', e.message);
      return { success: false, message: e.message };
    }
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot)
      });
      if (!resp.ok) {
        logger.warn('[canvas-sync] push failed: HTTP', resp.status);
        return { success: false, status: resp.status };
      }
      return { success: true };
    } catch (e) {
      logger.warn('[canvas-sync] push error:', e.message);
      return { success: false, message: e.message };
    }
  }

  async function pullSnapshot() {
    const db = typeof dbConn === 'function' ? dbConn() : dbConn;
    if (!db) return { success: false, message: 'local index not ready' };
    let remote;
    try {
      const resp = await fetch(apiUrl);
      if (!resp.ok) return { success: false, status: resp.status };
      remote = await resp.json();
    } catch (e) {
      logger.warn('[canvas-sync] pull error:', e.message);
      return { success: false, message: e.message };
    }
    if (!remote || remote.updatedAt == null) {
      // 后端无快照：以本地为准，反向补推（保证至少一端有数据）
      return pushSnapshot();
    }
    const local = buildSnapshot(db);
    if (String(remote.updatedAt) > String(local.updatedAt)) {
      // 后端更新 → 恢复覆盖本地
      try {
        const restored = restoreSnapshot(db, remote);
        logger.info('[canvas-sync] restored from backend:', JSON.stringify(restored));
        return { success: true, restored: true, counts: restored };
      } catch (e) {
        logger.warn('[canvas-sync] restore failed:', e.message);
        return { success: false, message: e.message };
      }
    } else if (String(remote.updatedAt) < String(local.updatedAt)) {
      // 本地更新 → 反向推后端
      return pushSnapshot();
    }
    // 时间戳相等 → 无操作
    return { success: true, unchanged: true };
  }

  return { schedulePush, pushSnapshot, pullSnapshot, buildSnapshot, restoreSnapshot };
}

module.exports = { initCanvasSync, buildSnapshot, restoreSnapshot };