/**
 * init.js - SQLite 本地索引层：建库建表 + schema 版本迁移
 *
 * v1：content / content_fts（仅 clip）。
 * v2：新增 relation 表（M3 图谱关系层），content.type 扩展支持
 *     knowledge / learning-plan 作为关系端点。
 * 后续扩展时新增版本迁移（schema_version+1），在 migrate() 里追加逻辑。
 */

const SCHEMA_VERSION = 2;

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

  if (current === 0) {
    // 全新建库：跑全量 SQL（v1 基础表 + v2 relation 表）
    db.exec(SQL_V1);
    db.exec(SQL_V2);
    upsertMeta(db, 'schema_version', String(SCHEMA_VERSION));
    return;
  }
  if (current < 2) {
    // v1 → v2：新增 relation 表
    db.exec(SQL_V2);
    upsertMeta(db, 'schema_version', String(SCHEMA_VERSION));
    return;
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