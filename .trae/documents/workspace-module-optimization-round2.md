# 工作台模块优化（第二轮）实施计划

> 目标：落实工作台模块审阅结论中"建议顺序 1~4 + 维护"的全部条目。
> 范围决策（用户已确认）：
> - 覆盖内容索引回归、工作台/成员 CRUD、删除列策略（迁移到默认列）、建议确定性 ID、事件轻量落库、文档与验收清单维护。
> - 事件链路采用"轻量落库、异步后续"：本轮仅补齐缺失事件写入并统一事件类型常量，不引入异步队列/幂等键。

---

## 背景与现状分析

### 已对齐（不新增处理）
- 本地优先、索引/成员/规则/列独立存储，原始业务数据不作为工作台副本。
- 剪藏/知识/待办/学习计划四类内容已统一解析进 `content-index.json`，映射器等均已落地。
- 规则、排除、来源标识（rule/manual/relation）、看板列与局部状态已落地。

### 需修复/补齐（本轮任务）
| 编号 | 优先级 | 问题 | 根因 | 处置 |
|------|--------|------|------|------|
| 1 | P0 | `ContentIndexStorageScanTest` 期望 4 条、实际 3 条 | 测试 mock 了废弃的 `getAllKnowledgeEntries()`（`knowledge/`、`KnowledgeEntry`），而实现 `ContentIndexService.rebuildFromStorage()` 调用的是 `getAllKnowledge()`（`knowledge-base/`、`Knowledge`）。"统一内容索引不漏内容"未被可靠验证。 | 修测试 + 补真实落盘集成测试 |
| 2 | P1 | 删除看板列后成员关系遗留旧列 ID | `WorkspaceIndexService.deleteColumn()` 仅从 `workspace-columns.json` 过滤列，未迁移 `workspace-memberships.json` 中指向该列的成员；前端仅内存置空 `boardColumnId`。 | 删除非默认列时原子迁移成员到默认列 |
| 3 | P1 | 工作台生命周期不完整：无改名/描述/颜色编辑、无归档/恢复 | `WorkspaceController.updateSettings()` 只改 `matchAll`；创建后无法改 name/description/color；无 status 变更接口。原计划要求完整 CRUD。 | 补编辑 + 归档/恢复接口与 UI |
| 4 | P1 | 手动加入/移除/跨工作台加入无完整入口与 API | 目前仅看板拖拽隐式创建成员（`moveMember`），无"加入/移除成员"独立接口与入口。 | 补成员加入/移除 API + 前端入口 |
| 5 | 缺漏 | 建议 ID 随机、不稳定 | `WorkspaceSuggestionService` 中内容建议用 `s_`+随机 UUID、规则建议用 `rs_`+随机 UUID；刷新后建议身份变化，采纳/忽略/拒绝统计失真。 | 建议改为确定性 ID |
| 6 | 缺漏 | 事件类型常量已定义但多处未实际写入 | `EventTypes` 定义了 `workspace_viewed`、成员增删、`suggestion_shown` 等，但 controller 只写 `board_column_changed`、`suggestion_accepted/ignored/rejected`、`workspace_excluded`。 | 补齐事件写入 + 统一类型常量 |
| 7 | 维护 | 主计划文档停在 2026-08-04，L3~L7 大量未勾选 | 计划文档 `TODO/工作台与数据层重构需求/01-数据层重构与用户习惯聚合开发计划.md` 更新日期止于 L1/L2，与实际代码脱节。 | 同步状态 + 增补验收清单 |

### 关键代码事实（探索确认）
- 实现：`ContentIndexService.rebuildFromStorage()` 依次调用 `getAllClips()`、`getAllKnowledge()`、`getAllTodos()`、`getAllLearningPlans()`。
- 数据源：`getAllKnowledge()` 扫 `knowledge-base/`（`Knowledge`），`getAllKnowledgeEntries()` 扫 `knowledge/`（`KnowledgeEntry`，遗留）。知识模块（`KnowledgeController`/`KnowledgeService`/`WikiQueryService`）实际使用 `getAllKnowledge()`，故**索引实现正确，勿改实现**。
- 成员模型：`WorkspaceMembership(workspaceId, contentId, source, reason, confidence, boardColumnId, position, createdAt, updatedAt)`。
- 列模型：`BoardColumn(id, workspaceId, key, name, position, isDefault, createdAt, updatedAt)`，首次删除即发生在 `WorkspaceController.deleteColumn()`（已校验不可删默认列）。
- 建议模型：`SuggestionCandidate(id, workspaceId, contentId, score, reasons, createdAt, expiresAt, status, type, title, suggestedField, suggestedValue)`。
- 前端详情头：`frontend/js/workspace.js` 中 `loadDetail()` 渲染 `.detail-header-actions`，现含"设为默认/删除"按钮（`setDefaultWsBtn`、`deleteWsBtn`）。
- 前端删除列：`deleteColumn()` 目前仅 `item.boardColumnId = null` 重置内存。

---

## 变更方案

### 任务 1（P0）：修复内容索引测试并补齐四类内容集成测试

**文件：**
- `backend/src/test/java/com/example/clip/index/ContentIndexStorageScanTest.java`
- 新增 `backend/src/test/java/com/example/clip/index/ContentIndexStorageScanIntegrationTest.java`

**做法：**
1. 修改现有 `ContentIndexStorageScanTest`：把 mock 的 `getAllKnowledgeEntries()` 改为 `getAllKnowledge()`（返回 `List<Knowledge>`，`Knowledge` 需构造 id=2L），使四类均被 mock，断言 `readAll().size()==4`。
2. 新增集成测试：用 `@TempDir` 建临时目录，通过真实 `FileStorageService` 写入 clip、knowledge（place 一个 `knowledge-base/xxx.json` 数组含一条 `Knowledge`）、todo、learning-plan 各一例，调用 `new ContentIndexService(temp/index.json).rebuildFromStorage(realStorage)`，断言：总条数=4；`type` 集合恰为 `{clip, knowledge, todo, learning-plan}`；id 前缀正确（`clip:1`、`knowledge:2`、`todo:3`、`learning-plan:4`）。

**验收：** `mvn test` 中该两测试通过，全量 0 失败。

---

### 任务 2（P1）：删除看板列时成员迁移到默认列

**文件：**
- `backend/src/main/java/com/example/clip/index/WorkspaceIndexService.java`
- `backend/src/main/java/com/example/clip/index/WorkspaceIndexServiceTest.java`（或新增）

**做法（方案：迁移到默认列）：**
1. 在 `WorkspaceIndexService` 新增 `deleteColumnWithMigration(workspaceId, columnId)`：
   - 读 columns；若 column 不存在或 `isDefault` 则按现有 Controller 逻辑抛错（Controller 层已校验）。
   - 找到该工作台 `isDefault==true` 的列作为目标列（`DEFAULT_COLUMNS`/`LEARNING_COLUMNS` 首列默认 `isDefault`）。若目标列被删（不应发生，因默认列禁删），则取该工作台 position 最小列兜底。
   - 读 memberships，凡 `boardColumnId==columnId` 的成员，`moveMember(workspaceId, contentId, defaultColId, 0)`（复用现有迁移/保存逻辑）。
   - 再从 `workspace-columns.json` 移除目标列。
2. Controller `WorkspaceController.deleteColumn()` 改为调用 `deleteColumnWithMigration`，异常映射不变。
3. 前端 `frontend/js/workspace.js` 的 `deleteColumnBody`：确认文案由"移将第一列"改为"该列内容将迁移到默认列"；删除成功后内存中该列内容的 `boardColumnId` 置为默认列 ID（需请求返回迁移后的默认列 id，或前端已知默认列）。**简化做法：删除成功后调用一次 `loadDetail()` 重新拉取，避免前端维护内存一致。**

**验收：** 删除非默认列后重新加载，原列内容仍指向存在的默认列；`workspace-memberships.json` 不再出现已删除列 ID。

---

### 任务 3（P1）：工作台编辑 + 归档/恢复

**后端文件：**
- `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`

**做法：**
1. 扩展 `WorkspaceRequest`/新增 `WorkspaceEditRequest`。将现有 `PUT /{workspaceId}/settings`（现仅 matchAll）升级为可编辑 `name/description/color/matchAll`：
   - 保留 `matchAll`；允许更新 name（非空校验）、description、color。
   - 或新增独立 `PUT /{workspaceId}` 编辑接口。**采用扩展现有 `/settings`**，避免新路由；`WorkspaceSettingsRequest` 增加 `name/description/color` 字段（可空，空则保持原值）。`validateWorkspace` 已校验 name 非空、时间为空。
   - 增加 name 长度校验（1~60）、description 长度校验（≤500），在 Controller 或 `WorkspaceIndexService.validateWorkspace` 服务层统一保护（审阅建议"服务层统一保护"）。
2. 新增归档/恢复：`PUT /{workspaceId}/status`，body `{status: "active"|"archived"}`，写入 `WorkspaceIndexService`。归档不影响成员/规则/列/内容；`overview` 已按 status 统计 active/archived，无需额外改。
3. 后端测试：`WorkspaceControllerTest` 补编辑、归档、恢复及非法参数（name 超长 400）用例。

**前端文件：**
- `frontend/js/workspace.js`
- `frontend/workspace.html`（若需编辑弹窗结构，尽量复用现有 modal）

**做法：**
1. `.detail-header-actions` 增加"编辑"与"归档/恢复"按钮（已有"设为默认/删除"）。
2. "编辑"点击打开弹窗（名称/描述/颜色），保存调 `PUT /settings`；成功后 `loadWorkspaces()` + `loadDetail()`。
3. "归档"按钮文案/行为按当前 `ws.status` 切换：active → "归档"；archived → "恢复"。调 `PUT /status`；归档后留在列表/概览，退出详情。
4. 概览页对已归档工作台显示"已归档"标记（现状 summary.archived 已返回，前端已有计数）。

**验收：** 改名/描述/颜色即时刷新；归档后从概览 active 计数消失、出现在 archived 计数；恢复同理。

---

### 任务 4（P1）：手动加入/移除成员 + 前端入口

**后端文件：**
- `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`

**做法：**
1. 新增 `POST /{workspaceId}/members`，body `{contentId, boardColumnId?}`：调 `WorkspaceIndexService.addMember`（source=`manual`, reason=`手动加入`, confidence=1.0, boardColumnId 缺省用默认列），校验 contentId 与工作台存在；记录事件 `workspace_member_added`。幂等：`addMember` 已按 workspaceId+contentId 去重覆盖。
2. 新增 `DELETE /{workspaceId}/members/{contentId}`：调 `removeMember`；记录事件 `workspace_member_removed`。
3. 后端测试：成员加入幂等、跨工作台加入、移除、非法 contentId。

**前端文件：**
- `frontend/js/workspace.js`
- `frontend/workspace.html`

**做法：**
1. "全部内容/概览"内容卡片增加"加入工作台"操作：弹窗选择目标工作台（工作台列表），调 `POST /{workspaceId}/members`。
2. 详情页内容项（`renderDetailContents` / 看板卡片）为 `source==='manual'` 的项提供"移出工作台"操作，调 `DELETE /members/{contentId}` 后 `loadDetail()`。
3. 移除后记录事件，成功后刷新。

**验收：** 可从"全部内容"明确将内容加入某工作台；可从详情页手动移除；同一工作台重复加入不产生重复成员。

---

### 任务 5（缺漏）：建议改为确定性 ID

**文件：**
- `backend/src/main/java/com/example/clip/index/WorkspaceSuggestionService.java`

**做法：**
1. 内容建议 ID：将 `s_`+随机改为稳定派生，如 `s_` + 由 `workspaceId` + `contentId` 计算的不含非法字符的稳定串（`s_` + base36/hex short hash 或 `workspaceId` 与 `contentId` 的确定性拼接去重后截断）。核心要求：**同一 (workspaceId, contentId) 每次生成同 ID**。
2. 规则建议 ID：`rs_`+随机 → `rs_` + 稳定派生自 `(workspaceId, tag)`。
3. 由于 `generateSuggestions`/`generateRuleSuggestions` 每次重算 ID，改成确定性后，配合现有 `saveSuggestions` 与 pending 过滤逻辑，刷新不会重复"新建身份"；采纳/忽略/拒绝能对应到稳定 ID。
4. 明确取舍（审阅第 2 点）：`ruleMatchedRefs` 参数当前不参与评分——保持现状并在代码注释中声明"规则命中仅作为候选资格，不参与分数；分数主要依赖已持久化成员画像"。若本轮要启用，需在 `scoreCandidate` 中加分——**默认不启用，仅加注释声明**，避免扩大范围。
5. 补充测试：同一输入两次调用，ID 一致。

**验收：** 两次 `generateSuggestions(同 ws, 同 内容集)` 返回的候选 ID 相同；采纳/拒绝能命中持久化记录。

---

### 任务 6（缺漏）：补齐事件写入 + 统一事件常量

**文件：**
- `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`

**做法（轻量落库，不动 `ActionEventService` 异步/幂等）：**
1. 使用 `EventTypes` 常量替换 Controller 中既有硬编码字符串：
   - `board_column_changed` → `EventTypes.BOARD_COLUMN_CHANGED`
   - `workspace_excluded` → `EventTypes.WORKSPACE_EXCLUDED`
   - `suggestion_accepted/ignored/rejected` → 对应常量（含 `rule_suggestion_accepted`，新增常量 `EventTypes.RULE_SUGGESTION_ACCEPTED`）。
2. 补齐缺失事件写入：
   - 打开工作台详情/概览（`loadDetail` 前端触发或后端 `overview?workspaceId=` / `resolution` 时）→ 记录 `WORKSPACE_VIEWED`。**建议在 `GET /{workspaceId}/resolution` 或 `overview?workspaceId=` 成功响应时由后端记录**，避免跨窗口协调；因高频需前端节流——本轮在 `resolution` 接口记 `WORKSPACE_VIEWED`，`recordAction` 为 best-effort 且已存在，不影响主流程。
   - 任务 4 的成员加入/移除 → `WORKSPACE_MEMBER_ADDED` / `WORKSPACE_MEMBER_REMOVED`。
   - 返回建议列表时 → `SUGGESTION_SHOWN`（在 `GET /{workspaceId}/suggestions` 成功返回后记录，一次请求可只记一条聚合或逐条，**记某种聚合一次**避免噪声）。
3. 明确 `EventTypes` 中未使用的桌面级常量保持不动（它们由 electron 侧/其他写入方使用，不以 grep 到 workspace 为准删除）。

**验收：** 触发上述动作后 `action-events.jsonl` 出现对应类型；既有行为不回退。

---

### 任务 7（维护）：同步主计划文档 + 工作台数据完整性验收清单

**文件：**
- `TODO/工作台与数据层重构需求/01-数据层重构与用户习惯聚合开发计划.md`

**做法：**
1. 更新顶部"更新日期"为当前日期，标注已完成的 L0/L1/L2 及本轮项。
2. 对 `后续开发顺序` 中已完成的条目打钩（P0 项目基础能力中已完成项）；将本轮（成员 CRUD、工作台编辑/归档、列迁移、确定性 ID、事件补齐）更新到对应章节或新增"第四轮落地状态"小节。
3. 新增"工作台数据完整性端到端验收清单"小节，覆盖：四类内容索引不漏、删列不遗旧列 ID、成员加入/移除/跨工作台幂等、工作台改名/归档/恢复、建议确定性 ID 与采纳/忽略/拒绝统计、事件写入覆盖、全量 `mvn test` 绿色、桌面/浏览器冒烟。

**验收：** 文档状态与代码一致，验收清单条目可被逐项核验。

---

## 建议执行顺序
1. 任务 1（P0，解锁全量测试基线）
2. 任务 2（列迁移，依赖底层存储）
3. 任务 3 + 任务 4（Controller/Service 层可并行设计，均改 WorkspaceController，建议一起改避免多次编译测试）
4. 任务 5 + 任务 6（建议 ID + 事件，均改同一 Controller/Service）
5. 任务 7（最后收口文档）
6. 全量 `mvn test` + Electron 页面语法检查 + 桌面冒烟

## 验证
- `cd backend && mvn test`：114+ 全绿，0 失败。
- 前端 `workspace.html/workspace.js` 无语法错误（浏览器 console 无异常）。
- 手工：加入/移除成员、改名/归档/恢复、删列迁移、建议 ID 稳定、事件落盘、观测页正常。

## 明确不做（本轮）
- 事件异步队列 / eventId 幂等 / 白名单机制（已确认"异步后续"）。
- 规则命中参与评分（仅加注释声明，不改算法）。
- 删除遗留的 `KnowledgeEntry` / `getAllKnowledgeEntries` 体系（属知识模块本身重构，不在工作台范围）。
- 观测页完整漏斗图表（事件已补齐后可于后续新增，本轮不新增渲染）。