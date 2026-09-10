# Markdown 预览全屏下唤醒反链/大纲/标签（悬浮覆盖 + 视口自适应宽度）

## Summary
在编辑器 `Ctrl+Shift+M` 预览并进入全屏（`markdown-fullscreen`）的阅读态下，当前反链(backlinks)/大纲(outline)/标签(tags)三个左抽屉会被完全隐藏、无法唤起。本次改造让这三个面板在全屏预览下可以被快捷键/状态栏按钮唤起，并以**悬浮覆盖抽屉**的形式叠在预览上方：宽度按视口 `clamp(280px, 34vw, 460px)` 自适应、半透明磨砂背景 + 可横向拖动停靠，避免完全盖住正文。概览(overview)依用户确认**不在本需求范围**。

## Current State Analysis
全屏预览的现状（关键代码）：
- `frontend/js/editor.js`：
  - `toggleMarkdownFullscreen()`（约 L1194-1204）在 `.editor-workspace` 上切换 `markdown-fullscreen` 类；全屏态同时保留 `markdown-preview` 类。
  - `toggleBacklinks()`（L5994-6019）、`toggleOutline()`（L6118-6128）、`toggleTags()`（L6217-6227）通过切换对应 pane 的 `aria-hidden` 与 `.show-backlinks/.show-outline/.show-tags` 类控制；三者打开时互斥（`closeOtherLeftPanes`）。
  - 快捷键由 `editor-shortcuts.js` 的统一捕获分发（`EditorShortcuts.registerHandler`）触发上述 toggle 函数，与全屏无关，唤起功能本身可用。
- `frontend/styles/editor.css`：
  - `.editor-workspace`（L351-359）为三列网格 `0fr minmax(0,1fr) 0fr`；左抽屉位于 `grid-column:1`（L375-389）。
  - `markdown-preview` 下网格变 `1fr 1fr`，且 `.markdown-preview > .backlinks/.outline/.tags-pane` 被 `display:none !important`（L416-420）。
  - 全屏规则（L1663-1689）：`.markdown-preview.markdown-fullscreen[.show-*]` 网格强制单列 `minmax(0,1fr)`；除 `.markdown-pane` 外，`.main-pane/>.backlinks-pane/>.filetree-pane/.../>.ai-chat-pane` 全部 `display:none !important`。

**结论**：全屏规则用 `display:none !important` 硬性隐藏了所有面板，单独保留 markdown-pane 独占工作区，因而反链/大纲/标签无法唤起。

## Proposed Changes

### 1) `frontend/styles/editor.css` — 新增全屏悬浮抽屉覆盖样式
在 `markdown-fullscreen` 全屏规则块（L1689 之后、抽屉 `aria-hidden` 过渡块之前）新增：

- 给全屏工作区加定位锚点：`.editor-workspace.markdown-preview.markdown-fullscreen { position: relative; }`，让绝对定位抽屉以工作区为基准。
- 三个抽屉唤起时的覆盖规则（**更高特异性覆盖**上面两处 `display:none !important`）：

```css
.editor-workspace.markdown-preview.markdown-fullscreen.show-backlinks > .backlinks-pane,
.editor-workspace.markdown-preview.markdown-fullscreen.show-outline > .outline-pane,
.editor-workspace.markdown-preview.markdown-fullscreen.show-tags > .tags-pane {
  display: flex;
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: clamp(280px, 34vw, 460px);
  z-index: 6;
  grid-column: auto; grid-row: auto;
  margin: 0;
  border-left: 1px solid var(--app-border);
  border-right: none;
  border-bottom: 0;
  box-shadow: var(--app-shadow-panel-left);
  /* 半透明磨砂：正文不被完全盖住（核心诉求） */
  background: color-mix(in srgb, var(--app-surface) 82%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  opacity: .95;
  max-height: none;
}
/* hover 提亮，便于阅读；拖动把手视觉提示 */
.editor-workspace.markdown-preview.markdown-fullscreen.show-backlinks > .backlinks-pane:hover,
.editor-workspace.markdown-preview.markdown-fullscreen.show-outline > .outline-pane:hover,
.editor-workspace.markdown-preview.markdown-fullscreen.show-tags > .tags-pane:hover {
  opacity: 1;
}
```

说明：`right:0` 默认停靠右缘形成阅读栏风格；宽度随视口 `clamp` 自适应。专一性保证该组规则覆盖 L416-420（`.markdown-preview > .outline/.tags`）与 L1675-1682（`.markdown-fullscreen > .backlinks-pane`）的 `display:none !important`。`backdrop-filter` 提供真实磨砂效果；不支持的旧内核退化为 `opacity..95` 半透明底，仍满足"不盖死正文"。

### 2) `frontend/js/editor.js` — 全屏悬浮抽屉可横向拖动
新增一个通用拖拽初始化的函数（挂在现有绘画初始化串中、`mainEditor` 已创建之后）：

- 功能：在全屏态下，三个抽屉（`backlinksPane/outlinePane/tagsPane`）的顶部 `.filetree-header` 作为横向拖动把手（`touch-action:none`、`cursor:grab`），通过 Pointer Events 计算 `translateX` 偏移，将抽屉沿 X 轴滑动（默认 `0` 即右缘停靠），范围为 `[-（工作区宽度 - 抽屉宽度）, 0]`，保证不拖出可视区。
- 实现要点：
  - 无把手元素则用 JS 在每个 pane 头部插入一个 `.md-drawer-grab` 拖拽把手（小竖条 + 位置提示），避免与头部「关闭」按钮等点击冲突；仅捕获阶段在该把手与头部空白区进行 `pointerdown`。
  - 拖动中仅首帧记录起点，拖动应用 `transform: translateX(offset)`，结束清除临时状态。
  - `transform` 而非改宽度，避免触发网格重排；退出全屏（`.markdown-fullscreen` 类移除）或抽屉关闭时重置 `transform` 与把手。
  - 只做内存态、不做持久化（简单、够用）。

入口绑定：复用 `toggleMarkdownFullscreen()`，在切换 `markdown-fullscreen` 类后调用一次初始化/归位逻辑；同时可在 `mainEditor.resize()` 附近补偿刷新拖动范围。

### 3) （可选收敛）避免与既有 `markdown-preview`（非全屏）抽屉行为冲突
- 明确本次只改**全屏**路径。非全屏 `markdown-preview` 下 outline/tags 仍按既有规则隐藏，backlinks 仍按 L1646-1661 左列并排显示，均不改动，保持稳定。

## Assumptions & Decisions
- 悬浮布局：**覆盖式**（面板叠在预览上，预览保持全宽）——用户已确认「悬浮覆盖(推荐)」。
- 宽度策略：**按视口 `clamp(280px, 34vw, 460px)`**——用户已确认；`34vw` 约占用 1/3 视口，阅读体验合理，可按反馈微调上限。
- 盖住正文问题：以**半透明磨砂(backdrop blur) + 横向拖动**双方案解决——用户已确认「可拖动或有透明度」。
- 概览(overview ruler)：**排除**——其依赖 ACE 编辑器画布，全屏预览时编辑区已隐藏，用户已确认排除。
- 三个左抽屉全屏打开时仍互斥（沿用 `closeOtherLeftPanes`），同一时刻只显示一个悬浮抽屉，布局清晰。

## Verification
1. 打开一个含较长内容且反链/大纲/标签非空的文档。
2. `Ctrl+Shift+M` 进入预览 → `⛶ 全屏`（或 `Esc` 相关）进入全屏预览态。
3. 全屏态下分别按反链(`Ctrl+Shift+B`)/大纲(`Ctrl+Shift+D`)/标签(`Ctrl+Shift+T`)唤醒：
   - 面板以右缘停靠的悬浮抽屉出现，宽度随窗口缩放自适应（clamp 区间内）。
   - 背景半透明磨砂，面板下方正文隐约可见，不被完全遮挡。
   - 顶部把手可横向拖动抽屉，松手停在目标位置，不外溢出可视区。
4. 开启一个抽屉时另一个自动互斥关闭。
5. 关闭预览或退出全屏后，抽屉恢复正常（非全屏）表现，编辑画布无空白残留（呼应此前 markdown-fullscreen 残留类 bug 的修复）。
6. `node --check` 校验 `editor.js` 语法；因仅改前端 CSS/JS，无 Maven 编译需要。