# 编辑器主工具栏 UI 改版（参考 NoteGen 设计语言）

## 一、Summary

以 NoteGen（开源 Markdown AI 笔记应用）的极简、图标优先、快速记录的设计语言为参照，对「碎碎记」/CutShelter 的**编辑器主工具栏**做一次收敛式改版。本版范围**仅限主工具栏**（`editor.html` 的 `editor-toolbar` 区），不动对比工具栏、状态栏、右键菜单。

核心改动三件事：
1. **图标为主**：把几乎全部文字按钮转为「图标按钮 + 悬浮提示（title 保留）」；仅保留 **保存** 与 **存入剪藏** 两个文字型主按钮（用户已确认此强度）。
2. **重排顺序 + 逻辑分组**：用分隔线按「处理 / 输出 / 显示配置 / 主操作」分组，并让几个模式切换按钮具备「激活态」高亮（选中条件化）。
3. **导出升级**：把文字按钮「导出 Word」改为**导出图标 + 二级下拉菜单**（参考 NoteGen 的导出交互），新增 **Markdown / PDF 导出** 选项；PDF 复用后端已有的 `PdfGenerator`，**无新增依赖**。

不做：溢出「⋯」折叠菜单（用户判定这些操作不算低频）、退出对比栏、状态栏、右键菜单、剪藏列表/知识图谱等其它模块。

---

## 二、现状分析（已核实）

### 2.1 工具栏结构（`frontend/editor.html` L19-L59）
`.editor-toolbar` 采用 `grid-template-columns: auto minmax(180px,1fr) auto`，左=文件操作组、中=文档身份区（文档名/路径）、右=主操作组。

- **文件组**（L20-L24，全文字）：`newFileBtn 新建`、`openFileBtn 打开`、`saveFileBtn 保存(primary)`、`saveAsBtn 另存`
- **主操作组**（L36-L58，除图片外全文字）：`languageSelect`（语言下拉）｜`formatBtn 格式化`｜`transformBtn 转换`｜`compareBtn 对比`｜`imageInsertBtn 图片(icon+text)`｜`markdownBtn Markdown`｜`exportWordBtn 导出 Word`｜`settingsBtn 设置`｜`fullscreenBtn 全屏`｜`clipBtn 存入剪藏(accent)`

### 2.2 样式（`frontend/styles/editor.css`）
- 已有 `.tool-btn`（L82-L87）、`.icon-text-btn`（L90-L95，图标+文字）、`.primary`（L110）、`.accent`（L120）等。
- **没有**纯图标方形按钮样式 `.icon-btn`，需新增。
- 主题令牌在 `design-tokens.css`（`--app-*`，含 `--app-primary #2383e2`、`--app-border` 等），所有新样式必须消费这些令牌，禁止硬编码色值。

### 2.3 悬浮提示机制（已具备，复用之）
- 所有按钮均含 `title` 悬浮提示（如「新建 Ctrl+N」）。
- `editor.js` 已有 `registerShortcutButton`/`syncShortcutTitle`/`refreshAllShortcutTitles`（L140-L160），配置变更后实时刷新 tooltip 文案与组合键。
- `editor.html` 尾部有平台脚本（L658-L669），自动把静态 `title` 里的 `Ctrl/Shift/Alt` 改写为 `⌘/⇧/⌥`。
- **因此图标化后无需改动提示机制，只需保留/补全 `title`**。

### 2.4 导出现状（已核实）
- 前端 `exportToWord()`（`editor.js` L3181-L3273）：提取 ```mermaid 块 → 渲染 PNG(base64) → `POST /api/editor/export-word`（`{markdown, images, filename}`）→ 下载 .docx。
- 后端 `Markdown2WordController`（`/api/editor/export-word`）+ `Markdown2WordService.convertToDocx`。
- 命令面板仅有 `export-word` 一条（L6409-L6437）。
- **后端已有成熟的 Markdown→PDF 服务**：`PdfGenerator.generateFromMarkdown(markdown)`（`service/PdfGenerator.java`），链路为 flexmark→HTML→OpenHTMLtoPDF，含 CJK 字体探测（subset=false）。**可直接复用，零新依赖**。它目前只接收纯 markdown，无 images 参数。
- `pom.xml` 已含 `flexmark-all` + `openhtmltopdf-pdfbox`。

### 2.5 事件绑定（已核实）
所有按钮均按 `id` 绑定（`editor.js` L3009-L3034），无读取按钮 `textContent` 做逻辑，图标化安全。

---

## 三、改版目标与设计语言落地

NoteGen 的语言特点：**界面极简、图标优先、悬浮提示承载说明、操作按流程分组、输出动作下沉为菜单**。落到本产品：

| NoteGen 特性 | 本版落地方式 |
|---|---|
| 图标优先、少文字 | 主操作区除「存入剪藏」外全部图标化；文件区除「保存」外全部图标化 |
| 悬浮提示承载说明 | 所有图标按钮保留富 `title`（含快捷键），mac 自动转 ⌘ 符号 |
| 操作按流程分组 | 用竖向分隔线划分为 文件/处理/输出/显示配置/主操作 五段 |
| 模式态可视化 | 对比、Markdown 预览、全屏进入时按钮高亮 `active` |
| 输出动作下沉菜单 | 「导出」图标 + 二级菜单（Markdown/Word/PDF） |

---

## 四、具体改动

### 4.1 `frontend/editor.html` —— 工具栏重构

#### 4.1.1 新增图标按钮素材
新增一套**内联 SVG 图标**，统一沿用现有 `imageInsertBtn` 的线框风格（`stroke="currentColor" stroke-width=2`）。新增图标清单：
- 新建 `+`（file-plus）、打开 `folder-open`、另存为 `save`、格式化 `wand`/`braces`、转换 `arrows-left-right`、对比 `columns`、Markdown 预览 `eye`、导出 `download`（带小箭头表示下拉）、设置 `gear`、全屏 `maximize`。

#### 4.1.2 文件组（保留 保存 为文字主按钮）
```html
<div class="toolbar-group toolbar-file-actions">
  <button class="tool-btn icon-btn" id="newFileBtn"  title="新建 Ctrl+N"          aria-label="新建">[file+ svg]</button>
  <button class="tool-btn icon-btn" id="openFileBtn" title="打开 Ctrl+O"          aria-label="打开">[folder svg]</button>
  <button class="tool-btn primary"  id="saveFileBtn" title="保存 Ctrl+S">保存</button>
  <button class="tool-btn icon-btn" id="saveAsBtn"   title="另存为 Ctrl+Shift+S" aria-label="另存为">[save svg]</button>
</div>
```
> `saveAsBtn` 为图标；`保存` 保持文字 primary，作为文件区主操作。

#### 4.1.3 主操作组（图标化 + 重排 + 分组 + 导出菜单）

重排后顺序（`toolbar-main-actions`）：

```
[语言下拉 select]
    │ 分隔线 │
[格式化] [转换] [对比]          ← 处理组
    │ 分隔线 │
[图片] [Markdown预览] [导出▾]    ← 输出组（图片→预览→导出）
    │ 分隔线 │
[设置] [全屏]                    ← 显示/配置组
    │ 分隔线 │
[存入剪藏]                       ← 主操作(accent, 最右)
```

HTML 骨架（导出改下拉，其它按钮文字→图标，`title` 保留）：
```html
<div class="toolbar-group toolbar-main-actions">
  <select class="tool-select" id="languageSelect" title="语言模式">…</select>

  <div class="toolbar-sep"></div>
  <button class="tool-btn icon-btn" id="formatBtn"  title="格式化（自动识别，JSON/SQL/XML）Ctrl+Shift+L" aria-label="格式化">[wand svg]</button>
  <button class="tool-btn icon-btn" id="transformBtn" title="文本转换（选区优先，Ctrl+Shift+X）" aria-label="转换">[arrows svg]</button>
  <button class="tool-btn icon-btn" id="compareBtn"    title="对比视图（当前文档对比右侧）" aria-label="对比">[columns svg]</button>

  <div class="toolbar-sep"></div>
  <button class="tool-btn icon-btn" id="imageInsertBtn" title="插入图片（支持粘贴/拖拽，Ctrl+Shift+I）" aria-label="插入图片">[image svg]</button>
  <button class="tool-btn icon-btn" id="markdownBtn"    title="Markdown 预览 Ctrl+Shift+M" aria-label="Markdown 预览">[eye svg]</button>

  <div class="toolbar-export">
    <button class="tool-btn icon-btn" id="exportBtn" title="导出（Markdown / Word / PDF）" aria-label="导出文档">[download svg]</button>
    <div class="toolbar-export-menu" id="exportMenu" hidden role="menu">
      <button class="toolbar-export-item" role="menuitem" id="exportMarkdownBtn">导出为 Markdown（.md）</button>
      <button class="toolbar-export-item" role="menuitem" id="exportExcelBtn"  hidden>…</button> <!-- 按需求可再扩展 -->
      <button class="toolbar-export-item" role="menuitem" id="exportPdfBtn"   >导出为 PDF（.pdf）</button>
      <div class="toolbar-sep"></div>
      <button class="toolbar-export-item" role="menuitem" id="exportWordLegacyBtn">导出为 Word（.docx）</button>
    </div>
  </div>

  <div class="toolbar-sep"></div>
  <button class="tool-btn icon-btn" id="settingsBtn"  title="编辑器设置 Ctrl+," aria-label="设置">[gear svg]</button>
  <button class="tool-btn icon-btn" id="fullscreenBtn" title="全屏模式 F11" aria-label="全屏">[max svg]</button>

  <div class="toolbar-sep"></div>
  <button class="tool-btn accent" id="clipBtn">存入剪藏</button>
</div>
```
> 说明：
> - `exportWordBtn` 原 id 改为 `exportBtn`（导出入口）。原 `exportWordBtn` 语义被菜单项 `exportWordLegacyBtn` 承接。
> - 顺序依据：「处理（格式化/转换/对比）→ 输出（图片/预览/导出）→ 显示配置（设置/全屏）→ 主操作（存入剪藏）」与 NoteGen「流程化分组」一致；高频检查类靠左、动作下沉靠右。

#### 4.1.4 命令面板同步（`editor.js`）
命令面板请新增/调整导出命令，使其包含二三级选项（可选）：保留 `export-word`，新增 `export-markdown`、`export-pdf`，与菜单联动。

### 4.2 `frontend/styles/editor.css` —— 图标按钮与分组样式

新增以下规则（全部消费 `--app-*` 令牌）：
```css
/* 纯图标按钮 */
.tool-btn.icon-btn {
  width: 32px; height: 32px;
  padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.tool-btn.icon-btn .btn-icon { width: 16px; height: 16px; }

/* 工具栏分组分隔线 */
.toolbar-sep {
  width: 1px; height: 20px;
  margin: 0 2px;
  background: var(--app-border);
}

/* 导出下拉容器 */
.toolbar-export { position: relative; display: inline-flex; }
.toolbar-export-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 30;
  min-width: 180px; padding: 6px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow-md);
}
.toolbar-export-item {
  display: block; width: 100%; text-align: left;
  padding: 7px 10px; border: none; background: none;
  color: var(--app-text); border-radius: var(--app-radius-sm);
  cursor: pointer; font-size: 12px;
}
.toolbar-export-item:hover { background: var(--app-surface-hover); }

/* 模式激活态 */
.tool-btn.active {
  color: var(--app-primary);
  border-color: var(--app-primary);
  background: var(--app-primary-soft);
}
```

### 4.3 `frontend/js/editor.js` —— 交互接线

#### 4.3.1 导出下拉菜单
- 新建 `toggleExportMenu()`：点击 `exportBtn` 切换 `exportMenu` 显隐；点击外部/`Esc` 关闭。
- 菜单项：
  - `exportMarkdownBtn` → 新增 `exportToMarkdown()`：直接下载当前 Markdown 文本为 `.md`（客户端 blob，无需后端）。
  - `exportWordLegacyBtn` → 复用现有 `exportToWord()`（不改逻辑）。
  - `exportPdfBtn` → 新增 `exportToPdf()`：**复用与 `exportToWord` 相同的 mermaid→PNG 提取管线**，但调用 `POST /api/editor/export-pdf` `{markdown, images, filename}`，下载 `.pdf`。

#### 4.3.2 激活态条件化
- 进入/退出 对比、Markdown 预览、全屏 时，对应按钮 `toggle(active)`：
  - `toggleCompare(t)` 里给 `compareBtn.classList.toggle('active', t)`；
  - `toggleMarkdownPreview(t)` 里给 `markdownBtn.classList.toggle('active', t)`；
  - 全屏切换处给 `fullscreenBtn.classList.toggle('active', isFullscreen)`。

#### 4.3.3 事件绑定调整
- `exportWordBtn` → `exportBtn`（下拉开关）；原 Word 导出逻辑经菜单项触发。
- 其余按钮 id 不变，事件绑定原样保留（L3009-L3034 已按 id 绑定）。

### 4.4 后端 —— 新增 PDF 导出接口（复用 PdfGenerator）

#### 4.4.1 `PdfGenerator` 增加 images 支持（`service/PdfGenerator.java`）
新增重载 `generateFromMarkdown(String markdown, Map<String,String> images)`：
- 复用现有 `generateFromMarkdown` 的 markdown→HTML 流程；
- 在 `wrapHtmlDocument` 产物渲染前，把 HTML 中 `src="{图片名}"`（如 `mmd-0.png`）替换为对应的 `data:data:image/png;base64,...` 内联图（从 `images` map 取值）；
- 无匹配或 images 为空时回退到现有纯 markdown 路径，保持向后兼容。

> OpenHTMLtoPDF（pdfbox 1.0.10）原生支持 `<img data:...>` 内联图，无需新增渲染器。

#### 4.4.2 新增 `Markdown2PdfController`（`controller/`，参照 `Markdown2WordController`）
- `POST /api/editor/export-pdf`，入参 `{markdown, images, filename}`，`Content-Type: application/pdf`，输出 `PdfGenerator.generateFromMarkdown(markdown, images)` 字节流。
- 文件名安全化、`Content-Disposition` 处理与 Word 控制器保持一致。

> 不改动现有 `/export-word`，不影响 Word 导出。

---

## 五、假设与决策

1. **图标来源**：全部使用内联 SVG（人工手写，延续 `imageInsertBtn` 线框风格），不引入图标库、不引入新 npm 依赖。
2. **导出顺序**：菜单默认展示 `Markdown / PDF / Word`（Markdown 最轻、PDF 快速、Word 完整格式）。

   > 注：`exportExcelBtn`（L4.1.3 中的隐藏项）为演示占位，默认 `hidden`，**不在本版实现**，避免超范围。

3. **激活态**为唯一的「条件化」落地；不做按语言禁用格式化等聪明逻辑（`formatCurrentContentAuto` 本身自动识别，禁用反而困惑）。
4. **PDF 图表保真度**：mermaid 经前端渲染为 PNG 后以 base64 内联进 PDF；与 Word 导出管线一致。若个别大图导致 PDF 体积增大，属可接受范围，本版不做图片压缩。
5. **范围克制**：严格只改主工具栏 + 导出链路；对比栏/状态栏/右键菜单保持不动。

---

## 六、验证步骤

1. **语法/构建**
   - `node --check frontend/js/editor.js`（改后）。
   - 后端：`cd backend && mvn -q -o compile`，`EXIT=0`。
2. **工具栏回归（运行应用）**
   - 图标按钮悬浮显示正确 title（含 ⌘/⌥ 平台符号转换）；保存/存入剪藏仍为文字 CTA。
   - 重排后分组分隔线渲染正确、无重叠；小窗口下不换行溢出。
3. **导出回归 + 新功能**
   - 原 Word 导出：点击菜单「导出为 Word」得到 .docx 且含 Mermaid 图。
   - Markdown 导出：得到 .md 原文。
   - **PDF 导出（新增）**：得到 .pdf，中文不乱码、mermaid 图正常内联。
4. **激活态**
   - 进入/退出 对比、Markdown 预览、全屏，对应按钮高亮/取消高亮正确。
5. **无回归**
   - 命令面板 `export-word` 仍可用；快捷键 tooltip 实时刷新逻辑不受影响。