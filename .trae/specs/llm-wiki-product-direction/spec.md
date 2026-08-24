# LLM Wiki 产品方向规划 — Web Clipper + 后端批量 AI 的省 Token 方案

## Why

### 用户核心诉求

1. **便利性**：用 Obsidian Web Clipper 浏览器插件剪藏，直接落入 vault，无需 CutShelter 重复造浏览器扩展
2. **节省 token 成本**：AI 操作要省 token，不能每条剪藏都触发 LLM，不能每次查询都读全量页面
3. **不用 Claudian**：不在 Obsidian 内嵌 Claude Code，产品逻辑保持清晰——CutShelter 后端是 AI 大脑，Obsidian 是浏览/编辑器
4. **基于 karpathy LLM Wiki 理论**：构建持久化、互链、增量维护的 wiki，而非一次性日报

### Karpathy LLM Wiki 理论核心洞察

karpathy 在 [llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 提出区别于 RAG 的个人知识库模式：

1. **RAG 的问题**：每次查询从原始文档检索碎片，知识不累积
2. **LLM Wiki 的解法**：LLM 增量构建并维护持久化 wiki——结构化、互链的 markdown 文件
3. **三层架构**：Raw sources（不可变原始）/ The wiki（LLM 维护）/ The schema（结构约定）
4. **三种操作**：Ingest（摄入）、Query（查询）、Lint（健康检查）
5. **关键**：wiki 是复利增长的产物，交叉引用已存在，矛盾已标记，综合分析已反映所有已读内容

### 省 Token 的核心策略

本方案的核心设计原则是**token 效率**，所有 AI 操作都围绕"最小化 LLM 调用成本"设计：

| 策略 | 说明 | 节省效果 |
|---|---|---|
| **批量 ingest** | 攒一批剪藏后统一 ingest，非逐条触发。一次 LLM 调用处理多条来源 | 减少 60-80% 调用次数 |
| **index 优先查询** | 查询时先读 index.md（小文件），仅读相关页面（2-3 个），非全量扫描 | 减少 90% 输入 token |
| **模型路由** | 简单任务（标签提取、实体识别）用便宜模型（DeepSeek），综合分析用强模型（Qwen-Max） | 降低 50% 单次成本 |
| **增量更新** | ingest 时只更新 AI 判断相关的页面（通常 3-5 个），非全量重建 | 减少 70% 输出 token |
| **按需 lint** | 用户手动触发，非定时。lint 结果缓存，未变更页面不重复检查 | 避免无效定时消耗 |
| **缓存分析结果** | 剪藏的 AI 分析结果缓存，重复内容不重新分析 | 避免重复消耗 |

## What Changes

### 产品架构：三层清晰分工

```
浏览器                  CutShelter 后端                    Obsidian Vault
┌──────────┐           ┌──────────────┐                 ┌──────────────────┐
│Web Clipper│           │ 批量 Ingest   │                │ sources/          │
│(剪藏入口) │──────────▶│ (攒批+AI处理) │───────────────▶│ (Web Clipper 直达)│
└──────────┘           │              │                 │ wiki/            │
                       │ Wiki Query   │◀───────────────▶│ ├─ entities/     │
                       │ (index优先)  │                 │ ├─ concepts/     │
                       │              │                 │ ├─ synthesis/    │
                       │ Wiki Lint    │                 │ ├─ sources/      │
                       │ (按需触发)    │                 │ ├─ index.md      │
                       │              │                 │ └─ log.md        │
                       │ 模型路由      │                 │                  │
                       │ (省token)    │                 │ (用户浏览/编辑)  │
                       └──────────────┘                 └──────────────────┘
```

**分工原则**：
- **Web Clipper**：负责剪藏便利性，网页→Markdown→vault `sources/`
- **CutShelter 后端**：负责 AI 处理和 token 效率，批量 ingest / index 优先查询 / 按需 lint
- **Obsidian**：负责浏览和编辑，用户在 Obsidian 中查看 wiki、graph view、手动编辑

### 模块建议（按优先级）

#### P0 — 批量 Ingest 引擎（省 token 核心）

1. **Vault 监听服务**（新增）
   - 监听 vault `sources/` 目录新增文件（Web Clipper 剪藏的来源）
   - 攒批等待：新剪藏先入队，不立即触发 AI，等待批量窗口（如攒满 5 条或用户手动触发）
   - 避免逐条 ingest 的 token 浪费

2. **批量 Ingest 服务**（新增）
   - 一次 LLM 调用处理一批来源：AI 同时读取多条来源，批量提取实体/概念，批量更新 wiki 页面
   - 增量更新：只更新与新增来源相关的已有页面（AI 判断相关性），非全量重建
   - 矛盾检测：批量 ingest 时检测新内容与已有页面的矛盾，标注 Callout
   - 生成来源页：每条来源生成 `wiki/sources/{id}.md`
   - 更新 index.md 和 log.md

3. **Wiki 页面服务**（新增）
   - 页面 CRUD：实体页、概念页、综述页、来源页
   - 所有页面 Obsidian 兼容（frontmatter/wiki-link/Callout，复用已完成 MVP）
   - 手动编辑保护：frontmatter `manual-edited: true` 的页面跳过自动更新

4. **Schema 配置**（新增）
   - 通过 `@ConfigurationProperties` 管理 wiki 结构、页面类型、ingest 工作流
   - 配置化批量窗口大小、模型路由策略、lint 触发方式

#### P1 — Index 优先查询 & 按需 Lint

5. **Index 优先查询服务**（新增）
   - 查询时 LLM 先读 `index.md`（小文件，含所有页面一行摘要）
   - AI 从 index 判断相关页面（通常 2-3 个），仅读这几个页面
   - 综合带 wiki-link 引用的答案
   - 好的答案可归档为综述页（探索复利）

6. **按需 Lint 服务**（新增）
   - 用户手动触发，非定时（省 token）
   - LLM 扫描 wiki 检测：矛盾、过时、孤儿页、缺失页、缺失交叉引用
   - 生成 `lint-report.md` 写入 vault
   - 缓存 lint 结果，未变更页面下次跳过

#### P2 — Obsidian 深度兼容

7. **MOC 索引页**（新增）
   - 每个一级分类生成 MOC 页，列出该分类 wiki 页面
   - ingest 后自动更新相关 MOC

8. **Dataview 兼容**（延续 MVP）
   - frontmatter 含 `type`/`tags`/`sources`/`updated`，支持 Dataview 动态查询
   - wiki-link 双向链接规范

### 不做的功能

| 功能 | 原因 |
|---|---|
| Claudian 插件集成 | 用户明确不用，产品逻辑保持清晰 |
| 逐条即时 ingest | token 浪费，改为批量 ingest |
| 定时 lint | token 浪费，改为按需触发 |
| 全量查询扫描 | token 浪费，改为 index 优先 |
| 向量数据库/RAG | index.md 在中等规模足够，省基础设施成本 |
| CutShelter 浏览器扩展增强 | 改用 Web Clipper，现有扩展保留不增强 |
| CutShelter 内建 wiki 浏览器 | 用户用 Obsidian 浏览 |

## Impact

- Affected specs:
  - `snaptium-features-port`（Obsidian 格式 MVP 的 frontmatter/Callout 规范被 wiki 页面继承）
  - `browser-extension-enhancements`（方向调整：不再增强，推荐 Web Clipper）
  - `smart-ingest`（入库流程对接 Web Clipper 的 vault 直达模式）
- Affected code:
  - 新增 `backend/.../service/wiki/VaultWatchService.java`：监听 vault sources/ 新增
  - 新增 `backend/.../service/wiki/BatchIngestService.java`：批量 ingest 引擎
  - 新增 `backend/.../service/wiki/WikiPageService.java`：页面 CRUD
  - 新增 `backend/.../service/wiki/WikiIndexService.java`：index.md/log.md 维护
  - 新增 `backend/.../service/wiki/WikiQueryService.java`：index 优先查询
  - 新增 `backend/.../service/wiki/WikiLintService.java`：按需 lint
  - 新增 `backend/.../config/WikiConfig.java`：wiki 配置（批量窗口/模型路由/lint 策略）
  - 复用 `backend/.../core/AiService.java`：新增批量提取/综合查询方法
  - 复用 `backend/.../service/obsidian/ObsidianExportFormatter.java`：页面格式化
  - 复用 `backend/.../core/RoutingLlmProvider.java`：模型路由（省 token）
  - 新增 `frontend/wiki.html`：wiki 查询/ingest 触发/仪表盘入口

## ADDED Requirements

### Requirement: Vault 监听与批量窗口

系统 SHALL 监听 vault `sources/` 目录新增文件，攒批后触发批量 ingest，避免逐条 AI 调用浪费 token。

#### Scenario: 攒批等待
- **WHEN** Web Clipper 剪藏新文件落入 vault `sources/` 目录
- **THEN** 系统将文件入队，不立即触发 AI
- **AND** 当队列达到配置的批量窗口大小（默认 5 条）或用户手动触发时，执行批量 ingest

#### Scenario: 手动触发批量 ingest
- **WHEN** 用户在 CutShelter 界面点击"立即摄入"或定时窗口到达
- **THEN** 系统取出队列中所有待处理来源，执行批量 ingest
- **AND** ingest 完成后清空队列，返回触及页面统计

#### Scenario: 去重处理
- **WHEN** 队列中存在已 ingest 过的来源（根据 frontmatter `clip-id` 判断）
- **THEN** 跳过该来源，不重复 AI 处理
- **AND** 记录跳过日志

### Requirement: 批量 Ingest 引擎

系统 SHALL 一次 LLM 调用处理一批来源，批量提取实体/概念并增量更新 wiki 页面，最小化 token 消耗。

#### Scenario: 批量提取
- **WHEN** 批量 ingest 触发，队列含 N 条来源
- **THEN** 系统将 N 条来源内容合并为一次 LLM 调用，AI 同时提取所有来源的实体和概念
- **AND** 返回结构化结果：每条来源的实体列表、概念列表、摘要

#### Scenario: 增量页面更新
- **WHEN** AI 提取出实体/概念后
- **THEN** 系统查找已有 wiki 页面，仅对相关页面调用 AI 更新（非全量重建）
- **AND** 每个页面更新时 AI 读取已有内容 + 新来源摘要，生成更新后内容
- **AND** 页面不存在则新建（使用 Obsidian 兼容 frontmatter）

#### Scenario: 矛盾检测
- **WHEN** 批量 ingest 时 AI 发现新来源与已有页面内容矛盾
- **THEN** 在相关 wiki 页面追加 `> [!warning] 矛盾标注` Callout，记录两方观点和来源
- **AND** 不自动删除旧内容，保留多方观点

#### Scenario: 来源页生成
- **WHEN** 一条来源被 ingest
- **THEN** 生成 `wiki/sources/{来源文件名}.md`，含原文摘要、AI 分析、原始来源链接、引用此来源的 wiki 页面列表

#### Scenario: 手动编辑保护
- **WHEN** 系统准备更新某个 wiki 页面，但该页面 frontmatter 含 `manual-edited: true`
- **THEN** 跳过自动更新，仅在该页面末尾"最近来源"区域追加新来源引用
- **AND** 记录跳过日志

### Requirement: 模型路由省 Token

系统 SHALL 通过模型路由策略，将简单任务分配给便宜模型，复杂任务分配给强模型，优化 token 成本。

#### Scenario: 任务分级路由
- **WHEN** 系统执行 AI 操作
- **THEN** 按任务类型路由模型：
  - 实体/概念提取、标签生成 → 便宜模型（如 DeepSeek）
  - 页面内容生成、综合查询 → 强模型（如 Qwen-Max）
  - 矛盾检测 → 强模型
- **AND** 路由策略可通过配置调整

#### Scenario: 失败降级
- **WHEN** 配置的模型不可用
- **THEN** 降级到默认模型，记录警告
- **AND** 不中断 ingest 流程

### Requirement: Index 优先查询

系统 SHALL 查询时先读 index.md 定位相关页面，仅读相关页面内容综合答案，最小化输入 token。

#### Scenario: index 定位
- **WHEN** 用户提问
- **THEN** LLM 先读 `wiki/index.md`（含所有页面一行摘要）
- **AND** AI 从 index 判断相关页面（通常 2-3 个），返回页面名列表

#### Scenario: 页面综合
- **WHEN** index 定位完成
- **THEN** 系统仅读取相关页面内容（非全量 wiki）
- **AND** LLM 综合答案，标注 `[[页面名]]` 引用
- **AND** 答案以 Markdown 返回渲染展示

#### Scenario: 答案归档
- **WHEN** 用户认为查询答案有价值
- **THEN** 用户可一键将答案归档为综述页 `wiki/synthesis/{标题}.md`
- **AND** 归档后更新 index.md

### Requirement: 按需 Lint

系统 SHALL 提供按需触发的 wiki 健康检查，用户手动点击执行，非定时消耗 token。

#### Scenario: 手动 lint
- **WHEN** 用户在界面点击"wiki 健康检查"
- **THEN** LLM 扫描所有 wiki 页面，检测矛盾、过时、孤儿页、缺失页、缺失交叉引用
- **AND** 生成 `wiki/lint-report.md` 写入 vault，按问题类型分组
- **AND** 展示问题摘要

#### Scenario: 增量 lint 缓存
- **WHEN** 用户再次触发 lint 且部分页面未变更（根据 frontmatter `updated` 判断）
- **THEN** 跳过未变更页面的重复检查
- **AND** 仅检查新增或更新过的页面，合并上次 lint 结果

### Requirement: Wiki 目录结构与页面类型

系统 SHALL 在 vault 下维护持久化的 `wiki/` 目录，包含 LLM 增量维护的结构化、互链 markdown 页面。

#### Scenario: 目录结构
- **WHEN** 系统首次执行 ingest 且 `wiki/` 目录不存在
- **THEN** 创建目录结构：`wiki/entities/`、`wiki/concepts/`、`wiki/synthesis/`、`wiki/sources/`
- **AND** 生成初始 `index.md`（空目录）和 `log.md`（首条初始化日志）

#### Scenario: 页面 frontmatter 规范
- **WHEN** LLM 生成或更新任意 wiki 页面
- **THEN** frontmatter 包含 `type`（entity/concept/synthesis/source）、`tags`、`sources`（关联来源 ID 列表）、`updated`、`aliases`、`manual-edited`（可选）
- **AND** 页面正文使用 Obsidian wiki-link `[[页面名]]` 互链

### Requirement: Index 与 Log 维护

系统 SHALL 维护内容导向的 index.md 和时间导向的 log.md。

#### Scenario: index.md 维护
- **WHEN** 任意 wiki 页面被创建或更新
- **THEN** `wiki/index.md` 同步更新，按类别列出该页面，含 wiki-link、一行摘要、更新日期
- **AND** index.md 顶部含统计信息（总页数、各类型页数、最近更新时间）

#### Scenario: log.md 维护
- **WHEN** 执行 ingest/query/lint 操作
- **THEN** 向 `wiki/log.md` 追加 `## [yyyy-MM-dd HH:mm] {操作类型} | {标题}`
- **AND** log.md 仅追加不修改

## 产品使用流程说明（PRD 核心）

### 整体流程：Web Clipper 剪藏 → 攒批 → 批量 Ingest → Obsidian 浏览 → 按需查询/Lint

```
浏览器                 CutShelter 后端                    Obsidian Vault
┌──────────┐          ┌──────────────┐                 ┌──────────────────┐
│Web Clipper│          │ Vault 监听    │                │ sources/          │
│(剪藏插件) │─────────▶│ (攒批队列)    │◀───────────────│ (Web Clipper 直达)│
└──────────┘          │              │                 └────────┬─────────┘
                      │ 批量 Ingest   │                          │
                      │ (一次LLM处理  │───更新页面──────────────▶│ wiki/            │
                      │  多条来源)    │                          │ ├─ entities/     │
                      │              │                          │ ├─ concepts/     │
                      │ 模型路由      │                          │ ├─ synthesis/    │
                      │ (省token)    │                          │ ├─ sources/      │
                      │              │                          │ ├─ index.md      │
                      │ Wiki Query   │◀──读index+相关页─────────│ └─ log.md        │
                      │ (index优先)  │───综合答案──────────────▶│                  │
                      │              │                          │ (用户浏览/编辑)  │
                      │ Wiki Lint    │◀──扫描wiki──────────────│                  │
                      │ (按需触发)    │───lint-report.md────────▶│                  │
                      └──────────────┘                          └──────────────────┘
```

### 流程一：日常剪藏与攒批（核心流程）

**触发**：用户在浏览器发现有价值内容

**步骤**：
1. **浏览器剪藏**：
   - 用户在浏览器点击 Web Clipper 图标
   - Web Clipper 将网页转为 Markdown（含 frontmatter: title/url/date/tags）
   - 内容直接存入 vault `sources/{标题}_{日期}.md`
2. **Vault 监听入队**：
   - CutShelter 后端监听到 `sources/` 新增文件
   - 文件入 ingest 队列，不立即触发 AI（省 token）
   - 界面提示"已加入摄入队列（当前 N/5）"
3. **攒批等待**：
   - 用户继续剪藏更多内容
   - 队列累积，达到批量窗口（默认 5 条）或用户手动触发

**交互**：
- CutShelter 界面显示队列状态（N 条待摄入）
- 可手动点击"立即摄入"提前触发

### 流程二：批量 Ingest（AI 处理核心）

**触发**：队列满 / 用户手动触发 / 定时窗口到达

**步骤**：
1. **批量提取**（一次 LLM 调用）：
   - 系统将队列中 N 条来源合并为一次 LLM 调用
   - AI 同时提取所有来源的实体和概念，生成每条摘要
   - 模型路由：此步骤用便宜模型（如 DeepSeek）
2. **增量页面更新**（按需 LLM 调用）：
   - 系统查找已有 wiki 页面，判断哪些页面与新增内容相关
   - 仅对相关页面（通常 3-5 个/来源）调用 AI 更新
   - 模型路由：此步骤用强模型（如 Qwen-Max）
   - 页面不存在则新建（使用 Obsidian frontmatter）
3. **矛盾检测**：
   - 页面更新时 AI 检测新内容与已有内容的矛盾
   - 矛盾时追加 `> [!warning]` Callout，不删除旧内容
4. **来源页生成**：
   - 每条来源生成 `wiki/sources/{文件名}.md`
5. **索引与日志**：
   - 更新 `wiki/index.md`，追加 `wiki/log.md`
6. **完成通知**：
   - 界面提示"摄入完成：更新 N 个页面，新增 M 个实体/概念"
   - 用户可在 Obsidian graph view 查看新连接

**交互**：
- ingest 过程显示进度（提取中→更新页面中→生成来源页中→更新索引中）
- 完成后可点击"在 Obsidian 中查看"跳转

### 流程三：综合查询（index 优先，省 token）

**触发**：用户在 CutShelter 提问

**步骤**：
1. **提问**：用户输入问题（如"React 和 Vue 在响应式原理上有什么区别？"）
2. **Index 定位**（小 LLM 调用）：
   - LLM 读取 `wiki/index.md`（小文件，所有页面一行摘要）
   - AI 判断相关页面（如 React 实体页、Vue 实体页、响应式概念页）
3. **页面综合**（强模型调用）：
   - 系统仅读取相关页面内容（2-3 个，非全量 wiki）
   - LLM 综合答案，标注 `[[页面名]]` 引用
4. **答案展示**：答案以 Markdown 渲染，引用可点击
5. **（可选）答案归档**：
   - 用户点击"归档为综述页"
   - 答案存入 `wiki/synthesis/{标题}.md`，成为 wiki 一部分

**交互**：
- 查询框标注"Wiki 综合查询"
- 答案区域含"归档为综述页"按钮
- 显示 token 消耗估算（透明化成本）

### 流程四：按需健康检查（省 token，非定时）

**触发**：用户手动点击"wiki 健康检查"

**步骤**：
1. **全量扫描**：LLM 读取所有 wiki 页面
2. **问题检测**：
   - 矛盾：不同页面事实陈述冲突
   - 过时：页面信息被新来源超越但未更新
   - 孤儿页：无入链的页面
   - 缺失页：被提及但无独立页的概念
   - 缺失交叉引用：相关页面未互链
3. **报告生成**：生成 `wiki/lint-report.md` 写入 vault
4. **建议**：LLM 建议新问题去探索、新来源去摄入

**交互**：
- 点击"健康检查"后显示扫描进度
- 完成后展示报告摘要（N 个矛盾、M 个孤儿页、K 个缺失页）
- 可点击问题跳转相关 wiki 页面
- 增量缓存：下次 lint 跳过未变更页面

### 流程五：Obsidian 浏览与编辑

**触发**：用户在 Obsidian 中打开 vault

**能力**：
- **Graph View**：可视化 wiki 页面连接，发现知识网络 hub 和孤岛
- **Backlinks**：在任意 wiki 页面查看反向链接
- **Dataview**：基于 frontmatter 生成动态列表（最近更新、引用最多）
- **手动编辑**：用户可手动编辑 wiki 页面，标记 `manual-edited: true` 后 CutShelter 跳过自动更新
- **MOC 导航**：分类 MOC 页作为入口

**交互**：
- CutShelter 负责 AI 摄入和查询，Obsidian 负责浏览和编辑
- 用户在 Obsidian 中的手动编辑受保护，不被覆盖

### 模块交互关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CutShelter 后端                                │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │VaultWatchSvc │─▶│BatchIngestSvc│─▶│ WikiPageService      │   │
│  │(监听sources/) │   │(批量AI处理)  │   │ (页面CRUD)           │   │
│  │(攒批队列)     │   │              │   │                      │   │
│  └──────────────┘   └──────┬───────┘   └────────┬─────────────┘   │
│                            │                    │                  │
│                            ▼                    ▼                  │
│                     ┌──────────────┐   ┌──────────────────────┐   │
│                     │ AiService    │   │ WikiIndexService     │   │
│                     │ (批量提取/   │   │ (index.md/log.md)    │   │
│                     │  增量更新/   │   │                      │   │
│                     │  综合查询)   │   │                      │   │
│                     └──────┬───────┘   └──────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│                     ┌──────────────┐                              │
│                     │RoutingLlmProv│ (模型路由省token)             │
│                     │ 便宜模型:提取│                              │
│                     │ 强模型:综合  │                              │
│                     └──────────────┘                              │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │WikiQuerySvc  │   │WikiLintSvc   │   │WikiConfig            │   │
│  │(index优先查询)│   │(按需lint)    │   │(@ConfigurationProps) │   │
│  └──────────────┘   └──────────────┘   └──────────────────────┘   │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ ObsidianExportFormatter (复用已完成MVP)                    │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ 读写 vault
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Obsidian Vault                                    │
│  sources/ (Web Clipper 直达)    wiki/ (CutShelter 维护)             │
│  ├── article1_2026-07-30.md    ├── entities/  concepts/            │
│  ├── article2_2026-07-30.md    ├── synthesis/  sources/            │
│  └── ...                       ├── index.md  log.md                │
│                                └── lint-report.md                   │
│  (用户在 Obsidian 浏览/编辑，manual-edited 页面受保护)              │
└─────────────────────────────────────────────────────────────────────┘
```

## MODIFIED Requirements

### Requirement: 浏览器扩展（方向调整）

现有 CutShelter 浏览器扩展 SHALL 不再作为主要剪藏入口，改为推荐 Obsidian Web Clipper。现有扩展保留维护但不新增功能。

#### Scenario: 浏览器扩展降级维护
- **WHEN** 用户询问剪藏方式
- **THEN** CutShelter 工作流引导推荐使用 Obsidian Web Clipper
- **AND** 现有浏览器扩展继续可用，但不再新增功能

### Requirement: 内容整理服务（职责调整）

现有 `ContentOrganizeService` SHALL 保留每日日报生成职责，日报可作为来源之一被 wiki ingest 摄入。wiki ingest 由独立的 `BatchIngestService` 负责，ContentOrganizeService 不承担 wiki ingest。

#### Scenario: 整理服务职责边界
- **WHEN** 系统执行每日整理
- **THEN** 生成当日分类日报（现有流程不变）
- **AND** 不触发 wiki ingest（由独立的 BatchIngestService 处理）
- **AND** 日报文件可作为 BatchIngestService 的来源之一
