# 编辑器模块升级方案：Obsidian 双链 / 大纲 / 标签 + 命令面板与模板 + 转 Word

> 状态：规划（本方案仅设计，待确认后实施）
> 借鉴来源：Obsidian（双链/大纲/标签/命令面板/模板）、[MD-Editor(52pojie)](https://www.52pojie.cn/thread-2112588-1-1.html)（转Word+Mermaid嵌入、批量）、[Mu-L/md-editor](https://github.com/Mu-L/md-editor/tree/main)（双栏预览/导出）
> 用户已确认：主攻「Obsidian 双链/大纲/标签 + 命令面板与模板」，并**打通**现有 Obsidian 集成与知识图谱链路；本轮**新增 Markdown 转 Word 导出**。

---

## 一、概述

编辑器模块已具备多标签、右键 AI、翻译词典、对比、Markdown 预览、AI Pet 对话、Mermaid 渲染、Callout，以及 800ms 防抖自动保存。本次升级分两批推进：

- **第一批（核心）**：Obsidian 风格知识编辑能力——FP-1 双链、FP-6 打通知识图谱与 Obsidian。
- **第二批（增强）**：FP-2 大纲、FP-3 标签、FP-4 命令面板、FP-5 模板系统，以及**新增 FP-9 Markdown 转 Word 导出**（含 Mermaid→PNG 嵌入）。

核心难点（用户重点关切）：**双链 wikilink 的相对路径在编辑器存储目录与剪藏落库目录不一致时应如何解析**。本方案沿用既定决策：**basename 全局解析（Obsidian 原生语义）为主 + 库内相对路径为辅**。

### 交付功能点清单

| 编号 | 功能 | 借鉴 | 优先级 | 状态 |
|------|------|------|--------|------|
| FP-1 | Obsidian 双链（wikilink）输入/补全/预览/反链 + 相对路径设计 | Obsidian | P0（核心） | **已完成** |
| FP-2 | 大纲（Outline）面板 | Obsidian | P1 | 未做 |
| FP-3 | 标签（#tag）识别与面板 | Obsidian | P1 | 未做 |
| FP-4 | 命令面板（Ctrl+P） | Obsidian | P1 | 未做 |
| FP-5 | 模板系统（插入/变量替换） | MD-Editor/Obsidian | P1 | 未做 |
| FP-6 | 打通知识图谱与 Obsidian（跳转/反链） | 本产品已有链路 | P0 | **已完成** |
| FP-7 | Mermaid 流程图渲染 | 52pojie MD-Editor | — | **已完成** |
| FP-8 | Callout 提示块渲染 | Obsidian | — | **已完成** |
| FP-9 | **Markdown 转 Word 导出（.docx，Mermaid→PNG 嵌入）** | 52pojie MD-Editor | P1（用户新增） | 未做 |

---

## 二、现状分析（已探索确认）

### 2.1 编辑器
- 编辑器为 ACE（`frontend/libs/ace/ace.js`），`mainEditor` 单实例 + 多标签（`createTabState`/`switchToTab`，[editor.js L26/L409](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- 已有多侧边面板（文件树/历史/最近/收藏/AI Pet），通过 `setPaneVisibility` + `aria-hidden` 统一控制（[editor.js L4448](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- ACE 自动补全已有一套模板：`registerDictCompleter()` 用 `langTools.addCompleter` / `mainEditor.completers` 注册（[editor.js L5003](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- Markdown 预览统一走 `window.MediaKit.render.renderMarkdown(text)`（[editor.js L1081](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)），实现在 `frontend/js/media-render.js` 的 `renderMarkdown`（marked → `sanitizeHtml` → `rewriteImageSrc`，[media-render.js L123](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)）。
- **Mermaid 已实现**：`renderMermaid(container)` 异步把 ` ```mermaid ` 代码块渲为 SVG（[media-render.js L223](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)），`ALLOWED_CLASS_PREFIXES` 已含 `mermaid`/`callout`（[media-render.js L41](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)）。
- **Callout 已实现**：`getCalloutRenderer()` 借用 marked blockquote 渲染器识别 `> [!type]`（[media-render.js L172](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)）。
- **自动保存已实现**：`autosaveFile` + 状态提示（[editor.js L3323](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- **拖拽导入已实现**（项目约束记忆确认）。
- 编辑器调用后端：`API_BASE_URL = 'http://127.0.0.1:8081/api/clip'`（[editor.js L4](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- **当前保存仅支持文本/Markdown**：`saveFile`/`saveAs` 用 Blob 写本地文件（[editor.js L842/L912](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)），**无 Word/PDF 导出**。
- 工具栏结构见 [editor.html L12-45](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html)：新建/打开/保存/另存 + 语言/格式化/转换/对比/图片/Markdown/设置/全屏/存入剪藏。

### 2.2 存储与 Obsidian 布局
- `config.storagePath` = Clip_Bed 父目录（默认 `APP_DIR`，[main.js L150](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）。
- 编辑器文件默认目录 = `{storagePath}/tmp`；缓存 = `{storagePath}/.tmp/editor/cache.json`。
- Obsidian 归档根 `organizedPath` = `{storagePath}/clip-organized`（[main.js L539](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）。
- 剪藏单条导出到 `{organizedPath}/clips/{yyyy}/{MM}/{categoryDir}/{yyMMdd}_{shortId}.md`，wikilink 为 `[[{yyMMdd}_{shortId}|标题]]`（basename 引用，[ContentOrganizeService.java L331](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java)）。
- 知识图谱存在「两套知识模型 ID 断层」已知问题，本次不处理，双链用 `basename/标题` 解析，不依赖 ID。

### 2.3 后端（转 Word 基础）
- 后端为 Spring Boot 3.2（Java 17），[pom.xml](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/pom.xml) 已含：
  - **Apache POI `poi-ooxml` 5.2.5**（可原生生成 .docx，L120-125）
  - **flexmark-all 0.64.8**（Markdown 解析/DOM，L83-88）
  - **openhtmltopdf-pdfbox 1.0.10**（已有「学习计划导出 PDF」先例，L103-118）
  - jsoup、pdfbox 等
- 结论：**后端已具备生成标准 OOXML .docx 的全部依赖，无需引入 Pandoc**。

---

## 三、关键设计

### 3.1 双链相对路径解析（沿用既定决策）
1. **主用 basename**：链接写成 `[[文件basename|别名]]` 或 `[[文件basename]]`，Obsidian 整库全局解析，与目录无关。
2. **辅用库内相对路径**：`[[文件夹/文件]]`，相对 vault root 解析。
3. **vault root（知识根目录）**：默认 = `{storagePath}/clip-organized`。
4. **编辑器文件可链接化**：默认仍在 `tmp/`；插入双链或「保存到知识库」时写入 `{organizedPath}/notes/{basename}.md`。
5. **冲突检测**：basename 重复时补全/预览标红，建议用相对路径消歧。

解析器 `resolveWikilink(target)` 流程：含 `/` → 相对 vault root 找文件；否则按 basename 在【链接索引】（编辑器缓存 + clip-organized/clips 下 *.md + 知识标题/别名）中查找；命中唯一→打开/跳转；多个→弹候选；无→Toast。

### 3.2 转 Word 技术选型（调研结论）
后端已含 POI + flexmark，**采用「后端 POI 生成真 .docx」**，与现有「学习计划导出 PDF」模式一致，离线、无外部依赖。Mermaid 处理沿用 52pojie 思路：前端已有 `renderMermaid` 产出 SVG → 前端 canvas 转高分辨率 PNG → base64 dataURL → 随正文 POST 后端 → POI 以图片嵌入 .docx。

备选方案（未采用）：前端 html-docx-js（产出 Word 兼容 HTML，非原生 OOXML，样式弱）；外部 Pandoc（质量最高但体积大、需下载配置，违背「轻量」原则）。

---

## 四、实施任务

### 第一批（P0 核心）

#### FP-1 Obsidian 双链支持
**文件**：
- `frontend/js/media-render.js`（改）
  - 新增 `renderWikilinks(md)`：在 `renderMarkdown` 的 `marked.parse` 前将 `[[target|alias]]`/`[[target]]` 预替换为 `<a class="wikilink" data-target="{target}">{alias}</a>`；`sanitizeHtml` 白名单放行 `a[data-target]`/`a.wikilink`。
  - 暴露 `renderWikilinks` 到 `MediaKit.render`。
- `frontend/js/editor.js`（改）
  - 新增 `registerWikilinkCompleter()`：仿 `registerDictCompleter`，匹配 `[[` 前缀触发，候选来自链接索引（编辑器文件 basename + 后台剪藏 md 索引 + 知识标题），caption=文件名、meta=来源归类。
  - 新增 `buildLinkIndex()` / `resolveWikilink(target)`（见 3.1）。
  - 新增 `openWikilink(target)`：编辑器文件→`openFileDataInNewTab`/`openTextInNewTab`；剪藏→navigate 剪藏；知识→navigate 知识；未知→Toast。
  - 反链：`buildBacklinks()` 扫描 vault root 下 md 找出含 `[[当前文件名]]` 的行；新增反链面板（复用 `setPaneVisibility`）。
  - 预览区 `.wikilink` 点击委托（`markdownBody` 上 `click` 事件）。
- `electron/main.js` + `electron/preload.js`（改）
  - 新增 IPC `editor:list-wikilink-targets`：扫描 `organizedPath` 下 `**/*.md` 的 basename + 相对路径，返回索引。
  - 新增 IPC `editor:save-to-vault`：当前编辑器内容写入 `{organizedPath}/notes/{basename}.md`。
- `frontend/styles/editor.css`（改）：`.wikilink` 样式（主题色/下划线/hover）、反链面板样式。

#### FP-6 打通知识图谱与 Obsidian
**文件**：
- `frontend/js/editor.js`（改）：`resolveWikilink` 对知识条目标题命中时跳转知识详情/图谱聚焦（复用现有知识 API 与 `openTextData`/navigate 路由）。
- `frontend/js/media-render.js`（改）：`renderWikilinks` 对剪藏/知识目标生成可点击链接，点击经 editor.js 委托跳转。
- 复用现有 index.html 路由（`openTextData`/`navigateLearningPlan`），不新增后端。

### 第二批（P1 增强）

#### FP-2 大纲（Outline）面板
**文件**：
- `frontend/editor.html`（改）：新增 `<div class="editor-pane outline-pane" id="outlinePane" aria-hidden="true">`（复用面板结构）。
- `frontend/js/editor.js`（改）
  - `buildOutline()`：正则 `^(\s{0,3}#{1,6})\s+(.*)$` 逐行解析产出 `{level,text,row}`；折叠收起次级标题。
  - `renderOutline()`：点击 `mainEditor.gotoLine(row+1)` 定位。
  - `toggleOutline()`：复用 `setPaneVisibility`，与文件树/历史/最近/收藏/AI Pet/反链 互斥。
  - 内容变更防抖刷新（复用 `scheduleMarkdownRender` 思路）。
- `frontend/styles/editor.css`（改）：大纲样式、层级缩进、hover 高亮。

#### FP-3 标签（#tag）支持
**文件**：
- `frontend/js/editor.js`（改）
  - `extractTags()`：识别 `#tag`/`#tag/subtag`，排除代码块与行内 URL。
  - 状态栏新增标签计数按钮 + 标签面板（与大纲同机制互斥）。
  - 标签点击 → 跳转剪藏列表按标签过滤（复用现有剪藏搜索/标签 API）。
  - 读取文档 frontmatter `tags:` 合并展示。
- `frontend/editor.html`（改）：标签面板 DOM；`frontend/styles/editor.css`（改）：标签胶囊样式。

#### FP-4 命令面板（Ctrl+P）
**文件**：
- `frontend/editor.html`（改）：新增浮层 `<div id="commandPalette">`（输入框 + 结果列表）。
- `frontend/js/editor.js`（改）
  - 命令注册表 `commands: [{id,name,keywords,run,shortcut}]`，覆盖：新建/打开/保存/另存/格式化/转换/对比/跳到行/大纲切换/标签切换/插入模板/双链实跳/AI 对话/导出 Word/全屏/设置等。
  - 模糊过滤（includes 匹配 name+keywords），↑↓ 导航、Enter 执行、Esc 关闭。
  - `Ctrl+P` 打开（ACE 内 `editor.commands` 自定义，避免与 ACE 冲突）。
- `frontend/styles/editor.css`（改）：命令面板浮层样式。

#### FP-5 模板系统
**文件**：
- `electron/main.js` + `electron/preload.js`（改）
  - 模板目录 `{storagePath}/templates/`（无则创建）；新增 IPC `editor:list-templates` / `editor:read-template` / `editor:save-template`。
- `frontend/js/editor.js`（改）
  - 命令面板注册「插入模板」→ 列出模板 → 读取内容插入光标处。
  - 变量替换：`{{date}}`→今天、`{{title}}`→当前文件名、`{{time}}`→当前时间。
- `frontend/editor.html`（改）：模板选择弹窗（或复用命令面板）。

#### FP-9 Markdown 转 Word 导出（.docx）
**后端**：
- 新增 `backend/src/main/java/com/example/clip/service/Markdown2WordService.java`（新）
  - 用 flexmark 解析 Markdown 为 AST，遍历生成 `XWPFDocument`：标题（`createHeading` 映射 H1-H6）、段落、列表（编号/项目符号）、表格、代码块（等宽样式）、引用、图片（base64 解码后 `XWPFRun.addPicture`）。
  - 支持 Markdown 内嵌图片（本地路径/相对路径）与 base64 图片。
- 新增 `Markdown2WordController.java`（新）：`POST /api/editor/export-word`，接收 `{ markdown, images: {name: dataURL} }`，返回 `.docx` 二进制流（`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`）。
**前端**：
- `frontend/js/editor.js`（改）
  - 新增 `exportToWord()`：取当前编辑器内容 → 遍历 ` ```mermaid ` 代码块，调用 `renderMermaid` 对应 SVG → `canvas.toDataURL('image/png')` 得高分辨率 PNG → 收集 base64 图片映射 → `fetch(API 导出端点)` → 接收 Blob → 触发下载。
  - 工具栏新增「导出 Word」按钮 + 命令面板注册「导出 Word」命令。
- `frontend/editor.html`（改）：工具栏按钮；`frontend/styles/editor.css`（改）：按钮样式。
**说明**：因 Mermaid SVG 需在预览 DOM 中渲染后转 PNG，导出时临时渲染到离屏容器完成，不污染主编辑区。

---

## 五、假设与决策

| 决策 | 结论 |
|------|------|
| 双链路径方案 | **basename 全局解析（Obsidian 原生语义）为主 + 库内相对路径为辅** |
| vault root | 新增可配置「知识根目录」，默认 `{storagePath}/clip-organized` |
| 编辑器文件可链接化 | 「保存到知识库」写入 vault root 的 `notes/` 下 |
| 双链跳转 | 只读跳转（打开文件/剪藏/知识），不做双向编辑同步 |
| 补全实现 | 复用现有 `registerDictCompleter` 的 ACE completer 模式 |
| Markdown 预览 | 复用 `MediaKit.render.renderMarkdown`，marked 前做 wikilink 预替换，三端（editor/clip/wiki/knowledge）统一起效 |
| 面板机制 | 大纲/标签/反链面板复用 `setPaneVisibility` + `aria-hidden` 互斥 |
| **转 Word 方案** | **后端 POI + flexmark 生成原生 .docx**；Mermaid 前端 SVG→PNG→dataURL 嵌入。不引入 Pandoc |
| 实施批次 | 第一批 FP-1+FP-6（核心）；第二批 FP-2/FP-3/FP-4/FP-5/FP-9（增强） |
| 已具备复用 | 自动保存、拖拽导入、Mermaid、Callout、格式化（无需重复实现） |
| 已知断层 | 知识图谱两套 ID 断层本次不处理；双链用 basename/标题解析 |

---

## 六、验证步骤

1. **FP-1 双链**：`[[` 触发补全；插入 `[[文件名]]` 后 Markdown 预览渲染为可点击链接；点击跳转到编辑器文件/剪藏/知识；反链面板能在被引用文件里看到当前文件；`tmp/` 文件与 `clip-organized/clips` 剪藏 md 均可被 basename 命中。
2. **FP-1 路径一致性**：编辑器文件保存到知识库后，`[[basename]]` 在 Obsidian 中可解析；basename 冲突时补全/预览给出提示。
3. **FP-2 大纲**：标题解析正确、点击跳转对应行、折叠生效、与其他面板互斥。
4. **FP-3 标签**：`#tag` 识别正确（无代码块误报）、面板展示、点击跳转剪藏按标签过滤、frontmatter tags 合并。
5. **FP-4 命令面板**：Ctrl+P 打开、模糊搜索、↑↓/Enter/Esc 正确、ACE 内不冲突。
6. **FP-5 模板**：模板列表、插入、`{{date}}/{{title}}` 变量替换。
7. **FP-9 转 Word**：含标题/列表/表格/代码块/Mermaid 的文档导出 .docx，用 Word/WPS 打开验证标题层级、表格、代码块、流程图（PNG 图片，非乱码）；纯文本 Markdown 也能正常导出。
8. **回归**：多标签、对比、AI Pet、词典补全、Markdown 预览、图片重写（RewriteImageSrc）、Mermaid/Callout 渲染不受影响；桌面模式打包前端后复测。