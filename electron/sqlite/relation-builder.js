/**
 * relation-builder.js - SQLite 本地索引层：从实体权威字段构建关系
 *
 * 对齐 backend GraphService/RelationIndexService 的语义，把关系从
 * relation-index.json（Java）迁移到 node:sqlite 的 relation 表：
 *   - derived_from : clip:{cid} → knowledge:{kid}（来源剪藏）
 *   - linked_to    : knowledge:{kid} → knowledge:{lid}（双向链接）
 *   - plan_links   : learning-plan:{id} → knowledge:{kid} / clip:{cid}（阶段关联）
 *
 * 一致性「文件为真、库为缓存」：每次扫描后全量重建 relation 表。
 * 重建后会合并遗留 relation-index.json 中的历史关系（M3.6 一次性迁移的持久化承载）：
 * 以 ON CONFLICT DO NOTHING 合并，派生关系优先、遗留关系为补充，且不会在下一次 rebuild 中被清掉。
 */

const fs = require('fs');
const path = require('path');
const scanner = require('./scanner');
const { entityId } = require('./indexer');

/**
 * 合并遗留关系索引文件 relation-index.json（M3.6）。
 * 幂等：与已存在关系冲突则跳过（保留派生/已导入的）。返回导入条数。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null|undefined} legacyFilePath
 * @returns {number}
 */
function importLegacy(db, legacyFilePath) {
  if (!legacyFilePath || !fs.existsSync(legacyFilePath)) return 0;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(legacyFilePath, 'utf-8')); }
  catch (e) { return 0; }
  if (!Array.isArray(rows)) return 0;

  const stmt = db.prepare(`
    INSERT INTO relation (from_id, to_id, relation_type, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_id, to_id, relation_type) DO NOTHING
  `);
  let imported = 0;
  for (const r of rows) {
    if (!r || typeof r.fromId !== 'string' || typeof r.toId !== 'string') continue;
    const added = stmt.run(
      r.fromId, r.toId,
      r.relationType || 'linked_to',
      r.source || 'migrated',
      typeof r.confidence === 'number' ? r.confidence : 1.0,
      r.createdAt || new Date().toISOString()
    );
    if (added && added.changes > 0) imported++;
  }
  return imported;
}

/** 遗留关系文件路径（{base}/index/relation-index.json），不存在返回 null。 */
function legacyIndexPath(storagePath) {
  try {
    const p = path.join(scanner.resolveBasePath(storagePath), 'index', 'relation-index.json');
    return p;
  } catch (e) { return null; }
}

/** 清除全部关系后，从实体集合重建，并合并遗留 index 关系。 */
function buildRelations(db, records, storagePath) {
  // 全量重建：先清空再写入。只写 relation 主表，不影响 content/content_fts。
  db.exec('DELETE FROM relation');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO relation (from_id, to_id, relation_type, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_id, to_id, relation_type)
    DO UPDATE SET source = excluded.source, created_at = excluded.created_at
  `);

  const written = [];
  const push = (fromId, toId, relationType, source) => {
    stmt.run(fromId, toId, relationType, source, 1.0, now);
    written.push({ fromId, toId, relationType, source, confidence: 1.0, createdAt: now });
  };

  for (const { type, entity } of records) {
    if (!entity || entity.id === null || entity.id === undefined) continue;
    if (type === 'knowledge') {
      const kid = entityId(entity, 'knowledge');
      // derived_from：知识 ← 来源剪藏
      if (Array.isArray(entity.sourceClipIds)) {
        for (const cid of entity.sourceClipIds) {
          if (cid !== null && cid !== undefined) {
            push('clip:' + cid, kid, 'derived_from', 'clip_to_knowledge');
          }
        }
      }
      // linked_to：知识 ↔ 知识（排除自环）
      if (Array.isArray(entity.linkedKnowledgeIds)) {
        for (const lid of entity.linkedKnowledgeIds) {
          if ((lid !== null && lid !== undefined) && String(lid) !== String(entity.id)) {
            push(kid, 'knowledge:' + lid, 'linked_to', 'wikilink');
          }
        }
      }
    } else if (type === 'learning-plan') {
      const pid = entityId(entity, 'learning-plan');
      // plan_links：学习计划 → 阶段关联的知识/剪藏
      if (Array.isArray(entity.phases)) {
        for (const phase of entity.phases) {
          if (Array.isArray(phase.linkedKnowledgeIds)) {
            for (const kid of phase.linkedKnowledgeIds) {
              if (kid !== null && kid !== undefined) {
                push(pid, 'knowledge:' + kid, 'plan_links', 'learning_plan_link');
              }
            }
          }
          if (Array.isArray(phase.sourceClipIds)) {
            for (const cid of phase.sourceClipIds) {
              if (cid !== null && cid !== undefined) {
                push(pid, 'clip:' + cid, 'plan_links', 'learning_plan_link');
              }
            }
          }
        }
      }
    }
  }

  // 合并遗留 relation-index.json 历史关系（幂等，持久化迁移）
  const legacyImported = storagePath ? importLegacy(db, legacyIndexPath(storagePath)) : 0;

  return { derived: written.length, legacyImported };
}

/** 读取某节点关联（出链 + 反链）。 @returns {Array<Object>} */
function findFor(db, entityIdStr) {
  const rows = db.prepare(
    'SELECT from_id AS fromId, to_id AS toId, relation_type AS relationType, source, confidence, created_at AS createdAt ' +
    'FROM relation WHERE from_id = ? OR to_id = ? ORDER BY id'
  ).all(entityIdStr, entityIdStr);
  return rows;
}

/** 当前关系条数。 @returns {number} */
function count(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM relation').get();
  return row ? row.c : 0;
}

module.exports = { buildRelations, findFor, count, importLegacy, legacyIndexPath };