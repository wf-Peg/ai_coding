# SQLite 本地索引层设计（可无损迁 TS、不依赖 Java 后端）

> 状态：设计稿（design）
> 目标：在现有 JSON 文件系统之上，引入 SQLite 作为**本地索引层**，提供全文搜索、关系/图谱、快速列表等能力，替代当前 Java 内存扫描 + 辅助 JSON 索引文件。
> 硬约束：**不依赖 Java 后端实现**，落地后可在完全移除 Spring Boot / JRE 时无损迁移到 Electron 主进程的纯 TypeScript / Node 实现。

---

## 一、问题背景与现状

当前数据链路（全 Java，索引无持久化数据库）：

```
前端 (frontend/*.js)
   │  fetch → http://127.0.0.1:8081/api/...  (Spring Boot REST)
   ▼
backend: FileStorageService (JSON 文件系统 = 权威数据源)
   ├── clip-storage/{category}/{yyMMdd}.json   剪藏
   ├── todoList/{yyMMdd}.json                  待办
   ├── knowledge/{yyMMdd}.json                 知识条目
   ├── knowledge-base/{yyyy-MM-dd}.json        知识库
   ├── learning-plan/{yyyy-MM-dd}.json         学习计划
   ▼
索引（内存扫描 / 辅助 JSON，无 DB）：
   ├── SearchService        → 全量扫 JSON + 同义词匹配，无倒排
   ├── GraphService         → relation-index.json / content-index.json 全量读内存 O(n)
   ├── RelationIndexService → 每次 add/remove 全量 readAll + 重写整个 JSON 文件
   └── ContentIndexService  → 同上
```

**痛点**：
1. `SearchService` 每次搜索全量遍历所有 JSON 文件，数据量增大后变慢。
2. `RelationIndexService`/`ContentIndexService` 每次变更整文件 read-modify-write，O(n) 且频繁全量 IO。
3. 索引逻辑深度耦合 Java（Spring 注入、Jackson）、`getAllXxx()` 内存全表扫描。
4. 无查询缓存、无增量更新、无数仓/分词能力。

---

## 二、设计原则（决定能否无损迁 TS）

1. **JSON 文件是唯一事实来源，SQLite 只是索引**——绝不把 SQLite 变成又要文件又要别的主存储。
2. **索引逻辑全放在「本地索引层」**，不依赖 Spring 注入、不依赖 Java 类库，只用标准 SQL 与文件系统。
3. **层的位置在 Electron 主进程（Node/TS）**，未来 Java 后端移除后，这一层原封不动继续工作。
4. **对外接口以「内部契约」暴露**：前端仍可用既有语义（搜索/图谱/列表），只是承载通道从 REST 换成 IPC（preload + `ipcMain.handle`）。
5. **一致性采用「文件为真、库为缓存」**：索引库可随时全量重建、局部丢弃重建，绝不阻塞写入幂等。

---

## 三、目标架构

```
Electron 主进程（Node/TS，不依赖 Java）
   electron/sqlite/
   ├── init.js             建库建表、迁移（schema version）
   ├── db.js               better-sqlite3 单例连接（同步 API，事务）
   ├── scanner.js          扫描 JSON 文件系统 → 提取可索引记录
   ├── indexer.js          增量 upsert / delete 到 sqlite
   ├── fts.js              全文检索查询封装（FTS5 + 中文分词策略）
   ├── graph.js            图谱节点/关系查询（替代 relation-index.json）
   ├── search.js           对外搜索契约（等价现有 /api/search）
   └── sync.js             文件 watcher + 全量重建调度
           │
   preload.js 暴露 window.electronAPI.localIndex.*  (ipcRenderer.invoke)
           │
   ipcMain.handle('local-index:search' | 'local-index:graph' | ...)
```

迁移到公开后端 memory：当 Spring Boot 被移除后，REST 的 `SearchController`/`GraphController` 直接改由 `ipcMain.handle` 转发到 `electron/sqlite/search.js` / `graph.js`，前端 114 处调用经统一 `apiClient` 分发，改造量集中在底层。

---

## 四、SQLite 数据模型（建表设计）

数据库文件位置：`{clip.storage.path}/.index/app-index.sqlite`（与应用数据同根，随用户数据走，不受小版本覆盖影响）。schema 由 `__meta` 表管理版本迁移。

### 4.1 `meta` — schema 版本

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- value: schema_version (整数)，data_generation (重建世代号)
```

### 4.2 `content` — 主内容索引（所有实体通用）

统一建模 clip / knowledge / learning-plan 等一切可检索对象：

```sql
CREATE TABLE IF NOT EXISTS content (
  id         TEXT PRIMARY KEY,   -- 全局唯一键：clip:123 / knowledge:456 / learning-plan:789
  type       TEXT NOT NULL,      -- 'clip' | 'knowledge' | 'learning-plan' | 'todo' | 'wiki'
  source_id  INTEGER,            -- 原始自增 ID（对应 JSON 里的 id）
  title      TEXT,
  summary    TEXT,
  category   TEXT,
  tags       TEXT,               -- JSON 数组字符串化
  body_plain TEXT,               -- 抽取的纯文本（用于 FTS 搜索）
  content_ref TEXT,              -- JSON：ContentRef 原始字段保真（保返回结构不变）
  mtime      TEXT,               -- 索引时记录的源文件修改时间（增量判断）
  file_path  TEXT,               -- 来源文件绝对路径（便于 traceback 与失效清理）
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_type   ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_source ON content(source_id);
CREATE INDEX IF NOT EXISTS idx_content_file   ON content(file_path);
```

### 4.3 `content_fts` — FTS5 全文检索虚拟表（external content 模式）

```sql
-- external content 模式：data=content，保证主表与全文索引一致，不回写冗余
CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  title,
  body_plain,
  category,
  tags,
  content='content',
  content_rowid='rowid',
  tokenize='unicode61'   -- 详见 6.2 中文分词策略
);
```

> 用 FTS5 而非常规 LIKE，因为 SQLite 内置倒排索引，子串/前缀/短语/布尔检索远超 `LIKE '%kw%'` 全表扫。

### 4.4 `relation` — 图谱关系（替代 relation-index.json）

```sql
CREATE TABLE IF NOT EXISTS relation (
  from_id     TEXT NOT NULL,   -- clip:123 / knowledge:456 ...
  to_id       TEXT NOT NULL,
  relation_type TEXT NOT NULL, -- derived_from | linked_to | plan_links
  link_subtype TEXT,           -- clip_to_knowledge / wikilink / learning_plan_link
  weight      REAL DEFAULT 1.0,
  created_at  TEXT,
  PRIMARY KEY (from_id, to_id, relation_type)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_relation_from ON relation(from_id);
CREATE INDEX IF NOT EXISTS idx_relation_to   ON relation(to_id);
```

### 4.5 `content_holder`（可选，二期）— content-index.json 的归宿

二期用 `content` 表直接替代 `content-index.json` 的查询（`content_ref` 保真），无需独立表。

---

## 五、Node 侧实现要点

### 5.1 驱动选择：`better-sqlite3`（同步、无回调地狱、事务直观）

- 必须在 Electron 主进程运行，**不打包进 asar unpack 需处理原生二进制**（本项目 onnxruntime 已有 `afterPack` 先例，参照裁剪/解压逻辑）。
- 若顾虑原生模块体积/编译，可评估 Node 内置 `node:sqlite`（Node ≥ 22.5，内置同步 API，零外依赖，天然迁 TS）。**推荐作为首选**；二者接口可抽象为同一 `Db` 门面，切换零成本。

### 5.2 建库与迁移（init.js）

```js
// 伪代码：实现要点
function openDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');   // 读写并发，降低主进程卡顿
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate(db); // 按 meta.schema_version 逐级升级
  return db;
}
```

### 5.3 增量索引（indexer.js）

write path（Java 侧每次成功写 JSON 后，或未来 Node 侧直接写后）触发：

```js
function upsert(record) {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO content (...) VALUES (...)
                ON CONFLICT(id) DO UPDATE SET ...`).run(record);
    db.prepare(`INSERT INTO content_fts(rowid, title, body_plain, category, tags)
                SELECT rowid, title, body_plain, category, tags FROM content WHERE id=?`)
      .run(record.id);
    // relation 同理：先删后插 for 幂等
  });
  tx();
}
```

### 5.4 全量重建（sync.js）

`POST /api/relations/sync` 语义映射到 `local-index:rebuild`：

1. `scanner` 遍历 clip-storage 各目录/JSON 文件提取记录；
2. 若文件 mtime 与库中不一致 → 增量 upsert/delete；
3. 可选世代号 `data_generation++` 用于处理整目录删除。

### 5.5 与 Java 后端的双写协调（过渡期）

暂不迁 TS、Java 还活跃的阶段：
- Java 写 JSON（事实源）→ 主进程通过 **chokidar 监听 clip-storage 变更** → 回调 `indexer.upsert`。
- 避免 Java 与 Node 同时写 SQLite（避免锁竞争）：**SQLite 只由 Node 主进程写**，Java 只负责 JSON，索引由 Node 侧监听消费。
- 前端读：搜索/图谱/Git 相关走新的 `local-index:*` IPC；其余 CRUD 仍走 REST（过渡期共存）。

---

## 六、关键设计决策与风险

### 6.1 为什么索引在 Node 而非 Java

- 与"最终迁 TS"目标零摩擦：Node 侧逻辑未来就是 TS 侧逻辑。
- 避免 Java 占有 SQLite 文件导致迁移时锁节点/文件句柄残留。
- 主进程本就掌握窗口与 IPC，索引查询不需要网络栈。

### 6.2 中文全文检索

- `unicode61` tokenizer 对中文**按整句分词**，英文 OK，中文效果一般但满足多数标题/标签搜索。
- 更优方案：FTS5 + `trigram` tokenizer（SQLite 3.34+），支持 `LIKE '%中文%'` 式子串，中文体验好，代价是索引更大。**二选一在 init.js 用 tokenizer 配置，可在 3.34+ 直接启用 trigram。**
- 不接受引入独立分词 JAR/SDK（违背不依赖 Java）。

### 6.3 一致性：`file_path + mtime` 失效判定

- 每次增删改记录 `file_path` 与源文件 mtime；
- sync 时对库中同一 file_path 但 mtime 变化 → 重新解析 upsert；
- 全目录删除：比对磁盘文件集合与库中 file_path 集合，差异则 delete。

### 6.4 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| FTS 与主表一致性 | 搜索漏/错 | external content + 事务内同写主表与 fts；重建兜底 |
| 中文分词效果 | 搜索命中率 | trigram；一期用 title+tags 限域（正文可选降级 LIKE） |
| 双写与锁竞争 | 索引卡顿/写失效 | 仅 Node 写库，Java 写 JSON，watcher 消费 |
| better-sqlite3 原生包 | 打包体积/编译 | 优先 `node:sqlite`；afterPack 处理原生二进制 |
| 迁移期前端契约 | 改造量大 | 统一 apiClient + `local-index:*` 同语义封装 |

---

## 七、接口契约（IPC，等价现有 REST）

| 新 IPC 频道 | 等价 REST | 说明 |
|---|---|---|
| `local-index:search` | `/api/search` + `/api/search/category` | 返回与现有 search 同结构 |
| `local-index:graph` | `/api/graph` | nodes/links 结构不变 |
| `local-index:rebuild` | `/api/relations/sync` | 全量重建 |
| `local-index:list-by-type` | 分类/列表类 | 走 content 表快速列表 |
| `local-index:status` | - | 索引是否就绪/世代号 |

`preload.js` 增加 `window.electronAPI.localIndex.*`，复用现有 IPC 模式（见 `electron/preload.js` 60+ 个先例）。前端统一入口走 `apiClient`，把 `/api/clip/list` 等当内部契约分发，降低 114 处调用改造量。

---

## 八、落地拆分细化（实施顺序，可独立交付）

- **M0 基建**：`electron/sqlite/` 建库迁移 + `node:sqlite`/`better-sqlite3` 选型，单测（`node --test`）。
- **M1 内容索引**：`content` 表 + scanner 全量建索引 + `local-index:list-by-type`。
- **M2 全文搜索**：FTS5 + `local-index:search`，对齐现有 `SearchService` 返回结构；watcher 增量。
- **M3 图谱/关系**：`relation` 表 + `local-index:graph` 替代 `relation-index.json`。
- **M4 契约接入**：前端 `apiClient` 收敛搜索/图谱调用，双通道过渡。
- **M5 迁移保底**：`local-index:rebuild` + 自检（与 JSON 对账 count）。

> 当前阶段仅 M0–M5 采用 Node 实现（纯 TS 可移植）；不触碰 CRUD 写入链路，Java 后端与 JRE 保留。

---

## 九、结论

- 引入 SQLite 作为**本地索引层**，直接解决全文搜索慢、关系索引 O(n) 全量重写、耦合 Java 三个痛点。
- 索引层刻意放在 **Electron 主进程 Node 侧**，不依赖 Java，天然满足"可无损迁 TS、可移除后端"的约束。
- 一致性遵循"文件为真、库为缓存"，可随时全量重建，风险可控。
- 当前只落地支持库迁移（不作 CRUD 替换），与"先只迁 sqlite"的范围一致。