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

新增一项轻量能力：**单条收件箱剪藏可即时生成"frontmatter + `## 原文/摘要/分析/标签`"的 Markdown 视图**，支持：
- 在剪藏详情里"以 Markdown 查看/复制"；
- 可作为后续"整理/导出"的原料。

不迁移既有数据、不改 JSON 存取层、不改异步 AI 回写逻辑。

---

## 四、改动方案（Proportional，最小必要）

### 1. 后端：新增 `ClipMarkdownService`（新建文件）
路径：`backend/src/main/java/com/example/clip/service/ClipMarkdownService.java`

`String buildMarkdown(ClipContent clip)`，职责：
1. `ObsidianExportFormatter.generateClipFrontmatter(date, tags, categoryName, sourceUrl, siteName, analysisStatus, summary, divergent, thoughts)` 生成 frontmatter。
2. 正文按你给的默认结构拼接：
   - `# {title || 剪藏}`
   - `## 原文` + `clip.content`（**保持 `media/{yyMM}/{uuid}.{ext}` 原样**，供应用内 MediaKit 渲染，不做 assets 重写；重写只发生在 Obsidian 归档 `exportClipToVault`，二者场景不同，勿复用那块逻辑）
   - `## 摘要` + `clip.summary`（无则省略该段）
   - `## 分析` + `clip.analysis`（无则省略）——analysis 内部已有 `###` 子标题/表格，作为 `##` 段下的内容天然兼容
   - `## 发散总结` + `clip.divergentSummary`（无则省略）
   - `## 我的思考` + `clip.myThoughts`（无则省略）
   - `## 标签` + `formatTagsInline(clip.tags)`
   - `🔗 来源：[sourceUrl][]`（有则追加）
3. 所有缺失字段按"空则不输出该段"处理，保持 MD 干净。

依赖注入：`ObsidianExportFormatter`。分类中文名映射保留在 `ContentOrganizeService.getCategoryName()`，为复用可将该私有方法抽为静态工具（或在本服务内复制一套简版映射——复制 2 行映射更轻，二选一由执行者按最小侵入决定，推荐复制简单映射避免动 `ContentOrganizeService` 的公共 API）。

### 2. 后端：`ClipController` 增加端点
在 [ClipController.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/ClipController.java) 增加：
```
GET /api/clip/{id}/markdown
```
返回 `text/plain; charset=utf-8` 的 MD 字符串；`id` 不存在返回 404；失败 500。实现：`clipService.getClipById(id)` → `clipMarkdownService.buildMarkdown(clip)`。（注意：受 Electron proxy 超时白名单影响——不需要新增白名单，走普通 GET 即可，参照 `divergent-summary/{id}` 同款实现风格。）

### 3. 前端：剪藏详情加"Markdown"入口
在 [clip-actions.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/clip-actions.js) 的 `createClipItem()` 操作区（现有"整理/发散总结/OCR"按钮旁）新增一个按钮（如"`📋 Markdown`"）：
- 点击 → `GET {API_BASE_URL}/clip/{id}/markdown`；
- 成功后用 `MediaKit.render.renderMarkdown(md)` 在弹层预览事务后 `copyToClipboard(md)`（复用已有 `copyToClipboard`）；
- 失败 `showToast`，参照 `generateDivergentSummary` 的 try/catch 风格。

弹层复用现有遮罩样式（`clip.html` 已有弹层机制），无需新增全局 UI 组件。

---

## 五、不改的东西（明确边界，避免过度设计）
- ❌ 不迁移/改写 `clip-storage/**/*.json` 存量数据。
- ❌ 不改 `FileStorageService` 的 JSON 读写与异步回写。
- ❌ 不做"收件箱整体按天聚合 MD"（日报/周报已有 `organize` / `weekly-report`）。
- ❌ 不改 Obsidian 归档的 `exportClipToVault` 逻辑。

---

## 六、假设与决策
- **A1**：MD 视图的图片引用保持 `media/...` 原样（应用内渲染），与 Obsidian assets 重写分离。→ 决策。
- **A2**：缺失字段的段直接不输出（保持 MD 干净）。→ 决策。
- **A3**：分类中文名映射以最小侵入复用（复制简版），不重构 `ContentOrganizeService`。→ 决策。
- **A4**：前端只加"查看/复制 MD"一个入口，不做批量。→ 决策（符合你"做核心好用功能、不过度复杂"偏好）。

---

## 七、验证步骤
1. 后端重启后 `GET /api/clip/{id}/markdown` 返回含 `---frontmatter---`、`## 原文`、`## 摘要`、`## 分析`、`## 标签` 的有效 MD；不存在 id 返回 404。
2. 找一个含"分析（内嵌 `###` 标题 + 表格）+ 标签 + 图片引用"的收件箱剪藏，确认 MD 结构正确、图片在应用内可渲染。
3. 前端详情点"Markdown"按钮 → 弹层正确渲染 MD → 点复制后剪切板内容与原 MD 一致。
4. 回归：`organize`（日报）、`weekly-report`、单剪藏"整理/编辑"、`divergent-summary`、OC均不受影响，`clip-storage` 内 JSON 无任何变更。
```