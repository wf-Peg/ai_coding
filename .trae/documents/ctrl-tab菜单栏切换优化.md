# Ctrl+Tab 菜单栏切换优化 — 实施计划

## 一、概述

### 目标
- **写作区内部**：保持现状 —— Ctrl+Tab / Ctrl+Shift+Tab 切换编辑区自己的标签页，行为不变。
- **其它所有地方**：Ctrl+Tab 切换**菜单栏**（侧边栏导航项），顺序递增到下一个菜单并循环；Ctrl+Shift+Tab 反向切换。
- 覆盖范围包括：主框架的菜单栏/标题栏/空白区，以及各模块 iframe（收件箱、工具、设置、知识库、Wiki、密码、学习计划、数据观测台等）内部聚焦时。

### 成功标准
1. 在收件箱点击空白处、或点击过侧边栏菜单后，按 Ctrl+Tab 依次循环 收件箱 → 写作 → 画布 → （沉淀区动态固定项）→ 工作台 → 工具 → 设置 → 回到收件箱。
2. 在编辑区 iframe 内按 Ctrl+Tab，仍然是切换编辑区标签页（不回退）。
3. 在「写作」视图但焦点在主窗口（例如刚点过编辑器工具栏）时按 Ctrl+Tab，仍然是切换编辑区标签页。
4. 光标位于输入框/文本域/可编辑区（如搜索框、表单、知识笔记正文）时，Ctrl+Tab **不**切换菜单，放行不拦截。
5. 各模块循环顺序与侧边栏视觉顺序一致，并自动包含用户在「显示到顶栏」中固定的动态子模块。

### 不在范围内
- 牛马（DSH Agent）是跨域侧车页面（localhost:3081），无法注入脚本，Ctrl+Tab 在其内部不生效。
- 不做快捷键可配置（不纳入 `editor-shortcuts.js` 的 DEFAULTS 配置表 / 设置页 UI）。
- 不改变编辑区自身 Ctrl+Tab 的既有实现。

---

## 二、现状分析

### 2.1 架构：主窗口 + 模块 iframe
- 主框架 `frontend/index.html` 持有左侧菜单区（`#titlebarNav`，`.titlebar-nav.sidebar`）与右侧显示区（`#mainContent`）。
- **每个模块都是一个 iframe**，例如 `#editorFrame → editor.html`、`#clipFrame → clip.html`、`#toolsFrame → tools.html`。
- 视图切换函数：`renderView(view)`（[index.html#L1712](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1712)），全局当前视图变量 `currentView`（初始化于 [index.html#L1586](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1586)）。

### 2.2 现有 Ctrl+Tab 实现（写作区内部，需保留）
[editor.js#L6050-L6061](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L6050-L6061)：

```js
document.addEventListener('keydown', event => {
  const modifier = event.ctrlKey || event.metaKey;
  ...
  } else if (modifier && event.key === 'Tab') {
    event.preventDefault();
    const next = event.shiftKey
      ? (activeTabIndex - 1 + tabs.length) % tabs.length
      : (activeTabIndex + 1) % tabs.length;
    switchToTab(next);
  }
```

该监听位于 `editor.html` 这个 **iframe 自己的 document** 里，所以只在焦点位于编辑区时生效。`switchToTab(index, recordHistory)` 定义于 [editor.js#L608](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L608)。

### 2.3 菜单栏结构（循环列表的数据源）
[index.html#L1172-L1222](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1172-L1222) 菜单按 DOM 顺序：

`工作流`(分组标题) → **收件箱 clip** → **写作 editor** → **画布 canvas** → `沉淀`(`#sidePinnedSection` 分组标题) → *（动态固定子模块，见下）* → `系统`(分组标题) → **工作台 workspace** → **工具 tools** → **设置 settings**

动态固定项由 `applyHeaderNav(list)`（[index.html#L2017-L2052](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2017-L2052)）插入到 `#sidePinnedSection` 之后，按钮类名 `nav-btn th-pinned`，同样带 `data-view`。因此 **`#titlebarNav .nav-btn[data-view]` 的 DOM 顺序 == 视觉顺序**，可直接作为循环列表。

菜单按钮的 URL 约定（见 [index.html#L2038](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2038)）：`clip` 用 `/`，其它用 `/<view>`。

### 2.4 关键约束：keydown 不会跨 iframe 冒泡
- 键盘事件只落在**当前聚焦的那个 document**。聚焦在某个模块 iframe 内部时，父窗口 `index.html` 收不到 keydown。
- 现有代码里**没有**通用的按键转发机制：只有编辑器专用的转发（父→子，[index.html#L2163-L2189](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2163-L2189)）和子→父的 `postMessage` 导航（`appNavigate`，[index.html#L1544-L1556](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1544-L1556)）。
- 结论：**要实现「各模块内部也生效」，必须在模块页里加一段转发脚本**，由父窗口统一决策。

### 2.5 现有父窗口 keydown 监听（无冲突）
| 快捷键 | 位置 |
|---|---|
| Ctrl/Cmd+Shift+R 强制刷新 | [index.html#L2681](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2681) |
| Ctrl/Cmd+K 全局命令面板 | [index.html#L3098](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L3098) |
| Ctrl/Cmd+Shift+F 全局搜索 | [index.html#L3348](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L3348) |
| 编辑器输入兜底 | [index.html#L2163](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2163) |

以上均未占用 Ctrl+Tab，无冲突。`index.html` 的主体逻辑全部位于同一个 `<script>`（[L1334-L3106](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1334-L3106)）内，函数声明可提升，故新增函数可被该脚本内的消息监听引用。

### 2.6 共享桥接脚本现状
`js/theme-bridge.js` 被 18 个页面引入（含 `index.html`、`editor.html`），但它是**主题**桥接，职责不符；`anniversary.html` 甚至未引入它。因此**新开一个专用小文件**并在需要的页面显式引入，符合本仓库「一个页面显式引入自己的桥接脚本」的既有约定。

---

## 三、改动方案

### 3.1 新增文件：`frontend/js/menu-tab-shortcut.js`

作用：在各模块 iframe 内把 Ctrl/Cmd+Tab 转发给**顶层窗口**统一决策。

```js
/**
 * menu-tab-shortcut.js — 模块 iframe 内的 Ctrl+Tab 菜单切换转发
 * 主界面是「主窗口 + 各模块 iframe」架构，keydown 只落在当前聚焦的 document。
 * 本脚本在各模块页把 Ctrl/Cmd+Tab（含 Shift 反向）转发给顶层窗口 index.html，
 * 由顶层统一决策：写作视图 → 编辑区标签切换；其它视图 → 菜单栏循环切换。
 * editor.html 不引入本脚本（写作区内部保留编辑区自身行为）。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var topWin = window.top;
  if (!topWin || topWin === window) return; // 仅在 iframe 内生效

  function isEditableTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key !== 'Tab') return;
    if (isEditableTarget(e.target)) return; // 输入框/可编辑区不拦截
    e.preventDefault();
    try {
      topWin.postMessage({ type: 'menuTabSwitch', dir: e.shiftKey ? -1 : 1 }, '*');
    } catch (err) { /* 跨域顶层（牛马侧车）时静默忽略 */ }
  }, true);
})();
```

要点：
- `window.top === window` 时直接退出，避免模块页单独打开时误触发。
- 捕获阶段（`true`）监听，优先于页面自身处理。
- 用 `window.top`（而非 `window.parent`），保证 `pdf.html` / `anniversary.html` 这类**嵌套在 tools.html 里**的页面也能转发到 `index.html`。

### 3.2 修改 `frontend/index.html`（父窗口：决策中枢）

在 `renderView` 之后（约 [L1732](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1732) 附近）新增一段自包含逻辑：

```js
// ====== Ctrl/Cmd+Tab 全局导航：写作区之外循环切换菜单栏 ======
// 菜单列表 = 侧边栏可见的 .nav-btn[data-view]，按 DOM 顺序（即视觉顺序）
function getMenuButtons() {
  return Array.prototype.slice.call(
    document.querySelectorAll('#titlebarNav .nav-btn[data-view]')
  ).filter(function (btn) { return btn.getClientRects().length > 0; });
}
function isEditableTarget(el) {
  if (!el) return false;
  var tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}
// 顺序递增循环：满则回到下标 0
function cycleMenu(dir) {
  var btns = getMenuButtons();
  if (!btns.length) return;
  var idx = -1;
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].dataset.view === currentView) { idx = i; break; }
  }
  var step = dir === -1 ? -1 : 1;
  var next = idx < 0 ? 0 : (idx + step + btns.length) % btns.length;
  var view = btns[next].dataset.view;
  renderView(view);
  if (window.history.pushState) {
    window.history.pushState({ view: view }, '', view === 'clip' ? '/' : '/' + view);
  }
}
// 写作视图：焦点在主窗口时，转发进编辑区复用其标签切换
function handleTabSwitch(dir) {
  if (currentView === 'editor' && editorFrame && editorFrame.contentWindow) {
    editorFrame.contentWindow.postMessage({ action: 'editorSwitchTab', dir: dir }, '*');
    return;
  }
  cycleMenu(dir);
}
// 场景一：焦点在主框架（菜单栏/标题栏/空白区）
document.addEventListener('keydown', function (e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key !== 'Tab') return;
  if (isEditableTarget(e.target)) return;
  e.preventDefault();
  handleTabSwitch(e.shiftKey ? -1 : 1);
});
// 场景二：焦点在各模块 iframe 内（由 menu-tab-shortcut.js 转发上来）
window.addEventListener('message', function (e) {
  var d = e.data || {};
  if (!d || d.type !== 'menuTabSwitch') return;
  if (isEditableTarget(document.activeElement)) return;
  handleTabSwitch(d.dir === -1 ? -1 : 1);
});
```

要点：
- `editorFrame`（[L1572](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1572)）与 `currentView` 在同一作用域，可直接引用。
- `idx < 0`（当前视图没有对应菜单按钮，例如未固定、经工具模块进入的知识库）时从下标 0 开始。
- 消息分支也复用 `handleTabSwitch`，因此「写作视图 + 焦点在其它 iframe」这种边界情况同样落到编辑区标签切换，与用户选择的规则一致。
- URL 约定与现有菜单点击（[L2038](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L2038)）保持一致。

### 3.3 修改 `frontend/js/editor.js`（编辑区：接受父窗口转发）

在编辑器 iframe 的消息分发链（[editor.js#L6158-L6210](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L6158-L6210)）中，新增一个分支（紧接 `editorKeyDown` 分支之后）：

```js
} else if (data.action === 'editorSwitchTab') {
  // 父窗口在写作视图、但焦点不在编辑区时转发进来：复用编辑区自身的标签切换
  if (tabs.length) {
    const dir = data.dir === -1 ? -1 : 1;
    const next = (activeTabIndex + dir + tabs.length) % tabs.length;
    switchToTab(next);
  }
}
```

要点：
- 复用既有 `switchToTab()` / `activeTabIndex` / `tabs`，与 [L6056-L6061](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L6056-L6061) 的算法完全一致。
- 编辑区自身的 Ctrl+Tab 监听**保持不动**；焦点在编辑区时父窗口收不到 keydown，因此不会双触发。

### 3.4 各模块页引入转发脚本（共 17 个文件）

在页面已有的 `theme-bridge.js` 引入行之后，追加一行：

```html
<script src="js/menu-tab-shortcut.js"></script>
```

| 文件 | 插入位置 |
|---|---|
| `frontend/clip.html` | L19 之后 |
| `frontend/canvas.html` | L459 之后 |
| `frontend/workspace.html` | L12 之后 |
| `frontend/tools.html` | L11 之后 |
| `frontend/settings.html` | L10 之后 |
| `frontend/knowledge.html` | L270 之后 |
| `frontend/wiki.html` | L554 之后 |
| `frontend/vault.html` | L274 之后 |
| `frontend/learning-plan.html` | L1015 之后 |
| `frontend/data-observability.html` | L181 之后 |
| `frontend/todo.html` | L1111 之后 |
| `frontend/pdf.html` | L367 之后 |
| `frontend/knowledge-detail.html` | L599 之后 |
| `frontend/knowledge-graph.html` | L450 之后 |
| `frontend/knowledge-editor.html` | L519 之后 |
| `frontend/knowledge-annotations.html` | L313 之后 |
| `frontend/anniversary.html` | L301 之后（该页未引入 theme-bridge，单独加在既有 script 之后） |

**不引入**：`frontend/editor.html`（写作区内部保留编辑区自身行为）、`frontend/index.html`（父窗口已自带监听）。

---

## 四、决策与假设

| 决策 | 取值 | 依据 |
|---|---|---|
| 生效范围 | 全部模块 | 用户选择 |
| 写作视图 + 焦点在主窗口 | 切换编辑区标签 | 用户选择 |
| 反向切换 | 支持 Ctrl+Shift+Tab | 用户选择 |
| 输入框/可编辑区聚焦 | 不切换（放行） | 用户选择 |
| 修饰键判定 | `ctrlKey \|\| metaKey`（且排除 `altKey`） | 与 editor.js 既有写法一致 |
| 循环列表 | `#titlebarNav .nav-btn[data-view]`，DOM 顺序，过滤不可见项 | DOM 顺序 == 视觉顺序；含动态固定项 |
| 当前视图不在菜单中 | 从下标 0 开始 | 兜底最自然（例如未固定的知识库视图） |
| 转发脚本落点 | 新建 `js/menu-tab-shortcut.js`，各页显式引入 | 与仓库「显式引入桥接脚本」约定一致；不污染 theme-bridge |
| 是否可配置 | 否，硬编码 Ctrl+Tab | 用户未要求；与 editor.js 现状一致 |
| 牛马（DSH） | 不覆盖 | 跨域侧车，无法注入；属已知限制 |

---

## 五、验证步骤

### 5.1 静态检查
1. 确认 `frontend/js/menu-tab-shortcut.js` 已创建，且 17 个页面均包含该 script 标签，`editor.html` / `index.html` **未**包含。
2. 确认 `index.html` 中 `getMenuButtons` / `cycleMenu` / `handleTabSwitch` 定义在主体 `<script>`（L1334-L3106）内，且 `editorFrame`、`currentView`、`renderView`、`titlebarNav` 均可访问。
3. 运行现有回归测试，确认无破坏：
   - `npm run test:editor-shortcuts`
   - `npm run test:editor-nav`

### 5.2 手动验证（`npm start` 启动应用）
| 场景 | 操作 | 期望 |
|---|---|---|
| 主框架空白区 | 点击侧边栏空白处 → Ctrl+Tab | 切到下一个菜单项并高亮，左侧面板随之切换 |
| 菜单栏满环 | 在「设置」上按 Ctrl+Tab | 循环回「收件箱」 |
| 反向 | Ctrl+Shift+Tab | 回到上一个菜单项 |
| 模块 iframe 内 | 进入「收件箱」，点击列表空白处 → Ctrl+Tab | 切换菜单栏（本次新增能力） |
| 输入框放行 | 聚焦收件箱搜索框 → Ctrl+Tab | 不切换菜单（本次不拦截） |
| 写作区内部 | 进入「写作」，焦点在编辑区 → Ctrl+Tab | 切换编辑区标签（行为不变） |
| 写作视图 + 焦点在主窗口 | 进入「写作」，点击编辑器工具栏 → Ctrl+Tab | 仍切换编辑区标签（用户选择的规则） |
| 动态固定项 | 在工具模块把「知识」显示到顶栏 → 在菜单栏循环 | 循环序列包含「知识」，位置在沉淀分组内 |
| URL 一致性 | 每次切换后观察地址栏 | `clip` 为 `/`，其它为 `/写作视图名` |
| 已知限制 | 进入「牛马」内部按 Ctrl+Tab | 不生效（跨域侧车，已在范围外说明） |

### 5.3 浏览器实测建议（可选、更快）
与上次排查返回按钮相同的方式：本地起静态服务 → 打开 `http://127.0.0.1:<port>/`，用脚本派发 Ctrl+Tab 键盘事件并读取 `#titlebarNav .nav-btn.active` 的 `data-view`，验证循环顺序与首尾回环；再在内嵌 iframe 破例场景下核对 `menuTabSwitch` 消息链路。注意 `browser_evaluate` 只做读取，触发交互需用原生浏览器工具。
