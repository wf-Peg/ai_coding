/**
 * init.js - SQLite 本地索引层：建库建表 + schema 版本迁移
 *
 * v1：content / content_fts（仅 clip）。
 * v2：新增 relation 表（M3 图谱关系层），content.type 扩展支持
 *     knowledge / learning-plan 作为关系端点。
 * v3：新增 canvas_layout 表（无限画布·布局层），存储节点手动画布坐标，
 *     与语义 relation 表分离，避免关系全量重建时被清掉。
 * v4：新增 canvas_node 表（画布可写节点：便签/链接/图片/引用）与
 *     canvas_edge 表（手动连线），同属画布层，与语义 relation 分离。
 * v5：新增 canvas_group / canvas_group_member 表（无限画布·分组 frame 层），
 *     把多个节点圈成可命名分组并整体拖动；同属画布层，与语义 relation 分离。
 * v6：修复迁移。历史库在 v3/v4/v5 增量迁移时被旧实现的「提前写入最高版本号 + return」
 *     跳级，出现 schema_version=5 但画布表缺失的坏状态；v6 重跑画布各层建表 SQL
 *     （全部 CREATE TABLE IF NOT EXISTS，幂等，健康库无副作用）兜底补齐。
 * v7：画布升级为「多文档 + 层级大纲」。新增 canvas_doc 表（画布文档），
 *     canvas_node 加 doc_id / parent_id / order_index（层级大纲：结构真源），
 *     canvas_edge / canvas_group 加 doc_id（按文档隔离）；历史数据统一回填到
 *     默认文档 doc:default，parent_id 全空（平铺根节点，视觉与升级前一致）。
 *     坐标仍存 canvas_layout（node_id 全局唯一，不加 doc_id，按文档取坐标用 JOIN）。
 * v8：新增 canvas_ink 表（画布手绘墨迹层），手绘笔迹（画笔/荧光笔/橡皮结果）
 *     按一笔一行 + points JSON 文本存储，doc_id 隔离；同属画布层，纳入快照 v3。
 * 后续扩展时新增版本迁移（schema_version+1），在 migrate() 里追加逻辑。
 */

const canvasDoc = require('./canvas-doc');

const SCHEMA_VERSION = 8;

// 建表 SQL（仅在 meta.schema_version 为空时执行 v1 建库）
const SQL_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS content (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  source_id   INTEGER,
  title       TEXT,
  summary     TEXT,
  category    TEXT,
  tags        TEXT,          -- JSON 数组字符串化
  body_plain  TEXT,          -- 抽取纯文本供 FTS
  content_ref TEXT,          -- 完整 ClipContent JSON（保返回结构）
  mtime       TEXT,          -- 源文件 mtime（增量判定）
  file_path   TEXT,          -- 来源文件绝对路径
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_type   ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_source ON content(source_id);
CREATE INDEX IF NOT EXISTS idx_content_file   ON content(file_path);

-- FTS5 external content 模式，与 content 表同步
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  title, body_plain, category, tags,
  content='content', content_rowid='rowid', tokenize='unicode61'
);
`;

// v2 增量：关系表（M3 图谱关系层，替代 Java relation-index.json）
const SQL_V2 = `
CREATE TABLE IF NOT EXISTS relation (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  relation_type TEXT NOT NULL,          -- derived_from / linked_to / plan_links
  source        TEXT,                   -- clip_to_knowledge / wikilink / learning_plan_link
  confidence    REAL DEFAULT 1.0,
  created_at    TEXT,
  UNIQUE(from_id, to_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relation_from ON relation(from_id);
CREATE INDEX IF NOT EXISTS idx_relation_to   ON relation(to_id);
CREATE INDEX IF NOT EXISTS idx_relation_type ON relation(relation_type);
`;

// v3 增量：画布布局表（无限画布·布局层，与语义 relation 分离）
const SQL_V3 = `
CREATE TABLE IF NOT EXISTS canvas_layout (
  node_id    TEXT PRIMARY KEY,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  updated_at TEXT
);
`;

// v4 增量：画布可写节点 + 手动连线（无限画布·画布层，与语义 relation 分离）
const SQL_V4 = `
CREATE TABLE IF NOT EXISTS canvas_node (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,          -- note / link / image / ref
  text       TEXT,                   -- note 正文 / link URL / image 图源 / ref 目标节点 id
  title      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS canvas_edge (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  created_at TEXT,
  UNIQUE(from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_canvas_edge_from ON canvas_edge(from_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edge_to   ON canvas_edge(to_id);
`;

// v5 增量：画布分组 frame 表（无限画布·分组层，与语义 relation 分离）
const SQL_V5 = `
CREATE TABLE IF NOT EXISTS canvas_group (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS canvas_group_member (
  group_id TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  PRIMARY KEY (group_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_cgm_member ON canvas_group_member(node_id);
`;

// v6 修复迁移：重跑画布各层建表 SQL（CREATE TABLE IF NOT EXISTS，幂等；
// 修复旧实现跳级导致的「schema_version=5 但画布表缺失」坏状态，健康库执行无副作用）
const SQL_V6 = SQL_V3 + SQL_V4 + SQL_V5;

// v7 增量①：画布文档表（列增量在 addColumnIfMissing 之后建索引，避免列未就绪报错）
const SQL_V7 = `
CREATE TABLE IF NOT EXISTS canvas_doc (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  sort_index INTEGER,
  created_at TEXT,
  updated_at TEXT
);
`;

// v7 增量②：画布各表按文档/层级建索引（须在补列之后执行）
const SQL_V7_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_canvas_node_doc  ON canvas_node(doc_id, parent_id, order_index);
CREATE INDEX IF NOT EXISTS idx_canvas_edge_doc  ON canvas_edge(doc_id);
CREATE INDEX IF NOT EXISTS idx_canvas_group_doc ON canvas_group(doc_id);
`;

// v8 增量：画布手绘墨迹层（一笔一行，points 存 JSON 文本，按文档隔离）
const SQL_V8 = `
CREATE TABLE IF NOT EXISTS canvas_ink (
  id         TEXT PRIMARY KEY,
  doc_id     TEXT NOT NULL,
  color      TEXT,
  width      REAL,
  opacity    REAL,
  points     TEXT NOT NULL,          -- JSON：[[x,y],...]（世界坐标）
  sort_index INTEGER,
  created_at TEXT,
  updated_at TEXT
);
`;
const SQL_V8_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_canvas_ink_doc ON canvas_ink(doc_id, sort_index);
`;

/** 判断某表是否已存在某列。 */
function hasColumn(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

/**
 * 增量补列（幂等）：列不存在才 ALTER TABLE ADD COLUMN。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table 表名（内部白名单校验，杜绝拼接注入）
 * @param {string} column 列名
 * @param {string} ddl 列定义（如 'TEXT' / 'INTEGER'）
 */
function addColumnIfMissing(db, table, column, ddl) {
  const TABLES = ['canvas_node', 'canvas_edge', 'canvas_group', 'canvas_doc'];
  const COLUMNS = ['doc_id', 'parent_id', 'order_index', 'sort_index'];
  if (!TABLES.includes(table) || !COLUMNS.includes(column)) {
    throw new Error('invalid canvas migration target: ' + table + '.' + column);
  }
  if (hasColumn(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/**
 * v7 回填：历史画布数据统一挂到默认文档；层级字段补默认值。
 * - canvas_doc 确保 doc:default 存在；
 * - canvas_node / canvas_edge / canvas_group 的 doc_id 为空则回填默认文档；
 * - canvas_node.order_index 为空则按 created_at 顺序在文档内递增编号；
 * - parent_id 保持 NULL（平铺根节点，视觉与升级前一致）。
 */
function backfillCanvasV7(db) {
  canvasDoc.ensureDefaultDoc(db);

  for (const table of ['canvas_node', 'canvas_edge', 'canvas_group']) {
    if (hasColumn(db, table, 'doc_id')) {
      db.prepare(`UPDATE ${table} SET doc_id = ? WHERE doc_id IS NULL OR doc_id = ''`)
        .run(canvasDoc.DEFAULT_DOC_ID);
    }
  }

  if (!hasColumn(db, 'canvas_node', 'order_index')) return;
  const rows = db
    .prepare('SELECT id, doc_id AS docId FROM canvas_node WHERE order_index IS NULL ORDER BY created_at, id')
    .all();
  const counters = new Map();
  const stmt = db.prepare('UPDATE canvas_node SET order_index = ? WHERE id = ?');
  for (const r of rows) {
    const docId = r.docId || canvasDoc.DEFAULT_DOC_ID;
    const next = counters.get(docId) || 0;
    stmt.run(next, r.id);
    counters.set(docId, next + 1);
  }
}

/**
 * 执行建库/迁移。基于 meta.schema_version 判断。
 * v1：建 meta/content/content_fts。
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);');
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version');
  const current = row ? parseInt(row.value, 10) : 0;

  // 逐级执行所有未到位的迁移（各段 SQL 均为 CREATE TABLE IF NOT EXISTS，可重入幂等）。
  // 注意：不得在中间步骤提前写入最高版本号并 return，否则后续迁移会被跳过（历史 bug）。
  if (current < 1) db.exec(SQL_V1);
  if (current < 2) db.exec(SQL_V2);
  if (current < 3) db.exec(SQL_V3);
  if (current < 4) db.exec(SQL_V4);
  if (current < 5) db.exec(SQL_V5);
  if (current < SCHEMA_VERSION) {
    // v6：兜底补齐缺失的画布表（修复旧实现跳级导致的坏状态）
    db.exec(SQL_V6);

    // v7：画布多文档 + 层级大纲（补列 → 建索引 → 回填默认文档）
    if (current < 7) {
      db.exec(SQL_V7);
      addColumnIfMissing(db, 'canvas_node', 'doc_id', 'TEXT');
      addColumnIfMissing(db, 'canvas_node', 'parent_id', 'TEXT');
      addColumnIfMissing(db, 'canvas_node', 'order_index', 'INTEGER');
      addColumnIfMissing(db, 'canvas_edge', 'doc_id', 'TEXT');
      addColumnIfMissing(db, 'canvas_group', 'doc_id', 'TEXT');
      db.exec(SQL_V7_INDEXES);
      backfillCanvasV7(db);
    }

    // v8：画布手绘墨迹层（建表 → 建索引，纯增量、幂等）
    if (current < 8) {
      db.exec(SQL_V8);
      db.exec(SQL_V8_INDEXES);
    }

    // 仅在全部迁移完成后统一写入最终版本号
    upsertMeta(db, 'schema_version', String(SCHEMA_VERSION));
  }
}

/** 读取/写入 meta 键值。 */
function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function upsertMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

module.exports = { migrate, getMeta, upsertMeta, SCHEMA_VERSION };