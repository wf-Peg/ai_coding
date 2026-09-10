/**
 * canvas-node.js - SQLite 本地索引层：无限画布·可写节点与手动连线层
 *
 * 属于「画布层」，与语义层（content / relation）分离：
 *   - content / relation 由文件扫描 + relation-builder 维护，是「AI 语义关系」。
 *   - canvas_node / canvas_edge 由用户在画布上手工创建，是「人的视觉组织」。
 * 二者互不污染：relation-builder 全量 DELETE 重建 relation 表时不会触碰到
 * canvas_node / canvas_edge，手动连线因此不会被误删。
 *
 * 一致性「文件为真、库为缓存」：画布可写节点与手动连线属于增量创作数据，
 * 同样只存于画布层（SQLite），语义权威文件不受其影响。
 *
 * 节点种类 kind：note（便签）/ link（链接）/ image（图片）/ ref（引用已有节点）。
 */

const { randomUUID } = require('node:crypto');
const canvasLayout = require('./canvas-layout');

const KINDS = ['note', 'link', 'image', 'ref'];

const now = () => new Date().toISOString();

/** 读取全部画布可写节点（按创建时间升序）。 */
function listNodes(dbConn) {
  return dbConn
    .prepare('SELECT id, kind, text, title, created_at AS createdAt, updated_at AS updatedAt FROM canvas_node ORDER BY created_at')
    .all();
}

/** 读取全部手动连线。@returns {Array<{id,source,target,createdAt}>} */
function listEdges(dbConn) {
  return dbConn
    .prepare('SELECT id, from_id AS source, to_id AS target, created_at AS createdAt FROM canvas_edge ORDER BY created_at')
    .all();
}

/**
 * 创建一个画布可写节点，并写入初始坐标。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {{kind:string,text?:string,title?:string,x?:number,y?:number}} opts
 * @returns {object} 新建节点（含 id/kind/text/title/x/y）
 */
function createNode(dbConn, opts = {}) {
  const kind = opts.kind;
  if (!KINDS.includes(kind)) throw new Error('invalid canvas node kind: ' + kind);

  const id = kind + ':' + randomUUID();
  const t = now();
  dbConn
    .prepare('INSERT INTO canvas_node (id, kind, text, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kind, opts.text != null ? opts.text : null, opts.title != null ? opts.title : null, t, t);

  const x = Number.isFinite(opts.x) ? opts.x : 0;
  const y = Number.isFinite(opts.y) ? opts.y : 0;
  canvasLayout.savePositions(dbConn, [{ id, x, y }]);

  return { id, kind, text: opts.text != null ? opts.text : null, title: opts.title != null ? opts.title : null, x, y };
}

/**
 * 更新画布可写节点内容（text/title）。
 * @returns {boolean} 是否命中更新
 */
function updateNode(dbConn, id, opts = {}) {
  const exists = dbConn.prepare('SELECT id FROM canvas_node WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn
    .prepare('UPDATE canvas_node SET text = ?, title = ?, updated_at = ? WHERE id = ?')
    .run(opts.text != null ? opts.text : null, opts.title != null ? opts.title : null, now(), id);
  return true;
}

/**
 * 删除画布可写节点，并级联清理其布局坐标与关联连线。
 * @returns {boolean} 是否命中删除
 */
function deleteNode(dbConn, id) {
  const exists = dbConn.prepare('SELECT id FROM canvas_node WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn.prepare('DELETE FROM canvas_node WHERE id = ?').run(id);
  dbConn.prepare('DELETE FROM canvas_layout WHERE node_id = ?').run(id);
  dbConn.prepare('DELETE FROM canvas_edge WHERE from_id = ? OR to_id = ?').run(id, id);
  return true;
}

/** 校验某 id 是否为画布节点或语义内容节点。 */
function nodeExists(dbConn, id) {
  if (dbConn.prepare('SELECT 1 FROM content WHERE id = ?').get(id)) return true;
  if (dbConn.prepare('SELECT 1 FROM canvas_node WHERE id = ?').get(id)) return true;
  return false;
}

/**
 * 创建一条手动连线（幂等：同向已存在则返回已有）。
 * @returns {object|null} { id, source, target }；端点缺失/自环返回 null
 */
function createEdge(dbConn, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return null;
  if (!nodeExists(dbConn, fromId) || !nodeExists(dbConn, toId)) return null;

  const existing = dbConn.prepare('SELECT id FROM canvas_edge WHERE from_id = ? AND to_id = ?').get(fromId, toId);
  if (existing) return { id: existing.id, source: fromId, target: toId };

  const id = 'edge:' + randomUUID();
  dbConn
    .prepare('INSERT INTO canvas_edge (id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, fromId, toId, now());
  return { id, source: fromId, target: toId };
}

/**
 * 删除一条手动连线。
 * @returns {boolean} 是否命中删除
 */
function deleteEdge(dbConn, id) {
  const exists = dbConn.prepare('SELECT id FROM canvas_edge WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn.prepare('DELETE FROM canvas_edge WHERE id = ?').run(id);
  return true;
}

/** 清空全部画布可写节点与手动连线（测试与手动重置用）。 */
function clearAll(dbConn) {
  dbConn.exec('DELETE FROM canvas_node');
  dbConn.exec('DELETE FROM canvas_edge');
  canvasLayout.clearPositions(dbConn);
}

module.exports = { listNodes, listEdges, createNode, updateNode, deleteNode, createEdge, deleteEdge, clearAll };