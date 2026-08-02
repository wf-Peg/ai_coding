# 编辑器模块面板动画与视觉美化方案

## 摘要

为编辑器模块右下角的五个面板（机器人/文件/最近/历史/概览）增加**推拉式抽屉动画**（打开/关闭双向）并进行**视觉升级**，参考 frontend-design 技能的设计原则，让面板交互从"瞬间硬切"变为"平滑生动"。

## 当前状态分析

### 面板架构（探索确认）

| 面板 | 容器 | 开关函数 | 位置/宽度 | 互斥 |
|------|------|---------|----------|------|
| 机器人 | `#aiChatPane` | `setAiChatPanelOpen` (editor.js:958) | 右侧 `--ai-chat-width`(360px) | 关 compare/markdown |
| 文件树 | `#fileTreePane` | `toggleFileTree` (editor.js:2255) | 左侧 220px | 关 history/recent |
| 最近 | `#recentPane` | `toggleRecentPanel` (editor.js:2848) | 左侧 280px | 关 filetree/history |
| 历史 | `#historyPane` | `toggleHistoryPanel` (editor.js:2685) | 左侧 280px | 关 filetree/recent |
| 概览 | `#overviewRuler` | `toggleOverviewRuler` (editor.js:2982) | 绝对定位浮层 48px | 无 |

### 核心问题

1. **面板显隐无动画**：全部依赖 `hidden` 属性（CSS `[hidden]{display:none!important}`）硬切，grid 模板无 transition，打开/关闭瞬时完成。
2. **grid 列宽动画与 `display:none` 冲突**：`display:none` 会瞬时塌陷 grid 列，无法播放列宽过渡，因此必须把隐藏机制从 `hidden` 属性改为「class 控制 + `aria-hidden`」。
3. **resize 时机**：打开/关闭后 50ms 调用 `mainEditor.resize()`，动画期间编辑区尺寸渐变，需在 transition 结束后再 resize，否则出现短暂留白/错位。
4. **状态栏按钮无激活态**：五个按钮（看板娘/文件/最近/历史/概览）无"当前面板已打开"的高亮反馈。

### 可复用资源

- `.side-panel` 的 `translateX(105%)→0` + `transition: transform 180ms ease`（editor.css:749-769）——滑入动效参考
- 现有 `prefers-reduced-motion: reduce` 降级规则（editor.css:1338-1340）——必须保留并扩展
- 现有设计 token：`--app-surface`、`--app-border`、`--app-primary`、`--app-radius-*` 等

## 方案设计

### 核心策略

**推拉式抽屉**：面板在 grid 中始终占位，隐藏时列宽为 `0fr`（+ `overflow:hidden` + `visibility:hidden` 过渡），打开时列宽过渡到目标宽度（`220px`/`280px`/`var(--ai-chat-width)`），编辑区被平滑推开/收回；面板内容叠加方向性滑入（左面板 `translateX(-20px)→0`，机器人 `translateX(20px)→0`）与淡入。

- 时长基准：**240ms**，缓动 `cubic-bezier(0.22, 1, 0.36, 1)`（易出缓出，`--app-ease-out` 风格）
- 概览浮层：`opacity` + 轻微 `scale(0.98→1)` 淡入淡出（不参与 grid）
- 双向动画：打开播放滑入，关闭播放滑出（延迟设 `aria-hidden`）

### 技术约束（Chromium）

- `grid-template-columns` transition：Chromium 107+ 支持，Electron 与主流 Chrome 均满足
- 面板 `min-width:0` + `overflow:hidden` 是 `0fr→Npx` 动画的前提（现有 `.filetree-pane` 已含 `min-width:0`）

## 具体改动

### 1. editor.html — 移除 `hidden` 硬依赖（5 处）

文件：`frontend/editor.html`

- `#fileTreePane`(L63)、`#historyPane`(L73)、`#recentPane`(L85)、`#aiChatPane`(L110)：移除 HTML 中初始 `hidden` 属性，改加 `class="... pane"`（保留现有类）+ `aria-hidden="true"`
- `#overviewRuler`(L97)：同样处理（浮层用 opacity 控制）
- 说明：面板初始为隐藏（`0fr` + `visibility:hidden`），不影响首屏布局

### 2. editor.css — 动画与视觉升级（核心）

文件：`frontend/styles/editor.css`

**a) 工作区 grid 过渡**
```css
.editor-workspace {
  transition: grid-template-columns 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

**b) 面板隐藏机制改造**（替换各 pane 的 `[hidden]{display:none!important}` 规则）
- 左面板（filetree/history/recent）统一：
  ```css
  .editor-pane { min-width: 0; overflow: hidden; }
  .editor-pane[aria-hidden="true"] {
    visibility: hidden;             /* 可过渡，避免 grid 0fr 下内容残留 */
    opacity: 0;
    transition: visibility 0s linear 240ms, opacity 240ms ease;
  }
  .editor-pane[aria-hidden="false"],
  .editor-pane:not([aria-hidden="true"]) { visibility: visible; opacity: 1; }
  ```
- grid 模板：`show-*` 类控制 `grid-template-columns: 0fr minmax(0,1fr)`（默认，隐藏）↔ `220px minmax(0,1fr)`（打开）等
  - 注意：需在 `.editor-workspace` 默认状态下定义 `grid-template-columns: 0fr minmax(0,1fr)`，使列数恒定（1 列编辑区 + 1 列面板位），`show-*` 只改宽度
  - `.show-ai-chat` 同理：`minmax(0,1fr) var(--ai-chat-width)`

**c) 面板内容方向性滑入**
```css
.editor-pane { /* 内容容器 */ }
.editor-pane[aria-hidden="false"] { animation: pane-in 240ms var(--app-ease-out); }
@keyframes pane-in {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0); }
}
.ai-chat-pane[aria-hidden="false"] { animation: pane-in-right 240ms ...; }
@keyframes pane-in-right {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}
```
- 关闭动画：由于 grid 0fr 收回本身带动画，面板 opacity 随 240ms 过渡淡出即可（无需额外 keyframes）

**d) 概览浮层**
```css
.overview-ruler {
  transition: opacity 240ms ease, transform 240ms ease;
}
.overview-ruler[aria-hidden="true"] { opacity: 0; transform: scale(0.98); pointer-events: none; }
```

**e) 状态栏按钮激活态 + hover 微动效**（frontend-design 原则）
```css
.status-btn { position: relative; transition: ... 160ms ease; }
.status-btn:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(...); }
.status-btn.active {
  color: var(--app-primary);
  border-color: var(--app-primary);
  background: var(--app-primary-soft);
}
.status-btn.active::after { /* 底部指示条 */ }
```

**f) 面板内部视觉升级**（适度，避免过度设计）
- 头部：`.filetree-header`/`.ai-chat-header`/历史·最近头部加图标占位与 hover 关闭按钮旋转动效（`.icon-close:hover{transform:rotate(90deg)}`，transition 160ms）
- 列表项：`.filetree-item`/`.recent-item`/`.history-item` hover 增加左侧 2px 主色指示条（`::before` + `transform: scaleY` 动画）或背景渐变滑入（`background-position` 过渡）
- 面板圆角/阴影：编辑器网格内面板保持直角（贴合网格），但头部与内容边界用 `--app-border` 微分隔；不加浮起阴影（避免与 dock 风格冲突）

**g) 无障碍降级**：扩展现有 `prefers-reduced-motion: reduce` 块
```css
@media (prefers-reduced-motion: reduce) {
  .editor-workspace, .editor-pane, .overview-ruler, .status-btn { transition: none !important; animation: none !important; }
}
```

### 3. editor.js — 开关函数与 resize 时序（核心）

文件：`frontend/js/editor.js`

**a) 新增统一辅助函数**（放编辑器初始化区附近）：
```js
function setPaneVisibility(pane, open, workspaceClass, workspaceEl) {
  pane.setAttribute('aria-hidden', String(!open));
  workspaceEl.classList.toggle(workspaceClass, open);
  const duration = open ? 240 : 240;
  if (open) {
    setTimeout(() => mainEditor.resize(), duration + 10);
  } else {
    setTimeout(() => mainEditor.resize(), duration + 10);
  }
}
```
（实际实现按各面板现状微调，机器人面板保留 `setAiChatWidth` 逻辑）

**b) 改造 5 个开关函数**：
- `setAiChatPanelOpen`(L958)：`elements.aiChatPane.hidden = !open` → `setAttribute('aria-hidden', String(!open))`；resize 从 50ms 改为 `240+10`ms
- `toggleFileTree`(L2255)：同上替换 hidden 逻辑，resize 时机调整
- `toggleHistoryPanel`(L2685) / `closeHistoryPanel`(L2702)：同上
- `toggleRecentPanel`(L2848) / `closeRecentPanel`(L2865)：同上
- `toggleOverviewRuler`(L2982)：`rulerEl.hidden = ...` → `rulerEl.setAttribute('aria-hidden', ...)`，保持无 workspace 类

**c) 按钮激活态同步**（L2471-2476 fileTreeBtn、L2709-2714 historyBtn、L2872-2877 recentBtn、L3078-3085 overviewBtn、L1170 aiPetBtn 相关）：
- 各开关函数内同步 `classList.toggle('active', open)` 到对应按钮
- 互斥关闭其他面板时，同步移除其他按钮 active

**d) 初始状态**：`init` 时确保各面板 `aria-hidden="true"`（HTML 已设）

### 4. 不动的内容

- 面板内部业务逻辑（渲染、拖拽调宽把手、快捷键、localStorage 持久化）
- 窄屏（≤680px）降级布局逻辑保持，仅动画属性自动适用
- 机器人看板娘动画、AI 消息动画保持不变

## 假设与决策

1. **隐藏机制**：`hidden` 属性 → `aria-hidden` + class，是 grid 列宽动画的必要前提（`display:none` 无法过渡）。已确认所有面板开关均通过 JS 统一入口，无第三方依赖直接读 `hidden`。
2. **动画时长**：240ms 为基准（易出缓出），与现有 `.side-panel` 180ms 相比略长以获得"推拉感"。
3. **grid 兼容**：Electron(Chromium) 与 Chrome/Edge 均支持 `grid-template-columns` transition；Firefox 部分版本不支持，降级为瞬时切换（无过渡，功能不受影响）。
4. **视觉升级范围**：仅动画 + 面板内交互细节（头部、列表项、按钮激活态），**不重排版式**、不更换字体/配色体系，遵循现有 design token，避免过度设计破坏编辑器工具性定位。
5. **不动业务代码**：所有动画为表现层改造，不改变面板互斥规则、数据渲染、快捷键等行为。

## 验证步骤

1. **语法检查**：`node --check frontend/js/editor.js`
2. **功能回归（浏览器/Electron 打开 editor.html）**：
   - 依次打开/关闭：文件、最近、历史、机器人、概览，确认推拉式动画平滑、编辑区让位无跳变
   - 确认互斥关系仍正确（打开文件树自动关闭历史/最近；打开机器人关闭对比/预览）
   - 打开动画期间及结束后编辑区无错位/留白（resize 时序正确）
   - 机器人面板宽度拖拽把手仍可用
   - 快捷键 Ctrl/Cmd+Shift+F / Ctrl/Cmd+Shift+O 仍正常
   - 窄屏（≤680px）布局正常
3. **激活态**：打开某面板时对应状态栏按钮高亮，关闭后取消
4. **无障碍**：系统开启"减弱动态效果"（prefers-reduced-motion）后动画全部关闭，功能正常
5. **全量回归**：确认标签页切换、自动保存、AI 对话、文件树导航、历史撤销/重做、最近打开等既有功能不受影响

## 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/editor.html` | 5 个面板移除 `hidden`，改 `aria-hidden` |
| `frontend/styles/editor.css` | grid 过渡、面板隐藏机制、滑入动画、按钮激活态、列表项 hover、reduced-motion |
| `frontend/js/editor.js` | 5 个开关函数 hidden→aria-hidden、resize 时序、按钮 active 同步 |
