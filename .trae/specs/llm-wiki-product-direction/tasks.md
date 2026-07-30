# Tasks

## 任务总览

基于 Obsidian Web Clipper + CutShelter 后端批量 AI 的省 token 方案。Web Clipper 负责便利剪藏，CutShelter 后端负责批量 ingest / index 优先查询 / 按需 lint，Obsidian 负责浏览编辑。按 P0（批量 Ingest 引擎）→ P1（Query + Lint）→ P2（Obsidian 深度兼容）分阶段实施。核心设计原则：token 效率（批量处理、index 优先、模型路由、按需触发）。

---

## P0 — 批量 Ingest 引擎（省 token 核心）

- [x] Task 1: 创建 Wiki 配置与目录结构
  - [ ] SubTask 1.1: 创建 `backend/.../config/WikiConfig.java`（@ConfigurationProperties(prefix = "wiki")），配置项：vault 路径、批量窗口大小（默认 5）、批量触发超时（默认 30 分钟）、模型路由策略（提取用便宜模型/综合用强模型）、页面类型定义、lint 缓存开关
  - [ ] SubTask 1.2: 在 `application.yml` 新增 `wiki` 配置段，写入默认值
  - [ ] SubTask 1.3: 创建 `backend/.../service/wiki/WikiPageService.java`，封装 wiki 页面 CRUD：`createPage(type, name, content)`、`updatePage(path, content)`、`readPage(path)`、`pageExists(type, name)`、`listPages(type)`、`isManualEdited(path)`
  - [ ] SubTask 1.4: 页面路径约定：`wiki/entities/{name}.md`、`wiki/concepts/{name}.md`、`wiki/synthesis/{title}.md`、`wiki/sources/{sourceName}.md`
  - [ ] SubTask 1.5: 初始化逻辑：首次 ingest 时若 `wiki/` 不存在，创建目录 + 初始 `index.md`（空目录结构）+ `log.md`（首条初始化日志）

- [x] Task 2: 创建 Index 与 Log 服务
  - [ ] SubTask 2.1: 创建 `backend/.../service/wiki/WikiIndexService.java`
  - [ ] SubTask 2.2: 实现 `updateIndex(pageType, pageName, summary, updatedDate)`：页面创建/更新时同步更新 `wiki/index.md`，按类别分组列出，含 wiki-link、一行摘要、更新日期
  - [ ] SubTask 2.3: index.md 顶部维护统计信息（总页数、各类型页数、最近更新时间）
  - [ ] SubTask 2.4: 实现 `appendLog(operationType, title)`：向 `log.md` 追加 `## [yyyy-MM-dd HH:mm] {type} | {title}`，仅追加不修改

- [x] Task 3: 创建 Vault 监听与攒批服务
  - [ ] SubTask 3.1: 创建 `backend/.../service/wiki/VaultWatchService.java`，使用 Java WatchService 或定时扫描监听 vault `sources/` 目录新增文件
  - [ ] SubTask 3.2: 实现 ingest 队列：新文件入队，不立即触发 AI；队列达到批量窗口大小（配置默认 5 条）或用户手动触发时，调用 `BatchIngestService.ingestBatch()`
  - [ ] SubTask 3.3: 实现去重：根据来源文件 frontmatter `clip-id` 或文件名判断是否已 ingest，已处理则跳过
  - [ ] SubTask 3.4: 实现定时窗口：若队列非空但未达批量大小，超时（默认 30 分钟）后自动触发
  - [ ] SubTask 3.5: 暴露队列状态查询接口（当前队列长度、批量窗口配置），供前端展示

- [x] Task 4: 创建批量 Ingest 引擎（核心）
  - [ ] SubTask 4.1: 创建 `backend/.../service/wiki/BatchIngestService.java`，注入 `AiService`、`WikiPageService`、`WikiIndexService`、`ObsidianExportFormatter`
  - [ ] SubTask 4.2: 实现 `ingestBatch(List<Path> sourceFiles)` 主流程：
    1. 读取所有来源文件内容
    2. 一次 LLM 调用批量提取实体和概念（新增 `AiService.batchExtractEntitiesAndConcepts(List<String> contents)`）
    3. 为每个实体/概念查找已有 wiki 页面，仅对相关页面调用 AI 增量更新
    4. 为每条来源生成来源页 `wiki/sources/{文件名}.md`
    5. 更新 index.md，追加 log.md
  - [ ] SubTask 4.3: 实现矛盾检测：页面更新时 AI 比对新内容与已有页面，发现矛盾则追加 `> [!warning] 矛盾标注` Callout
  - [ ] SubTask 4.4: 实现手动编辑保护：读取页面 frontmatter，若 `manual-edited: true` 则跳过自动更新，仅在末尾"最近来源"区域追加引用
  - [ ] SubTask 4.5: 返回 ingest 统计（触及页面数、新增实体/概念数、跳过数、token 消耗估算）

- [x] Task 5: AiService 新增批量 Wiki 方法
  - [ ] SubTask 5.1: `batchExtractEntitiesAndConcepts(List<String> contents)` → 返回 `List<WikiExtractionResult>`，一次调用处理多条来源（省 token）
  - [ ] SubTask 5.2: `generateEntityPage(String entityName, String newSourceSummary, String existingPageContent)` → 生成/更新实体页（含 wiki-link 互链）
  - [ ] SubTask 5.3: `generateConceptPage(String conceptName, String newSourceSummary, String existingPageContent)` → 生成/更新概念页
  - [ ] SubTask 5.4: `generateSourcePage(String sourceContent, String sourceUrl)` → 生成来源页
  - [ ] SubTask 5.5: `detectContradiction(String newContent, String existingPageContent)` → 检测矛盾，返回矛盾描述或 null
  - [ ] SubTask 5.6: 所有方法通过 RoutingLlmProvider 路由：提取类用便宜模型，生成/检测类用强模型；通过 PromptConfigService 配置 Prompt；失败降级返回空结果

## P1 — Index 优先查询 & 按需 Lint

- [x] Task 6: Wiki 综合查询服务（index 优先）
  - [ ] SubTask 6.1: 创建 `backend/.../service/wiki/WikiQueryService.java`，注入 `AiService`、`WikiPageService`
  - [ ] SubTask 6.2: 实现 `query(String question)` 两步流程：
    1. **Index 定位**（便宜模型）：LLM 读 `index.md`，返回相关页面名列表（通常 2-3 个）
    2. **页面综合**（强模型）：系统仅读取相关页面内容，LLM 综合带 `[[页面名]]` 引用的答案
  - [ ] SubTask 6.3: 实现 `archiveAsSynthesis(String title, String answer)`：将查询答案归档为综述页
  - [ ] SubTask 6.4: 返回 token 消耗估算（透明化成本）
  - [ ] SubTask 6.5: 新增 `WikiQueryController`，暴露 `/api/wiki/query` 和 `/api/wiki/archive` 端点
  - [ ] SubTask 6.6: 前端新增 wiki 查询入口（`wiki.html` 或现有页面加 tab），查询结果 Markdown 渲染，含"归档为综述页"按钮，显示 token 消耗

- [x] Task 7: Wiki 按需 Lint 服务
  - [ ] SubTask 7.1: 创建 `backend/.../service/wiki/WikiLintService.java`，注入 `AiService`、`WikiPageService`
  - [ ] SubTask 7.2: 实现 `lint()`：扫描所有 wiki 页面，AI 检测矛盾、过时声明、孤儿页面（无入链）、缺失页（被提及无独立页）、缺失交叉引用
  - [ ] SubTask 7.3: 生成 `wiki/lint-report.md`，按问题类型分组，含建议新来源/新问题
  - [ ] SubTask 7.4: 实现增量 lint 缓存：根据 frontmatter `updated` 判断页面是否变更，未变更跳过，合并上次 lint 结果
  - [ ] SubTask 7.5: 新增 `WikiLintController`，暴露 `/api/wiki/lint` 端点（手动触发，异步执行）
  - [ ] SubTask 7.6: 前端 lint 报告展示（问题列表+跳转相关页面）

- [x] Task 8: Ingest 触发与队列管理前端
  - [ ] SubTask 8.1: 在 `frontend/wiki.html` 或现有页面新增 ingest 队列状态展示（当前 N/批量窗口）
  - [ ] SubTask 8.2: "立即摄入"按钮，手动触发 `BatchIngestService.ingestBatch()`
  - [ ] SubTask 8.3: ingest 进度展示（提取中→更新页面中→生成来源页中→更新索引中）
  - [ ] SubTask 8.4: 完成后显示统计（更新 N 个页面、新增 M 个实体/概念、消耗 K token）
  - [ ] SubTask 8.5: 新增 `/api/wiki/ingest/queue`（查询队列状态）和 `/api/wiki/ingest/trigger`（手动触发）端点

## P2 — Obsidian 深度兼容

- [x] Task 9: MOC 索引页生成
  - [ ] SubTask 9.1: 创建 `backend/.../service/wiki/MocGeneratorService.java`
  - [ ] SubTask 9.2: 实现 `generateMoc(String categoryName)`：扫描该分类相关 wiki 页面，按日期倒序生成 wiki-link 列表 + 标签云
  - [ ] SubTask 9.3: MOC 文件 `wiki/MOC_{分类中文名}.md`，frontmatter `type: moc`
  - [ ] SubTask 9.4: 每次 ingest 后更新相关分类的 MOC

- [x] Task 10: Obsidian 原生体验增强
  - [ ] SubTask 10.1: wiki 页面 frontmatter 统一使用 `aliases` 字段（Obsidian 别名，容错 wiki-link）
  - [ ] SubTask 10.2: 利用 Dataview 兼容：frontmatter 含 `sources`（来源 ID 列表）、`updated`、`type`，支持 Dataview 查询
  - [ ] SubTask 10.3: wiki-link 双向链接规范：页面引用其他页面时使用 `[[页面名]]` 或 `[[页面名|显示名]]`
  - [ ] SubTask 10.4: 文档说明：在 wiki 根目录生成 `README.md` 说明 wiki 结构、Obsidian 使用建议（graph view/Dataview/MOC）

# Task Dependencies

- Task 1（配置+目录）→ Task 2（Index/Log 依赖目录）→ Task 4（Ingest 依赖 Index/Log）
- Task 3（Vault 监听）依赖 Task 1（配置 vault 路径），可与 Task 2 并行
- Task 4（批量 Ingest）依赖 Task 1、2、3
- Task 5（AiService 方法）可与 Task 1-3 并行，Task 4 依赖 Task 5
- P1 的 Task 6、7、8 依赖 P0 完成
- Task 6（Query）与 Task 7（Lint）可并行
- Task 8（前端）依赖 Task 4（ingest 服务）
- P2 的 Task 9、10 依赖 P1 完成
- 并行机会：Task 1+2+3 可与 Task 5 并行；Task 6 与 Task 7 可并行

# 设计模式说明

- **职责分离**：VaultWatchService（监听攒批）、BatchIngestService（批量 AI 处理）、WikiPageService（页面 CRUD）、WikiIndexService（索引日志）、WikiQueryService（查询）、WikiLintService（检查）各自独立
- **可配置化**：WikiConfig（@ConfigurationProperties）管理 vault 路径、批量窗口、模型路由、lint 策略
- **低耦合**：BatchIngestService 作为编排者，通过依赖注入调用各服务，不内联具体逻辑
- **token 效率**：批量提取（一次调用处理多条）、index 优先查询（仅读相关页）、模型路由（简单任务便宜模型）、按需 lint（非定时）、增量更新（仅相关页面）
- **复用**：ObsidianExportFormatter（已完成 MVP）被 wiki 页面格式化复用；RoutingLlmProvider 被模型路由复用；PromptConfigService 被 prompt 管理复用

# 验证方式

1. 用 Web Clipper 剪藏 3 条网页，确认文件落入 vault `sources/` 目录
2. 在 CutShelter 界面确认队列状态显示 3/5
3. 点击"立即摄入"，确认批量 ingest 执行（一次 LLM 调用提取，多次增量更新）
4. 在 `wiki/entities/`、`wiki/concepts/`、`wiki/sources/` 确认页面生成
5. 确认 `index.md` 更新，`log.md` 追加 ingest 记录
6. 用 Obsidian 打开 vault，graph view 可见页面连接
7. 再剪藏 2 条相关内容，确认已有实体/概念页被更新（非重复创建）
8. 在 wiki 查询入口提问，确认 index 优先查询返回带引用答案，显示 token 消耗
9. 触发 lint，确认生成 lint-report.md，再次 lint 确认未变更页面被跳过
10. 确认模型路由生效：提取用便宜模型，综合用强模型（查看日志）
