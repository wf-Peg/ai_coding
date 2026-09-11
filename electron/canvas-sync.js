/**
 * canvas-sync.js - 无限画布·后端持久化 + 双向自动同步
 *
 * 把「手动画布层」五张表（canvas_node / canvas_edge / canvas_layout /
 * canvas_group / canvas_group_member）以全量快照 JSON 的形式同步到后端
 * GraphController 提供的 /api/canvas（存于 clip.storage.path/graph/canvas-state.json）。
 *
 * 合并策略：last-write-wins，以快照 updatedAt 时间戳为基准（更大的覆盖旧的）。
 * 同步失败不阻塞本地：push 失败仅记日志，后续变更/进图会再补。
 *
 * 依赖 fetch（Electron 主进程 Node 18+ 全局可用）。
 */

const canvasNode = require('./sqlite/canvas-node');
const canvasLayout = require('./sqlite/canvas-layout');
const canvasGroup = require('./sqlite/canvas-group');

const SNAPSHOT_VERSION = 1;

/** 把本地 canvas 五表组装为全量快照。 */
function buildSnapshot(dbConn) {
  const nodes = canvasNode.listNodes(dbConn);
  const edges = canvasNode.listEdges(dbConn);
  const groups = canvasGroup.listGroups(dbConn);

  const layoutMap = canvasLayout.positions(dbConn); // Map<id, {x,y}>
  const layout = {};
  for (const [id, p] of layoutMap) layout[id] = { x: p.x, y: p.y };

  // updatedAt 取各表最大 updated_at；全空则用当前时间，保证快照带可比较时间戳
  let updatedAt = '';
  for (const n of nodes) if (n.updatedAt && n.updatedAt > updatedAt) updatedAt = n.updatedAt;
  for (const g of groups) if (g.updatedAt && g.updatedAt > updatedAt) updatedAt = g.updatedAt;
  if (!updatedAt) updatedAt = new Date().toISOString();

  return { nodes, edges, layout, groups, updatedAt, version: SNAPSHOT_VERSION };
}

/** 清空本地画布层全部表。 */
function wipe(dbConn) {
  canvasNode.clearAll(dbConn);
  canvasGroup.clearAll(dbConn);
}

/** 把后端快照恢复到本地画布层（整库一致替换）。 */
function restoreSnapshot(dbConn, snapshot) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const nodes = Array.isArray(s.nodes) ? s.nodes : [];
  const edges = Array.isArray(s.edges) ? s.edges : [];
  const layout = s.layout && typeof s.layout === 'object' ? s.layout : {};
  const groups = Array.isArray(s.groups) ? s.groups : [];

  const begin = dbConn.exec('BEGIN');
  try {
    wipe(dbConn);

    const insNode = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_node (id, kind, text, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const n of nodes) {
      if (!n || typeof n.id !== 'string') continue;
      insNode.run(n.id, n.kind || 'note', n.text != null ? n.text : null, n.title != null ? n.title : null,
        n.createdAt || n.created_at || new Date().toISOString(), n.updatedAt || n.updated_at || new Date().toISOString());
    }

    const insEdge = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_edge (id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const e of edges) {
      if (!e) continue;
      const from = typeof e.source === 'object' && e.source ? e.source.id : e.source;
      const to = typeof e.target === 'object' && e.target ? e.target.id : e.target;
      if (!from || !to || from === to) continue;
      insEdge.run(e.id && String(e.id).startsWith('edge:') ? e.id : 'edge:' + (e.id || `${from}->${to}`),
        from, to, e.createdAt || e.created_at || new Date().toISOString());
    }

    const insLayout = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_layout (node_id, x, y, updated_at) VALUES (?, ?, ?, ?)'
    );
    for (const id of Object.keys(layout)) {
      const p = layout[id];
      const x = Number(p && p.x);
      const y = Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      insLayout.run(id, x, y, s.updatedAt || new Date().toISOString());
    }

    const insGroup = dbConn.prepare(
      'INSERT OR REPLACE INTO canvas_group (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    );
    const insMember = dbConn.prepare(
      'INSERT OR IGNORE INTO canvas_group_member (group_id, node_id) VALUES (?, ?)'
    );
    for (const g of groups) {
      if (!g || typeof g.id !== 'string') continue;
      insGroup.run(g.id, g.name != null ? String(g.name) : '未命名分组',
        g.createdAt || g.created_at || new Date().toISOString(), g.updatedAt || g.updated_at || new Date().toISOString());
      const members = Array.isArray(g.members) ? g.members : [];
      for (const nid of members) {
        if (nid && typeof nid === 'string') insMember.run(g.id, nid);
      }
    }

    dbConn.exec('COMMIT');
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
  return { nodes: nodes.length, edges: edges.length, layout: Object.keys(layout).length, groups: groups.length };
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