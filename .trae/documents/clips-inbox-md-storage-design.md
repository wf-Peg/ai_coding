# 收件箱剪藏：JSON 权威存储 + 单条剪藏 Markdown 视图（设计分析与方案）

## 一、结论（先回答问题）

**收件箱剪藏不适合直接改 MD 存储，当前 JSON 存储是合适的，应保留。**

理由（结合代码实证与你的澄清）：

1. **剪藏是"基础数据/原料"**：你已确认"剪藏是基础数据，用户选择加工或者日报周报输出的才是 md 文件"。这正好对应系统现有架构——
   - `clip-storage/{category}/{yyMMdd}.json` = 剪藏原始数据（Feed）
   - `clip-organized/` 下的 `.md` = 加工/整理产物（Archive）
   两者的"归档 vs 整理"属性本来就是分开的，符合你的预期。
2. **ClipContent 有约 30 个结构化字段**（[ClipContent.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/model/ClipContent.java)）：
   `id / content / analysis / tags / workflowStatus / analysisStatus / imagePaths / annotations / myThoughts / contentFormat / sourceEncoding …`
   这些字段驱动异步 AI 回写、检索、生命周期、标注汇总。**纯 MD + `##` 分段无法无损承载它们**，硬塞 frontmatter 会让 MD 结构臃肿且解析脆弱。
3. **一个日期文件是按天聚合的"对象数组"**（[FileStorageService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/FileStorageService.java#L303-L306)），且 **AI 分析是异步回写**：先进库 `pending`，后台线程改 `summary/analysis` 后再重写整个数组（[ContentOrganizeService 调用链](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java#L248-L306)）。这种"高频改写 + 数组聚合"更贴合 JSON；改 MD 需在每个回写点做"解析 MD 结构 + 定点替换"，易错、易破格式。
4. **系统已有 MD 产物 + Obsidian frontmatter 先例**：`ContentOrganizeService.exportClipToVault()` 已在"整理"时把单条剪藏导出为独立 `.md`（frontmatter + `# 标题` + `## 原文` + AI 分析/发散/思考 callout），存储到 `clip-organized/clips/{年}/{月}/{分类}/{yyMMdd}_{短id}.md`（[ContentOrganizeService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java#L347-L405)）。**这条"剪藏→MD"管线已经存在**，只是只在批量"整理/日报"时触发，缺少针对单条收件箱剪藏的即时入口。

### 结论
把收件箱剪藏本身存成 MD 是改造错方向。正确做法是：**保留 JSON 为权威存储，在"单剪藏加工"边界补一个按需的 Markdown 视图/导出能力**（即你选的混合方案 B），让用户看到/拿到的是干净的 `## 原文/摘要/分析/标签` MD，而不是裸 JSON。这样既不改脆弱的存取层，又能让剪藏以可读 MD 被消费。

---

## 二、现状盘点（已读代码）

| 层 | 文件 | 要点 |
|---|---|---|
| 模型 | [ClipContent.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/model/ClipContent.java) | 30+ 字段，含 annotations / imagePaths / analysisStatus 等 |
| 存储 | [FileStorageService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/FileStorageService.java) | 按 `{category}/{yyMMdd}.json`，存"对象数组"；read/write 全量原子改写 |
| 服务 | [ClipService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java) | `getClipById()` 单条详情入口；AI 异步回写 |
| 整理 | [ContentOrganizeService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java) | 已有单剪藏→MD（`exportClipToVault`），但仅批量整理触发；`rewriteImageReferences` 为私有 |
| 格式化 | [ObsidianExportFormatter.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/obsidian/ObsidianExportFormatter.java) | `generateClipFrontmatter()` / `wrapCallout()` / `formatTagsInline()` 全可复用 |
| 后端路由 | [ClipController.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/ClipController.java) | `GET /api/clip/list` 等；详情/详情操作端点集中于此 |
| 前端详情 | [clip-actions.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/clip-actions.js) | `createClipItem()` 渲染单条剪藏，含"整理/编辑"(`organize/{id}`)、"发散总结"、"OCR"、"在编辑器打开"等操作 |
| 前端渲染 | [clip.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/clip.html) / `clip-list.js` | 收件箱列表；内容用 `MediaKit.render.renderMarkdown()` 渲染 |

---

## 三、目标

新增一项轻量能力：**单条剪藏可即时生成 Markdown 视图**，并支持按需落盘知识库：
- 剪藏详情区「📄 导出 MD」按钮 → 弹窗预览 Markdown（YAML frontmatter + 章节结构）；
- 弹窗内可「📋 复制 MD」到剪贴板，或「📁 落盘到知识库」（与整理归档同一目录约定，Obsidian 可直接索引）。

不迁移既有数据、不改 JSON 存取层、不改异步 AI 回写逻辑。

---

## 四、改动方案（最终实现，2026-09-16 对齐后落地）

### 1. 后端：新增 `ClipMarkdownService`（新建文件，已完成）
路径：`backend/src/main/java/com/example/clip/service/ClipMarkdownService.java`

- `String buildMarkdown(ClipContent clip)`：
  - frontmatter 采用**新形态**（对齐「写作区智能剪藏」预览，独立于 organize 旧 FM）：
    `title` / `tags`(flow 列表，空不输出) / `type: clip` / `status`(workflowStatus，空回退 inbox) / `created`(yyyy-MM-dd HH:mm) / `source`(sourceUrl 非空才输出)
  - 正文：`# 标题` + 按序章节 `## 原文/摘要/分析/发散总结/标签/我的思考`（空章节跳过）+ `🔗 来源：[url](url)`
  - 私有 helpers：`appendSection`（空跳过）、`yamlScalar`（含冒号/井号/引号/列表起始符时双引号）、`topCategoryLabel`（复用 `AiService.CATEGORY_TREE` 值 → 顶层中文名，兜底返还原值）、`sanitizeDirName`、`shortIdOf`（8 位 hex 短 id，与 organize 一致）
- `String exportToVault(ClipContent clip, String markdown)`：落盘 `{organizedStoragePath}/clips/{yyyy}/{MM}/{一级分类目录}/{yyMMdd}_{短id}.md`，返回相对知识库根路径。目录/文件名约定与 `ContentOrganizeService.exportClipToVault` 完全一致（复制简版映射，未动其公共 API —— 决策 A3）。
- 依赖注入：`@Value("${clip.organized-storage.path:./clip-organized}")`。

### 2. 后端：`ClipController` 双模式端点（已完成）
```
GET /api/clip/{id}/export-markdown          → 预览：JSON {id, markdown, saved:false, path:null}
GET /api/clip/{id}/export-markdown?save=1   → 落盘：JSON {id, markdown, saved:true, path:"clips/2026/05/..."}
```
- `id` 不存在 → 404（`getClipById` 返回 null 即 `notFound()`）；异常 → 500 `{error}`。
- 落盘路径为相对知识库根（organizedStoragePath）的路径，前端直接展示。
- 普通快速 GET，**无需** Electron 代理超时豁免（与 `divergent-summary/{id}` 同理）。

### 3. 后端：organize 归档 FM 补 `analysis`（已完成）
- `ObsidianExportFormatter.generateClipFrontmatter` 新增 `String analysis` 参数（summary 之后）与 `case "analysis"`（输出格式同 summary，`yamlEscapeValue`）。
- `ObsidianExportConfig.clipFrontmatterFields` 默认列表在 `summary` 后插入 `analysis`。
- `ContentOrganizeService.exportClipToVault` 调用点传入 `clip.getAnalysis()`。

### 4. 后端：captureMethod 白名单修复（已完成）
- `ClipService.SUPPORTED_CAPTURE_METHODS` 追加 `"editor-document"`、`"editor-selection"`，不再被 `normalizeCaptureMethod` 归一化为 `popup`。

### 5. 前端：剪藏详情「导出 MD」入口 + 预览弹窗（已完成）
- `clip-list.js`：`createClipItem()` 的 `.clip-detail` 顶部新增按钮 `📄 导出 MD`（`onclick="openExportMdModal(${clip.id})"`）；文件尾部新增 4 个全局函数：
  - `openExportMdModal(clipId)`：GET 预览端点 → `MediaKit.render.renderMarkdown` 渲染进弹窗；
  - `closeExportMdModal()`；
  - `copyExportMd()`：复用全局 `copyToClipboard` 复制缓存 MD；
  - `saveExportMdToVault()`：GET `?save=1` → `showToast` 展示返回路径。
- `clip.html`：新增 `#export-md-modal` 弹窗（modal-header「导出 MD 预览」+ 关闭、modal-body 含 hint + `#export-md-preview` 滚动区、modal-footer 含「📋 复制 MD / 📁 落盘到知识库 / 关闭」三按钮）。

---

## 五、不改的东西（明确边界，避免过度设计）
- ❌ 不迁移/改写 `clip-storage/**/*.json` 存量数据。
- ❌ 不改 `FileStorageService` 的 JSON 读写与异步回写。
- ❌ 不做"收件箱整体按天聚合 MD"（日报/周报已有 `organize` / `weekly-report`）。
- ❌ 不改 Obsidian 归档的 `exportClipToVault` 逻辑。

---

## 六、假设与决策（2026-09-16 与用户对齐后拍板）
- **A1**：MD 视图的图片引用保持 `media/...` 原样（应用内渲染），与 Obsidian assets 重写分离。→ 决策。
- **A2**：缺失字段的段直接不输出（保持 MD 干净）。→ 决策。
- **A3**：分类中文名映射以最小侵入复用（复制简版），不重构 `ContentOrganizeService`。→ 决策。
- **A4**：前端只加"导出 MD"一个入口，不做批量。→ 决策。
- **D1（端点形态）**：`GET /api/clip/{id}/export-markdown` 双模式 —— 默认返回 MD 预览（JSON 包装），`save=1` 落盘知识库并返回相对路径。→ 用户已选「预览 + 落盘双模式」。
- **D2（前端入口）**：放在**剪藏详情弹窗/详情区**（`.clip-detail` 顶部「📄 导出 MD」按钮），与"整理/编辑"同层。→ 用户已选「剪藏详情弹窗」。
- **D3（frontmatter 两套形态）**：新导出端点用**新形态**（title/tags/type/status/created + 章节，对齐写作区智能剪藏预览）；现有 organize 归档 FM **仅补 `analysis` 字段**，其余字段不动。→ 用户已选「导出新形态 + 归档补 analysis」。
- **D4（captureMethod）**：白名单补 `editor-document`/`editor-selection`，否则写作区智能剪藏带 `captureMethod=editor-*` 的请求会被归一化为 `popup`。→ 用户已选「修复白名单」。

---

## 七、验证记录（2026-09-16 已全部通过）
1. ✅ `GET /api/clip/38/export-markdown` → 200，frontmatter（title/tags/type/status/created/source）+ `## 原文/摘要/标签` + `🔗 来源` 结构正确，空字段段（分析/发散/思考）正确跳过。
2. ✅ `GET /api/clip/38/export-markdown?save=1` → 200 `{saved:true, path:"clips/2026/05/default/20260519_00000026.md"}`，落盘文件 UTF-8 内容与预览一致（测试后已清理）。
3. ✅ 不存在 id（99999999）→ 404。
4. ✅ `POST /api/clip/add`（captureMethod=editor-document）→ 入库后 `GET /api/clip/{id}` 返回 `captureMethod=editor-document`（不再归一化为 popup）；测试剪藏已 DELETE 清理、无残留。
5. ✅ `mvn -q package -DskipTests` 编译通过（含 organize 归档补 analysis 的签名/调用点/默认字段三处改动）；后端已重启为新 jar，前端 3001 / 后端 8081 均 200。
6. 回归面：organize（日报）、weekly-report、单剪藏"整理/编辑"、divergent-summary 均未改动调用链，JSON 存储层零变更。