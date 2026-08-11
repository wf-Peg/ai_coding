# Wiki 模块现状说明（与产品开发工作台的关系）

> 目的：回答"wiki 区现在是什么、能做什么、和产品开发工作台什么关系"。此前 wiki 相关内容散落在 llm-wiki-product-direction spec、web-clipper-and-wiki-nav-plan、CODE_WIKI 三处，本文统一说明。

## 一、现状：代码已实现，文档未同步

wiki 后端代码已存在（git 已跟踪），不是规划中的东西：

| 组件 | 位置 | 状态 |
|------|------|------|
| 批量入库服务 | `backend/.../service/wiki/BatchIngestService.java` | 已实现 |
| Vault 监听服务 | `backend/.../service/wiki/VaultWatchService.java` | 已实现 |
| 页面服务 | `backend/.../service/wiki/WikiPageService.java` | 已实现 |
| 索引服务 | `backend/.../service/wiki/WikiIndexService.java` | 已实现 |
| 查询服务 | `backend/.../service/wiki/WikiQueryService.java` | 已实现 |
| Lint 服务 | `backend/.../service/wiki/WikiLintService.java` | 已实现 |
| MOC 生成 | `backend/.../service/wiki/MocGeneratorService.java` | 已实现 |
| Ingest 接口 | `WikiIngestController`（`/api/wiki/ingest`） | 已实现 |
| Lint 接口 | `WikiLintController`（`/api/wiki/lint`） | 已实现 |
| 查询接口 | `WikiQueryController` | 已实现 |
| 前端页面 | `frontend/wiki.html` | 已实现，支持查询/归档/批量入库/索引/页面列表/lint |

配置（`application_templete.yml` 的 `wiki:` 段）：vault-path、wiki-dir-name、sources-dir-name、batch-size、batch-timeout-minutes、lint-cache-enabled、extraction-model、synthesis-model、page-types、sync-enabled、sync-interval-seconds。

## 二、设计方向（llm-wiki-product-direction）

基于 Karpathy LLM Wiki 理论：以 Obsidian Vault 为存储，CutShelter 后端做 AI 处理（批量 ingest 省 token、index 优先查询、按需 lint），用户在 Obsidian 中浏览编辑。

关键省 token 策略：批量攒批 ingest（默认 5 条）、index.md 优先查询、模型路由（抽取用 DeepSeek、综合用 Qwen）、增量更新、按需 lint。

## 三、与产品开发工作台的关系

| 维度 | 产品开发工作台（pd-builtin） | Wiki 模块 |
|------|------------------------------|-----------|
| 数据源 | 剪藏 + 待办（Tag/Category=product-dev） | Obsidian Vault（sources/ + wiki/） |
| 落库方式 | Agent 归档 → TODO 目录 → 扫描落库 | Web Clipper → vault sources/ → 批量 ingest |
| 展示 | workspace 规则系统 | wiki.html + Obsidian |
| 二期关系 | spec 1.3：Wiki 落库 → 二期 | 独立演进 |

**当前两者互不依赖**：产品开发工作台 MVP 不读取 wiki 数据；wiki 模块也不向剪藏/待办落库。若二期要让 wiki 内容进入工作台，路径是：wiki 页面 → 导出/同步为剪藏（打 product-dev 标签）→ 规则命中。这是二期决策点，本期不实现。

## 四、一句话定位

wiki 是"基于 Obsidian 的 AI 知识库"，与"产品开发工作台（编码产出归档）"是两条独立链路，当前互不影响；代码已完成主体，缺的是把 llm-wiki-product-direction 的方向规划与已实现能力对齐的文档（本期不做代码改动）。
