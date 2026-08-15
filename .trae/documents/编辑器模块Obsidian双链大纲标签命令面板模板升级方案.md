# 编辑器模块升级方案：Obsidian 双链 / 大纲 / 标签 + 命令面板与模板

> 状态：规划（本方案仅设计，待确认后实施）
> 借鉴来源：Obsidian（双链/大纲/标签/命令面板/模板）、[MD-Editor](https://www.52pojie.cn/thread-2112588-1-1.html)（双栏实时预览/导出理念）
> 用户已确认：主攻「Obsidian 双链/大纲/标签 + 命令面板与模板」，并**打通**现有 Obsidian 集成与知识图谱链路。

---

## 一、概述

编辑器模块已具备多标签、右键 AI、翻译词典、对比、Markdown 预览、AI Pet 对话等能力。本次升级引入 **Obsidian 风格的知识编辑能力**，让编辑器成为「临时笔记 → 知识库 → Obsidian 归档」链条上的活跃节点，并与现有剪藏反链、知识图谱打通。

核心难点（用户重点关切）：**双链（wikilink）的相对路径在编辑器存储目录与剪藏落库目录不一致时应如何解析**。本方案给出明确设计（见「三、关键设计：双链相对路径解析」）。

### 本次交付功能点

| 编号 | 功能 | 借鉴 | 优先级 |
|------|------|------|--------|
| FP-1 | Obsidian 双链（wikilink）输入/补全/预览/反链 + 相对路径设计 | Obsidian | P0（核心） |
| FP-2 | 大纲（Outline）面板 | Obsidian | P1 |
| FP-3 | 标签（#tag）识别与面板 | Obsidian | P1 |
| FP-4 | 命令面板（Ctrl+P） | Obsidian | P1 |
| FP-5 | 模板系统（插入/变量替换） | MD-Editor/Obsidian | P1 |
| FP-6 | 打通知识图谱与 Obsidian（跳转/反链） | 本产品已有链路 | P0 |

不纳入本次：Mermaid 图表渲染与 Word 导出、KaTeX 数学公式（用户未选，避免过度设计）。

---

## 二、现状分析（已探索确认）

### 2.1 编辑器
- 编辑器为 ACE（`frontend/libs/ace/ace.js`），`mainEditor` 单实例 + 多标签（`createTabState`/`switchToTab`，[editor.js L26/L409](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- 已有多侧边面板（文件树/历史/最近/收藏/AI Pet），通过 `setPaneVisibility` + `aria-hidden` 统一控制（[editor.js L4448](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- ACE 自动补全已有一套模板：`registerDictCompleter()` 用 `langTools.addCompleter` / `mainEditor.completers` 注册（[editor.js L4998](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
- Markdown 预览统一走 `window.MediaKit.render.renderMarkdown(text)`（[editor.js L1081](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)），实现在 `frontend/js/media-render.js` 的 `renderMarkdown`（marked → `sanitizeHtml` → `rewriteImageSrc`，[media-render.js L123](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)）。
- 跨模块跳转路由已存在：index.html 的 `openTextData`（编辑器新标签打开文本）与 `navigateLearningPlan`（[index.html L749/L755](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/index.html)）。

### 2.2 存储与 Obsidian 布局
- `config.storagePath` = Clip_Bed 父目录（默认 `APP_DIR`，[main.js L150](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）。
- 编辑器文件默认目录 = `{storagePath}/tmp`（`getEditorDefaultDirectory`，[main.js L1745](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）；编辑器缓存 = `{storagePath}/.tmp/editor/cache.json`。
- Obsidian 归档根 `organizedPath` = `{storagePath}/clip-organized`（[main.js L539](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）。
- 剪藏单条导出到 `{organizedPath}/clips/{yyyy}/{MM}/{categoryDir}/{yyMMdd}_{shortId}.md`，wikilink 为 `[[{yyMMdd}_{shortId}|标题]]`（basename 引用，`ContentOrganizeService.exportClipToVault`，[ContentOrganizeService.java L331](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java)）。
- frontmatter 配置含 tags/category/source/summary/divergent/thoughts（`ObsidianExportConfig`，[ObsidianExportConfig.java L66](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/obsidian/ObsidianExportConfig.java)）。
- 知识图谱存在「两套知识模型 ID 断层」已知问题（content-index.json 旧 KnowledgeEntry vs relation-index.json 主 Knowledge），本次不处理，双链用 `basename/标题` 解析，不依赖 ID。

---

## 三、关键设计：双链相对路径解析

### 3.1 问题
- 编辑器文件在 `{storagePath}/tmp/`，剪藏落库在 `{storagePath}/clip-organized/clips/...`，两者相对路径不互通。
- 若用相对路径写 `[[../clip-organized/clips/...]]`，一旦文件移动/换目录即失效，且 Obsidian 不认这种写法。

### 3.2 决策：采用 Obsidian 原生「basename 全局解析」语义（主）+「库内相对路径」（辅）
Obsidian 的 wikilink 是**按文件名（basename）在整库范围内全局解析**的，与文件所处目录无关。这正是解决「目录不一致」的正确方式——**不存相对路径，存 basename**。

1. **主用 basename**：链接写成 `[[目标文件名（不含扩展名）]]` 或 `[[文件名|显示别名]]`。
   - 无论目标在编辑器 `tmp/` 还是剪藏 `clips/...`，只要 basename 唯一，Obsidian 都能解析。
2. **辅用库内相对路径**：当 basename 冲突或用户显式指定时，支持 `[[文件夹/文件名]]`，相对 **vault root** 解析。
3. **vault root（知识根目录）**：新增可配置项，默认 = Obsidian 归档根 `{storagePath}/clip-organized`。编辑器预览与补全在此根下扫描候选。
4. **编辑器文件可链接化**：编辑器文件默认仍在 `tmp/`；当用户插入双链或选择「保存到知识库」时，把该文件写入 vault root（如 `{organizedPath}/notes/{basename}.md`），使其 basename 全局可解析。这样既保留编辑器轻量，又进入 Obsidian 生态。
5. **冲突检测**：扫描时若 basename 重复，补全与预览标红提示，并建议用库内相对路径消歧。

### 3.3 解析器流程（`resolveWikilink(target)`）
```
输入 target（支持 "文件名" 或 "文件夹/文件名" 或 "文件名|别名"）
1. 若含 "/" → 相对 vault root 找文件；命中则打开。
2. 否则按 basename 在【链接索引】中查找：
   a. 编辑器已打开/缓存文件（tmp）
   b. 剪藏导出 md（clip-organized/clips 下 *.md）
   c. 知识条目（标题/别名）
3. 命中唯一 → 打开/跳转；多个 → 弹候选让用户选；无 → 提示未找到。
```

---

## 四、实施任务（按功能点）

### FP-1 Obsidian 双链支持（P0 核心）
**文件**：
- `frontend/js/media-render.js`（改）
  - 新增 `renderWikilinks(md)`：在 `renderMarkdown` 的 `marked.parse` 前，将 `[[target|alias]]`/`[[target]]` 预替换为 `<a class="wikilink" data-target="{target}">{alias}</a>`；`sanitizeHtml` 白名单放行 `a[data-target]`/`a.wikilink`。
  - 暴露 `renderWikilinks` 到 `MediaKit.render`。
- `frontend/js/editor.js`（改）
  - 新增 `registerWikilinkCompleter()`：仿 `registerDictCompleter`，匹配 `[[` 前缀触发，候选来自链接索引（编辑器文件 basename + 后台剪藏 md 索引 + 知识标题），caption=文件名、meta=来源归类。
  - 新增 `buildLinkIndex()` / `resolveWikilink(target)`（见 3.3）。
  - 新增 `openWikilink(target)`：按解析结果跳转——编辑器文件→`openFileDataInNewTab`/`openTextInNewTab`；剪藏→navigate 剪藏；知识→navigate 知识；未知→Toast。
  - 反链：`buildBacklinks()` 扫描 vault root 下 md，找出含 `[[当前文件名]]` 的行；新增反链面板（复用 `setPaneVisibility` 面板机制）。
  - 预览区 `.wikilink` 点击委托（`markdownBody` 上 `click` 事件）。
- `electron/main.js` + `electron/preload.js`（改）
  - 新增 IPC `editor:list-wikilink-targets`：扫描 `organizedPath` 下 `**/*.md` 的 basename + 相对路径，返回索引；供补全与反链使用。
  - 新增 IPC `editor:save-to-vault`：把当前编辑器内容写入 `{organizedPath}/notes/{basename}.md`。
- `frontend/styles/editor.css`（改）：`.wikilink` 样式（主题色、下划线、hover）、反链面板样式。

### FP-2 大纲（Outline）面板（P1）
**文件**：
- `frontend/editor.html`（改）：新增 `<div class="editor-pane outline-pane" id="outlinePane" aria-hidden="true">`（复用面板结构，含「大纲」标题 + 折叠按钮 + 关闭按钮）。
- `frontend/js/editor.js`（改）
  - `buildOutline()`：正则 `^(\s{0,3}#{1,6})\s+(.*)$` 逐行解析标题，产出 `{level,text,row}`；折叠收起次级标题。
  - `renderOutline()`：渲染为可点击列表，点击 `mainEditor.gotoLine(row+1)` 定位。
  - `toggleOutline()`：复用 `setPaneVisibility`，与文件树/历史/最近/收藏/AI Pet 面板互斥。
  - 内容变更时防抖刷新大纲（复用 `scheduleMarkdownRender` 思路）。
- `frontend/styles/editor.css`（改）：大纲面板样式、层级缩进、hover 定位高亮。

### FP-3 标签（#tag）支持（P1）
**文件**：
- `frontend/js/editor.js`（改）
  - `extractTags()`：正则识别 `#tag`/`#tag/subtag`，排除代码块与行内 URL（用 ACE tokenizer 或简单行扫描）。
  - 状态栏新增标签计数按钮；新增标签面板（与大纲面板同机制，互斥）。
  - 标签点击 → 跳转剪藏列表按标签过滤（复用现有剪藏搜索/标签 API）。
  - 读取文档 frontmatter 的 `tags:` 合并展示（与 Obsidian 打通）。
- `frontend/editor.html`（改）：标签面板 DOM。
- `frontend/styles/editor.css`（改）：标签胶囊样式、面板样式。

### FP-4 命令面板（Ctrl+P）（P1）
**文件**：
- `frontend/editor.html`（改）：新增命令面板浮层 `<div id="commandPalette">`（输入框 + 结果列表）。
- `frontend/js/editor.js`（改）
  - 新增命令注册表 `commands: [{id, name, keywords, run, shortcut}]`，覆盖：新建/打开/保存/另存/格式化/转换/对比/跳到行/大纲切换/标签切换/插入模板/双链实跳/AI 对话/全屏/设置等。
  - 模糊过滤（简单 includes 匹配 name+keywords），↑↓ 导航、Enter 执行、Esc 关闭。
  - `Ctrl+P` 打开（ACE 内需 `editor.commands` 自定义或全局 keydown 拦截，避免与 ACE 冲突）。
- `frontend/styles/editor.css`（改）：命令面板样式（仿 Obsidian 浮层）。

### FP-5 模板系统（P1）
**文件**：
- `electron/main.js` + `electron/preload.js`（改）
  - 模板目录 `{storagePath}/templates/`（不存在则创建）；新增 IPC `editor:list-templates` / `editor:read-template` / `editor:save-template`（用于新建/删除模板文件）。
- `frontend/js/editor.js`（改）
  - 命令面板注册「插入模板」命令 → 列出模板 → 读取内容插入光标处。
  - 变量替换：`{{date}}`→今天、`{{title}}`→当前文件名、`{{time}}`→当前时间。
- `frontend/editor.html`（改）：模板选择弹窗（或复用命令面板结果列表）。

### FP-6 打通知识图谱与 Obsidian（P0）
**文件**：
- `frontend/js/editor.js`（改）：`resolveWikilink` 对知识条目标题命中时，跳转知识详情/图谱聚焦（复用现有知识 API 与 `openTextData`/navigate 路由）。
- `frontend/js/media-render.js`（改）：`renderWikilinks` 对剪藏/知识目标生成可点击链接，点击经 editor.js 委托跳转。
- 复用现有 index.html 路由（`openTextData`/`navigateLearningPlan`），不新增后端。

---

## 五、假设与决策

| 决策 | 结论 |
|------|------|
| 双链路径方案 | **basename 全局解析（Obsidian 原生语义）为主 + 库内相对路径为辅**，不存跨目录相对路径，解决「tmp 与剪藏目录不一致」 |
| vault root | 新增可配置「知识根目录」，默认 `{storagePath}/clip-organized` |
| 编辑器文件可链接化 | 「保存到知识库」把编辑器文件写入 vault root 的 `notes/` 下，使其可被双链与 Obsidian 解析 |
| 双链跳转 | 只读跳转（打开文件/剪藏/知识），不做双向编辑同步 |
| 补全实现 | 复用现有 `registerDictCompleter` 的 ACE completer 模式 |
| Markdown 预览 | 复用 `MediaKit.render.renderMarkdown`，在 marked 前做 wikilink 预替换，三端（editor/clip/wiki/knowledge）统一起效 |
| 面板机制 | 大纲/标签/反链面板复用现有 `setPaneVisibility` + `aria-hidden` 互斥机制 |
| 不纳入 | Mermaid/Word 导出、KaTeX（用户未选，避免过度设计） |
| 已知断层 | 知识图谱两套 ID 断层本次不处理；双链用 basename/标题解析，不依赖 ID |

---

## 六、验证步骤

1. **FP-1 双链**：`[[` 触发补全；插入 `[[文件名]]` 后 Markdown 预览渲染为可点击链接；点击跳转到编辑器文件/剪藏/知识；反链面板能在被引用文件里看到当前文件；`tmp/` 文件与 `clip-organized/clips` 剪藏 md 均可被 basename 命中。
2. **FP-1 路径一致性**：编辑器文件保存到知识库后，`[[basename]]` 在 Obsidian 中可解析；basename 冲突时补全/预览给出提示。
3. **FP-2 大纲**：标题解析正确、点击跳转到对应行、折叠生效、与其他面板互斥。
4. **FP-3 标签**：`#tag` 识别正确（无代码块误报）、面板展示、点击跳转剪藏按标签过滤、frontmatter tags 合并。
5. **FP-4 命令面板**：Ctrl+P 打开、模糊搜索、↑↓/Enter/Esc 操作正确、ACE 内不冲突。
6. **FP-5 模板**：模板列表、插入、`{{date}}/{{title}}` 变量替换。
7. **回归**：多标签、对比、AI Pan、词典补全、Markdown 预览、图片重写（RewriteImageSrc）不受影响；桌面模式打包前端后复测。