# 验证检查清单

## P0 — 批量 Ingest 引擎

### Task 1: Wiki 配置与目录结构

#### 功能验证
- [x] `WikiConfig.java` 已创建，使用 @ConfigurationProperties(prefix = "wiki")
- [x] 配置项含：vault 路径、批量窗口大小（默认 5）、批量触发超时（默认 30 分钟）、模型路由策略、页面类型定义、lint 缓存开关
- [x] `application.yml` 含 `wiki` 配置段，有合理默认值
- [x] `WikiPageService.java` 已创建，含 createPage/updatePage/readPage/pageExists/listPages/isManualEdited 方法
- [x] 页面路径遵循 `wiki/entities/`、`wiki/concepts/`、`wiki/synthesis/`、`wiki/sources/` 约定
- [x] 首次 ingest 时自动创建 `wiki/` 目录 + 初始 `index.md` + `log.md`

#### 设计模式验证
- [x] WikiConfig 与业务逻辑分离，不含处理代码
- [x] WikiPageService 是独立 @Service，不依赖 ContentOrganizeService
- [ ] 目录结构和命名规则通过配置控制，非硬编码

### Task 2: Index 与 Log 服务

#### 功能验证
- [x] `WikiIndexService.java` 已创建
- [x] 页面创建/更新时 `index.md` 同步更新，按类别分组列出
- [x] index.md 每条含 wiki-link、一行摘要、更新日期
- [x] index.md 顶部含统计信息（总页数、各类型页数、最近更新时间）
- [x] `log.md` 每次操作追加 `## [yyyy-MM-dd HH:mm] {type} | {title}` 记录
- [x] log.md 仅追加不修改

#### 设计模式验证
- [x] WikiIndexService 是独立 @Service
- [x] index/log 更新逻辑不在 IngestService 中内联，通过调用 WikiIndexService 完成

### Task 3: Vault 监听与攒批服务

#### 功能验证
- [x] `VaultWatchService.java` 已创建
- [x] 能监听 vault `sources/` 目录新增文件（WatchService 或定时扫描）
- [x] 新文件入队，不立即触发 AI
- [ ] 队列达到批量窗口大小（默认 5）时自动触发 `BatchIngestService.ingestBatch()`
- [x] 去重：已 ingest 的来源（根据 clip-id 或文件名）跳过
- [ ] 定时窗口：队列非空但未达批量大小，超时（默认 30 分钟）自动触发
- [x] 队列状态查询接口可用（当前队列长度、批量窗口配置）

#### 省 token 验证
- [x] 逐条剪藏不触发逐条 AI，而是攒批后一次处理
- [x] 去重避免重复 ingest 已处理来源

### Task 4: 批量 Ingest 引擎

#### 功能验证
- [x] `BatchIngestService.java` 已创建
- [x] `ingestBatch(List<Path> sourceFiles)` 完整流程：批量提取 → 增量更新页面 → 生成来源页 → 更新 index → 追加 log
- [x] 批量提取：一次 LLM 调用处理多条来源（非逐条调用）
- [x] 增量更新：仅更新 AI 判断相关的已有页面（非全量重建）
- [x] 实体页含：实体定义、相关来源摘要、与其他实体的 wiki-link 关系
- [x] 概念页含：概念释义、跨源综合、相关实体链接、相关来源列表
- [x] 来源页含：原文摘要、AI 分析、原始来源链接
- [x] 矛盾检测：新内容与已有页面矛盾时，追加 `> [!warning] 矛盾标注` Callout
- [x] 手动编辑保护：frontmatter `manual-edited: true` 的页面跳过自动更新，仅追加"最近来源"
- [ ] 返回 ingest 统计（触及页面数、新增实体/概念数、跳过数、token 消耗估算）

#### 省 token 验证
- [x] 批量提取是一次 LLM 调用处理 N 条来源（查看日志确认）
- [x] 增量更新仅对相关页面调用 AI（非全量页面）
- [ ] token 消耗估算返回正确

#### 设计模式验证
- [x] BatchIngestService 构造器注入 AiService/WikiPageService/WikiIndexService/ObsidianExportFormatter
- [x] ingest 编排逻辑清晰，不包含具体页面格式化代码（委托给 formatter）
- [x] 复用已完成的 ObsidianExportFormatter 生成 frontmatter/Callout

### Task 5: AiService 批量 Wiki 方法

#### 功能验证
- [x] `batchExtractEntitiesAndConcepts(List<String>)` 一次调用处理多条来源，返回 List 结果
- [x] `generateEntityPage()` 生成含 wiki-link 互链的实体页 Markdown
- [x] `generateConceptPage()` 生成含跨源综合的概念页
- [x] `generateSourcePage()` 生成来源页（原文摘要+AI 分析+链接）
- [x] `detectContradiction()` 返回矛盾描述或 null

#### 省 token 验证
- [ ] 提取类方法（batchExtract）路由到便宜模型（如 DeepSeek）
- [ ] 生成/检测类方法（generate/detect）路由到强模型（如 Qwen-Max）
- [ ] 路由策略可通过配置调整

#### 设计模式验证
- [x] 新增方法不硬编码 Prompt，通过 PromptConfigService 读取
- [x] 通过 RoutingLlmProvider 路由模型，不直接调用具体 provider
- [x] 失败降级，不抛出异常中断 ingest 流程

## P1 — Index 优先查询 & 按需 Lint

### Task 6: Wiki 综合查询（index 优先）

#### 功能验证
- [x] `WikiQueryService.java` 已创建
- [x] `query()` 两步流程：index 定位（便宜模型）→ 页面综合（强模型）
- [x] index 定位：LLM 读 index.md，返回相关页面名列表（通常 2-3 个）
- [x] 页面综合：仅读取相关页面内容（非全量 wiki），LLM 综合带 wiki-link 引用答案
- [x] 答案含 wiki-link 引用，可点击
- [x] `archiveAsSynthesis()` 将答案归档为综述页
- [x] 返回 token 消耗估算
- [x] `/api/wiki/query` 和 `/api/wiki/archive` 端点可用
- [x] 前端查询入口可用，含"归档为综述页"按钮，显示 token 消耗

#### 省 token 验证
- [x] 查询不读全量 wiki，仅读 index + 2-3 个相关页
- [ ] index 定位用便宜模型，页面综合用强模型
- [x] token 消耗估算透明展示

#### 设计模式验证
- [x] WikiQueryService 独立于 BatchIngestService
- [x] 查询和归档分离，归档是可选操作

### Task 7: 按需 Lint 服务

#### 功能验证
- [x] `WikiLintService.java` 已创建
- [x] `lint()` 检测：矛盾、过时、孤儿页、缺失页、缺失交叉引用
- [x] 生成 `wiki/lint-report.md`，按类型分组
- [x] `/api/wiki/lint` 端点可手动触发，异步执行
- [x] 前端 lint 报告展示可用
- [x] 增量 lint 缓存：未变更页面（根据 frontmatter `updated`）跳过，合并上次结果

#### 省 token 验证
- [x] lint 是用户手动触发，非定时消耗
- [x] 增量缓存：未变更页面不重复检查
- [x] 再次 lint 时仅检查新增/更新页面

#### 设计模式验证
- [x] WikiLintService 独立，不依赖 IngestService 运行时状态
- [ ] lint 报告作为 wiki 页面归档，本身也被 index 收录

### Task 8: Ingest 触发与队列管理前端

#### 功能验证
- [x] ingest 队列状态展示（当前 N/批量窗口）
- [x] "立即摄入"按钮可手动触发
- [ ] ingest 进度展示（提取中→更新页面中→生成来源页中→更新索引中）
- [ ] 完成后显示统计（更新 N 个页面、新增 M 个实体/概念、消耗 K token）
- [x] `/api/wiki/ingest/queue` 和 `/api/wiki/ingest/trigger` 端点可用

#### 交互验证
- [x] 队列状态实时更新
- [ ] 进度反馈清晰
- [ ] token 消耗透明展示

## P2 — Obsidian 深度兼容

### Task 9: MOC 索引页

#### 功能验证
- [x] `MocGeneratorService.java` 已创建
- [x] `generateMoc()` 生成 `wiki/MOC_{分类中文名}.md`
- [x] MOC 含按日期倒序的 wiki-link 列表 + 标签云
- [x] MOC frontmatter 含 `type: moc`
- [x] ingest 后自动更新相关分类 MOC

### Task 10: Obsidian 原生体验

#### 功能验证
- [x] wiki 页面 frontmatter 含 `aliases` 字段（Obsidian 别名容错）
- [x] frontmatter 含 `sources`/`updated`/`type`，支持 Dataview 查询
- [x] wiki-link 使用 `[[页面名]]` 或 `[[页面名|显示名]]` 规范
- [x] wiki 根目录含 `README.md` 说明结构和 Obsidian 使用建议

#### Obsidian 兼容性验证
- [ ] 用 Obsidian 打开 vault，graph view 可见页面连接网络
- [ ] Backlinks 面板显示反向链接
- [ ] Dataview 插件可基于 frontmatter 生成动态列表
- [ ] MOC 页可作为分类导航入口
- [ ] 标签面板显示所有 wiki 标签

## 跨阶段验证

### 省 Token 验证（核心设计目标）
- [x] 批量 ingest：N 条来源用 1 次提取调用 + M 次增量更新（M << N×全量页面）
- [x] index 优先查询：仅读 index + 2-3 相关页（非全量扫描）
- [ ] 模型路由：提取/标签用便宜模型，综合/检测用强模型
- [x] 按需 lint：用户手动触发，非定时；增量缓存跳过未变更页
- [ ] token 消耗估算在 ingest 和 query 后透明展示

### 知识复利验证
- [x] 新增剪藏后，已有 wiki 页面被更新（非重复创建）
- [x] 多次 ingest 后，wiki 页面内容随来源增加而丰富
- [x] 矛盾被标注而非删除，保留多方观点
- [x] 查询答案可归档为综述页，探索复利

### 与现有功能并存验证
- [x] 现有浏览器扩展继续可用，不被破坏
- [x] 现有 ContentOrganizeService 日报生成流程正常，不触发 wiki ingest
- [x] 现有全文搜索仍搜索原始剪藏，不受 wiki 影响
- [x] Git 同步包含 wiki 目录
- [x] 现有 Obsidian 格式 MVP（frontmatter/Callout/标签）被 wiki 页面继承

### Web Clipper 集成验证
- [ ] Web Clipper 剪藏的文件落入 vault `sources/` 目录
- [ ] VaultWatchService 能监听到新文件并入队
- [ ] Web Clipper 的 frontmatter（title/url/date/tags）被正确解析
