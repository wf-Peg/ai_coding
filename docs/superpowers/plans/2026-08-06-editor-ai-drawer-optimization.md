# 编辑区与抽屉面板深度优化计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 参考 YouMind、Notion 等大厂产品的 AI 功能模块设计，深度优化编辑区功能的产品体验和前端界面，增强抽屉式开关功能区的层次感、阴影等设计元素，提升整体高级感。

**参考产品：**
- **Notion AI** — 内联 AI 命令（Cmd+J）、AI 气泡卡片设计、上下文感知的 AI 建议、平滑动画
- **YouMind** — 侧边面板深度层次、多层阴影、玻璃拟态（Glassmorphism）、微交互动效

**架构：** 纯前端改造，涉及 CSS 设计系统、编辑器 HTML 结构微调、JS 交互逻辑增强。不涉及后端改动。

**Tech Stack:** CSS Custom Properties, CSS Animation, JavaScript (vanilla), Ace Editor

---

## 文件结构

### 主要修改文件
- `frontend/styles/design-tokens.css` — 新增阴影/层级/动画设计 token
- `frontend/styles/editor.css` — 抽屉面板阴影、动画、状态栏按钮、AI 区域样式重写
- `frontend/editor.html` — 新增抽屉面板入口 DOM 结构、AI 功能区增强
- `frontend/js/editor.js` — 交互逻辑增强、面板状态管理优化

---

## 设计原则

1. **层次感（Hierarchy）**：通过多层阴影、z-index 叠加、颜色渐变区分功能层级
2. **高级感（Premium Feel）**：圆角柔和、过渡平滑、微动效反馈、克制用色
3. **一致性（Consistency）**：所有面板统一设计语言，入口按钮统一风格
4. **可访问性（Accessibility）**：prefers-reduced-motion 支持，键盘导航

---

### Task 1: 设计 Token 系统增强

**Files:**
- Modify: `frontend/styles/design-tokens.css`

- [ ] **Step 1.1: 新增阴影层级 token**

在 `:root` 和 `html[data-theme="dark"]` 中新增多级阴影 token：

```css
/* 新增阴影层级 */
--app-shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.04);
--app-shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
--app-shadow-md: 0 4px 6px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.04);
--app-shadow-lg: 0 10px 15px rgba(15, 23, 42, 0.08), 0 4px 6px rgba(15, 23, 42, 0.04);
--app-shadow-xl: 0 20px 25px rgba(15, 23, 42, 0.10), 0 8px 10px rgba(15, 23, 42, 0.06);
--app-shadow-panel: 0 0 0 1px rgba(15, 23, 42, 0.04), 0 2px 6px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08);
--app-shadow-panel-right: -4px 0 8px rgba(15, 23, 42, 0.04), -8px 0 24px rgba(15, 23, 42, 0.08);
--app-shadow-panel-left: 4px 0 8px rgba(15, 23, 42, 0.04), 8px 0 24px rgba(15, 23, 42, 0.08);
```

- [ ] **Step 1.2: 新增动画曲线和时长 token**

```css
/* 新增动画曲线 */
--app-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--app-ease-in-out-expo: cubic-bezier(0.87, 0, 0.13, 1);
--app-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--app-ease-smooth: cubic-bezier(0.22, 1, 0.36, 1);

/* 动画时长 */
--app-duration-fast: 120ms;
--app-duration-normal: 200ms;
--app-duration-slow: 300ms;
--app-duration-panel: 250ms;
```

- [ ] **Step 1.3: 暗色模式适配**

暗色主题下阴影值需调整（暗色模式下阴影更浓）：
```css
html[data-theme="dark"] {
  --app-shadow-panel: 0 0 0 1px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.3), 0 16px 32px rgba(0, 0, 0, 0.4);
  --app-shadow-panel-right: -4px 0 12px rgba(0, 0, 0, 0.3);
  --app-shadow-panel-left: 4px 0 12px rgba(0, 0, 0, 0.3);
  --app-shadow-lg: 0 10px 20px rgba(0, 0, 0, 0.3);
  --app-shadow-xl: 0 20px 30px rgba(0, 0, 0, 0.4);
}
```

---

### Task 2: 抽屉面板阴影与层次感优化

**Files:**
- Modify: `frontend/styles/editor.css`

- [ ] **Step 2.1: 左侧面板应用多层阴影**

替换当前左侧面板（filetree/history/recent/fav）的纯 `border-right` 为阴影+边框组合：

```css
/* 左侧面板：阴影在右侧，与右侧面板拉开层次 */
.editor-workspace > .filetree-pane,
.editor-workspace > .history-pane,
.editor-workspace > .recent-pane,
.editor-workspace > .fav-pane {
  box-shadow: var(--app-shadow-panel-left);
  border-right: 1px solid var(--app-border);
  /* 移除旧的 border-right: 1px solid var(--app-border-strong); */
}
```

- [ ] **Step 2.2: AI 对话面板应用右侧阴影**

```css
/* AI 面板：阴影在左侧，产生悬浮于编辑区之上的效果 */
.editor-workspace > .ai-chat-pane {
  box-shadow: var(--app-shadow-panel-right);
  border-left: 1px solid var(--app-border);
  /* 保持 z-index 高于编辑区，确保阴影覆盖 */
  z-index: 1;
}
```

- [ ] **Step 2.3: 面板打开时内容区深度感**

当面板打开时，编辑区通过微妙的遮罩或阴影过渡体现层次：
```css
/* 左面板打开时，编辑区左侧有微弱阴影过渡 */
.editor-workspace.show-filetree .main-pane::before,
.editor-workspace.show-history .main-pane::before,
.editor-workspace.show-recent .main-pane::before,
.editor-workspace.show-fav .main-pane::before {
  content: '';
  position: absolute;
  z-index: 5;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(to right, rgba(15, 23, 42, 0.06), transparent);
  pointer-events: none;
}
```

- [ ] **Step 2.4: 面板动画增强**

将现有 `pane-slide-in` 动画升级为更流畅的版本：
```css
@keyframes pane-slide-in {
  from { 
    opacity: 0; 
    transform: translateX(-12px); 
    box-shadow: none;
  }
  to   { 
    opacity: 1; 
    transform: translateX(0); 
    box-shadow: var(--app-shadow-panel-left);
  }
}

@keyframes pane-slide-in-right {
  from { 
    opacity: 0; 
    transform: translateX(12px); 
    box-shadow: none;
  }
  to   { 
    opacity: 1; 
    transform: translateX(0); 
    box-shadow: var(--app-shadow-panel-right);
  }
}
```

- [ ] **Step 2.5: 面板头部美化**

面板头部添加视觉层次，区分标题区和内容区：
```css
.filetree-header {
  /* 增加底部阴影分隔 */
  position: relative;
  /* ... 保留现有样式 */
}

.filetree-header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(to right, var(--app-border), transparent 80%);
}
```

---

### Task 3: 状态栏入口按钮重设计

**Files:**
- Modify: `frontend/styles/editor.css`
- Modify: `frontend/js/editor.js`

- [ ] **Step 3.1: 状态栏按钮视觉升级**

当前按钮为纯文本按钮，升级为图标+文字组合，增加视觉权重区分：

```css
/* 升级状态栏按钮 */
.status-btn {
  /* 保留现有基础样式 */
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* 增加过渡 */
  transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease,
              transform 160ms ease, box-shadow 160ms ease;
}

.status-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
}

/* 激活态：面板已打开时高亮（含底部指示条） */
.status-btn.active {
  color: var(--app-primary);
  border-color: var(--app-primary);
  background: color-mix(in srgb, var(--app-primary-soft) 65%, transparent);
}

.status-btn.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -2px;
  transform: translateX(-50%);
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: var(--app-primary);
}
```

- [ ] **Step 3.2: 按钮分组与视觉分隔**

在状态栏中对按钮进行逻辑分组，增加视觉分隔：
```css
/* 按钮分组分隔 */
.status-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.status-btn-group + .status-btn-group::before {
  content: '';
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--app-border);
}
```

- [ ] **Step 3.3: JS 按钮生成逻辑增强**

修改 `editor.js` 中各按钮的创建逻辑，增加图标和分组：

```javascript
// 创建带图标的 status-btn
function createStatusBtn(label, icon, title) {
  var btn = document.createElement('button');
  btn.className = 'status-btn';
  btn.title = title || label;
  btn.innerHTML = (icon ? '<span class="status-btn-icon">' + icon + '</span>' : '') 
    + '<span class="status-btn-label">' + label + '</span>';
  return btn;
}

// 示例：文件树按钮
var fileTreeBtn = createStatusBtn('文件', '📁', '文件浏览器');
fileTreeBtn.addEventListener('click', toggleFileTree);
```

- [ ] **Step 3.4: 快捷键提示**

在按钮 title 中增加快捷键提示，hover 时显示：
```javascript
// 快捷键映射
var SHORTCUT_HINTS = {
  fileTreeBtn: 'Ctrl+Shift+E',
  historyBtn: 'Ctrl+Shift+H',
  recentBtn: 'Ctrl+Shift+R',
  favBtn: 'Ctrl+Shift+F',
  aiPetBtn: 'Ctrl+Shift+A'
};
```

---

### Task 4: AI 功能区深度优化

**Files:**
- Modify: `frontend/styles/editor.css`
- Modify: `frontend/editor.html`
- Modify: `frontend/js/editor.js`

- [ ] **Step 4.1: AI 对话面板头部重设计**

参考 Notion AI 的对话头部设计，增加模型标识、上下文状态指示：

```html
<div class="ai-chat-header">
  <div class="ai-chat-heading">
    <span class="ai-chat-model-badge">AI</span>
    <span class="ai-chat-title">Pet 助手</span>
    <span class="ai-chat-status" id="aiChatStatus">就绪</span>
  </div>
  <div class="ai-chat-actions">
    <button class="ai-chat-context-btn" id="aiChatContextBtn" title="读取编辑器上下文">
      <span class="context-dot"></span>
      上下文
    </button>
    <button class="ai-chat-action-btn" id="aiChatClearBtn" title="清空会话">×</button>
    <button class="ai-chat-close-btn" id="aiChatCloseBtn" title="关闭面板">×</button>
  </div>
</div>
```

- [ ] **Step 4.2: AI 消息气泡优化**

参考 YouMind 的消息卡片设计，增强视觉层次：

```css
/* AI 消息气泡 - 更精致的卡片设计 */
.ai-chat-message.assistant .ai-chat-bubble {
  /* 多层阴影 + 微妙边框 */
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
  border: 1px solid var(--app-border);
  border-radius: 12px 12px 12px 4px;
  transition: box-shadow 200ms ease;
}

.ai-chat-message.assistant .ai-chat-bubble:hover {
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

/* 用户消息 - 现代化气泡 */
.ai-chat-message.user .ai-chat-bubble {
  border-radius: 12px 12px 4px 12px;
}
```

- [ ] **Step 4.3: AI 输入区增强**

参考 Notion AI 的输入区域设计，增加上下文提示和快捷操作：

```css
/* AI 输入区增强 */
.ai-chat-composer {
  position: relative;
  background: var(--app-surface);
  border-top: 1px solid var(--app-border);
  padding: 8px;
}

.ai-chat-composer textarea {
  border-radius: 10px;
  padding: 10px 12px;
  min-height: 44px;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  border: 1px solid var(--app-border);
  background: var(--app-surface-subtle);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.ai-chat-composer textarea:focus {
  border-color: var(--app-primary);
  box-shadow: 0 0 0 3px var(--app-primary-soft);
}

/* 输入区快捷操作栏 */
.ai-chat-composer-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.ai-chat-composer-tool-btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 120ms ease;
}

.ai-chat-composer-tool-btn:hover {
  background: var(--app-surface-hover);
  color: var(--app-text);
}
```

- [ ] **Step 4.4: 选中上下文提示条优化**

当前选中提示条较为简单，增强为浮动卡片式：

```css
.ai-chat-selection-hint {
  /* 从简单的条状改为浮动卡片 */
  margin: 4px 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--app-primary-soft);
  border: 1px solid color-mix(in srgb, var(--app-primary) 20%, transparent);
  box-shadow: 0 2px 6px rgba(35, 131, 226, 0.1);
  transition: all 200ms ease;
}

.ai-chat-selection-hint .hint-text {
  color: var(--app-primary);
  font-weight: 500;
}

.ai-chat-selection-hint .hint-clear {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background 120ms;
}

.ai-chat-selection-hint .hint-clear:hover {
  background: rgba(0, 0, 0, 0.1);
}
```

- [ ] **Step 4.5: AI 代码块卡片增强**

当前 AI 代码块已有基本样式，增强视觉层次和操作反馈：

```css
.ai-code-block {
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: box-shadow 200ms ease;
  margin: 12px 0;
}

.ai-code-block:hover {
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.ai-code-block-header {
  padding: 6px 10px;
  background: var(--app-bg-secondary);
  border-bottom: 1px solid var(--app-border);
}

.ai-code-block-lang {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--app-text-muted);
}

.ai-code-btn {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 6px;
  font-weight: 500;
  transition: all 150ms ease;
}

.ai-code-btn:active {
  transform: scale(0.95);
}
```

---

### Task 5: 编辑区体验增强

**Files:**
- Modify: `frontend/styles/editor.css`
- Modify: `frontend/js/editor.js`

- [ ] **Step 5.1: 编辑器顶部工具栏优化**

增加工具栏视觉层次，分组按钮用分隔线区分：

```css
.editor-toolbar {
  /* 增加底部阴影，与编辑区拉开层次 */
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  /* 保留现有样式 */
}

/* 工具栏按钮分组分隔 */
.toolbar-group + .toolbar-group {
  padding-left: 8px;
  margin-left: 8px;
  border-left: 1px solid var(--app-border);
}

.toolbar-file-actions {
  /* 保留 */
}

.toolbar-main-actions {
  /* 增加操作按钮密度 */
  gap: 4px;
}
```

- [ ] **Step 5.2: 标签栏增强**

当前标签栏样式较简洁，增加视觉层次：

```css
.tab-item {
  position: relative;
  /* 激活标签增加顶部指示条 */
}

.tab-item.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--app-primary);
  border-radius: 0 0 2px 2px;
}

.tab-item.active {
  border-bottom: none; /* 移除旧样式，改用 ::before */
}
```

- [ ] **Step 5.3: 差异对比面板美化**

```css
.diff-panel {
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}

.diff-panel-header {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 5.4: 弹窗/模态框阴影升级**

```css
.modal-card {
  box-shadow: var(--app-shadow-xl);
  /* 增加入场动画 */
  animation: modal-enter 200ms var(--app-ease-out-expo);
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

---

### Task 6: 响应式与可访问性

**Files:**
- Modify: `frontend/styles/editor.css`

- [ ] **Step 6.1: 窄屏适配优化**

确保窄屏下抽屉面板有良好的阴影和动画表现：

```css
@media (max-width: 680px) {
  .editor-workspace > .ai-chat-pane {
    box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.1);
    border-left: 0;
    border-top: 1px solid var(--app-border);
  }
  
  .editor-workspace.show-filetree .main-pane::before,
  .editor-workspace.show-history .main-pane::before {
    display: none; /* 窄屏下不显示阴影遮罩 */
  }
}
```

- [ ] **Step 6.2: 减少动效支持**

```css
@media (prefers-reduced-motion: reduce) {
  .editor-workspace,
  .ai-chat-pane,
  .filetree-pane,
  .history-pane,
  .recent-pane,
  .fav-pane,
  .status-btn,
  .ai-code-block,
  .ai-chat-bubble,
  .modal-card {
    transition: none !important;
    animation: none !important;
  }
  
  .filetree-pane[aria-hidden="false"],
  .history-pane[aria-hidden="false"],
  .recent-pane[aria-hidden="false"],
  .fav-pane[aria-hidden="false"],
  .ai-chat-pane[aria-hidden="false"] {
    animation: none !important;
  }
}
```

---

## 执行顺序

1. **Task 1** — 设计 Token 系统增强（CSS 变量）
2. **Task 2** — 抽屉面板阴影与层次感优化（CSS 重写）
3. **Task 3** — 状态栏入口按钮重设计（CSS + JS）
4. **Task 4** — AI 功能区深度优化（CSS + HTML + JS）
5. **Task 5** — 编辑区体验增强（CSS + JS）
6. **Task 6** — 响应式与可访问性（CSS）

---

## 预期效果

| 模块 | 当前状态 | 优化后 |
|------|---------|--------|
| 抽屉面板 | 仅边框分隔，无阴影层次 | 多层阴影+渐变遮罩，悬浮感强 |
| 状态栏按钮 | 纯文本按钮，无视觉权重 | 图标+文字组合，hover 动效，激活态高亮 |
| AI 对话面板 | 基础气泡样式 | 精致卡片设计，阴影过渡，上下文提示 |
| AI 代码块 | 基本操作按钮 | 卡片阴影，hover 交互增强 |
| 编辑区工具栏 | 平铺分隔 | 分组+阴影层次，视觉分区清晰 |
| 弹窗/模态框 | 基础阴影 | 入场动画+加强阴影，高级感提升 |