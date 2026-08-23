# M3 图谱关系层（relation 表替代 relation-index.json）实施计划

> 状态：Done（M3.1–M3.7 已实现并验证）
> 阶段：SQLite 本地索引层第二期
> 交付：schema v2 relation表 + knowledge/learning-plan 实体索引 + 三类型关系构建 + 图谱查询IPC + 前端接线 + 遗留 index 迁移（单测 14/14、editor 23/23）
> 关联：`docs/superpowers/specs/2026-08-22-sqlite-local-index-design.md`、`sqlite-local-index-layer-clip-phase1.md`
> 目标：在 Electron 主进程 Node 的 SQLite 索引层中新增 `relation` 表，替代 Java 侧 `index/relation-index.json`，为前端知识图谱提供统一的关系数据源，逐步脱离 Spring Boot。

---

## 一、现状与差距（调研结论）

### 1. 现状（Java 侧）
- `backend/.../index/ContentRelation.java`：关系记录 `(fromId, toId, relationType, source, confidence, createdAt)`
- `backend/.../index/RelationIndexService.java`：`relation-index.json` 的读写封装（add/remove/clear/findFor/readAll）
- `backend/.../service/GraphService.java`：三类关系
  - `derived_from`：`clip:{cid} → knowledge:{kid}`（来源剪藏）
  - `linked_to`：`knowledge:{kid} → knowledge:{lid}`（双向链接）
  - `plan_links`：`learning-plan:{id} → knowledge:{kid}/clip:{cid}`（阶段关联）
- `backend/.../controller/GraphController.java`：`GET /api/graph`、`POST /api/relations/sync`
- 前端 `frontend/knowledge-graph.js`：调用 `/api/graph` → D3 渲染

### 2. Node 索引层现状（一期已完成）
- 仅索引 clip 内容（`content` 表），目录排除 `knowledge/learning-plan/todoList` 等
- 具备建库迁移、增量 upsert、FTS 搜索、实时 watcher
- **尚未纳入** knowledge / learning-plan 实体，因此无关系数据

### 3. 关键差距
- Node 侧无 `relation` 表、无知识/学习计划实体、无图谱查询接口
- 前端图谱仍强依赖 Java `/api/graph`

---

## 二、目标与边界

### 本期目标
1. 新增 `relation` 表（schema v2）
2. 引入 knowledge / learning-plan 实体索引（作为关系端点与节点元信息）
3. 从权威字段构建三类型关系写入 `relation` 表
4. Node 侧提供图谱查询（nodes + links）+ IPC
5. 前端 `knowledge-graph.js` 迁移到 apiClient（本地索引优先，REST 回退）
6. 一次性迁移：将现有 `relation-index.json` 导入 `relation` 表，避免丢历史

### 不在本期
- 前端图谱 UI 交互改造（筛选、节点展开、编辑关系）
- 移除 Java `GraphService/RelationIndexService`（保留用于回退，后续独立迁移阶段删除）

---

## 三、实施步骤（PHASE M3）

### M3.1 schema v2：relation 表 + 实体迁移
- `electron/sqlite/init.js`：
  - `SCHEMA_VERSION = 2`
  - `migrate()` 增加 `if (current < 2)` 分支，追加 `SQL_V2`
  - `relation` 表 DDL：
    ```sql
    CREATE TABLE IF NOT EXISTS relation (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id       TEXT NOT NULL,
      to_id         TEXT NOT NULL,
      relation_type TEXT NOT NULL,      -- derived_from / linked_to / plan_links
      source        TEXT,               -- clip_to_knowledge / wikilink / learning_plan_link
      confidence    REAL DEFAULT 1.0,
      created_at    TEXT,
      UNIQUE(from_id, to_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_relation_from ON relation(from_id);
    CREATE INDEX IF NOT EXISTS idx_relation_to   ON relation(to_id);
    CREATE INDEX IF NOT EXISTS idx_relation_type ON relation(relation_type);
    ```
  - `content` 表 `type` 扩展支持 `knowledge` / `learning-plan`（不改表，仅使用现有 `type` 字段）

### M3.2 实体扫描器扩展
- `electron/sqlite/scanner.js`：
  - 新增 `scanEntities(storagePath)`：分别读取 `{base}/knowledge/{yyMMdd}.json`、`{base}/learning-plan/{date}.json`
  - 复用 `parseClipFile` 的三种形态解析（数组 / `{clips}`），knowledge/plan 也是数组
  - 排除逻辑：这批文件本身就是目标，不走 clip 的排除集
  - `resolveClipStoragePath` 增加 `resolveBasePath`（返回 `clip-storage` 的父目录），供 knowledge/learning-plan 定位

### M3.3 关系构建 & 写入
- `electron/sqlite/relation-builder.js`（新）：
  - `buildRelations(db, entities)`：读权威字段生成关系
    - knowledge `sourceClipIds` → `clip:{cid} → knowledge:{kid}`（`derived_from`）
    - knowledge `linkedKnowledgeIds` → `knowledge:{kid} → knowledge:{kid}`（`linked_to`，排除自环）
    - learning-plan 各 phase 的 `linkedKnowledgeIds`/`sourceClipIds` → `learning-plan:{id} → ...`（`plan_links`）
  - 先按参与 entity 清空旧关系（对齐 Java `recordKnowledgeRelations` 幂等语义），再统一写入
- `electron/sqlite/index-service.js`：
  - `rescan` 扩展：除 clip 外，同时扫描 knowledge / learning-plan，写入 `content`（type=knowledge/plan）+ `relation`
  - 末尾统一 `rebuildFts`（仅 content_fts 涉及 clip/knowledge body）

### M3.4 图谱查询 + IPC
- `electron/sqlite/graph.js`（新）：
  - `getGraph(db, includeTypes)`：查询 relations + 关联节点，装配 `{ nodes, links }`
  - `listRelations(db, findId)`：反链/出链查询（供编辑器反链面板复用）
- `electron/main.js`：注册 IPC
  - `local-index:graph` ❨items] 返回完整图谱
  - `local-index:relations` ❨findId] 返回某节点关系

### M3.5 前端接线
- `frontend/js/clip-shared.js` `apiClient`：新增 `fetchGraph({includeTypes})`、`fetchRelations(findId)`
- `frontend/js/clip-list.js` / `frontend/knowledge-graph.js`：图谱页 `fetchData()` 改走 apiClient → 本地索引优先，失败回退 REST（与一期搜索同一模式）

### M3.6 一次性数据迁移
- `electron/sqlite/migrate-from-relations-json.js`（新）：
  - 读取旧 `index/relation-index.json`
  - 幂等 upsert 进 `relation` 表
  - 成功后按版本号标记导入完成（写 meta 键 `relation_imported_v1=true`），避免重复导入
- 挂到 `initLocalIndex` 首次建 v2 之后执行

### M3.7 测试 & 验证
- `electron/sqlite/graph.test.js`：覆盖三类关系构建、去重、自环排除、幂等重建
- `electron/sqlite/relation-builder.test.js`：knowledge/plan 字段边界（null / 空数组 / 重复 id）
- 回归：`node --test electron/sqlite/*.test.js` + `npm run test:editor-all`
- 联调：mock `Clip_Bed` 数据（knowledge+plan）验证图谱节点/边正确

---

## 四、验证标准（Definition of Done）
- [ ] `relation` 表随 schema v2 自动建立，旧库无数据丢失
- [ ] 三类关系（derived_from / linked_to / plan_links）从权威字段正确构建
- [ ] 旧 `relation-index.json` 一次迁移成功，meta 标记防重
- [ ] `local-index:graph`、`local-index:relations` IPC 可用
- [ ] 前端知识图谱页改走本地索引，Java 不可用时图谱仍可用
- [ ] 全量回归测试通过

---

## 五、风险与决策
| 风险 | 应对 |
|---|---|
| knowledge/learning-plan 文件结构多变 | 复用一期 `parseClipFile` 三形态解析，解析失败空结果不中断 |
| 关系量大导致重扫慢 | 全部走单事务 + 索引覆盖查询；relation 表按 id 唯一聚簇 |
| watcher 触发频率高 | 复用一期防抖，knowledge/plan 变更纳入同一次 `rescan` |
| 旧 data 结构不匹配 | 迁移脚本容错（解析失败跳过单条），仅读不改写权威 JSON |