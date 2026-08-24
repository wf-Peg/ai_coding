# 编辑器模块升级方案（含 Mermaid 与 Callout 扩展）

> 状态：规划（待确认后实施）
> 基础：继承《编辑器模块Obsidian双链大纲标签命令面板模板升级方案.md》的 6 个功能点（双链/大纲/标签/命令面板/模板/图谱打通）
> 本次新增：借鉴 [MD-Editor](https://www.52pojie.cn/thread-2112588-1-1.html) 与 Obsidian，追加 **FP-7 Mermaid 流程图渲染** 与 **FP-8 Callout 提示块渲染**
> 用户已确认：新增「Mermaid 流程图渲染」与「Callout 提示块渲染」两个功能点

---

## 一、本次新增功能点总览

| 编号 | 功能 | 借鉴 | 优先级 | 可行性依据 |
|------|------|------|--------|-----------|
| FP-7 | Mermaid 流程图渲染（` ```mermaid ` 代码块 → SVG） | MD-Editor 杀手锏、Obsidian | P1 | 库已存在 `libs/mermaid.min.js`，仅需在 editor.html 引入 |
| FP-8 | Callout 提示块渲染（`> [!note]` 等） | Obsidian | P1 | 后端 frontmatter 已有 `calloutTypes` 配置（analysis/thoughts→note/quote），前端渲染需新增 |

> MD-Editor 其余亮点（托盘常驻、800ms 防抖自动保存）已被现有能力覆盖：托盘 `createTray()`（[main.js L1033](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js)）、自动保存 `autosaveFile`（[editor.js L3333](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js)）。
> 用户未选：导出 Word/PDF、双栏分屏、拖拽批量导入、属性编辑面板（避免过度设计，遵循「做核心好用的功能」）。

---

## 二、现状关键事实（已确认）

- Mermaid 库已存在：`frontend/libs/mermaid.min.js`；但 **editor.html 未引入**（仅引入 `marked.min.js`，[editor.html L466](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html)）。
- Markdown 预览统一入口：`window.MediaKit.render.renderMarkdown(text)`（[media-render.js L123](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)），链路 = `marked.parse` → `sanitizeHtml` → `rewriteImageSrc`。
- 消毒白名单 `ALLOWED_TAGS` / `ALLOWED_ATTRS` / `ALLOWED_CLASS_PREFIXES`（[media-render.js L18-L28](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/media-render.js)）——Mermaid 渲染产物为 `<svg>`，**必须加入白名单**，否则会被剥离。
- Callout 的后端配置已存在：`ObsidianExportConfig.calloutTypes`（analysis→note、thoughts→quote，[ObsidianExportConfig.java L52-L53](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/obsidian/ObsidianExportConfig.java)）。

---

## 三、FP-7 Mermaid 流程图渲染（P1）

### 3.1 目标
在 Markdown 预览区把 ` ```mermaid\n...\n``` ` 代码块渲染为可交互 SVG 流程图，与 MD-Editor/Obsidian 一致；支持 AI 生成 Mermaid 代码 → 粘贴 → 预览 → 导出（后续可接工具模块）。

### 3.2 实施任务
**文件**：
- `frontend/editor.html`（改）
  - 引入 `<script src="libs/mermaid.min.js"></script>`（放在 marked.min.js 之后、media-render.js 之前）。
- `frontend/js/media-render.js`（改）
  - `ALLOWED_TAGS` 加入 `svg`、及 mermaid 输出所需子标签（`g`/`path`/`rect`/`circle`/`text`/`line`/`polygon`/`polyline` 等）；`ALLOWED_ATTRS` 加入 `viewBox`/`fill`/`stroke`/`stroke-width`/`d`/`x`/`y`/`width`/`height`/`transform`/`class`/`marker-end`/`font-size`/`font-family`/`text-anchor`/`dominant-baseline` 等。
  - 新增 `renderMermaid(html)`：在 `sanitizeHtml` 之后、输出之前，找出 `<pre><code class="language-mermaid">code</code></pre>`，替换为 `<div class="mermaid">code</div>` 占位，并触发 `mermaid.render()` 异步渲染；渲染失败时回退显示原始代码块（不阻断预览）。
  - **注意顺序**：`renderMarkdown` 需改为「marked → 双链预替换(renderWikilinks) → sanitizeHtml → mermaid 占位 → 异步渲染 → rewriteImageSrc」。Mermaid 需在 sanitize 之后、DOM 渲染之后执行（因 mermaid 会操作 DOM）。
  - 暴露 `renderMermaid` 到 `MediaKit.render`。
- `frontend/js/editor.js`（改）
  - 预览渲染完成后调用 `MediaKit.render.renderMermaid(container)`，用 `MutationObserver` 或防抖处理，避免重复初始化解散。
- `frontend/styles/editor.css`（改）：`.mermaid` 容器样式（居中、最大宽度、溢出滚动）、错误占位样式。

### 3.3 关键决策
- Mermaid 渲染产物是 SVG，**必须扩白名单**，否则被 `sanitizeHtml` 剥离为空白。
- 采用「sanitize 后异步渲染」而非「sanitize 前」，避免 mermaid 注入的样式/脚本被误杀，同时保证 XSS 安全。
- 渲染失败回退为源码，保证编辑器稳定性。

---

## 四、FP-8 Callout 提示块渲染（P1）

### 4.1 目标
渲染 Obsidian 风格的 `> [!type] 标题\n> 内容` 引用块为彩色 Callout 卡片，与剪藏导出（backend 已把 analysis/thoughts 写成 callout）视觉一致，打通「编辑器预览 ⇄ Obsidian 归档展示」。

### 4.2 支持的 Callout 类型（映射）
| 关键字 | 色系 | 图标 | 对应后端 calloutTypes |
|--------|------|------|----------------------|
| `note` | 蓝 | 💡 | analysis |
| `quote` | 灰 | 💬 | thoughts |
| `info`/`tip`/`warning`/`danger`/`success` | 常规 | — | 扩展 |

### 4.3 实施任务
**文件**：
- `frontend/js/media-render.js`（改）
  - 新增 `renderCallouts(md)`：在 `marked.parse` **之前**，用正则把 `> [!type] ...` 块预替换为 `<div class="callout callout-{type}"><div class="callout-title">…</div><div class="callout-body">…</div></div>`，再交给 marked 渲染内部内容。
  - 或者更稳：用 marked 的 `customRenderer` 拦截 blockquote，检测首行 `[!type]`。推荐 customRenderer 方案（避免正则破坏嵌套引用）。
  - `ALLOWED_TAGS` 加入 `div`（已有）；保留 `callout-*` class 前缀到 `ALLOWED_CLASS_PREFIXES`。
  - 暴露 `renderCallouts` 到 `MediaKit.render`。
- `frontend/styles/editor.css`（改）：`.callout` 各类型配色、左侧色条、标题栏、圆角、暗色主题适配。
- （可选）`editor.js`：预览区对 Callout 无特殊交互，仅靠 CSS 即可。

### 4.4 关键决策
- 用 **marked customRenderer** 实现，比正则更健壮，能正确处理嵌套引用与多行内容。
- Callout 类型与剪藏导出的 `calloutTypes` 语义对齐，保证本软编辑器预览与 Obsidian 归档展示一致。

---

## 五、与既有方案的关系

- 本方案**不覆盖**既有 FP-1~FP-6（双链/大纲/标签/命令面板/模板/图谱打通），仅在其上追加 FP-7、FP-8。
- Mermaid 渲染与双链（FP-1）都改 `media-render.js` 的 `renderMarkdown` 链路，需统一梳理渲染管线顺序：`marked(customRenderer: callout) → renderWikilinks → sanitizeHtml(svg白名单) → mermaid占位/异步渲染 → rewriteImageSrc`。
- 实施顺序建议：先 FP-1 双链（P0 核心）+ FP-7 Mermaid（依赖 media-render 管线改造）→ FP-8 Callout（customRenderer）→ FP-2~FP-6。

---

## 六、验证步骤

1. **FP-7 Mermaid**：预览含 ` ```mermaid ` 代码块/`graph TD`/时序图/类图，渲染为 SVG 且可缩放；`sanitizeHtml` 不剥离 SVG；非法 mermaid 代码回退显示源码不报错；暗色主题下 SVG 文字可读。
2. **FP-8 Callout**：`> [!tip]`、`> [!warning]`、`> [!note]` 渲染为对应彩色卡片；嵌套引用不被破坏；剪藏导出含 `> [!note]` 的内容预览一致。
3. **回归**：图片重写（rewriteImageSrc）、双链渲染、普通引用块、代码块高亮不受影响；三端（editor/clip/wiki/knowledge）统一起效。