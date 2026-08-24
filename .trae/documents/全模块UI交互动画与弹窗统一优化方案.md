# 全模块 UI 交互、动画与弹窗统一优化方案

## 一、摘要 / Summary

本方案对桌面端（Electron + 前端 `frontend/`）做出**一次跨模块的 UX 统一与打磨**，聚焦三个方向：

1. **弹窗样式统一**：把散落在各模块的重复 toast / 确认框 / 弹窗 / 遮罩收敛到一套基于 `design-tokens.css` 主题变量的共享组件上，杜绝内联样式与各写各的。
2. **交互动画统一**：用现有 `--app-ease-*`、`--app-duration-*` 曲线补齐 hover、视图切换、弹窗开关、空态/加载态的过渡动画，尊重 `prefers-reduced-motion`。
3. **报错响应统一**：移除 `window.confirm` / `window.alert`，统一友好的错误提示、加载失败 / 空状态 / 离线提示，复用 `friendlyError` 式文案。

核心手段是**新建一套轻量共享 UI 层**（不新增重型依赖），再**按模块分批接入**，每批可独立验收，避免一次性改动过大失控（遵循项目「轻量、低占用、只做核心好用功能」的偏好）。

## 二、现状分析 / Current State Analysis

### 2.1 架构
- 主框架壳：`frontend/index.html`，顶栏 5 个视图（编辑/工作台/剪藏/工具/设置），每个视图是一个 `.view-panel` 内嵌 `<iframe>`（见 [index.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L644-L649)）。
- 主题 token 系统：`frontend/styles/design-tokens.css`，已含 light/regular/dark 三套、完整色板、阴影层级、动画曲线与时长（`--app-ease-*` / `--app-duration-*`），是统一的基础。
- 工具子模块：tools.html 的 `#overlay` 通过 iframe 加载各子工具页（wiki/vault/knowledge/learning-plan/data-observability/pdf/password）等，均有独立 html/css/js。

### 2.2 已发现的重复/不一致点（Grep 实测）
- **Toast 实现至少 4 套**：`index.html#showToast`（L1587，内联样式）、`global-notification-bar`（L448-L509）、`tools.html#thToast`（L12，内联样式）、`editor.html #toast`，以及 knowledge-detail/clip-sync 等各自 showToast。
- **确认弹窗至少 3 套**：`tools.html#thConfirmMask`、`th-modal-mask`、`data-observability.html#obs-modal`，各按钮样式、间距、圆角口径不一。
- **原生 confirm/alert 残留**：`frontend/` 下 25 个文件共 474 处 modal/toast/confirm 相关引用；部分模块仍直接用 `window.confirm`/`window.alert`。
- **空态/加载态口径不一**：有 `th-empty`/`th-loading`/`th-spinner`、`section-empty`、`obs-*`、`exception-empty` 等多种写法，样式视觉不统一。
- **动画**：204 处 `animation`/`@keyframes` 散落在 22 个文件，命名与缓动不统一；多数模块弹窗开合无动画。
- **主题适配不全**：`tools.html` 等大量使用内联样式或 `#3f8cff` 等硬编码色值，仅部分写 `html[data-theme="dark"]`，与 `--app-*` 主题 token 未对齐。

### 2.3 直接复用基础
- 主题变量、阴影、缓动、时长 token 已齐全，无需发明。
- `index.html` 已有 `friendlyError()`（网络错误友好化）可抽离复用。
- 顶栏导航 `data-view`、视图切换 `renderView()`/`MODULE_BACK_VIEWS` 逻辑已存在，可只补动画。

## 三、拟变更 / Proposed Changes

### 阶段 A：建立共享 UI 层（基石）

**A1. 新建 `frontend/styles/ui-common.css`**
基于现有 `--app-*` token，定义一套统一组件类（全部用 token，不用硬编码色值，自动适配 light/dark/regular）：

- **Toast 通知**：`.ui-toast`（顶部或底部滑入），类型 `.ui-toast--success/--error/--warning/--info`，含关闭按钮、自动消失、图标。
- **确认/提示弹窗**：`.ui-modal-backdrop` + `.ui-modal`（标题 `.ui-modal__title`、正文、操作区 `.ui-modal__actions`）；按钮 `.ui-btn`、`.ui-btn--primary`、`.ui-btn--ghost`、`.ui-btn--danger`；`.ui-modal--alert`（仅确定）与 `.ui-modal--confirm`（取消+确定）。
- **空状态**：`.ui-empty`（图标、标题、说明、可选动作按钮）。
- **加载态**：`.ui-loading`（.ui-spinner）与骨架屏 `.ui-skeleton`。
- **离线/错误横幅**：复用并规整 `.ui-notice--error/--warning`。
- **表单统一**：`.ui-input`、`.ui-textarea`、`.ui-select`、`focus-visible` 高亮环（`outline` 用 `--app-primary`）。
- **动画工具类**：`.ui-fade-in`、`.ui-slide-up`、`.ui-pop`、`.ui-scale-in`，统一使用 `--app-ease-smooth`/`--app-duration-normal`，并包裹 `@media (prefers-reduced-motion: reduce)` 关闭位移/缩放动画。

**A2. 新建 `frontend/js/ui-common.js`**
暴露全局 `window.UI`，纯原生、无依赖：
- `UI.toast(msg, {type, duration})` —— 动态创建 `.ui-toast`，自动入列、自动消失、可手动关闭。
- `UI.confirm({title, message, okText, cancelText, danger})` —— 返回 Promise，替换 `window.confirm`。
- `UI.alert({title, message})` —— 替换 `window.alert`。
- `UI.empty(el, {icon, title, description, actionLabel, onAction})` —— 渲染空态。
- `UI.loading(el, show)` —— 渲染/移除加载态与骨架屏。
- `UI.friendlyError(err)` —— 抽取 `index.html#friendlyError` 逻辑统一带出（网络错误 → 友好中文）。
- 全局挂载一个 `<div id="ui-root">` 承载 toast/modal，避免与各模块 DOM 冲突。

### 阶段 B：主框架壳接入（index.html）

**B1.** 引入 `ui-common.css` / `ui-common.js`。
**B2.** `showToast()`（L1587）改走 `UI.toast`；`global-notification-bar` 保留但内部复用 `.ui-notice--*` 样式口径与动画曲线，避免两套并存突兀。
**B3.** 视图切换动画：给 `.view-panel` 显示/隐藏时叠加 `.ui-fade-in` / 轻微位移（用 `--app-ease-out-expo`、`--app-duration-panel`），使切 Tab 更顺滑，仍是 `opacity+transform+visibility` 方案，不破坏现有 JS 状态机。
**B4.** 顶栏 `.nav-btn` 补齐 hover/active 过渡与 `focus-visible` 高亮，统一用 token。
**B5.** 右键菜单/后端启动等处的 `window.confirm` → `UI.confirm`。

### 阶段 C：各业务模块分批接入（每批可独立验收）

按「先高频、后低频」分批，每批同一流程：顶部 `<link ui-common.css>` + 引入 `ui-common.js` → 替换本模块自建 toast/modal/confirm → 空态/加载态统一 → 补交互动画 → 复用 `UI.friendlyError`。

1. **剪藏模块**（`clip.html` + `js/clip-*.js`）：`showToast` → `UI.toast`；确认删除/待办 → `UI.confirm`；列表空态 → `UI.empty`；卡片 hover 动画。
2. **工具模块**（`tools.html` + `js/tools-core.js`）：`thToast`/`thConfirmMask`/`th-modal` → 统一 `UI.toast`/`UI.confirm`/`.ui-modal`；`agentInstallMask` 吸旧风格；卡片 hover 抬升与菜单动画对齐 token；导入/提示词弹窗开合动画。
3. **编辑器模块**（`editor.html` + `js/editor.js` + `js/editor-*.js`）：`#toast`、词典/模态框 → 统一组件；`UI.friendlyError` 替换原生报错；状态栏/抽屉动画对齐。
4. **工作台模块**（`workspace.html` + `js/workspace.js`）：其自建 toast/confirm 及空态 → 统一组件；规则卡片交互动画。
5. **设置模块**（`settings.html` + `js/settings.js`）：折叠面板动画、保存按钮、确认重置 → `UI.confirm`；表单控件统一 `.ui-*`。
6. **工具子页面**（wiki/vault/knowledge / learning-plan / data-observability / pdf / password 等）：`window.confirm`/`window.alert` → `UI.confirm`/`UI.alert`；各自空态/加载态/错误态对齐 `.ui-*`；`obs-modal` 等本地弹窗改引共享 `.ui-modal`；补弹窗开关动画；`UI.friendlyError` 统一网络报错文案。
7. **多主题校验**：每个改动页面在 light/regular/dark 三主题下核对，移除硬编码色值（如 `#3f8cff`）。

### 阶段 D：动效与细节打磨（贯穿）
- 通用按钮/卡片 `transition` 统一用 `--app-duration-fast/normal` + 既有缓动。
- 弹窗加入场/退场动画、遮罩淡入淡出。
- toast 滑入滑出，避免闪现。
- 空态插画/图标与 loading 过渡更顺滑。
- 全面尊重 `prefers-reduced-motion`。

## 四、假设与决策 / Assumptions & Decisions

- **采用共享 UI 层方案**（用户跳过了澄清，按其偏好的“先建共享层再铺开”推荐做法执行）。
- **纯原生实现**，不引入新依赖（符合“轻量、低占用”偏好）。
- **分阶段交付**，每批可独立验收后再进下一批。
- 优先级：弹窗统一 → 报错统一 → 交互动画；整体覆盖全模块但分批落地。
- 不动后端；仅改 `frontend/` 与（必要时）`electron/` 下与 toast/modal 交互相关的少量渲染逻辑。
- 不以 `node_modules`、第三方 min.js（chart/mermaid/d3 等）为改动对象。

## 五、验证 / Verification

- 每个改动 JS 文件执行 `node --check <file>` 通过。
- `frontend/server.js` 静态服务或主框架启动后，逐一在浏览器/桌面端打开：index（含 5 大视图）、clip、tools、editor、workspace、settings，以及各工具子页。
- 三主题（light/regular/dark）下逐一核对 toast/弹窗/按钮/空态/加载态视觉一致、无硬编码色。
- 触发错误路径：停掉后端 → 网络报错均为友好中文；确认/删除弹窗无原生 `confirm`/`alert`。
- 开启系统“减弱动态效果”后动画退化为淡入/无位移，不影响可用性。
- 回归：视图切换、抽屉互斥、工具 overlay 返回按钮、模块返回按钮（`MODULE_BACK_VIEWS`）行为不变。
- 交互自查：toast 可手动关闭并自动消失；modal 支持 Esc 与遮罩点击关闭（confirm 除外）；`focus-visible` 键盘可达。

## 六、注意 / Notes
- 大量改动，务必分批提交，每批遵循项目 `commit_history.log` 记录约定。
- 优先保证视觉与原子态稳定，不做花哨堆砌；保持与现有 Notion/Obsidian 级观感一致。