# SQLite 本地索引层 —— 存量迁移与验证说明

> 关联设计：`docs/superpowers/specs/2026-08-22-sqlite-local-index-design.md`
> 关联计划：`.trae/documents/sqlite-local-index-layer-clip-phase1.md`
> 范围：一期（仅 clip 内容索引 + 全文搜索）。图谱/关系（M3）、前端契约接入（M4）不在本说明范围。
> 定稿：2026-08-23

---

## 一、核心结论

**方案是"重建索引"，不是"搬运数据"。** 全程不需要导表、不需要中间文件、不需要停 Java 后端。

设计铁律（来源：设计文档 §二.1）：

> **JSON 文件是唯一事实来源，SQLite 只是索引** —— 绝不把 SQLite 变成既要文件又要别的主存储。

权威数据一直在 `clip-storage/**/*.json` 里，SQLite 只是它的「搜索缓存」。存量数据进库的本质 = 把所有 JSON 扫一遍、整理进索引库，这个动作叫 **全量重建（rebuild）**。

---

## 二、迁移方案：重建索引

### 2.1 流程（对应 `electron/sqlite/index-service.js` 的 `initLocalIndex`）

```
1. 打开(建)索引库，清空旧的 content / content_fts   ← 缓存可随时丢弃
2. scanner 递归扫 clip-storage/**/*.json             ← 存量数据全部在这
      排除 todoList / knowledge / tmp / .git ... 等非剪藏目录
3. 每条 clip 提取 title/summary/tags/正文 → body_plain
      整条 clip JSON 存进 content_ref（保返回结构不变）
4. 写入 content（幂等：file_path + mtime 未变则跳过）
5. 一次性 rebuild content_fts                        ← 建全文倒排
6. data_generation++                                ← 记录本次全量重建世代
```

- 触发时机：**程序启动时自动执行**；或前端调用 `electronAPI.localIndex.rebuild()`（IPC `local-index:rebuild`）。
- 全流程在**单事务**内（BEGIN/COMMIT），失败自动 ROLLBACK，不会留半截数据。

### 2.2 为什么安全无损

- JSON 权威源一个字节都不动。
- 索引库是缓存，随时可重建；任何异常只需 `rebuild` 一次回正。
- 已入库数据（如本机 23 条 / generation=5）即存量迁移完成态。

### 2.3 一期边界（不覆盖）

- `index/relation-index.json`（图谱关系）→ M3 才迁移，关系**无法**靠扫 `clip-storage` 还原，需单独读取建 `relation` 表。
- `index/content-index.json`（内容索引）→ M3。
- 前端 114 处 REST 调用改走 `local-index:*` → M4（契约接入）。

---

## 三、验证方式（跨平台通用）

### 3.1 定位索引库文件

```
{storagePath}/.index/app-index.sqlite
```

其中 `storagePath` 即设置里的数据目录（`config.storagePath`）：

| 平台 | 默认值（未自定义时） |
|---|---|
| macOS / Linux | `~/.cut-shelter`（Electron userData，注意非数据目录，仅缓存） |
| Windows | `%LOCALAPPDATA%\CutShelter`（`C:\Users\<用户名>\AppData\Local\CutShelter`） |

> ⚠️ 实际以 `config.storagePath` 为准；macOS 上默认 `~/.cut-shelter` 实为 Electron 缓存目录，**真正的数据目录是设置里的存储路径**。找不到文件时在程序设置页看数据目录，或在磁盘搜索 `app-index.sqlite`。

### 3.2 工具

| 方式 | 优点 | 安装 |
|---|---|---|
| DB Browser for SQLite（推荐） | 图形化，直观 | `brew install --cask db-browser-for-sqlite`（macOS）；官网下载 / `winget install DBBrowserForSQLite`（Windows） |
| DBeaver | 通用/专业 | winget / zip |
| `sqlite3` 命令行 | 零依赖、可脚本化 | macOS 自带；Windows 从 sqlite.org 下 `sqlite-tools-win-x64-*.zip` 或 `winget install SQLite.SQLite` |

### 3.3 只读打开（强烈建议，避免 WAL 写锁冲突）

索引库为 **WAL 模式 + 单写者**（只有程序主进程写）。验证数据时应**只读**打开，避免 `SQLITE_BUSY` / 损坏风险：

```bash
# macOS / Linux
DB="{storagePath}/.index/app-index.sqlite"
sqlite3 "file:$DB?mode=ro&immutable=1"
```

```cmd
:: Windows（若 URI 语法在盘符路径有兼容问题，改用 3.4 的只读副本方式）
sqlite3.exe "file:C:\{路径}\.index\app-index.sqlite?mode=ro&immutable=1"
```

一句话口诀：**只查用 RO + immutable；目录可写且需要改数据用普通打开，但不要在程序 `rebuild()` 进行时手动写库。**

### 3.4 只读副本（最稳妥，永不碰原库）

```bash
cp "{storagePath}/.index/app-index.sqlite" /tmp/verify.sqlite && sqlite3 /tmp/verify.sqlite
```

```cmd
copy "C:\{路径}\.index\app-index.sqlite" %TEMP%\verify.sqlite && sqlite3.exe %TEMP%\verify.sqlite
```

---

## 四、回归自检 SQL（对账）

怀疑索引没跟上 / 想验证从存量重建正常时执行：

```sql
-- 1. 库内 clip 条数
SELECT count(*) FROM content;

-- 2. 全文索引可检索条数，应 == 步骤1 的 content 条数
SELECT count(*) FROM content_fts WHERE content_fts NOT IN ('rebuild');

-- 3. schema 版本 / 重建世代号
SELECT key, value FROM meta WHERE key IN ('schema_version','data_generation');

-- 4. 抽样看数据
SELECT id, category, substr(coalesce(title,'(无标题)'),1,30) AS title
FROM content ORDER BY updated_at DESC LIMIT 5;
```

**判定**：
- `content` 明显小于 `clip-storage` 里实际剪藏数 → 需要 `rebuild`（前端调 `rebuild()` 或重启程序）。
- `content_fts` 可检索数 < `content` 数 → FTS 未同步，执行一次 `INSERT INTO content_fts(content_fts) VALUES('rebuild')`。

---

## 五、Windows 特注意事项

1. 程序运行时用**只读**打开（见 §3.3），避免 WAL 单写锁冲突。
2. URI 只读方式在盘符路径（`C:\...`）上若报错，直接用 §3.4 只读副本。
3. 不要一边让序跑 `rebuild()` 一边用客户端写库（会触发锁竞争 / SQLITE_CORRUPT，历史上 FTS 逐行 DELETE 有 CORRUPT 隐患）。
4. `node:sqlite` 属实验性模块，主进程 stderr 会有 `ExperimentalWarning`，属正常，非错误。

---

## 附：相关代码位置

- 编排入口：[electron/sqlite/index-service.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/index-service.js)
- 库驱动/迁移：[electron/sqlite/db.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/db.js)、[electron/sqlite/init.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/init.js)
- 扫描/抽取：[electron/sqlite/scanner.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/scanner.js)
- 写入/重建：[electron/sqlite/indexer.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/indexer.js)
- 检索：[electron/sqlite/search.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/search.js)
- IPC 接线：[electron/main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js) / [electron/preload.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/preload.js)