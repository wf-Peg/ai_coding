# 收件箱剪藏列表：下拉文案修正 + 选择区高级过渡 + 删除即时刷新

> 状态：✅ 已实现并验证（浏览器模式验证通过：下拉面板/文案/选中高亮/动画/空态卡片/无 JS 报错；删除与日报按钮的确认交互为安全起见未由自动化点击，属运行期人工一步验证项）

## Summary

围绕「收件箱」模块（`frontend/clip.html`，由 `index.html` 的 `clipFrame` 内嵌加载）的剪藏列表做三处改造，全部是前端改动（HTML / CSS / JS），不动 Java 后端：

1. **下拉选择区文案修正**：工作流筛选下拉由「收件箱（待整理）/ 仅已整理 / 全部流程」改为「待整理 / 已整理 / 全部剪藏」（用户已确认）。
2. **选择区切换交互动画升级**：把原生 `<select>` 换成自定义高级下拉面板（缩放+淡入、选项交错浮现、选中高亮、毛玻璃、键盘支持）；切换筛选时列表柔和交叉淡入 + 条目交错入场，计数徽章弹出动画；**空状态（暂无剪藏内容）样式与列表行风格统一**，消除「有数据/空数据」切换的突兀感。**列表切换为单次抽屉滑入**（不做独立退场）：切换时新列表在同一帧内替换旧列表并整体滑入（`.switching` 400ms 完整淡入 + `.item-entrance` 条目交错入场 36ms 步进/0.36s 时长），无空白间隙，避免「先退场再入场」被感知为两次刷新；`listTransitionSeq` 令牌丢弃内容不变时的过期重渲染。计数徽章与下拉选中值均用 `--app-ease-smooth` 柔和浮现（去掉弹簧过冲），`#clip-count` 用等宽数字 + `min-width` 固定宽度，避免数字位数变化推动周边重排。
3. **删除即时可见修复**：删除（单选/批量）后，由于 Electron 本地索引（`local-index:list-by-type`）靠文件 watcher 增量同步（约 800ms 滞后），紧随其后的 `fetchClips()` 仍会读到含已删条目的旧数据，导致被删剪藏「复活」，用户需手动刷新才能看到已删除。通过会话级 `softDeletedIds` 墓碑集合过滤 + 批量删除也补上淡出右移动画，保证删除后列表即时、稳定地反映结果。
4. **额外（用户补充）**：收件箱头部「整理」按钮（`#organize-btn`，位于「整理收件箱」右侧、周报左侧）文案改为「日报」，图标由闪电换成日报/文档类图标（行为不变：`organizeContent()` → `POST /api/clip/organize` 生成今日日报）。

---

## Current State Analysis

- 收件箱 = [clip.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/clip.html)（iframe 内嵌），头部为收件箱 brand + 动作行。
- 下拉选择区：[clip.html#L440-L455](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/clip.html#L440-L455) `.list-controls` 内：`#workflow-filter`（原生 select，选项为 收件箱（待整理）/ 仅已整理 / 全部流程）+ `#clip-count` 计数。
- 筛选切换入口：[clip-shared.js#L625-L628](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-shared.js#L625-L628) `workflowFilter.addEventListener('change', fetchClips)`。
- 列表重建：[clip-list.js#L170-L251](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L170-L251) `fetchClips()`（含 `seq` 竞态保护、workflow 过滤、排序）；[clip-list.js#L271-L381](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L271-L381) `renderClipList()` 用 `clipItemsContainer.innerHTML=''` 硬清空重建 → 生硬、无过渡；计数在 [clip-list.js#L284](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L284) `clipCountElement.textContent = clips.length`。空列表在 [clip-list.js#L287-L295](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L287-L295) 渲染 `.empty-state`。
- 空状态样式与列表行的割裂：[clip.css#L2482-L2505](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/clip.css#L2482-L2505) `.empty-state`（白底卡片 + 2px dashed 边框 + 80px 大留白 + 1.8rem Noto 衬线 h3）vs 列表行 `.clip-item`（透明无边框、14px 内边距、12px 圆角）→ 筛选切到空数据时视觉跳变突兀。`.empty-state` 同样被错误态 [clip-list.js#L244-L249](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L244-L249) 复用。
- 单条删除：[clip-actions.js#L282-L316](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-actions.js#L282-L316) `deleteClip` → `axios.delete` → `animateRemoveClipItem`（240ms 淡出右移）→ `fetchClips()` → 撤销 toast（6s）。撤销 `undoDeleteClip` 用缓存数据 `POST /add` 重建。
- 批量删除：[clip-sync.js#L606-L640](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-sync.js#L606-L640) `batchDeleteClips` → `Promise.all(axios.delete)` → `fetchClips()` → 撤销 toast。**无逐条淡出动画**。
- 本地索引数据源：[clip-shared.js#L219-L230](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-shared.js#L219-L230) `listClips()` 优先走 `window.electronAPI.localIndex.listByType('clip')`（SQLite 本地索引），REST 兜底；本地索引变更经 [electron/main.js#L6321](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L6321) 的文件 watcher `startWatcher` 增量 rescan（约 800ms 级异步）。删除只打 REST、不动本地索引 → `fetchClips` 立即读到包含已删 id 的旧数据 → 剪藏复活。
- 「整理」按钮：[clip.html#L227-L230](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/clip.html#L227-L230) `#organize-btn`（⚡ 图标 + 文本「整理」，title「整理今日内容」）；行为 [clip-actions.js#L519-L548](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-actions.js#L519-L548) `organizeContent()`。
- 主题 token：[design-tokens.css](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/design-tokens.css)（`--app-duration-*`、`--app-ease-smooth`、`--app-ease-out-expo`、`--app-surface-subtle`、`--app-primary*` 等），约束见 project_memory「UI animations must use existing theme tokens」。

---

## Proposed Changes

### 1. 下拉选择区：文案 + 自定义高级下拉面板

**文件：** `frontend/clip.html`、`frontend/styles/clip.css`、`frontend/js/clip-shared.js`

#### 1a. HTML（`clip.html`）
把 `.list-controls` 中的原生 `<select id="workflow-filter">` 替换为「自定义下拉 + 隐藏 select（值载体，保留既有 JS 读取） + 计数徽章」结构：

- 隐藏 select 保留（`class="workflow-filter"` + 新 `wf-hidden`，`display:none`；其 value 仍是 `fetchClips` 的数据源），选项文案更新为三组新文案。
- 新增自定义下拉：
  - 触发器按钮 `#workflow-filter-trigger`（显示当前选项文本 `#workflow-filter-label` + 旋转箭头 chevron）。
  - 下拉面板 `#workflow-filter-menu`（`role="listbox"`，内含 3 个 `role="option"` 按钮，`data-value` 与隐藏 select 一致；选中项带勾选图标 + 高亮）。
- `#clip-count` 计数：文案由纯数字改为「N 条」（配合 3c 的 JS 改动）。

#### 1b. CSS（`clip.css`）
下拉面板采用「高级感」样式与动画（全部用现有 token）：
- 触发器：`height:34px`、圆角 `10px`、`background: var(--app-surface-subtle)`，hover/展开时边框与文字过渡到 `--app-primary`，箭头使用 `rotate(180deg)` 过渡。样式可复用/微调现有 `.workflow-filter` 风格。
- 面板：`position:absolute; top:calc(100%+8px); right:0; min-width:172px`；`background: color-mix(in srgb, var(--app-surface) 88%, transparent)` + `backdrop-filter: blur(14px)`；`border:1px solid var(--app-border)`、`border-radius:12px`、柔和阴影；进场动画 `wfMenuIn`（`opacity 0→1`、`translateY(-6px) scale(.98)→1`，`transform-origin: top right`，时长 `var(--app-duration-panel)`、缓动 `var(--app-ease-out-expo)`）。
- 面板选项：行式、圆角 `8px`、hover 背景 `var(--app-surface-hover)`；选中项文字/勾选图标用 `--app-primary` + 浅底 `--app-primary-soft`；交错入场用 `animation: wfItemIn ... both; animation-delay: calc(var(--i) * 28ms)`（JS 注入 `--i`）。
- 隐藏 select：`.wf-hidden { display:none; }`。

#### 1c. JS（`clip-shared.js`）
- 移除 `workflowFilter.addEventListener('change', fetchClips)` 或保留（见下）。新增下拉交互初始化：
  - 打开/关闭：点击触发器 toggle（`aria-expanded` 同步）；关闭逻辑：`Escape` 键、外部点击（复用 `document.addEventListener('click', ...)` 模式，与 `closeAllMoreActions` 同思路）。
  - 选择：点击 option → 同步隐藏 select 的 `value` + 触发 label → `workflowFilter.value` 变更后 **dispatch `change` 事件**（保持旧 listener 生效）或直接调用过滤切换方法（见 2）。
  - 键盘：触发器的 `Enter/Space` 开关，面板内 `ArrowUp/Down` 移动焦点 + `Enter` 选中（轻量实现）。
  - 初始化 label 文案 = 当前选中 option 的文本。
- 建议把原 `change` listener 改为调用 clip-list.js 暴露的「带过渡的切换入口」（见 2），避免 `showSkeleton`/硬刷。

> 说明：保留隐藏 `<select>` 是为了自底向上与既有 `fetchClips`（`document.getElementById('workflow-filter').value`）、`workspace 相关筛选` 等任意读取点兼容，改动面最小、零后端影响。

### 2. 列表切换过渡（生硬 → 柔和 + 交错入场）

**文件：** `frontend/js/clip-list.js`、`frontend/styles/clip.css`

#### 2a. JS（`clip-list.js`）
- `fetchClips(opts)` 与 `renderClipList(clips, opts)` 增加 `opts.animate` 开关（默认关闭，避免初始加载/2.5s pending 轮询时反复闪动）。
- 新增切换入口 `applyWorkflowFilter(value)`（挂在 window 供 clip-shared.js 调用）：
  1. 若值未变化直接返回；
  2. `fetchClips({ animate: true })`。
- `renderClipList` 当 `animate` 为真时：
  - 容器加 `.list-switching`（淡出）→ `renderClipList` 渲染完成后移除；
  - 每个 `.clip-item`（及空状态）注入内联 `--i` 并整个容器加 `.list-anim` 触发交错入场（交错上限 8~10 条，避免超长列表全部延迟）。
- `#clip-count` 更新改为 `${clips.length} 条`（[clip-list.js#L284](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L284)），并加 `count-pop` 弹出动画类（数值变化时重触发）。

#### 2b. 空状态样式与列表行风格统一（`clip.css`、`clip-list.js`）
消除「有数据 ↔ 空数据」切换的突兀感：
- **样式对齐**（`clip.css`）：列表空态改为与 `.clip-item` 一致的轻量观感——去掉白底卡片 + 2px dashed 边框 + 80px 大留白 + 1.8rem Noto 衬线 h3 的组合：改为透明背景、`border-radius: 12px`、适度内边距（约 48px）、正文用 `var(--app-text-muted)` 与列表同字号（非巨型衬线标题），配一个小巧的收件箱/空匣线条图标与一行提示文案，整体像「列表行」的延续而非独立大卡片。
- **不误伤错误态**：「获取剪藏列表失败」（[clip-list.js#L244-L249](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L244-L249)）共用 `.empty-state`。实施时给列表正常空态加专用类（如 `.list-empty`，由 [clip-list.js#L287-L295](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L287-L295) 渲染时注入）覆盖轻量样式；`.empty-state` 基类保持，错误态不受影响（仍保留醒目提示）。
- **出场动画一致**：空态与条目共用 `clipItemIn`（淡入+上移）。`renderClipList({ animate: true })` 时给空态同样加 `.list-anim` 容器入场（含交错延迟）；筛选切换（含切到空数据 / 从空数据切回）走 2c 的容器交叉淡入，两端视觉平滑衔接。

#### 2c. CSS（`clip.css`）
- `.clip-items.list-switching { opacity:0; transform: translateY(3px); }` + `transition`（`var(--app-duration-fast)`、`var(--app-ease-smooth)`）。
- `.clip-items.list-anim .clip-item { animation: clipItemIn var(--app-duration-normal) var(--app-ease-smooth) both; animation-delay: calc(var(--i) * 24ms); }`，`clipItemIn` = `opacity 0→1` + `translateY(6px)→0`。
- `.clip-count.count-pop { animation: countPop 260ms var(--app-ease-out-expo); }`（scale 1→1.28→1）。
- `@keyframes` 均放在 clip.css 既有 keyframes 区。

### 3. 删除即时可见（本地索引滞后导致「剪藏复活」）

**文件：** `frontend/js/clip-shared.js`、`frontend/js/clip-actions.js`、`frontend/js/clip-sync.js`、`frontend/js/clip-list.js`、`frontend/styles/clip.css`

#### 3a. 墓碑集合（`clip-shared.js`，在 `selectedClipIds` 附近声明）
`var softDeletedIds = new Set();`（经典 script 顺序加载，clip-shared.js 最先，全模块可见）。

#### 3b. 写入墓碑
- `clip-actions.js deleteClip`（成功分支）：`softDeletedIds.add(String(id));`（`animateRemoveClipItem` + `fetchClips` 前）。
- `undoDeleteClip` 成功回调：`softDeletedIds.delete(String(id));`。
- `clip-sync.js batchDeleteClips` 成功分支：`ids.forEach(id => softDeletedIds.add(String(id)));`；其撤销回调中 `clips.forEach(c => softDeletedIds.delete(String(c.id)));`。

#### 3c. 过滤（`clip-list.js fetchClips`）
获取 `clips` 后、workflow 过滤前插入：
```js
clips = (clips || []).filter(c => !c || c.id == null || !softDeletedIds.has(String(c.id)));
for (const id of softDeletedIds) {
  if (!clips.some(c => String(c.id) === id)) softDeletedIds.delete(id); // 源数据已不含 → 清理墓碑
}
```
- 效果：本地索引仍含已删 id 时被墓碑过滤 → 不复活；撤销（新 id 重入）不受影响；源数据最终不含该 id 后墓碑自动清理，集合不膨胀。
- 计数、空状态均随过滤后的 `filteredClips` 自然正确。

#### 3d. 批量删除补淡出动画（`clip-sync.js batchDeleteClips`）
在 `Promise.all(delete)` 成功后、`fetchClips()` 前：
```js
ids.forEach(id => {
  const it = document.getElementById('check-area-' + id)?.closest('.clip-item');
  if (it) it.classList.add('clip-item-removing');
});
setTimeout(() => fetchClips(), 240);
```
（复用 `.clip-item-removing`，与单条删除一致；240ms 对齐 project_memory 的删除动画约束。）

#### 3e. 删除动画补 transition（`clip.css`）
`.clip-item` 的 `transition` 补上 `opacity` 与 `transform`（现只有 background/border-color，导致 240ms 淡出实际是硬跳）。此为现有删除动画的隐性缺陷，一并修复，保证 3d 的淡出真实可见。

### 4. 头部「整理」按钮 → 「日报」

**文件：** `frontend/clip.html`、`frontend/js/clip-actions.js`

- `clip.html#L227-L230` `#organize-btn`：
  - 文本 `<span class="gbtn-text">整理</span>` → `日报`；
  - title / aria-label：`整理今日内容` → `生成今日日报`；
  - 图标：⚡ 闪电 SVG 换成日报/文档类图标（与周报图标风格一致的文档/笔记本线条图标，如文档+日期小标）。
- `doOrganizeContent()`（`clip-actions.js`）：loading 文案「正在整理今日内容...」等微调为日报口径（「正在生成今日日报...」），按钮行为/接口不变。
- `organizeContent()` 确认弹窗文案同步口径（「整理今日内容吗」「按分类聚合并生成整理结果」→ 对齐「生成今日日报」）。

---

## Assumptions & Decisions

- 「下拉选择区」= `.list-controls` 的 `#workflow-filter`；「切换生硬」= 原生 select 无动画 + `renderClipList` 硬清空重建 + 计数跳变 → 用自定义面板 + 列表交叉淡入/交错入场 + 计数 pop 解决（用户已确认自定义下拉方案）。
- 文案定稿（用户确认）：`待整理 / 已整理 / 全部剪藏`。
- 「整理」按钮 = `#organize-btn`（整理收件箱右侧、周报左侧，用户已确认），仅改文案+图标，行为与后端接口不变。
- 删除刷新根因 = Electron 本地索引 watcher 异步滞后导致 `fetchClips` 读到旧数据；采用前端会话级墓碑集合过滤修复，**不改后端、不改 Electron 主进程、不加 IPC**（符合用户「低成本、前端优先、不动后端」偏好）。浏览器模式（无本地索引）下墓碑为空集，逻辑零影响。
- 不动 `design-prototype/inbox-redesign-review.html`（纯设计稿，非运行代码）。

## Verification

1. 启动后端（8081）与前端静态服务：`node frontend/server.js`（端口 3001），打开 `http://localhost:3001/clip.html`（浏览器模式走 REST）。
2. 下拉选择区：
   - 选项文案显示为「待整理 / 已整理 / 全部剪藏」，默认「待整理」；
   - 点击触发器面板缩放+淡入展开、选项交错浮现、选中项勾选高亮；Escape/外部点击可关闭；Ctrl 切换后显示正确。
3. 切换筛选（如 待整理 ↔ 全部剪藏）：列表柔和交叉淡入 + 条目交错入场，无闪烁/抖动；计数徽章弹出并显示「N 条」；选中态被清除。
4. 空状态：
   - 切到无数据的筛选（如「已整理」无内容）时，「暂无剪藏内容」以轻量列表行风提示淡入（与 `.clip-item` 观感一致，无白卡/dashed 边框/巨型衬线标题），与有数据态平滑衔接、无突兀跳变；
   - 从空态切回有数据态同样平滑；
   - 后端不可用时错误态「获取剪藏列表失败」仍保持醒目可读（未被轻量化误伤）。
5. 删除：
   - 单条删除：淡出右移动画（240ms）→ 列表即时刷新 → 撤销 toast 6s；不点撤销，被删条目不再出现（本地索引场景下也不「复活」），无需手动刷新；
   - 批量删除（勾选多条 → 底部浮动栏删除）：逐条淡出动画 + 计数即时减少 + toast「已删除 N 条」；
   - 撤销：条目恢复（新 id 重入），计数回增；再次删除重复生效。
6. 日报按钮：`#organize-btn` 显示「日报」+ 新图标，点击仍弹确认并调用 `POST /api/clip/organize`（后端在跑时观察 loading 文案与完成通知）。
7. 回归：`fetchClips` 轮询（pending 剪藏）与初始加载无多余入场动画；≤768px 下 `.list-controls` 宽度 100%、下拉可点；深色/浅色主题下下拉面板观感正常。