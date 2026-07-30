# Web Clipper Source Sync Spec

## Why

用户已采用 Obsidian Web Clipper 作为浏览器剪藏入口，剪藏文件直接落入 vault `sources/`。但当前 CutShelter 的剪藏列表（ClipContent 表）无法感知这些文件——用户在 CutShelter 界面看不到 Web Clipper 剪藏的内容，导致两个系统割裂。

需要监听 `sources/` 目录，将 Web Clipper 剪藏的文件**同步为"待整理"剪藏**，复用 Web Clipper 在 frontmatter 中已存储的属性（title/source/tags/published 等）作为基础信息，原文不复制而是用 Obsidian wiki-link `[[sources/文件名|标题]]` 引用，保持 vault 为唯一真源。

## What Changes

- **新增** `SourceSyncService`：监听 `sources/` 目录，发现新文件时解析 frontmatter，创建 ClipContent 记录（category=inbox, workflowStatus=inbox, source=web-clipper）
- **新增** `WebClipperFrontmatterParser`：解析 Web Clipper 标准 frontmatter 字段（title/source/author/published/created/tags/description）映射到 ClipContent 字段
- **新增** 去重机制：通过文件名持久化已同步记录（`.synced-files`），避免重复创建 ClipContent
- **新增** `SourceSyncController`：提供手动同步触发和状态查询端点
- **修改** `frontend/clip.html`：剪藏列表展示 Web Clipper 来源标记，原文引用以 wiki-link 形式展示并可点击跳转
- **不改动** 现有 `VaultWatchService`（攒批 AI ingest 流程独立运行，互不干扰）
- **不改动** 现有 `ClipService` 入库接口（SourceSyncService 直接调用 FileStorageService 持久化，复用 ClipContent 模型）

## Impact

- Affected specs:
  - `llm-wiki-product-direction`（VaultWatchService 与 SourceSyncService 并行监听同一 sources/ 目录，各自维护已处理/已同步集合，互不干扰）
  - `smart-ingest`（智能入库的 clip intent 与 web-clipper 来源共存，source 字段区分）
  - `clip-enhancements`（剪藏列表新增 web-clipper 来源类型和 wiki-link 原文引用）
- Affected code:
  - 新增 `backend/.../service/sync/SourceSyncService.java`：监听 sources/ 同步到剪藏列表
  - 新增 `backend/.../service/sync/WebClipperFrontmatterParser.java`：解析 Web Clipper frontmatter
  - 新增 `backend/.../controller/SourceSyncController.java`：同步触发和状态查询端点
  - 复用 `backend/.../model/ClipContent.java`：剪藏数据模型（新增 source="web-clipper" 取值）
  - 复用 `backend/.../service/FileStorageService.java`：剪藏持久化
  - 复用 `backend/.../config/WikiConfig.java`：vault 路径和 sources 目录名配置
  - 修改 `frontend/clip.html`：展示 web-clipper 来源标记和 wiki-link 原文引用

## ADDED Requirements

### Requirement: Sources 目录监听与同步

系统 SHALL 监听 vault `sources/` 目录新增的 .md 文件，自动同步为"待整理"剪藏记录，无需用户手动操作。

#### Scenario: Web Clipper 剪藏同步
- **WHEN** Obsidian Web Clipper 将网页转为 Markdown 存入 vault `sources/` 目录
- **THEN** 系统在下次扫描时（默认 60 秒周期）检测到新文件
- **AND** 解析文件 frontmatter 提取 title/source/tags/published/created/author/description 字段
- **AND** 创建 ClipContent 记录，category=inbox, workflowStatus=inbox, source=web-clipper
- **AND** content 字段设为 wiki-link 引用 `[[sources/{文件名去扩展名}|{标题}]]`
- **AND** 将文件名加入 `.synced-files` 持久化集合，避免重复同步

#### Scenario: 去重处理
- **WHEN** 扫描发现的文件已在 `.synced-files` 集合中
- **THEN** 跳过该文件，不重复创建 ClipContent
- **AND** 不记录警告日志（正常行为）

#### Scenario: frontmatter 缺失降级
- **WHEN** 文件无 frontmatter 或 frontmatter 解析失败
- **THEN** 降级创建 ClipContent，title 取文件名（去扩展名），tags 为空，capturedAt 取文件创建时间
- **AND** content 字段仍为 wiki-link 引用
- **AND** 记录降级日志

#### Scenario: 手动触发同步
- **WHEN** 用户调用 `POST /api/sync/trigger`
- **THEN** 系统立即执行一次 sources/ 目录扫描和同步
- **AND** 返回同步统计（新增 N 条剪藏、跳过 M 条已同步）

### Requirement: Web Clipper Frontmatter 解析

系统 SHALL 解析 Obsidian Web Clipper 标准 frontmatter 字段，映射到 ClipContent 模型字段。

#### Scenario: 完整 frontmatter 映射
- **WHEN** Web Clipper 文件含完整 frontmatter
- **THEN** 按以下映射填充 ClipContent：
  | Web Clipper frontmatter | ClipContent 字段 | 说明 |
  |---|---|---|
  | title | title | 网页标题 |
  | source | sourceUrl | 原始 URL |
  | author | siteName | 作者/站点 |
  | published | capturedAt | 发布时间 |
  | created | createdAt | 剪藏时间 |
  | tags | tags | 标签列表 |
  | description | summary | 描述/摘要 |
- **AND** source 字段固定为 "web-clipper"
- **AND** type 字段固定为 "text"
- **AND** category 字段固定为 "inbox"
- **AND** workflowStatus 字段固定为 "inbox"

#### Scenario: frontmatter 字段缺失
- **WHEN** frontmatter 中某些字段缺失（如无 author 或 published）
- **THEN** 对应 ClipContent 字段为 null，不报错
- **AND** 其他字段正常映射

#### Scenario: tags 格式兼容
- **WHEN** tags 字段为 YAML 列表格式（`- tag1\n- tag2`）
- **THEN** 正确解析为 List<String>
- **WHEN** tags 字段为逗号分隔字符串（`tag1, tag2`）
- **THEN** 兼容解析为 List<String>（按逗号分割并 trim）

### Requirement: 原文 wiki-link 引用

系统 SHALL 在 ClipContent.content 字段使用 Obsidian wiki-link 引用 sources/ 中的原文件，而非复制原文内容，保持 vault 为唯一真源。

#### Scenario: wiki-link 格式
- **WHEN** 系统创建 Web Clipper 同步剪藏
- **THEN** content 字段格式为 `[[sources/{文件名去扩展名}|{标题}]]`
- **AND** 文件名去扩展名指去除 `.md` 后缀
- **AND** 标题取 frontmatter title，缺失时用文件名
- **例如** 文件 `sources/2026-07-30_React入门.md`，title="React 入门指南"，content=`[[sources/2026-07-30_React入门|React 入门指南]]`

#### Scenario: Obsidian 可点击跳转
- **WHEN** 用户在 Obsidian 中查看该剪藏记录（若剪藏记录也在 vault 中）
- **THEN** wiki-link 可点击跳转到 sources/ 中的原文件
- **AND** 显示文本为 title

### Requirement: 同步状态查询

系统 SHALL 提供同步状态查询接口，展示已同步文件数和待同步文件数。

#### Scenario: 查询同步状态
- **WHEN** 用户调用 `GET /api/sync/status`
- **THEN** 返回 `{ syncedCount, pendingCount, lastSyncTime, sourcesDir }`
- **AND** syncedCount 为 `.synced-files` 集合大小
- **AND** pendingCount 为 sources/ 目录中未同步的文件数

### Requirement: 与 Wiki Ingest 流程独立

系统 SHALL 与现有 VaultWatchService + BatchIngestService 的 AI ingest 流程完全独立，互不干扰。

#### Scenario: 并行运行
- **WHEN** SourceSyncService 和 VaultWatchService 同时监听 sources/ 目录
- **THEN** 两个服务各自维护独立的已处理集合（`.synced-files` vs `.processed-files`）
- **AND** SourceSyncService 同步剪藏不触发 AI ingest
- **AND** BatchIngestService 的 AI ingest 不影响剪藏列表同步
- **AND** 同一文件会被两个服务独立处理（SourceSyncService 创建剪藏记录，BatchIngestService 更新 wiki 页面）

## MODIFIED Requirements

无。不改动现有接口。

## REMOVED Requirements

无。
