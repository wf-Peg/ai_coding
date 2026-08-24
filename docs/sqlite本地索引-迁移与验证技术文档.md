# SQLite 本地索引层 · 存量迁移与验证技术文档

> 文档类型：技术说明 / 规范（开发者与运维向）
> 读者：Electron 主进程开发者、本地数据运维人员
> 范围：一期——仅 clip 内容索引与全文搜索；图谱/关系（M3）、前端契约接入（M4）不在本文范围
> 版本：1.1　生效日期：2026-08-23　负责人：跳剪（CutShelter）桌面端
> 更新：补充体验收益、兜底策略、当前接入范围

---

## 1. 文档背景

当前应用的数据链路以 JSON 文件系统为权威数据源，搜索由 Java 侧 `SearchService` 全量内存扫描完成 `[Data-backed]`。SQLite 本地索引层作为过渡方案，将索引能力下沉到 Electron 主进程 Node 侧，为最终移除 Spring Boot / JRE 铺路 `[Data-backed]`。

设计文档：`docs/superpowers/specs/2026-08-22-sqlite-local-index-design.md`
实施计划：`.trae/documents/sqlite-local-index-layer-clip-phase1.md`

---

## 2. 设计约束

- **JSON 是唯一事实来源，SQLite 只是索引缓存** `[Data-backed]`。索引库可随时清空重建，不承载权威数据。
- **索引层运行于 Electron 主进程 Node 侧**，使用 Node 内置 `node:sqlite`（零第三方依赖），不依赖 Java 后端 `[Data-backed]`。
- **单写者**：SQLite 仅由主进程写入；Java 仍写 JSON，两侧不争同一写口 `[Data-backed]`。
- 一致性采用 **文件为真、库为缓存**，以 `file_path + mtime` 判定增量 `[Data-backed]`。

---

## 3. 数据模型

库文件位于 `{storagePath}/.index/app-index.sqlite`。

### 3.1 meta 表

键值存储，用于 schema 版本与重建世代记录。

| 键 | 含义 |
|---|---|
| `schema_version` | 建表版本号，当前为 `1` |
| `data_generation` | 全量重建世代号，每次重建递增 |

### 3.2 content 表（仅承载 clip）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 全局唯一键，形如 `clip:123` |
| `type` | TEXT | 一期恒为 `clip`，预留扩展 |
| `source_id` | INTEGER | 对应原 clip 的 id |
| `title` / `summary` / `category` | TEXT | 检索展示字段 |
| `tags` | TEXT | 标签，JSON 数组字符串化 |
| `body_plain` | TEXT | 抽取的纯文本，供 FTS 检索 |
| `content_ref` | TEXT | 完整 ClipContent JSON，保返回结构一致 |
| `mtime` | TEXT | 源文件修改时间戳，增量判定依据 |
| `file_path` | TEXT | 来源文件绝对路径 |
| `created_at` / `updated_at` | TEXT | 索引记录时间 |

索引：`idx_content_type`、`idx_content_source`、`idx_content_file`。

### 3.3 content_fts 表（FTS5 全文虚拟表）

external content 模式，`content_rowid='rowid'` 关联 content 主表，`tokenize=unicode61`。字段：`title`、`body_plain`、`category`、`tags`。

> 约束：content 表不能加 `WITHOUT ROWID`，否则 FTS 关联失效 `[Data-backed]`。

---

## 4. 存量数据迁移

迁移方式为**重建索引**，无需搬移权威 JSON 数据。

### 4.1 迁移流程

1. 打开或创建索引库，清空 `content` 与 `content_fts`。
2. 递归扫描 `clip-storage/**/*.json`，排除 todoList、knowledge、tmp 等非剪藏目录。
3. 每条 clip 抽取 `title/summary/tags/正文` 拼成 `body_plain`，整条 JSON 存入 `content_ref`。
4. 写入 `content`（幂等：同 `file_path` 且 `mtime` 未变则跳过）。
5. 一次性执行 FTS5 `rebuild` 重建 `content_fts`。
6. `data_generation` 递增。

全部在单事务内执行，失败自动回滚 `[Data-backed]`。

### 4.2 触发时机

- 程序启动时自动执行。
- 前端调用 `electronAPI.localIndex.rebuild()` / IPC `local-index:rebuild`。

### 4.3 不纳入本次迁移的数据

| 数据 | 归属 | 说明 |
|---|---|---|
| 图谱关系 `relation-index.json` | M3 | 关系无法靠扫 `clip-storage` 还原，需单独读取建 `relation` 表 `[Expert judgment]` |
| 内容索引 `content-index.json` | M3 | 归入二期 |
| 前端 REST 调用改走 `local-index:*` | M4 | 契约接入，独立议题 |

---

## 5. 验证数据

### 5.1 定位索引库文件

库文件一律位于 `{storagePath}/.index/app-index.sqlite`，`storagePath` 以应用设置的数据目录为准。

| 平台 | 数据目录默认值 |
|---|---|
| macOS / Linux | `~/.cut-shelter`（Electron userData，仅缓存的默认目录；真实数据目录以设置为准） |
| Windows | `%LOCALAPPDATA%\CutShelter` |

### 5.2 查询工具

| 工具 | 适用 |
|---|---|
| DB Browser for SQLite | GUI，直观，跨平台 |
| DBeaver | 通用数据库工具 |
| `sqlite3` 命令行 | 零依赖，可脚本化 |

### 5.3 只读打开（推荐）

索引库为 WAL 模式且单写者，验证时应只读打开，避免锁冲突与损坏风险。

```bash
# macOS / Linux
DB="{storagePath}/.index/app-index.sqlite"
sqlite3 "file:$DB?mode=ro&immutable=1"
```

```cmd
:: Windows
sqlite3.exe "file:C:\{路径}\.index\app-index.sqlite?mode=ro&immutable=1"
```

若 URI 只读方式在 Windows 盘符路径上不可用，改用只读副本验证。

### 5.4 只读副本（备选）

```bash
cp "{storagePath}/.index/app-index.sqlite" /tmp/verify.sqlite && sqlite3 /tmp/verify.sqlite
```

```cmd
copy "C:\{路径}\.index\app-index.sqlite" %TEMP%\verify.sqlite && sqlite3.exe %TEMP%\verify.sqlite
```

### 5.5 回归自检 SQL

```sql
SELECT count(*) FROM content;                              -- 库内 clip 条数
SELECT count(*) FROM content_fts                           -- 全文可检索条数，应等于上一条
  WHERE content_fts NOT IN ('rebuild');
SELECT key, value FROM meta                                -- 版本与世代
  WHERE key IN ('schema_version','data_generation');
SELECT id, category, substr(coalesce(title,'(无标题)'),1,30) AS title
  FROM content ORDER BY updated_at DESC LIMIT 5;           -- 抽样
```

判定标准：`content_fts` 可检索数应为 `content` 的条数；`content` 明显小于剪藏实际数时需重建索引。

---

## 6. 常见问题排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 搜索漏掉新增剪藏 | 一期无实时 watcher，运行中新增未入索引 | 重启程序或执行 `local-index:rebuild` |
| `content_fts` 可检索数 < `content` 条数 | FTS 与主表未同步 | `INSERT INTO content_fts(content_fts) VALUES('rebuild')` |
| 启动日志含 `[local-index] init skipped:` | `config.storagePath` 有误或目录无 `clip-storage` | 核正数据目录后重建索引 |
| 打开库时报 `unable to open database file` | WAL 伴随文件不可写（目录写约束） | 使用只读副本或 `immutable=1` 打开 |
| stderr 出现 `ExperimentalWarning: SQLite is an experimental feature` | `node:sqlite` 属实验性模块 | 属正常现象，不影响运行，无需处理 |

> 规避：不要在程序执行 `rebuild()` 时用客户端写入该库，会触发锁竞争或 `SQLITE_CORRUPT` `[Data-backed]`。

---

## 7. 体验收益

索引层替换的是 Java 侧 `SearchService` 的全量内存扫描，收益集中在查询性能与工程可迁移性。

- **搜索从"读文件"变"查库"**：旧逻辑每次搜索全量遍历 JSON 再 `contains` 匹配；新逻辑直接查 FTS5 倒排索引，数据量增大时差距拉大 `[Data-backed]`。
- **中文可命中**：`unicode61` 对中文整句分词弱，故采用 FTS5 精确匹配 + LIKE 子串兜底双路径，避免中文搜索落空 `[Data-backed]`。
- **增量免重扫**：以 `file_path + mtime` 判定，仅变更文件重新入索引，重复调用幂等 `[Data-backed]`。
- **可无损迁 TS**：索引层运行于主进程 Node 侧、零第三方依赖，移除 Spring Boot / JRE 后可原样迁移 `[Data-backed]`。

---

## 8. 兜底策略

前提：**JSON 是权威源，SQLite 只是缓存**，索引损坏不会影响数据本身 `[Data-backed]`。兜底按层级递进：

| 层级 | 场景 | 机制 |
|---|---|---|
| L1 搜索双路径 | FTS 索引错乱/未命中 | FTS 查不到自动降级走 LIKE 对 `content` 表再查 `[Data-backed]` |
| L2 全量重建 | 索引条目错乱/搜索漏 | 前端 `local-index:rebuild` 或重启程序，从权威 JSON 清空重建 `[Data-backed]` |
| L3 FTS 单独修复 | `content_fts` 与主表不同步 | `INSERT INTO content_fts(content_fts) VALUES('rebuild')` 单独重建全文索引 `[Data-backed]` |
| L4 库文件损坏 | 打开库抛异常 | 主进程捕获后打日志跳过，应用照常运行（本轮不启用索引）；人工删 `.index/` 目录重启即重建 `[Data-backed]` |
| L5 日常预防 | 降低损坏概率 | WAL + 单写者、写操作单事务（失败回滚）、规避外部工具在 `rebuild()` 时写库 `[Data-backed]` |

---

## 9. 当前接入范围

一期仅**剪藏搜索**接入本地索引，其余内容类型与人入口不变 `[Data-backed]`。

| 功能 | 是否接入 SQLite 索引 | 说明 |
|---|---|---|
| 剪藏库"信息检索"搜索 | 是 | `clip-list.js` 经 `apiClient.search` → `localIndex.search`，失败回退 REST `[Data-backed]` |
| 编辑器 Ctrl+O 快速切换文件 | 否 | 走编辑器文件系统，与索引无关 `[Data-backed]` |
| 全局跨内容搜索 | 否 | 一期无跨剪藏/知识/待办的全局搜索入口，属后续范围 |
| 知识/待办/学习计划搜索 | 否 | 索引层只扫剪藏，排除这些目录 `[Data-backed]` |

搜索可命中字段（`body_plain` 抽取范围）= 正文 + 摘要 + 分析 + 标题 + 分类 + 类型 + 来源 + 标签；查询时 FTS 检索 `title/body_plain/category/tags`，LIKE 兜底检索 `title/body_plain/tags` `[Data-backed]`。

---

## 10. 相关代码索引

| 模块 | 文件 | 职责 |
|---|---|---|
| 编排入口 | `electron/sqlite/index-service.js` | `initLocalIndex / rebuild / status / listByType` |
| 库驱动 | `electron/sqlite/db.js` | `node:sqlite` 连接、WAL、单例 |
| 建表迁移 | `electron/sqlite/init.js` | meta/content/content_fts、schema 版本迁移 |
| 扫描抽取 | `electron/sqlite/scanner.js` | 扫 `clip-storage`，排除非剪藏目录 |
| 写入重建 | `electron/sqlite/indexer.js` | upsert、重建 FTS |
| 检索 | `electron/sqlite/search.js` | FTS + LIKE 兜底查询 |
| IPC 接线 | `electron/main.js`、`electron/preload.js` | `local-index:*` 频道与 `electronAPI.localIndex.*` |