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

## 边界（禁止事项）

- **密码库不可访问**：密码库为 DES 零知识加密，不开放给 Agent，任何任务都不要尝试读取或破解。
- **不要删除/修改用户既有内容**，除非用户明确要求；删除类操作（`clip_delete`）需先向用户确认。
- **不直接修改** `clip-storage/`、`obsidian-vault/` 内的文件。
- **周报生成**（`/api/weekly-report/generate`）会触发 AI 与文件写入并消耗 token，仅在用户明确要求时调用；本桥默认只暴露 `weekly_report_status`。

## 常见场景模板

- 用户在 DSH 里说"把我上周收集的关于 X 的内容整理一下" → `clip_search('X')` → 汇总结果给用户，需要落库时用 `clip_add`。
- "帮我建一个待办：周五前写完周报" → `todo_add({title:'…', deadline:'…'})`。
- "知识库里有什么学习计划？" → `learning_plan_list`。
- 干完活要沉淀成果 → 用 `clip_session` 工具把会话成果摘要落库（Phase 1）；或按约定写入 `TODO/` 目录（见下）。

## 会话成果落库（Phase 1）

完成一段有保留价值的工作后，调用 **`clip_session`** 工具：`title` 给简短主题，`summary` 给 Markdown 成果摘要，自动成为一条剪藏（`source=dsh`）进入知识库。

## TODO 目录约定（feature-points.json，当前构建扫描器已禁用）

后端存在 `TodoScannerService`，约定从 `product-dev.todo-dir`（默认 `./TODO`）读取 **`feature-points.json`** 批量导入剪藏与待办（按 `.imported` 标记幂等去重）。格式（与后端注释约定对齐）：

```json
{
  "requirement": { "title": "需求标题", "summary": "…", "tags": [], "phase": "…", "createdAt": "…" },
  "clips": [ { "title": "…", "contentFile": "path.md", "section": "可选章节", "category": "…", "tags": [] } ],
  "todos": [ { "title": "…", "priority": "high|medium|low", "status": "todo|done" } ],
  "config": { "clipCategory": "…", "todoCategory": "…", "autoTag": "…" }
}
```

> ⚠️ **注意**：当前 `TodoScannerService.scanAndImport()` 在构建中被硬禁用（方法体直接返回空结果），且无调用方。**现阶段待办落库请走 `todo_add` 工具（API 路径，可靠）**；如需恢复批量文件导入，需还原扫描器实现并接回启动钩子（参见 `docs/DSH集成探索.md` 第 5 节 Phase 1）。
