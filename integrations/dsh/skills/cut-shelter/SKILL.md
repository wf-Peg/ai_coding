---
name: cut-shelter
description: 剪藏（CutShelter）个人知识库的使用规范：存储布局、读写约定、工具用法。当任务涉及用户的知识库（剪藏、待办、wiki、学习计划）时加载本技能。
---

# CutShelter（剪藏）知识库技能

剪藏是一个本地优先的个人知识管理系统：Spring Boot 后端（默认 `http://127.0.0.1:8081`）+ Electron 桌面端 + 浏览器扩展。所有数据为本地文件。本技能说明如何正确读写它。

## 数据布局（本地文件，只读优先）

| 目录 | 内容 |
|---|---|
| `clip-storage/` | 剪藏正文（JSON + Markdown）、图片（media/）、分类目录 |
| `obsidian-vault/`（或配置的 vault 路径） | Wiki 源：`wiki/`（实体/概念/综合页）、`sources/`（待入库原始 Markdown） |
| `weekly-report/` | 周报输出 |
| `TODO/` | Agent 产出待办约定目录（后端启动时扫描落库为待办） |
| `~/.cut-shelter/` | 应用配置（git 配置、工具注册表） |

## 读写约定（重要）

- **读**：DSH 的 read / grep / glob / 文件工具可直接读上述目录（纯文件），这是零成本读面。
- **写**：**禁止直接改剪藏数据文件**，会破坏数据结构。写操作一律走 MCP 工具（`mcp__cut_shelter__*`），由后端负责元数据与去重。
- **新增剪藏**：用 `mcp__cut_shelter__clip_add`，必填 `content`，建议同时给 `title` 与 `summary`（summary 应为概括而非原文）；`useAiTags` 默认 false（省 token）。
- **搜索**：语义搜索用 `mcp__cut_shelter__clip_search`（`query` + `topK`）；列表用 `clip_list`（`keyword`/`workflowStatus`/`limit`）。
- **待办**：创建用 `todo_add`（`title` 必填）；改状态用 `todo_set_status`；查询用 `todo_list`。
- **分类**：先调 `clip_categories` 取可选值，再填 `clip_add.category`。
- **学习计划 / Wiki 索引 / 周报状态**：分别用 `learning_plan_list`、`wiki_index`、`weekly_report_status`。

## 工具清单总表（14 个 = 13 个 MCP + 1 个插件）

所有 MCP 工具在 Agent 侧的名称前缀为 `mcp__cut_shelter__`，例如 `mcp__cut_shelter__clip_search`。

| # | 工具 | 读/写 | 作用 | 关键参数 |
|---|---|---|---|---|
| 1 | `clip_search` | 只读 | 语义搜索剪藏 | `query`、`topK` |
| 2 | `clip_list` | 只读 | 剪藏列表 | `keyword`、`workflowStatus`、`limit` |
| 3 | `clip_categories` | 只读 | 分类树（先取再填） | 无 |
| 4 | `clip_add` | 写 | 新增剪藏（自动去重；`useAiTags` 默认 false） | `content`（必填）、`title`、`summary`、`category` |
| 5 | `clip_delete` | 写/破坏性 | 删除剪藏 | `id`（需用户确认，见边界） |
| 6 | `todo_list` | 只读 | 待办列表 | 可选筛选 |
| 7 | `todo_add` | 写 | 新增待办 | `title`（必填）、`deadline` 等 |
| 8 | `todo_set_status` | 写 | 改待办状态 | `id`、`status` |
| 9 | `learning_plan_list` | 只读 | 学习计划列表 | 无 |
| 10 | `wiki_index` | 只读 | 知识库 Wiki 索引（Markdown） | 无 |
| 11 | `weekly_report_status` | 只读 | 周报状态/路径 | 无 |
| 12 | `tools_hub_list` | 只读 | Tools Hub 小工具注册表（id/名称/分类/描述/启用状态） | 无 |
| 13 | `tools_hub_page` | 只读 | 读取 Tools Hub 小工具 HTML 源码（前 3000 字符，便于复用） | `id`（先用 `tools_hub_list` 获取） |
| — | `clip_session`（插件） | 写 | 把会话成果四字段归档到产品概览迭代记录（source=dsh-agent） | `title`、`outcome`（必填）；`project`、`problem`、`solution`、`tags`（可选） |

> 说明：`clip_search` 走后端语义检索（可能涉及嵌入服务/消耗 token）；列表、状态、新增类操作是纯本地接口，不额外消耗 LLM token。

### Tools Hub（工具中心，与 Agent 工具是两种概念）

Tools Hub 是剪藏桌面端内置的自包含 HTML 小工具集（如知识/Wiki/密码/AI 干活/学习计划/数据观测等），**不是 MCP 工具**，仅用于了解剪藏已有哪些能力。

- 想了解用户装了什么小工具 → `tools_hub_list`（返回 id/名称/分类/描述/启用状态）。
- 想复用某个小工具的实现 → 先 `tools_hub_list` 拿到 `id`，再 `tools_hub_page({ id })` 读其 HTML 源码（前 3000 字符）。
- 只读，不改变任何工具状态。

## 边界（禁止事项）

- **密码库不可访问**：密码库为 DES 零知识加密，不开放给 Agent，任何任务都不要尝试读取或破解。
- **不要删除/修改用户既有内容**，除非用户明确要求；删除类操作（`clip_delete`）需先向用户确认。
- **`clip_delete` 操作要领**：① 删除前先用 `clip_search` / `clip_list` 精确定位并展示给用户复核；② 删除是破坏性的且不可完全逆回，执行前必须获得用户明确同意；③ `clip_add` 会异步触发 AI 分析，刚新增后立即删除可能被分析写回（后端行为），删除后建议确认列表里已消失，必要时重试一次。
- **不直接修改** `clip-storage/`、`obsidian-vault/` 内的文件。
- **周报生成**（`/api/weekly-report/generate`）会触发 AI 与文件写入并消耗 token，仅在用户明确要求时调用；本桥默认只暴露 `weekly_report_status`。

## 常见场景模板

- 用户在 DSH 里说"把我上周收集的关于 X 的内容整理一下" → `clip_search('X')` → 汇总结果给用户，需要落库时用 `clip_add`。
- "帮我建一个待办：周五前写完周报" → `todo_add({title:'…', deadline:'…'})`。
- "知识库里有什么学习计划？" → `learning_plan_list`。
- 干完活要沉淀成果 → 用 `clip_session` 工具把会话成果归档到产品概览（四个字段）；或者什么都不用做，插件会在回合结束时自动归档（见下）。

## 会话成果归档产品概览（clip-capture 插件）

完成一段有保留价值的工作后，成果自动进入**工作台产品概览的迭代记录**（不再落剪藏/待办，避免与用户手动内容混杂）。两条路径：

1. **自动归档（默认开）**：插件监听每轮会话结束事件（`turn/end`），本轮有产出（调用过工具，或 AI 输出足够长）且未显式归档过时，自动把会话内容发给后端 `/api/workspace/feature-points/iterations/ai-session`，由后端 AI 提炼四字段落库（source=dsh-session）。闲聊轮不归档。
2. **显式归档**：调用 **`clip_session`** 工具，自己填四字段：`title`=这轮干了什么、`problem`=解决什么问题、`solution`=如何解决、`outcome`=最终结果的大白话描述（必填 `title`+`outcome`）；`project` 可选填所属需求（如「DSH（DeepSeek Harness）集成」）。落库 source=dsh-agent，该轮自动归档自动跳过避免重复。

插件配置（cordis.patch.yml）里 `config.autoArchive: false` 可关闭自动归档。

## TODO 目录与 feature-points.json（产品开发工作台约定）

- `TODO/*/feature-points.json`（v2.0：`requirement` / `featurePoints` / `knowledgePoints`）是**产品开发工作台**的数据源，由后端 `FeaturePointsService` 直读并经 `GET /api/workspace/feature-points` 渲染产品概览页。它**不**导入剪藏/待办，请勿当作待办批量导入文件来写。
- 本知识库的待办一律走接口：`todo_add`（建）/ `todo_set_status`（改状态）/ `todo_list`（查）。不要手写 `feature-points.json` 来"落库待办"，那会污染产品概览数据源。
- 旧 `TodoScannerService`（曾把 feature-points.json 的 v1 `clips[]/todos[]` 导入剪藏/待办）**已退役**，请勿再依赖或尝试"恢复"。
- 涉及产品开发工作台的需求归档，改用 `product-dev-archive` 技能（独立维护的约定），而非直接手写 feature-points.json。

## 技能包维护约定（新增/修改工具时必读）

本技能（SKILL.md）是剪藏 × DSH 的**单一事实来源**，必须与 `mcp-server/server.mjs` 暴露的工具保持同步。任何工具变更都需遵守：

1. **新增 MCP 工具**：① 在 `server.mjs` 用 `server.registerTool` 注册；② 在本文件「工具清单总表」新增一行（读/写性质、作用、关键参数）；③ 在「读写约定」补充用法；④ 若涉及破坏性操作，同时在「边界」明确安全要领。
2. **新增本地插件工具**（如 `clip_session`）：① 在 `plugins/` 注册；② 在「工具清单总表」（插件行）登记；③ 更新 README 的工具总数描述。
3. **修改既有工具**：同步更新总表中该工具的作用与关键参数；若语义变化，同步更新「读写约定」与场景模板。
4. **变更单测**：每次新增/修改后，运行 `node test.mjs`（MCP server）与 `node test-plugin.mjs`（插件）验证端到端可用。
5. **数量自检**：文末应始终满足「13 个 MCP 工具 + 1 个插件 = 14 个可选工具」；不匹配即代表文档或实现有遗漏。
