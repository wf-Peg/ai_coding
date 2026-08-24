# SQLite 本地索引层（一期：clip 内容索引 + 全文搜索）实施计划

> 状态：Done（已实现并验证）
> 交付提交：`feature`（electron/sqlite/ + main.js + preload.js 本地索引接口）
> 关联文档：`docs/superpowers/specs/2026-08-22-sqlite-local-index-design.md`（下称「设计文档」）
> 目标：在 Electron 主进程 Node 侧引入 SQLite 索引层，一期只覆盖「剪藏 clip」的内容索引 + 全文搜索，解决当前 Java 侧 `SearchService` 全量内存扫描的痛点，且不依赖 Java 后端、可无损迁 TS。

---

## 一、概述（Summary）

在现有 JSON 文件系统（`clip-storage/{category}/{yyMMdd}.json` 为权威数据源）之上，新增一个轻量的 SQLite 索引库，仅索引「clip」类型数据，提供：

- `local-index:search` —— 等价现有 `GET /api/clip/search` 的全文搜索（一期仅 FTS5 精确匹配）
- `local-index:list-by-type` —— 快速列表查询
- `local-index:status` —— 索引就绪状态 / 世代号

索引层完全落在 Electron 主进程 Node 侧（`electron/sqlite/`），使用 Node 内置 `node:sqlite`（零第三方依赖），不经过 Spring Boot、不依赖 Java 类库，为后续「完全移除 Spring Boot / JRE」的迁移铺路。本次**只做索引层本身**，不改造前端调用（前端 `apiClient` 抽象层与契约接入作为独立议题 M4 另议）。

---

## 二、Node 升级 review 结论（已完成的先行步骤）

上一阶段已完成 Electron 与 electron-builder 升级，review 结论如下：

| 检查项 | 现状 | 结论 |
|---|---|---|
| electron | `^36.9.5` | ✅ 已升级，内置 Node **22.19.0** |
| electron-builder | `^26.15.7` | ✅ 已升级 |
| `win.sign`/`signingHashAlgorithms` | 已替换为 `win.signtoolOptions: null` | ✅ 修复 builder 26 schema 兼容 |
| 镜像配置 | `.npmrc` 删除，迁到 `ELECTRON_MIRROR` 环境变量 | ✅ npm 警告消除 |
| `node:sqlite` | 已在 Electron 36 下验证 `require('node:sqlite')` 可用 | ✅ 可用 |
| 打包验证 | `--dir` 产物正常启动，原生模块按 Electron 36 重建 | ✅ 通过 |

**遗留风险（不阻塞，但需知晓）**：`node:sqlite` 在 Node 22 属实验性模块（stability 1.1），`require` 时会向 stderr 输出 `ExperimentalWarning: SQLite is an experimental feature`。功能可用、不影响运行；一期选择「接受告警」，不刻意抑制。

> 关键收益确认：本次 Node 升级正是为 `node:sqlite` 铺路——Electron 28 内置 Node 18.18 无法使用 `node:sqlite`，升级到 36（Node 22.19）后，索引层可用**零第三方依赖**的内置 SQLite，避免引入 `better-sqlite3` 原生模块带来的打包体积/编译成本。

---

## 三、现状分析（Current State）

### 3.1 现有数据链路

```
前端 frontend/*.js —— fetch http://127.0.0.1:8081/api/... ——▶ Spring Boot (backend/)
   ├── FileStorageService：JSON 文件系统（权威数据源）
   │     clip-storage/{category}/{yyMMdd}.json   剪藏
   │     todoList/{yyMMdd}.json                  待办
   │     knowledge/{yyMMdd}.json                 知识
   │     knowledge-base/{yyyy-MM-dd}.json        知识库
   │     learning-plan/{yyyy-MM-dd}.json         学习计划
   └── 索引（Java 内存扫描，无 DB）
         SearchService        → getAllClips() 全量扫描 + contains 匹配 + AI 同义词兜底
         GraphService         → index/relation-index.json + index/content-index.json 全量读内存
         RelationIndexService → 每次 add/remove 全量 readAll + 重写 JSON
```

### 3.2 关键事实（探索确认，纠正设计文档偏差）

1. **搜索只覆盖 clip**：`SearchService.search()`（[SearchService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/SearchService.java#L54-L73)）只用 `getAllClips()`，返回 `List<ClipContent>`。它**不索引** knowledge/todo/learning-plan。搜索字段拼接见 [SearchService.java L177-L235](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/SearchService.java#L177-L235)（content/type/source/category/summary/analysis/tags 拼接 lowercase 后 `contains`）。

2. **搜索接口**：`GET /api/clip/search?query=&topK=` 与 `GET /api/clip/search/category?query=&category=`，见 [ClipController.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/controller/ClipController.java#L397-L432)。

3. **ClipContent 实体 40+ 字段**：[ClipContent.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/model/ClipContent.java)（id/content/type/source/category/title/sourceUrl/siteName/capturedAt/selectedText/tags/summary/analysis/divergentSummary/imagePaths/bodyContent…）。→ 索引表**不复制这些字段**，用 `content_ref` 存完整 clip JSON，返回时反序列化原样给出，保返回结构不变。

4. **索引库路径事实来源是 Electron `config.storagePath`**，而非 `application.yml` 的 `clip.storage.path`：
   - `application.yml`（[application.yml L33-35](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/resources/application.yml#L33-L35)）里是**开发机硬编码路径**，仅作模板。
   - 后端 jar 启动时，Electron 在 JAR 同级目录**动态生成** `application.yml`，用 `generateApplicationYml(config)` 以 `config.storagePath` 覆盖（[main.js L673-L676](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L673-L676)）。
   - `config.storagePath` 是 Clip_Bed 父目录，`clip-storage`/`clip-organized`/`weekly-report` 为其固定子目录（[main.js L150-153](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L150-L153)）。
   - **结论**：索引库应落盘于 `{config.storagePath}/.index/app-index.sqlite`（与三个子目录平级）。

5. **`config.storagePath` 的 clip-storage 路径归一化已存在**：`main.js` 内多处用 `config.storagePath.endsWith('clip-storage') ? ... : path.join(config.storagePath, 'clip-storage')` 归一（[main.js L534-536](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L534-L536)、[L2217-2219](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L2217-L2219)）。索引层的 scanner 应复用同一归一逻辑。

6. **IPC 模式成熟**：`main.js` 的 `setupIPC()`（[L2184](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L2184)）+ `preload.js` 的 `contextBridge.exposeInMainWorld('electronAPI', ...)`（[preload.js L20-L22](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/preload.js#L20-L22)）已有 60+ 个 `ipcMain.handle` + `ipcRenderer.invoke` 先例，索引层直接复用该模式。

---

## 四、设计文档审核发现（需对齐的问题清单）

对 `2026-08-22-sqlite-local-index-design.md` 逐条审核，发现以下偏差，本计划据此对齐：

| # | 设计文档原述 | 现状事实 | 对齐结论 |
|---|---|---|---|
| 1 | §5.1 标题写「better-sqlite3」，正文又「推荐 node:sqlite」 | Node 已升 22.19，`node:sqlite` 可用 | **收敛为 `node:sqlite`**，彻底放弃 better-sqlite3（免原生模块体积/编译） |
| 2 | §7 假设「统一 apiClient 分发 114 处调用」 | 前端**无 apiClient 抽象**，硬编码 `http://127.0.0.1:8081/api/...`（grep 14 处、glob 无 apiClient 文件） | 前端改造（新建 apiClient + M4 契约接入）**移出本次范围**，独立议题 |
| 3 | §4 统一建模 clip/knowledge/learning-plan/todo/wiki 一切实体 | 现状 `SearchService` 只搜 clip | 一期 content 表**只承载 clip**，其余实体留二期 |
| 4 | §4 索引库位置 `{clip.storage.path}/.index/` | 事实来源是 Electron `config.storagePath` | 落盘 `{config.storagePath}/.index/app-index.sqlite` |
| 5 | content 表字段 `summary/tags/body_plain` 等 | ClipContent 有 40+ 字段，不可全复制 | `content_ref` 存完整 clip JSON 保真，content 表只留索引/检索必需列 |
| 6 | §5.5 用 `chokidar` 监听 | `package.json` 无 chokidar 依赖 | 一期不做实时 watcher，用「启动全量建索引 + `local-index:rebuild` 手动/按需重建」；增量 watcher 留二期 |
| 7 | §6.2 trigram（SQLite 3.34+） | `node:sqlite` 捆绑 SQLite 版本较新，但 trigram tokenizer 是否编译启用**需实测** | 一期用 `unicode61`（英文 OK、中文标题/标签够用）；trigram 作为 M2 内的实测分支 |

---

## 五、范围与决策（已由用户拍板）

1. **搜索范围**：一期只索引「clip」，`local-index:search` 对齐 `GET /api/clip/search` 的返回结构（`List<ClipContent>`）。
2. **交付范围**：只做索引层本身（`electron/sqlite/` + IPC + preload 暴露接口），**不含前端页面改造**（apiClient/调用改 IPC 属 M4，独立议题）。
3. **一期 AI 同义词兜底**：`SearchService` 现有「精确 `contains` + AI 同义词」两级策略。AI 同义词依赖 Java 侧 `AiService`（dashscope）。一期 `local-index:search` **只做 FTS5 精确匹配**；AI 同义词兜底**仍留在 Java REST**，不迁（二期再议）。

---

## 六、对齐后的技术方案

### 6.1 目录与文件

```
electron/sqlite/
├── db.js        # node:sqlite DatabaseSync 单例；openDatabase(dbPath)：WAL + 迁移
├── init.js      # 建表 SQL（meta/content/content_fts）；schema_version 迁移
├── scanner.js   # 扫描 clip-storage/**/*.json → 提取可索引 clip 记录
├── indexer.js   # 增量 upsert / delete clip 到 content + content_fts
├── search.js    # FTS5 查询，返回 List<ClipContent>（content_ref 反序列化）
└── (index.test.js)  # node --test 单测（node:sqlite 建库/索引/搜索）
```

### 6.2 驱动：`node:sqlite` 门面（对应原设计 §5.1/§5.2）

```js
// electron/sqlite/db.js（要点）
const { DatabaseSync } = require('node:sqlite');

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');      // 读写并发，降主进程卡顿
  db.exec('PRAGMA synchronous = NORMAL;');
  migrate(db);                                 // 按 meta.schema_version 逐级升级
  return db;
}
```

> 与 better-sqlite3 的 API 差异需注意：`node:sqlite` 无 `db.transaction()`，事务需手写 `db.exec('BEGIN')/COMMIT/ROLLBACK`；`StatementSync` 提供 `.run()/.get()/.all()`。两者均为同步 API，设计文档中的 db 门面抽象可直接以 node:sqlite 落地。

### 6.3 建表（对齐后，仅 clip）

```sql
-- meta：schema 版本
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- content：只承载 clip
CREATE TABLE IF NOT EXISTS content (
  id          TEXT PRIMARY KEY,          -- 'clip:123'
  type        TEXT NOT NULL,             -- 'clip'
  source_id   INTEGER,                   -- 原 clip.id
  title       TEXT,
  summary     TEXT,
  category    TEXT,
  tags        TEXT,                      -- JSON 数组字符串化
  body_plain  TEXT,                      -- 抽取纯文本供 FTS（content/summary/analysis/tags 拼接）
  content_ref TEXT,                      -- 完整 ClipContent JSON（保返回结构）
  mtime       TEXT,                      -- 源文件 mtime（增量判定）
  file_path   TEXT,                      -- 来源文件绝对路径
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_type   ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_source ON content(source_id);
CREATE INDEX IF NOT EXISTS idx_content_file   ON content(file_path);

-- FTS5 external content（tokenize 一期 unicode61，M2 实测 trigram 分支）
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  title, body_plain, category, tags,
  content='content', content_rowid='rowid', tokenize='unicode61'
);
```

> 关键约束：`content` 表**不得**加 `WITHOUT ROWID`（它用 `id TEXT PRIMARY KEY` → 存在隐式 rowid 供 FTS5 `content_rowid='rowid'` 关联，否则 FTS 关联会失效）。

### 6.4 索引写入语义

- 「文件为真、库为缓存」：JSON 文件是权威，SQLite 可随时全量重建。
- 以 `file_path + mtime` 判定增量；启动时全量扫描建索引；`local-index:rebuild` 触发全量重建。
- 仅 Node 主进程写 SQLite（follow 原设计 §5.5 的「避免双写锁竞争」原则）；Java 仍写 JSON。

### 6.5 IPC / preload 接口

`main.js` `setupIPC()` 内新增（复用现有 `ipcMain.handle` 模式）：

| IPC 频道 | 等价 REST | 返回 |
|---|---|---|
| `local-index:search` | `/api/clip/search` | `List<ClipContent>`（content_ref 反序列化） |
| `local-index:list-by-type` | 分类/列表 | clip 列表 |
| `local-index:status` | - | `{ ready, generation, count }` |
| `local-index:rebuild` | `/api/relations/sync` | 全量重建结果 |

`preload.js` 增加 `window.electronAPI.localIndex.{search,listByType,status,rebuild}`（`ipcRenderer.invoke` 包装），只「暴露接口」，不改造前端消费方。

### 6.6 索引库路径与初始化时机

- 路径：`path.join(config.storagePath, '.index', 'app-index.sqlite')`；`.index/` 目录惰性创建。
- 初始化时机：`app.whenReady()` 后（config 已加载）调用 `initLocalIndex(config.storagePath)`，建库建表；随后异步全量扫描建索引（不阻塞窗口）。

---

## 七、实施步骤

### M0 —— 基建：建库 + 驱动门面 + 单测  ✅ 完成
- 新增 `electron/sqlite/db.js`：`DatabaseSync` 单例 + WAL + `migrate()`。
- 新增 `electron/sqlite/init.js`：`meta`/`content`/`content_fts` 建表 SQL + `schema_version=1` 迁移。
- 新增 `electron/sqlite/db.test.js`：用 `node --test` 验证建库/建表/FTS5 可用性（含 trigram 实测分支）。
- 验证：`node --test electron/sqlite/db.test.js` 通过（5/5）；`node:sqlite` 无异常。

### M1 —— 索引 clip：scanner + indexer + 列表  ✅ 完成
- 新增 `electron/sqlite/scanner.js`：复用 main.js 的 clip-storage 路径归一逻辑，扫描 `clip-storage/**/*.json`，解析每个 clip（id/type/category/title/summary/tags/analysis/content），拼接 `body_plain`，保留完整 JSON 进 `content_ref`，记录 `file_path`/`mtime`。
- 新增 `electron/sqlite/indexer.js`：`upsert(clip)`（`INSERT ... ON CONFLICT(id) DO UPDATE`，事务内同步写 content + content_fts）。
- `main.js`：`initLocalIndex()` 建库后 `scanner` 全量 `indexer.upsert`；注册 `local-index:status`、`local-index:list-by-type`、`local-index:rebuild`。
- 验证：对真实 `clip-storage` 目录跑通，`local-index:status` 返回的 `count` 与 JSON 内 clip 条数一致。

### M2 —— 全文搜索：对齐 /api/clip/search  ✅ 完成
- 新增 `electron/sqlite/search.js`：`search(query, topK)` 用 FTS5 `MATCH` 查询，命中后按 `content.content_ref` 反序列化返回 `ClipContent` 数组（字段与 Java 侧一致）。
- 注册 `local-index:search`。
- 对齐校验：对同一 `clip-storage`，比较 `local-index:search(q)` 与 `GET /api/clip/search?query=q` 的结果条数/字段结构（一期仅精确匹配，同义词兜底不在比较范围）。
- 验证：搜索标题/标签/正文关键词能命中；返回字段与 `/api/clip/search` 结构一致。

---

## 八、实施纪要（开发中的关键发现与修复）

### 8.1 SQLITE_CORRUPT(267) 与 FTS 重建
- **现象**：`node:sqlite` 下对 external content 模式的 `content_fts` 做「逐行 DELETE / 直接 DELETE FROM content_fts」会在 WAL 下触发 `SQLITE_CORRUPT database disk image is malformed`。
- **根因**：FTS5 external content 表的 shadow 索引与 WAL 在手动行级删除时不一致。
- **修复**：
  - `upsertClip` 不再逐行同步 FTS；改为只写 `content` 主表，全量流程末尾统一调用 `rebuildFts()`（`INSERT INTO content_fts(content_fts) VALUES('rebuild')`）。
  - `clearAll` 只清 `content` 主表 + `rebuildFts()`，**不手动 `DELETE FROM content_fts`**，从根上规避 CORRUPT。
- **验证**：对真实索引库连续两次 `initLocalIndex`（含 clearAll 重建，generation 递增）均稳定通过。

### 8.2 真实数据里的「重复 clip id」合并
- 真实 `clip-storage` 扫描得 24 条记录、**唯一 id 仅 23**（clip id=`23` 出现在两个不同 JSON 文件）。
- `content` 以 `clip:<source_id>` 为主键 `ON CONFLICT DO UPDATE`，重复 id 自动合并为一行 —— count=23 与「唯一 clip 数」一致，行为正确（对齐 Java 单一 clip id 语义）。

### 8.3 搜索策略：FTS + LIKE 中文兜底
- `search()` 先走 FTS5 `MATCH`（英文/标点分词生效），未命中再走 `LIKE '%q%'` 兜底（中文任意子串）。
- 真实验证：关键词 `Telegram`→4、`下载`→4、`知识管理`→2、`电报`→0（数据中无该词，符合预期）；返回结构含 `id/title/content/summary/category/source/createdAt/tags` 等核心字段，与 Java `ClipContent` 对齐。
- `trigram` tokenizer 实测 supported=true，但一期维持 `unicode61`（LIKE 兜底已覆盖中文），trigram 切换留二期评估。

### 8.4 模块清单（交付）
```
electron/sqlite/
├── db.js          # node:sqlite DatabaseSync 单例；openDatabase(storagePath) → WAL + migrate
├── init.js        # meta/content/content_fts 建表 + schema_version 迁移
├── scanner.js     # 扫描 clip-storage → 可索引 clip 记录（排除非 clip 目录）
├── indexer.js     # upsert/clearAll/rebuildFts/count（幂等等制）示例
├── index-service.js # 对外编排：initLocalIndex/rebuild/status/listByType
├── search.js      # FTS5 + LIKE 中文兜底，返回 List<ClipContent>
└── db.test.js     # node --test 单测
```

### （明确不在本次范围）
- 前端 `apiClient` 抽象 + 114 处调用改 IPC（M4，独立议题）
- 图谱 `relation` 表 + `local-index:graph`（M3，需跨实体 knowledge/learning-plan，与「一期只 clip」冲突）
- 实时 watcher / chokidar 增量（二期）
- AI 同义词搜索迁移到 Node（二期）

---

## 九、假设与决策

1. **驱动**：`node:sqlite`（Node 22.19 已可用，零第三方依赖）；不引 better-sqlite3。
2. **索引库位置**：`{config.storagePath}/.index/app-index.sqlite`。
3. **一期实体范围**：仅 clip；knowledge/todo/learning-plan/wiki 二期扩展。
4. **搜索语义**：一期仅 FTS5 精确匹配 + LIKE 中文兜底；AI 同义词兜底仍走 Java REST。
5. **一致性**：文件为真、库为缓存；`file_path + mtime` 判定；`local-index:rebuild` 全量重建兜底。
6. **tokenizer**：一期 `unicode61`（LIKE 兜底覆盖中文）；`trigram` 实测可用但留二期评估切换。
7. **node:sqlite 实验性告警**：接受 `ExperimentalWarning`，不抑制。
8. **不碰 CRUD 写入链路**：Java 后端与 JRE 保留，索引层只读消费 JSON + 独立写自己的 SQLite。

---

## 十、验证步骤（一期已全部达成 ✅）

1. **单测**：`node --test electron/sqlite/db.test.js` 通过（5/5：node:sqlite 可用、schema_version=1、表创建+FTS 写入、trigram 实测 supported=true、WAL 开启）。
2. **建索引**：真实目录扫描 24 条记录、唯一 id 23，`status.count=23` 与「唯一 clip 数」一致（重复 id 合并）。
3. **搜索对齐**：`local-index:search(q)` 返回结构含 `id/title/content/summary/category/source/createdAt/tags`，与 `ClipContent` 对齐；精确关键词命中正确（中英文均验证）。
4. **重建兜底**：连续两次 `initLocalIndex`（clearAll 重建，generation 递增）后 count 不变、搜索仍正确，无 CORRUPT。
5. **不破坏现有功能**：索引层仅新增模块 + IPC，未改动既有 REST/CRUD 链路。

---

## 十一、遗留 / 二期事项

- M4 契约接入（搜索部分✅已完成）：新建 `window.apiClient.search()`（[clip-shared.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-shared.js)），优先走 `local-index:search` IPC、回退后端 REST；[clip-list.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js) 的 `performSearch()` 已迁移接入。列表 `fetchClips` 仍走 REST（依赖 workspaceId/流程筛选/轮询，本地索引一期不覆盖）。其余待办：
- M3 图谱：`relation` 表替代 `relation-index.json`（需跨 clip/knowledge/learning-plan）。
- 实时增量 watcher（chokidar 或 `fs.watch`）替代「启动全量 + 手动 rebuild」。
- AI 同义词搜索迁移到 Node（对齐 SearchService 两级策略的完整语义）。
- 扩展到 knowledge/todo/learning-plan 的 content 索引。