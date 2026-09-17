/**
 * canvas-node.js - SQLite 本地索引层：无限画布·可写节点与手动连线层
 *
 * 属于「画布层」，与语义层（content / relation）分离：
 *   - content / relation 由文件扫描 + relation-builder 维护，是「AI 语义关系」。
 *   - canvas_node / canvas_edge 由用户在画布上手工创建，是「人的视觉组织」。
 * 二者互不污染：relation-builder 全量 DELETE 重建 relation 表时不会触碰到
 * canvas_node / canvas_edge，手动连线因此不会被误删。
 *
 * v7 起：节点归属某个画布文档（doc_id），并携带层级大纲结构
 * （parent_id / order_index，由大纲编辑器维护，属「结构真源」）；
 * 坐标仍存 canvas_layout（视觉缓存，可随时按大纲重算）。
 *
 * 一致性「文件为真、库为缓存」：画布可写节点与手动连线属于增量创作数据，
 * 同样只存于画布层（SQLite），语义权威文件不受其影响。
 *
 * 节点种类 kind：note（便签）/ link（链接）/ image（图片）/ ref（引用已有节点）。
 */

const { randomUUID } = require('node:crypto');
const canvasLayout = require('./canvas-layout');
const canvasDoc = require('./canvas-doc');

const KINDS = ['note', 'link', 'image', 'ref'];

const now = () => new Date().toISOString();

/**
 * 读取画布可写节点。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} [docId] 指定文档；不传则返回全部文档的节点（图谱等全局场景用）
 * @returns {Array<{id,kind,text,title,docId,parentId,orderIndex,createdAt,updatedAt}>}
 */
function listNodes(dbConn, docId) {
  const base = `
    SELECT id, kind, text, title,
           doc_id     AS docId,
           parent_id  AS parentId,
           order_index AS orderIndex,
           created_at AS createdAt, updated_at AS updatedAt
    FROM canvas_node
  `;
  const order = ' ORDER BY order_index IS NULL, order_index, created_at';
  if (docId) {
    return dbConn.prepare(base + ' WHERE doc_id = ?' + order).all(docId);
  }
  return dbConn.prepare(base + order).all();
}

/**
 * 读取手动连线。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} [docId] 指定文档；不传则返回全部
 * @returns {Array<{id,source,target,docId,createdAt}>}
 */
function listEdges(dbConn, docId) {
  const base = 'SELECT id, from_id AS source, to_id AS target, doc_id AS docId, created_at AS createdAt FROM canvas_edge';
  const order = ' ORDER BY created_at';
  if (docId) {
    return dbConn.prepare(base + ' WHERE doc_id = ?' + order).all(docId);
  }
  return dbConn.prepare(base + order).all();
}

/** 该文档内下一个 order_index（追加到末尾）。 */
function nextOrderIndex(dbConn, docId) {
  const row = dbConn
    .prepare('SELECT MAX(order_index) AS maxIndex FROM canvas_node WHERE doc_id = ?')
    .get(docId);
  const maxIndex = row && Number.isFinite(row.maxIndex) ? row.maxIndex : -1;
  return maxIndex + 1;
}

/**
 * 创建一个画布可写节点，并写入初始坐标与层级位置。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {{kind:string,text?:string,title?:string,x?:number,y?:number,docId?:string,parentId?:string|null,orderIndex?:number}} opts
 * @returns {object} 新建节点（含 id/kind/text/title/x/y/docId/parentId/orderIndex）
 */
function createNode(dbConn, opts = {}) {
  const kind = opts.kind;
  if (!KINDS.includes(kind)) throw new Error('invalid canvas node kind: ' + kind);

  const docId = (opts.docId && String(opts.docId)) || canvasDoc.DEFAULT_DOC_ID;
  const parentId = opts.parentId ? String(opts.parentId) : null;
  const orderIndex = Number.isFinite(opts.orderIndex) ? opts.orderIndex : nextOrderIndex(dbConn, docId);

  const id = kind + ':' + randomUUID();
  const t = now();
  dbConn
    .prepare('INSERT INTO canvas_node (id, kind, text, title, doc_id, parent_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, kind, opts.text != null ? opts.text : null, opts.title != null ? opts.title : null,
      docId, parentId, orderIndex, t, t);

  const x = Number.isFinite(opts.x) ? opts.x : 0;
  const y = Number.isFinite(opts.y) ? opts.y : 0;
  canvasLayout.savePositions(dbConn, [{ id, x, y }]);
  if (docId === canvasDoc.DEFAULT_DOC_ID) canvasDoc.ensureDefaultDoc(dbConn);
  canvasDoc.touch(dbConn, docId);

  return {
    id, kind,
    text: opts.text != null ? opts.text : null,
    title: opts.title != null ? opts.title : null,
    docId, parentId, orderIndex, x, y
  };
}

/**
 * 更新画布可写节点内容（text/title）。
 * @returns {boolean} 是否命中更新
 */
function updateNode(dbConn, id, opts = {}) {
  const exists = dbConn.prepare('SELECT doc_id AS docId FROM canvas_node WHERE id = ?').get(id);
  if (!exists) return false;
  dbConn
    .prepare('UPDATE canvas_node SET text = ?, title = ?, updated_at = ? WHERE id = ?')
    .run(opts.text != null ? opts.text : null, opts.title != null ? opts.title : null, now(), id);
  canvasDoc.touch(dbConn, exists.docId || canvasDoc.DEFAULT_DOC_ID);
  return true;
}

/** 收集某节点的全部后代 id（不含自身），供「删除子树」与 UI 提示复用。 */
function descendantIds(dbConn, id) {
  const rows = dbConn.prepare('SELECT id, parent_id AS parentId FROM canvas_node').all();
  const childrenOf = new Map();
  for (const r of rows) {
    if (!r.parentId) continue;
    if (!childrenOf.has(r.parentId)) childrenOf.set(r.parentId, []);
    childrenOf.get(r.parentId).push(r.id);
  }
  const out = [];
  const stack = (childrenOf.get(id) || []).slice();
  const seen = new Set([id]);
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    const kids = childrenOf.get(cur);
    if (kids) stack.push(...kids);
  }
  return out;
}

/**
 * 删除画布可写节点，并级联清理其子树、布局坐标与关联连线。
 * @returns {boolean} 是否命中删除
 */
function deleteNode(dbConn, id) {
  const row = dbConn.prepare('SELECT id, doc_id AS docId FROM canvas_node WHERE id = ?').get(id);
  if (!row) return false;

  const targets = [id].concat(descendantIds(dbConn, id));
  dbConn.exec('BEGIN');
  try {
    const delLayout = dbConn.prepare('DELETE FROM canvas_layout WHERE node_id = ?');
    const delEdge = dbConn.prepare('DELETE FROM canvas_edge WHERE from_id = ? OR to_id = ?');
    const delMember = dbConn.prepare('DELETE FROM canvas_group_member WHERE node_id = ?');
    const delNode = dbConn.prepare('DELETE FROM canvas_node WHERE id = ?');
    for (const nid of targets) {
      delLayout.run(nid);
      delEdge.run(nid, nid);
      delMember.run(nid);
      delNode.run(nid);
    }
    dbConn.exec('COMMIT');
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
  canvasDoc.touch(dbConn, row.docId || canvasDoc.DEFAULT_DOC_ID);
  return true;
}

/**
 * 批量保存层级结构（大纲的缩进/移动/排序）：只写传入的行，一个事务一次落库。
 * 校验：父节点必须同属该文档；父链回溯检测环，非法则整体拒绝（不做部分写入）。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} docId
 * @param {Array<{id:string,parentId?:string|null,orderIndex?:number}>} entries
 * @returns {{success:boolean,saved:number,message?:string}}
 */
function saveStructure(dbConn, docId, entries) {
  const doc = (docId && String(docId)) || canvasDoc.DEFAULT_DOC_ID;
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.id === 'string') : [];
  if (!list.length) return { success: true, saved: 0 };

  const current = new Map(
    dbConn
      .prepare('SELECT id, parent_id AS parentId FROM canvas_node WHERE doc_id = ?')
      .all(doc)
      .map((r) => [r.id, r.parentId || null])
  );

  const proposed = new Map();
  for (const e of list) proposed.set(e.id, e.parentId ? String(e.parentId) : null);

  const parentOf = (id) => (proposed.has(id) ? proposed.get(id) : (current.has(id) ? current.get(id) : null));

  for (const e of list) {
    if (!current.has(e.id)) return { success: false, saved: 0, message: '节点不存在或不属于该文档: ' + e.id };
    const parentId = proposed.get(e.id);
    if (parentId && parentId === e.id) return { success: false, saved: 0, message: '节点不能成为自己的父节点' };
    if (parentId && !current.has(parentId)) {
      return { success: false, saved: 0, message: '父节点不存在或不属于该文档: ' + parentId };
    }
    let cursor = parentId;
    const seen = new Set([e.id]);
    while (cursor) {
      if (seen.has(cursor)) return { success: false, saved: 0, message: '层级存在环，已拒绝' };
      seen.add(cursor);
      cursor = parentOf(cursor);
    }
  }

  dbConn.exec('BEGIN');
  let saved = 0;
  try {
    const stmt = dbConn.prepare(
      'UPDATE canvas_node SET parent_id = ?, order_index = COALESCE(?, order_index), updated_at = ? WHERE id = ? AND doc_id = ?'
    );
    const t = now();
    for (const e of list) {
      const orderIndex = Number.isFinite(e.orderIndex) ? e.orderIndex : null;
      saved += stmt.run(proposed.get(e.id), orderIndex, t, e.id, doc).changes || 0;
    }
    dbConn.exec('COMMIT');
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
  canvasDoc.touch(dbConn, doc);
  return { success: true, saved };
}

/** 校验某 id 是否为画布节点或语义内容节点。 */
function nodeExists(dbConn, id) {
  if (dbConn.prepare('SELECT 1 FROM content WHERE id = ?').get(id)) return true;
  if (dbConn.prepare('SELECT 1 FROM canvas_node WHERE id = ?').get(id)) return true;
  return false;
}

/** 取某节点所属文档（非画布节点返回 null）。 */
function docIdOfNode(dbConn, id) {
  const row = dbConn.prepare('SELECT doc_id AS docId FROM canvas_node WHERE id = ?').get(id);
  return row ? row.docId : null;
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

  const docId = docIdOfNode(dbConn, fromId) || docIdOfNode(dbConn, toId) || canvasDoc.DEFAULT_DOC_ID;
  const id = 'edge:' + randomUUID();
  dbConn
    .prepare('INSERT INTO canvas_edge (id, from_id, to_id, doc_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, fromId, toId, docId, now());
  canvasDoc.touch(dbConn, docId);
  return { id, source: fromId, target: toId };
}

/**
 * 删除一条手动连线。
 * @returns {boolean} 是否命中删除
 */
function deleteEdge(dbConn, id) {
  const row = dbConn.prepare('SELECT doc_id AS docId FROM canvas_edge WHERE id = ?').get(id);
  if (!row) return false;
  dbConn.prepare('DELETE FROM canvas_edge WHERE id = ?').run(id);
  canvasDoc.touch(dbConn, row.docId || canvasDoc.DEFAULT_DOC_ID);
  return true;
}

/** 清空全部画布可写节点与手动连线（测试与手动重置用）。 */
function clearAll(dbConn) {
  dbConn.exec('DELETE FROM canvas_node');
  dbConn.exec('DELETE FROM canvas_edge');
  canvasLayout.clearPositions(dbConn);
}

module.exports = {
  KINDS,
  listNodes,
  listEdges,
  createNode,
  updateNode,
  deleteNode,
  descendantIds,
  saveStructure,
  docIdOfNode,
  createEdge,
  deleteEdge,
  clearAll
};
