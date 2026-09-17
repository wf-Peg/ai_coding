/**
 * canvas-doc.js - SQLite 本地索引层：无限画布·文档层（多画布）
 *
 * 属于「画布层」，与语义（content / relation）分离：
 *   - canvas_doc 是用户的多块画布（对标幕布的「文档列表」）。
 *   - canvas_node / canvas_edge / canvas_group 通过 doc_id 归属到某个文档，
 *     切换文档即只加载该文档的节点、连线、分组与坐标。
 *
 * 一致性「文件为真、库为缓存」：文档与其内容属增量创作数据，只存于画布层。
 *
 * 默认文档固定为 doc:default（标题「我的画布」）：v7 迁移把历史单画布数据
 * 全部回填到该文档，保证升级后用户看到的内容与升级前一致。
 */

const { randomUUID } = require('node:crypto');

const DEFAULT_DOC_ID = 'doc:default';
const DEFAULT_DOC_TITLE = '我的画布';

const now = () => new Date().toISOString();

/** 读取全部画布文档（按 sort_index 升序，附节点数避免列表页 N+1 查询）。 */
function listDocs(dbConn) {
  const docs = dbConn
    .prepare(`
      SELECT id, title, sort_index AS sortIndex, created_at AS createdAt, updated_at AS updatedAt
      FROM canvas_doc
      ORDER BY sort_index, created_at
    `)
    .all();
  const counts = new Map(
    dbConn
      .prepare('SELECT doc_id AS docId, COUNT(*) AS c FROM canvas_node GROUP BY doc_id')
      .all()
      .map((r) => [r.docId, r.c])
  );
  for (const d of docs) d.nodeCount = counts.get(d.id) || 0;
  return docs;
}

/** 读取单个画布文档；不存在返回 null。 */
function getDoc(dbConn, id) {
  const row = dbConn
    .prepare('SELECT id, title, sort_index AS sortIndex, created_at AS createdAt, updated_at AS updatedAt FROM canvas_doc WHERE id = ?')
    .get(id);
  return row || null;
}

/**
 * 新建画布文档（sort_index 追加到末尾）。
 * @param {{title?:string}} opts
 * @returns {{id:string,title:string,sortIndex:number,createdAt:string,updatedAt:string,nodeCount:number}}
 */
function createDoc(dbConn, opts = {}) {
  const id = 'doc:' + randomUUID();
  const title = (opts.title != null && String(opts.title).trim()) || '未命名画布';
  const maxRow = dbConn.prepare('SELECT MAX(sort_index) AS maxIndex FROM canvas_doc').get();
  const maxIndex = maxRow && Number.isFinite(maxRow.maxIndex) ? maxRow.maxIndex : -1;
  const t = now();
  dbConn
    .prepare('INSERT INTO canvas_doc (id, title, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, title, maxIndex + 1, t, t);
  return { id, title, sortIndex: maxIndex + 1, createdAt: t, updatedAt: t, nodeCount: 0 };
}

/** 重命名画布文档。@returns {boolean} 是否命中 */
function renameDoc(dbConn, id, title) {
  const exists = dbConn.prepare('SELECT id FROM canvas_doc WHERE id = ?').get(id);
  if (!exists) return false;
  const next = String(title == null ? '' : title).trim();
  dbConn
    .prepare('UPDATE canvas_doc SET title = ?, updated_at = ? WHERE id = ?')
    .run(next || '未命名画布', now(), id);
  return true;
}

/**
 * 删除画布文档，并级联清理其节点、坐标、连线、分组与分组成员。
 * 至少保留一个文档：最后一个文档不允许删除。
 * @returns {{success:boolean, message?:string, removed?:object}}
 */
function deleteDoc(dbConn, id) {
  const exists = dbConn.prepare('SELECT id FROM canvas_doc WHERE id = ?').get(id);
  if (!exists) return { success: false, message: '文档不存在' };
  const total = dbConn.prepare('SELECT COUNT(*) AS c FROM canvas_doc').get();
  if (total && total.c <= 1) return { success: false, message: '至少保留一个画布文档' };

  const removed = { nodes: 0, edges: 0, groups: 0, layout: 0 };
  dbConn.exec('BEGIN');
  try {
    const nodeRows = dbConn.prepare('SELECT id FROM canvas_node WHERE doc_id = ?').all(id);
    const groupRows = dbConn.prepare('SELECT id FROM canvas_group WHERE doc_id = ?').all(id);

    const delLayout = dbConn.prepare('DELETE FROM canvas_layout WHERE node_id = ?');
    for (const n of nodeRows) removed.layout += delLayout.run(n.id).changes || 0;

    const delMemberByGroup = dbConn.prepare('DELETE FROM canvas_group_member WHERE group_id = ?');
    for (const g of groupRows) delMemberByGroup.run(g.id);
    const delMemberByNode = dbConn.prepare('DELETE FROM canvas_group_member WHERE node_id = ?');
    for (const n of nodeRows) delMemberByNode.run(n.id);

    removed.groups = dbConn.prepare('DELETE FROM canvas_group WHERE doc_id = ?').run(id).changes || 0;
    removed.edges = dbConn
      .prepare('DELETE FROM canvas_edge WHERE doc_id = ? OR from_id IN (SELECT id FROM canvas_node WHERE doc_id = ?) OR to_id IN (SELECT id FROM canvas_node WHERE doc_id = ?)')
      .run(id, id, id).changes || 0;
    removed.nodes = dbConn.prepare('DELETE FROM canvas_node WHERE doc_id = ?').run(id).changes || 0;
    dbConn.prepare('DELETE FROM canvas_doc WHERE id = ?').run(id);

    dbConn.exec('COMMIT');
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
  return { success: true, removed };
}

/**
 * 确保默认文档存在（迁移回填与启动兜底共用）。
 * @returns {boolean} 是否本次新建
 */
function ensureDefaultDoc(dbConn) {
  const exists = dbConn.prepare('SELECT id FROM canvas_doc WHERE id = ?').get(DEFAULT_DOC_ID);
  if (exists) return false;
  const t = now();
  dbConn
    .prepare('INSERT OR IGNORE INTO canvas_doc (id, title, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(DEFAULT_DOC_ID, DEFAULT_DOC_TITLE, 0, t, t);
  return true;
}

/** 刷新文档 updated_at（写入画布内容后调用，供快照时间戳比较）。 */
function touch(dbConn, id) {
  dbConn.prepare('UPDATE canvas_doc SET updated_at = ? WHERE id = ?').run(now(), id);
}

/** 清空全部文档（仅测试/手动重置用；清后自动补回默认文档）。 */
function clearAll(dbConn) {
  dbConn.exec('DELETE FROM canvas_doc');
  ensureDefaultDoc(dbConn);
}

module.exports = {
  DEFAULT_DOC_ID,
  DEFAULT_DOC_TITLE,
  listDocs,
  getDoc,
  createDoc,
  renameDoc,
  deleteDoc,
  ensureDefaultDoc,
  touch,
  clearAll
};
