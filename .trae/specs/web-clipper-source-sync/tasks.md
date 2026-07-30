# Tasks

## 任务总览

监听 vault `sources/` 目录（Obsidian Web Clipper 剪藏落地处），将新文件同步为"待整理"剪藏记录（ClipContent），复用 Web Clipper frontmatter 作为基础信息，原文用 `[[sources/文件名|标题]]` wiki-link 引用。与现有 VaultWatchService + BatchIngestService 的 AI ingest 流程独立运行。

---

## P0 — 核心同步引擎

- [x] Task 1: 创建 Web Clipper Frontmatter 解析器
  - [ ] SubTask 1.1: 创建 `backend/.../service/sync/WebClipperFrontmatterParser.java`，@Service，构造器注入无依赖
  - [ ] SubTask 1.2: 实现 `Map<String, Object> parse(String fileContent)`：解析 YAML frontmatter（`---` 包裹部分），返回字段 Map
  - [ ] SubTask 1.3: 实现 `ClipContent toClipContent(String fileContent, String fileName)`：将解析结果映射到 ClipContent 字段：
    - title → title（缺失时取 fileName 去扩展名）
    - source → sourceUrl
    - author → siteName
    - published → capturedAt（缺失时取 created）
    - created → createdAt
    - tags → tags（兼容 YAML 列表和逗号分隔字符串）
    - description → summary
    - source/type/category/workflowStatus 固定值：web-clipper/text/inbox/inbox
  - [ ] SubTask 1.4: frontmatter 缺失时降级：title=fileName 去扩展名，tags=空列表，capturedAt=文件修改时间
  - [ ] SubTask 1.5: 实现 `String extractTitle(String fileContent, String fileName)` 辅助方法
  - [ ] SubTask 1.6: 实现 `List<String> parseTags(Object tagsValue)` 辅助方法，兼容 YAML 列表（`- tag`）和逗号分隔字符串

- [x] Task 2: 创建 SourceSyncService 核心服务
  - [ ] SubTask 2.1: 创建 `backend/.../service/sync/SourceSyncService.java`，@Service，构造器注入 `WebClipperFrontmatterParser`、`FileStorageService`、`WikiConfig`
  - [ ] SubTask 2.2: 实现 `@PostConstruct init()`：加载 `.synced-files` 持久化集合，启动定时扫描（60 秒周期，复用 VaultWatchService 的扫描间隔）
  - [ ] SubTask 2.3: 实现 `Map<String, Object> syncSources()`：扫描 sources/ 目录，对每个未同步文件：
    1. 读取文件内容
    2. 调用 `webClipperFrontmatterParser.toClipContent(content, fileName)` 生成 ClipContent
    3. 设置 content 字段为 `[[sources/{文件名去扩展名}|{标题}]]`
    4. 调用 `fileStorageService.saveClip(clipContent)` 持久化
    5. 将文件名加入 `.synced-files` 集合并持久化
    6. 计数：新增 N 条、跳过 M 条
    7. 返回 `{syncedCount, skippedCount, totalScanned, message}`
  - [ ] SubTask 2.4: 实现去重：`isSynced(Path file)` 检查文件名是否在 `.synced-files` 集合
  - [ ] SubTask 2.5: 实现 `.synced-files` 持久化：路径 `{vaultPath}/{wikiDirName}/.synced-files`（与 `.processed-files` 同目录），每行一个文件名，仅追加
  - [ ] SubTask 2.6: 实现 `getStatus()`：返回 `{syncedCount, pendingCount, lastSyncTime, sourcesDir}`
  - [ ] SubTask 2.7: 实现 `@PreDestroy destroy()`：关闭调度器

- [x] Task 3: 创建 SourceSyncController
  - [ ] SubTask 3.1: 创建 `backend/.../controller/SourceSyncController.java`，@RestController @RequestMapping("/api/sync") @CrossOrigin(origins = "*")
  - [ ] SubTask 3.2: 端点 `POST /api/sync/trigger`：调用 `sourceSyncService.syncSources()`，返回同步统计
  - [ ] SubTask 3.3: 端点 `GET /api/sync/status`：调用 `sourceSyncService.getStatus()`，返回同步状态
  - [ ] SubTask 3.4: 参考现有 `WikiIngestController.java` 的代码风格

- [x] Task 4: 前端剪藏列表展示 Web Clipper 来源
  - [ ] SubTask 4.1: 修改 `frontend/clip.html`，在剪藏列表项中根据 `source` 字段显示来源标记（如 "Web Clipper" 徽章）
  - [ ] SubTask 4.2: 当 content 字段为 `[[...|...]]` 格式时，展示为可点击的 wiki-link 样式（蓝色链接文本，点击跳转到 vault 文件路径）
  - [ ] SubTask 4.3: 在剪藏列表页新增"同步状态"展示区（可选，或在设置页）：显示已同步 N 条、待同步 M 条
  - [ ] SubTask 4.4: 新增"立即同步"按钮，调用 `POST /api/sync/trigger`，显示同步结果

## P1 — 增强体验

- [x] Task 5: 同步配置化
  - [ ] SubTask 5.1: 在 `WikiConfig.java` 新增字段：`syncEnabled`（默认 true）、`syncIntervalSeconds`（默认 60）
  - [ ] SubTask 5.2: SourceSyncService 根据配置控制扫描间隔和开关
  - [ ] SubTask 5.3: 在 `application_templete.yml` 的 `wiki` 段新增配置项

- [x] Task 6: 剪藏记录与 wiki 关联
  - [ ] SubTask 6.1: 在 ClipContent 新增可选字段 `sourceFilePath`（存储 sources/ 中的相对路径，如 `sources/2026-07-30_React入门.md`）
  - [ ] SubTask 6.2: SourceSyncService 同步时填充 sourceFilePath
  - [ ] SubTask 6.3: 前端剪藏详情页展示"查看原文"链接，点击打开 vault 文件

# Task Dependencies

- Task 1（Frontmatter 解析器）→ Task 2（SourceSyncService 依赖解析器）
- Task 2（SourceSyncService）→ Task 3（Controller 依赖 Service）
- Task 2（SourceSyncService）→ Task 4（前端依赖后端 API）
- Task 5、6 可与 Task 3、4 并行
- 与 `llm-wiki-product-direction` 的 Task 1-10 无依赖（独立运行）

# 设计模式说明

- **职责分离**：WebClipperFrontmatterParser（解析）、SourceSyncService（同步编排）、SourceSyncController（接口）各自独立
- **低耦合**：SourceSyncService 不依赖 VaultWatchService 或 BatchIngestService，仅共享 sources/ 目录
- **去重独立**：`.synced-files`（SourceSyncService）与 `.processed-files`（VaultWatchService）各自维护，互不干扰
- **复用**：复用 ClipContent 模型、FileStorageService 持久化、WikiConfig 配置
- **降级**：frontmatter 解析失败时降级创建剪藏，不中断同步流程

# 验证方式

1. 在 vault `sources/` 目录手动创建一个含 frontmatter 的 .md 文件（模拟 Web Clipper 剪藏）
2. 等待 60 秒或调用 `POST /api/sync/trigger`
3. 调用 `GET /api/clip` 确认剪藏列表新增一条记录，source=web-clipper, category=inbox
4. 确认 content 字段为 `[[sources/文件名|标题]]` 格式
5. 确认 frontmatter 字段正确映射（title/sourceUrl/tags 等）
6. 调用 `GET /api/sync/status` 确认 syncedCount 增加
7. 再次触发同步，确认不重复创建（skippedCount 增加）
8. 创建一个无 frontmatter 的 .md 文件，确认降级创建（title=文件名）
9. 确认 VaultWatchService 的 ingest 队列不受影响（`.processed-files` 与 `.synced-files` 独立）
