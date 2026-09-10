/**
 * canvas-layout.js - SQLite 本地索引层：画布布局（无限画布·布局层）
 *
 * 与语义关系（relation 表）分离：relation 表示「A 和 B 有没有关系」，
 * canvas_layout 只代表「节点在画布上放在哪、属于哪个组、手动连了谁」。
 *
 * 一致性「文件为真、库为缓存」：布局属于视觉缓存，可随时清空/重建；
 * 清空后最多回退到自动布局，不会影响语义关系。
 *
 * 本期（阶段一）仅持久化节点坐标 x/y；分组与手动连线字段（group_id 等）
 * 留待阶段二/三通过 schema v4 增量扩展。
 */

/** 读取全部节点画布坐标。@returns {Map<string, {x:number,y:number}>} */
function positions(dbConn) {
  const rows = dbConn.prepare('SELECT node_id AS id, x, y FROM canvas_layout').all();
  const map = new Map();
  for (const r of rows) map.set(r.id, { x: r.x, y: r.y });
  return map;
}

/**
 * 批量保存（upsert）节点画布坐标。跳过无效条目（缺 id、坐标非有限数值）。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {Array<{id:string,x:number,y:number}>} entries
 * @returns {number} 实际写入条数
 */
function savePositions(dbConn, entries) {
  const stmt = dbConn.prepare(`
    INSERT INTO canvas_layout (node_id, x, y, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(node_id)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  let saved = 0;
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    stmt.run(e.id, e.x, e.y, now);
    saved++;
  }
  return saved;
}

/** 清空全部布局（用于测试与手动重置布局）。 */
function clearPositions(dbConn) {
  dbConn.exec('DELETE FROM canvas_layout');
}

module.exports = { positions, savePositions, clearPositions };