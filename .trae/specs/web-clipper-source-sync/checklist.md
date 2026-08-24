# 验证检查清单

## P0 — 核心同步引擎

### Task 1: Web Clipper Frontmatter 解析器

#### 功能验证
- [x] `WebClipperFrontmatterParser.java` 已创建，@Service
- [x] `parse(fileContent)` 能解析 `---` 包裹的 YAML frontmatter，返回字段 Map
- [x] `toClipContent(fileContent, fileName)` 正确映射字段：
  - title → title（缺失时取 fileName 去扩展名）
  - source → sourceUrl
  - author → siteName
  - published → capturedAt
  - created → capturedAt（作为 published 缺失时的 fallback）
  - tags → tags
  - description → summary
- [x] source 固定为 "web-clipper"
- [x] type 固定为 "text"
- [x] category 固定为 "inbox"
- [x] workflowStatus 固定为 "inbox"
- [x] frontmatter 缺失时降级：title=fileName 去扩展名，tags=空列表
- [x] `parseTags()` 兼容 YAML 列表格式（`- tag1\n- tag2`）
- [x] `parseTags()` 兼容逗号分隔字符串（`tag1, tag2`）
- [x] `parseTags()` 对空 tags 字段返回空列表

#### 设计模式验证
- [x] WebClipperFrontmatterParser 无依赖注入（纯解析逻辑）
- [x] 解析失败不抛异常，降级返回默认值

### Task 2: SourceSyncService 核心服务

#### 功能验证
- [x] `SourceSyncService.java` 已创建，@Service
- [x] 构造器注入 WebClipperFrontmatterParser、FileStorageService、WikiConfig
- [x] `@PostConstruct init()` 加载 `.synced-files` 并启动定时扫描
- [x] 定时扫描间隔 60 秒（可配置）
- [x] `syncSources()` 主流程：扫描 → 解析 → 创建 ClipContent → 持久化 → 标记已同步
- [x] content 字段设为 `[[sources/{文件名去扩展名}|{标题}]]`
- [x] 去重：已同步文件不重复创建
- [x] `.synced-files` 持久化到 `{vaultPath}/{wikiDirName}/.synced-files`
- [x] `getStatus()` 返回 syncedCount、pendingCount、lastSyncTime、sourcesDir
- [x] `@PreDestroy destroy()` 关闭调度器

#### 降级验证
- [x] 文件读取失败时跳过该文件，不中断同步
- [x] ClipContent 持久化失败时记录错误日志，继续处理下一个文件

#### 独立性验证
- [x] `.synced-files` 与 VaultWatchService 的 `.processed-files` 是独立文件
- [x] SourceSyncService 不依赖 VaultWatchService 或 BatchIngestService
- [x] 同步剪藏不触发 AI ingest

### Task 3: SourceSyncController

#### 功能验证
- [x] `SourceSyncController.java` 已创建，@RestController @RequestMapping("/api/sync")
- [x] `POST /api/sync/trigger` 触发同步，返回 `{syncedCount, skippedCount, totalScanned, message}`
- [x] `GET /api/sync/status` 返回 `{syncedCount, pendingCount, lastSyncTime, sourcesDir}`
- [x] @CrossOrigin(origins = "*")

### Task 4: 前端展示

#### 功能验证
- [x] `clip.html` 剪藏列表项根据 source 字段显示来源标记
- [x] source="web-clipper" 时显示 "Web Clipper" 徽章
- [x] content 为 `[[...|...]]` 格式时展示为 wiki-link 样式（蓝色链接）
- [x] wiki-link 点击可跳转（或在 Obsidian 中打开）
- [x] "立即同步"按钮调用 POST /api/sync/trigger
- [x] 同步结果展示（新增 N 条、跳过 M 条）

#### 交互验证
- [x] 同步按钮有加载状态
- [x] 同步完成后自动刷新剪藏列表

## P1 — 增强体验

### Task 5: 同步配置化

#### 功能验证
- [x] WikiConfig 新增 syncEnabled（默认 true）和 syncIntervalSeconds（默认 60）字段
- [x] SourceSyncService 根据配置控制扫描间隔
- [x] syncEnabled=false 时不启动定时扫描
- [x] application_templete.yml 的 wiki 段含新配置项

### Task 6: 剪藏记录与 wiki 关联

#### 功能验证
- [x] ClipContent 新增 sourceFilePath 字段（可选）
- [x] SourceSyncService 同步时填充 sourceFilePath（如 `sources/2026-07-30_React入门.md`）
- [x] 前端剪藏详情页展示"查看原文"链接（wiki-link 渲染为可点击链接，功能等效）
- [x] 点击链接打开 vault 文件路径（openInObsidian 跳转）

## 跨阶段验证

### frontmatter 映射验证
- [x] 完整 frontmatter 文件：所有字段正确映射
- [x] 部分字段缺失：对应字段为 null，不报错
- [x] 无 frontmatter 文件：降级创建，title=文件名
- [x] tags YAML 列表格式：正确解析为 List<String>
- [x] tags 逗号分隔格式：正确解析为 List<String>

### wiki-link 引用验证
- [x] content 格式为 `[[sources/{文件名去扩展名}|{标题}]]`
- [x] 文件名去 .md 扩展名
- [x] 标题取 frontmatter title，缺失时用文件名
- [x] 在 Obsidian 中该 wiki-link 可点击跳转到原文件

### 独立性验证
- [x] SourceSyncService 与 VaultWatchService 并行运行不冲突
- [x] `.synced-files` 和 `.processed-files` 是独立文件
- [x] 同一文件被两个服务独立处理（同步剪藏 + AI ingest）
- [x] 同步剪藏不消耗 AI token（无 LLM 调用）

### 与现有功能并存验证
- [x] 现有浏览器扩展剪藏继续可用（source=browser）
- [x] 现有手动剪藏继续可用（source=manual）
- [x] 现有智能入库继续可用（source=system）
- [x] 剪藏列表能区分 web-clipper/browser/manual/system 来源
- [x] 现有 inbox 工作流不受影响（web-clipper 剪藏也走 inbox → organized 流程）
