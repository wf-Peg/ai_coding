# 编辑器多标签（Multi-Tab）计划

## 摘要

为编辑器模块增加类似 Notepad++ 的多画布/多标签功能：双击标签栏空白区域或 Ctrl+T 新建标签，标签间可切换编辑，各标签的编辑状态（内容、文件路径、修改标记、编码、光标位置等）完全隔离。

## 现状分析

### 当前架构（单标签模式）

| 层面 | 现状 | 关键代码位置 |
|------|------|-------------|
| **DOM** | `editor-app` 为 4 行 CSS Grid：toolbar → compare-toolbar → workspace → statusbar | [editor.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html) L11-L81 |
| **状态** | 单一的 `state` 对象，包含 fileToken、fileName、encoding、modified 等 | [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L10-L34) |
| **编辑器实例** | `mainEditor`（可编辑）+ `compareEditor`（只读对比），两个 Ace 实例 | [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L61-L62) |
| **UI 同步** | `updateDocumentIdentity()` 将 state 映射到 toolbar 的标题/路径/修改标记 | [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L100-L109) |
| **内容设置** | `setEditorContent()` 直接调用 `mainEditor.setValue()` 并更新 state | [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L116-L131) |

### 当前所有操作都直接依赖全局 `state` 和 `mainEditor`

```
state.modified / state.fileName / state.encoding / ...
     ↓
mainEditor.getValue() / mainEditor.setValue()
     ↓
updateDocumentIdentity() → toolbar UI
```

改为多标签后，需要将以上映射改为"当前活跃标签"。

## 设计方案

### 核心思路：单 Ace 实例 + 标签快照

- **不创建多个 Ace 编辑器实例**（Ace 实例创建开销大、内存占用高）
- 始终只使用一个 `mainEditor` Ace 实例
- 切换标签时：先将当前标签的内容 + 光标/滚动位置 + 选择状态保存到快照，再切换到目标标签
- 每个标签维护一个独立的 `TabState` 对象

### 标签状态快照结构

```javascript
// 每个标签的独立状态
{
  id: 'tab_1',              // 唯一标识
  fileToken: null,          // 文件令牌
  fileName: '未命名.txt',    // 文件名
  displayPath: '',           // 显示路径
  encoding: 'UTF-8',         // 编码
  encodingConfidence: '',    // 编码可信度
  lineEnding: 'LF',          // 换行符
  expectedMtimeMs: null,     // 文件修改时间
  modified: false,           // 是否已修改
  content: '',               // 文本内容快照
  language: 'text',          // 语言模式
  browserBytes: null,        // 浏览器文件字节
  clipId: null,              // 剪藏 ID
  clipType: 'store-only',    // 剪藏类型
  clipMetadata: null,        // 剪藏元数据
  scrollTop: 0,              // 滚动位置
  scrollLeft: 0,             // 水平滚动
  cursorRow: 0,              // 光标行
  cursorColumn: 0            // 光标列
}
```

### 全局状态变化

```javascript
// 旧（单标签）
const state = { fileToken, fileName, ... };

// 新（多标签）
const tabs = [];           // TabState[]
let activeTabIndex = 0;    // 当前活跃标签索引
```

保留原有 `state` 对象作为**当前活跃标签的引用**，减少代码改动量：

```javascript
let state = null; // 指向 tabs[activeTabIndex]
```

## 修改范围

### 文件 1：`frontend/editor.html` — 新增标签栏 DOM

在 `<header class="editor-toolbar">` 和 `<section class="compare-toolbar">` 之间插入标签栏：

```html
<!-- 标签栏 -->
<nav class="tab-bar" id="tabBar" aria-label="编辑标签">
  <!-- 动态生成 tab 项 -->
  <button class="tab-new-btn" id="tabNewBtn" title="新建标签 (Ctrl+T)">+</button>
</nav>
```

### 文件 2：`frontend/js/editor.js` — 核心逻辑重构

| 改动项 | 说明 |
|--------|------|
| **新增 `createTabState()`** | 工厂函数，生成默认标签快照 |
| **新增 `saveActiveTabSnapshot()`** | 保存当前内容、光标、滚动位置到活跃标签 |
| **新增 `switchToTab(index)`** | 保存当前标签快照 → 切换活跃索引 → 恢复目标标签快照 |
| **新增 `createNewTab()`** | 新建标签（默认名"未命名.txt"），添加到 tabs 数组，切换到新标签 |
| **新增 `closeTab(index)`** | 关闭标签（含未保存确认），至少保留一个标签 |
| **新增 `renderTabBar()`** | 根据 tabs 数组重新渲染标签栏 DOM |
| **修改 `setEditorContent()`** | 操作 `state`（当前标签）而非全局 |
| **修改 `resetDocument()`** | 重置当前标签状态 |
| **修改 `confirmDiscardChanges()`** | 检查 `state.modified`（当前标签） |
| **修改 `saveFile()`** | 保存当前标签，更新 `state.fileToken` 等 |
| **修改 `openMainFile()`** | 在当前标签打开文件，或新建标签后打开 |
| **修改 `loadClip()`** | 在当前标签加载剪藏 |
| **修改 `updateDocumentIdentity()`** | 从 `state` 读取当前标签信息 |
| **修改 `updateCursorStatus()`** | 从 `state` 读取当前标签光标 |
| **修改 `setLanguage()`** | 更新 `state.language` |
| **修改 `setModified()`** | 更新 `state.modified` |
| **修改 `mainEditor.session.on('change')`** | 设置 `state.modified = true` |
| **修改 Ctrl+N 快捷键** | 改为新建标签 |
| **新增 Ctrl+T 快捷键** | 新建标签 |
| **新增 Ctrl+W 快捷键** | 关闭当前标签 |
| **新增 Ctrl+Tab / Ctrl+Shift+Tab** | 切换标签 |
| **修改 `beforeunload`** | 检查所有标签是否有未保存修改 |
| **修改 `applyTheme()`** | 保持对 `mainEditor` 设置主题 |
| **修改 `elements` 映射** | 新增 `tabBar`、`tabNewBtn` |

### 文件 3：`frontend/styles/editor.css` — 标签栏样式

新增标签栏及相关样式：

```css
/* 标签栏容器 */
.tab-bar {
  display: flex; align-items: stretch; gap: 0;
  background: var(--app-surface-subtle);
  border-bottom: 1px solid var(--app-border);
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin;
  min-height: 32px;
}

/* 单个标签 */
.tab-item {
  display: flex; align-items: center; gap: 6px;
  padding: 0 10px; min-width: 80px; max-width: 200px;
  border-right: 1px solid var(--app-border);
  cursor: pointer; font-size: 11px; color: var(--app-text-secondary);
  white-space: nowrap; overflow: hidden;
  transition: background 100ms, color 100ms;
  user-select: none;
}
.tab-item:hover { background: var(--app-surface-hover); color: var(--app-text); }
.tab-item.active { background: var(--app-surface); color: var(--app-text); font-weight: 600;
  border-bottom: 2px solid var(--app-primary); }

/* 标签修改圆点 */
.tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.tab-dot.active { background: var(--app-warning); }

/* 标签关闭按钮 */
.tab-close-btn {
  width: 16px; height: 16px; border: 0; border-radius: 3px;
  background: transparent; cursor: pointer; flex-shrink: 0;
  color: var(--app-text-muted); font-size: 14px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.tab-close-btn:hover { background: var(--app-danger-soft); color: var(--app-danger); }

/* 新建标签按钮 */
.tab-new-btn {
  flex-shrink: 0; width: 30px; border: 0;
  background: transparent; cursor: pointer;
  color: var(--app-text-muted); font-size: 16px;
  display: flex; align-items: center; justify-content: center;
}
.tab-new-btn:hover { background: var(--app-surface-hover); color: var(--app-text); }

/* 双击标签栏空白区域 */
.tab-bar-spacer { flex: 1; min-width: 20px; }
```

### 文件 4：`frontend/editor.html` — 调整 Grid 行

将 `editor-app` 的 grid 从 4 行改为 5 行：

```css
.editor-app {
  grid-template-rows: auto auto auto minmax(0, 1fr) 27px;
  /* 新增一行：tab-bar 在 toolbar 和 compare-toolbar 之间 */
}
```

## 标签切换流程

```
用户点击标签 B
  → saveActiveTabSnapshot()  ← 保存当前标签 A 的内容、光标、滚动
  → activeTabIndex = B 的索引
  → state = tabs[activeTabIndex]  ← 切换引用
  → mainEditor.setValue(state.content)  ← 恢复内容
  → mainEditor.gotoLine(state.cursorRow, state.cursorColumn)
  → mainEditor.session.setScrollTop(state.scrollTop)
  → updateDocumentIdentity()  ← 更新 toolbar 标题/路径
  → renderTabBar()  ← 更新标签栏高亮
```

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 关闭最后一个标签 | 不允许关闭，至少保留一个空白标签 |
| 关闭有未保存修改的标签 | 弹出确认弹窗，确认后关闭 |
| 切换标签时当前标签有未保存修改 | 不做阻断（修改保留在快照中），允许自由切换 |
| 新建标签打开文件 | 在当前活跃标签中打开，或新建标签后打开 |
| 页面关闭（beforeunload） | 遍历所有标签，有任一未保存则弹出确认 |
| Ctrl+S 保存 | 保存当前活跃标签，更新 state.fileToken |
| 对比模式 | 仅在当前标签上生效，切换标签时退出对比模式 |

## 假设与决策

- **使用单 Ace 实例**：避免多实例的内存开销和 Ace 创建/销毁的性能问题
- **标签数量无上限**：不设硬限制，由用户自行管理
- **标签栏溢出**：水平滚动（overflow-x: auto），不做折叠
- **双击区域**：双击标签栏空白区域（spacer）或 Ctrl+T 新建标签
- **对比模式**：切换标签时自动退出对比模式，简化状态管理
- **不持久化**：标签关闭后内容不保存到磁盘，除非用户手动保存

## 验证步骤

1. 启动编辑器，默认有一个"未命名.txt"标签
2. 双击标签栏空白区域，新建标签"未命名.txt"
3. Ctrl+T 新建标签，验证快捷键
4. 在不同标签中输入不同内容，切换标签验证内容隔离
5. 在一个标签中保存文件，验证 fileToken 绑定正确
6. 关闭有未保存修改的标签，验证确认弹窗
7. 关闭最后一个标签，验证至少保留一个
8. Ctrl+Tab / Ctrl+Shift+Tab 切换标签
9. Ctrl+W 关闭当前标签
10. 修改标签内容后，验证标签圆点指示器显示