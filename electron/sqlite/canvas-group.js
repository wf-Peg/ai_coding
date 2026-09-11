/**
 * canvas-group.js - SQLite 本地索引层：无限画布·分组 frame 层
 *
 * 属于「画布层」，与语义（content / relation）分离：
 *   - 分组是用户在画布上把多个节点圈成一束命名 frame 的视觉组织数据。
 *   - 仅存 canvas_group / canvas_group_member，不影响语义 relation，
 *     因此 relation-builder 全量重建时不会误删分组。
 *
 * 一致性「文件为真、库为缓存」：分组属于增量创作数据，只存于画布层。
 *
 * 分组本身不存独立坐标：frame 是一个「环绕其成员节点」的矩形框，
 * 拖动 frame 等价于拖动全部成员节点（成员坐标仍由 canvas_layout 持久化）。
 */

const { randomUUID } = require('node:crypto');

const now = () => new Date().toISOString();

/**
 * 读取全部分组（含成员节点 id 列表，按创建时间升序）。
 * @returns {Array<{id:string,name:string,members:string[],createdAt:string,updatedAt:string}>}
 */
function listGroups(dbConn) {
  const groups = dbConn
    .prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM canvas_group ORDER BY created_at')
    .all();
  const memberRows = dbConn
    .prepare('SELECT group_id AS gid, node_id AS nodeId FROM canvas_group_member ORDER BY node_id')
    .all();
  const byGroup = new Map();
  for (const m of memberRows) {
    if (!byGroup.has(m.gid)) byGroup.set(m.gid, []);
    byGroup.get(m.gid).push(m.nodeId);
  }
  for (const g of groups) g.members = byGroup.get(g.id) || [];
  return groups;
}

/**
 * 创建分组并登记成员。空成员 / 重复成员被忽略；无有效成员则不建组。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {{name?:string,memberIds?:string[]}} opts
 * @returns {object|null} 新建分组 {id,name,members}
 */
function createGroup(dbConn, opts = {}) {
  const memberIds = Array.from(new Set((opts.memberIds || []).filter((x) => x && typeof x === 'string')));
  if (!memberIds.length) return null;

  const id = 'group:' + randomUUID();
  const name = (opts.name != null && String(opts.name).trim()) || '未命名分组';
  const t = now();
  dbConn
    .prepare('INSERT INTO canvas_group (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, t, t);

  const stmt = dbConn.prepare('INSERT OR IGNORE INTO canvas_group_member (group_id, node_id) VALUES (?, ?)');
  for (const nid of memberIds) stmt.run(id, nid);

  return { id, name, members: memberIds };
}

/**
 * 重命名分组。
 * @returns {boolean} 是否命中
 */
function renameGroup(dbConn, id, name) {
  const exists = dbConn.prepare('SELECT id FROM canvas_group WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn.prepare('UPDATE canvas_group SET name = ?, updated_at = ? WHERE id = ?')
    .run(String(name == null ? '' : name), now(), id);
  return true;
}

/**
 * 解散分组：删除分组与其成员登记（仅拆 frame，节点本身与坐标保留）。
 * @returns {boolean} 是否命中
 */
function dissolveGroup(dbConn, id) {
  const exists = dbConn.prepare('SELECT id FROM canvas_group WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn.prepare('DELETE FROM canvas_group WHERE id = ?').run(id);
  dbConn.prepare('DELETE FROM canvas_group_member WHERE group_id = ?').run(id);
  return true;
}

/** 清空全部分组（测试与手动重置用）。 */
function clearAll(dbConn) {
  dbConn.exec('DELETE FROM canvas_group_member');
  dbConn.exec('DELETE FROM canvas_group');
}

module.exports = { listGroups, createGroup, renameGroup, dissolveGroup, clearAll };