/**
 * canvas-ink.js - SQLite 本地索引层：无限画布·手绘墨迹层（多文档隔离）
 *
 * 属于「画布层」，与语义（content / relation）分离：
 *   - 墨迹是用户在画布上用画笔/荧光笔/橡皮创作的增量数据，按 doc_id 归属文档。
 *   - 一笔一行，points 存 JSON 文本（世界坐标采样点），贴合「整笔增/删」语义，
 *     不做点级表拆分（不存在按点查询/更新的需求，拆分只会增加 join 与多写）。
 *   - 落库策略为「整文档全量替换」：写操作只有整笔增/删/撤销/清空四种，
 *     全量替换实现最简、状态最一致，避免库与内存分叉。
 *
 * 一致性「文件为真、库为缓存」：墨迹属于增量创作数据，只存于画布层，
 * 并纳入快照 v3 参与跨设备同步。
 */

const canvasDoc = require('./canvas-doc');

/** 单文档笔迹数上限（超限截断最旧并返回 truncated 标记，防止快照无界膨胀）。 */
const INK_MAX_PER_DOC = 3000;

const now = () => new Date().toISOString();
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 生成稳定墨迹 id（不引依赖）：`ink:` + base36 时间戳 + 6 位随机后缀。 */
function newInkId() {
  let rnd = '';
  for (let i = 0; i < 6; i++) rnd += B36[Math.floor(Math.random() * 36)];
  return `ink:${Date.now().toString(36)}:${rnd}`;
}

/** points 合法性：数组，元素为长度 2 的有限数数组（允许字符串数字）。 */
function validPoints(points) {
  return Array.isArray(points) && points.every((p) => {
    return Array.isArray(p) && p.length === 2
      && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
  });
}

/**
 * 读取墨迹（完整对象，points 已反序列化）。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} [docId] 指定画布文档；不传则返回全部文档（供快照全量组装）
 */
function listInk(dbConn, docId) {
  const base = `
    SELECT id, doc_id AS docId, color, width, opacity, points,
           sort_index AS sortIndex, created_at AS createdAt, updated_at AS updatedAt
    FROM canvas_ink`;
  const rows = docId
    ? dbConn.prepare(base + ' WHERE doc_id = ? ORDER BY sort_index, created_at, id').all(docId)
    : dbConn.prepare(base + ' ORDER BY sort_index, created_at, id').all();
  return rows.map((r) => {
    try { r.points = JSON.parse(r.points); } catch (e) { r.points = []; }
    return r;
  });
}

/**
 * 保存某文档的墨迹（整文档全量替换，事务包裹）。
 * 非法笔画（points 不合法）跳过；超上限时截断最旧笔迹并置 truncated。
 * 成功后 touch 文档时间戳（快照 updatedAt 纳入 ink 的双重保证之一）。
 * @param {import('node:sqlite').DatabaseSync} dbConn
 * @param {string} docId
 * @param {Array} strokes 前端 strokes（元素含 id/color/width/opacity/points）
 * @returns {{success:boolean, saved:number, truncated:boolean, message?:string}}
 */
function saveInk(dbConn, docId, strokes) {
  if (!docId) return { success: false, message: 'docId is required', saved: 0, truncated: false };
  const list = Array.isArray(strokes) ? strokes : [];
  const valid = list.filter((s) => s && typeof s === 'object' && validPoints(s.points));
  // 超限截断最旧：仅保留最后 INK_MAX_PER_DOC 笔
  const overflow = valid.length - INK_MAX_PER_DOC;
  const kept = overflow > 0 ? valid.slice(-INK_MAX_PER_DOC) : valid;

  dbConn.exec('BEGIN');
  try {
    dbConn.prepare('DELETE FROM canvas_ink WHERE doc_id = ?').run(docId);
    const ins = dbConn.prepare(`
      INSERT INTO canvas_ink (id, doc_id, color, width, opacity, points, sort_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const t = now();
    let saved = 0;
    kept.forEach((s, i) => {
      ins.run(
        (typeof s.id === 'string' && s.id) || newInkId(),
        docId,
        s.color != null ? String(s.color) : null,
        s.width != null ? Number(s.width) : null,
        s.opacity != null ? Number(s.opacity) : null,
        JSON.stringify(s.points),
        i,
        s.createdAt || t,
        s.updatedAt || t
      );
      saved++;
    });
    // 刷新文档时间戳：只画笔迹不动节点时，快照 updatedAt 仍会前进，避免被 last-write-wins 吞掉
    canvasDoc.touch(dbConn, docId);
    dbConn.exec('COMMIT');
    return { success: true, saved, truncated: overflow > 0 };
  } catch (e) {
    try { dbConn.exec('ROLLBACK'); } catch (_e) { /* 忽略回滚失败 */ }
    throw e;
  }
}

/** 清空某文档的全部墨迹。@returns {boolean} 是否有清除 */
function clearDoc(dbConn, docId) {
  const r = dbConn.prepare('DELETE FROM canvas_ink WHERE doc_id = ?').run(docId);
  return (r.changes || 0) > 0;
}

/** 清空全部文档墨迹（restore 前 wipe 用，杜绝幽灵墨迹）。@returns {number} 清除条数 */
function clearAll(dbConn) {
  const r = dbConn.prepare('DELETE FROM canvas_ink').run();
  return r.changes || 0;
}

/** 统计某文档墨迹笔数。 */
function countInk(dbConn, docId) {
  const r = dbConn.prepare('SELECT COUNT(*) AS c FROM canvas_ink WHERE doc_id = ?').get(docId);
  return r ? r.c : 0;
}

module.exports = { INK_MAX_PER_DOC, newInkId, validPoints, listInk, saveInk, clearDoc, clearAll, countInk };