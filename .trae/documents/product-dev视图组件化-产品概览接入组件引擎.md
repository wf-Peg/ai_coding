# product-dev 视图组件化：产品概览接入组件引擎

## Context（背景）

「全部概览」已升级为可自定义拼装的组件面板（`window.WB` 引擎，拖动换位/缩放/增删/紧凑/设置弹窗/多工作台独立布局）。「产品概览」（workspace.html 侧边栏 ⚙ 入口 → `#productDevView`）仍是静态写死布局，本次将它的「总览」tab 接入同一 WB 引擎，使其与「全部概览」平级：可自定义拼装、布局持久化（独立 localStorage key）。

范围：仅组件化「总览」tab（dashboard）。需求看板/归档 tab、标签筛选、二期 graph/timeline 保持不变。数据仍来自只读接口 `/api/workspace/feature-points` + `/iterations`，组件布局存 localStorage，数据不上后端。

## 架构决策

**单例引擎换板**：WB 是单例（一个 board / 一份 state / 一个 STORAGE_KEY）。overview 与 product-dev 总览共用同一 WB 实例，视图切换时更换挂载容器与布局命名空间。

- 引擎新增 `detachBoard()`：persist 旧布局 → 逐个调用旧组件的 `destroy` 回调 → 清空 `cards/state`、清理 settle 定时器 → **disconnect 旧 ResizeObserver 并重建**（现状 mount 每次 `new ResizeObserver().observe(board)` 从不断开，换板后旧 observer 会造成幽灵重排）。
- `mount(el, cfg)` 增加可选 `cfg.layoutKey`（挂载前切换 STORAGE_KEY，解决先 mount 后 setLayoutKey 顺序错误）与 `cfg.scope`。
- `register(def)` 增加 `scope`（默认 `'overview'`）；`getRegistered(scope)` 支持过滤（缺省返回全部，兼容现状）。
- **守卫 `onClickWidgetWsCtx` / `fillWidgetWsCtx`**：新增模块级 `activeBoardScope`，仅当 `activeBoardScope==='overview'` 时才执行 overview 工作台下拉的 `setLayoutKey`，防止切到 pd 板后误切换其布局。

**组件划分（9 个 pd 组件，scope:'productdev'，id 均加 `pd-` 前缀）**：每张图复用现有 `makeChartSlot(el)`（div.wb-chart + canvas）模式，chart 实例登记到 `pdChartInstances`（widgetId→Chart），组件 `destroy` 回调销毁对应实例（替代现状 loadProductDev 开头的全量 destroy）。

| id | 标题 | defaultSize (col,row,w,h) | 内容 |
|----|------|------|------|
| pd-stat-cards | 产品数据概览 | (0,0,4,1) min(2,1) | 9 张统计卡（.pd-dash-card 复用） |
| pd-chart-phase | 各阶段需求分布 | (0,1,2,2) | doughnut 环形图 |
| pd-chart-todo | 任务完成率 | (2,1,2,2) | 进度环 + 中心百分比 |
| pd-chart-knowledge | 知识积累趋势 | (0,3,2,2) | 折线图 |
| pd-chart-layer | 模块分布 | (2,3,2,2) | 横向柱状图 |
| pd-activity | 最近活动 | (0,5,2,2) | 活动列表，点击弹详情 |
| pd-chart-tags | 热门标签 | (2,5,2,2) | 横向柱状图 |
| pd-ai-archive | 牛马记录 | (0,7,2,2) | 牛马卡列表，展开/收起 |
| pd-task-list | 任务状态 | (2,7,2,3) | 自带 全部/已完成/待完成 筛选，点击弹详情 |

## 改动点

### A. frontend/js/workbench-widgets.js
1. `registry` 条目存 `scope`（`def.scope||'overview'`）。
2. 新增 `detachBoard()`（mount 到不同容器时/`destroy()` 时调用）：`persist()` → 遍历 state.widgets 调 `registry[id].destroy(cards[id])` → 清 `cards/state/editing/settleTimer/settleEl` → disconnect 并置空 `ro` 变量。
3. `mount(el, cfg)`：开头 `if (board && board !== el) detachBoard()`；`STORAGE_KEY = (cfg&&cfg.layoutKey) || STORAGE_KEY`；`editing=false`；保存 `ro = new ResizeObserver(...)` 到模块变量。
4. `getRegistered(scope)`：缺省返回全部，传入则按 `def.scope` 过滤。
5. `destroy()` 复用 detachBoard 语义（保持 api 兼容）。

### B. frontend/workspace.html
1. 「总览」tab（L266-313）内 `.pd-dashboard`、`.pd-chart-row`、两个 `.pd-section`、`.pd-task-list-section` 整体替换为 `<div class="wb-board" id="pdWidgets"></div>`。
2. `.pd-header-actions`（L250-253）增加紧凑按钮 `#pdWidgetCompactBtn`、自定义按钮 `#pdWidgetEditBtn`（含 `<span id="pdWidgetEditBtnText">自定义</span>`），复用 `.wb-edit-btn` 样式。
3. `.pd-shell` 内追加 `.wb-palette#pdWidgetPalette`（复制 overview 的 palette 结构：`#pdWidgetPaletteList` + `#pdWidgetPaletteClose`，样式复用）。

### C. frontend/js/workspace.js
1. 新增模块级状态：`var pdWidgetsData = null`（{stats, phaseDist, todoCompletion, knowledgeTrend, layerDist, tagCounts, allTasks, activities, aiRecs}）、`var pdTaskFilterState='all'`、`var activeBoardScope='overview'`。`pdChartInstances` 改为 `widgetId→Chart`。
2. 新增 `registerPdWidgets()`：注册上表 9 个组件（scope:'productdev'，含 defaultSize/minSize/destroy）。图组件按 `renderTypeChartWidget`（L230-249）同款模式：`el` 参数化 + `makeChartSlot`。任务/活动/牛马组件各自内部实现筛选或展开逻辑（不再依赖 `document.querySelector('.pd-task-list-filter.active')` 与固定容器 id）。注册在 init 中与 `registerOverviewWidgets()` 并列调用（注册与 mount 分离）。
3. 新增 `switchWbBoard(scope)`：
   - overview → `WB.mount($('overviewWidgets'), {cols:4,rowH:170,scope:'overview', layoutKey: widgetWsLayoutKey($('widgetWsCtx').value||'')})`
   - productdev → `WB.mount($('pdWidgets'), {cols:4,rowH:170,scope:'productdev', layoutKey:'productdev_widget_layout_v1'})`
   - 更新 `activeBoardScope`；重置两视图编辑按钮（remove `.on`、文本回「自定义」）、关闭两侧 palette。
4. `showView()`：overview 分支与 product-dev 分支在显示视口后调用 `switchWbBoard(scope)`；product-dev 分支**先 mount 后 `loadProductDev()`**（保证 refreshAll 有落点）。
5. `loadProductDev()` 改造：
   - 删除 `renderPdDashboard`/`renderPdCharts` 调用与该两函数；调用点处把统计数据组装进 `pdWidgetsData`（stats 卡 HTML 逻辑内联进 pd-stat-cards 组件；5 张图的 Chart 构造拆到对应组件函数）。
   - `renderPdTaskList`/`renderPdActivities`/`renderPdAiArchive` 改签名为 `(el, ctx)` 的组件渲染函数，从 `pdWidgetsData` 取数；`pdAiArchiveExpandecd` 逻辑保留，`pdAiArchiveToggle` 用组件内 `el.querySelector` 查询。
   - 计算完成后（原 renderPd* 调用处）→ `if (window.WB && activeBoardScope==='productdev') window.WB.refreshAll();`
   - catch 分支（L2460-2463）改为写空 `pdWidgetsData` + `refreshAll()`。
6. Palette / 编辑态镜像：
   - `openPalette(scope)` 参数化：meta 表覆盖 overview+pd 两套组件，`WB.getRegistered(scope)` 过滤；容器按 scope 取 `$('widgetPalette')` 或 `$('pdWidgetPalette')`。
   - 新增 `openPdEditMode()` 镜像 L377-383（target `pdWidgetEditBtn`/`pdWidgetEditBtnText`）。
   - init 绑定：`pdWidgetEditBtn`→openPdEditMode、`pdWidgetPaletteClose`→pd 版 closePalette、`pdWidgetCompactBtn`→`WB.compact()`。
7. 删除 L3604-3613 `#pdTaskFilters` click 绑定（移入组件）；`onClickWidgetWsCtx`/`fillWidgetWsCtx` 加 `activeBoardScope==='overview'` 守卫。

### D. frontend/styles/workbench-widgets.css（少量补充）
- `.wb-board` 上下文内的内部滚动覆盖：`.wb-body .pd-ai-archive-list{height:100%;max-height:none}`、`.wb-body .pd-task-list{height:100%;overflow:auto}`、（.wb-body 为 overflow:hidden，卡片高度由 grid 决定）。
- 其余 pd-* 类（.pd-dash-card/.pd-activity-item/.pd-iter-*/.pd-task-*/.pd-ai-toggle 等）全部复用 workspace.css 现有样式，不改。
- pd-header-actions 按钮复用 `.wb-edit-btn`（已有）。

## 不可删除清单（其它位置仍引用，组件化后保留原样）
`renderPdKanban`(L2440)、`renderPdGraph`/`renderPdTimeline`(L2443-2444)、`renderPdArchives`(L2459)、`renderPdTagFilter`(L2286)、`showPdRequirementDetail`（活动/任务/归档列表点击）、`pdIterationCountFor`/`pdKanbanCardHtml`（看板）、`aiCardHtml`/`aiSessionBadge`/`isAiSessionSource`（牛马卡）、`monthLabelOf`（统计）、`pdRequirementsCache`/`pdIterations`/`pdAiArchiveExpanded`/`pdURL`/`activePdTag`。

## 验证

1. 语法：`node --check frontend/js/workbench-widgets.js` 与 `node --check frontend/js/workspace.js`。
2. 服务已在运行（前端 3001 / 后端 8081，静态文件即时生效，无需重启）。
3. 浏览器（TRAE-browseruse 或手动）验证清单：
   - 「全部概览」→「产品概览」来回切换，两板各自布局独立、不串换；overview 原有 6 组件不丢。
   - overview 顶部 wsCtx 下拉切换工作台后再回 pd 板，pd 布局未被误切（守卫生效）。
   - pd 板编辑态：添加/移除组件、拖动换位、右下角缩放、紧凑排列、设置弹窗改标题/尺寸；刷新重进后布局保留。
   - pd 5 张图卡缩放后 chart 不叠加重建（实例正确销毁）；牛马记录展开/收起；活动/任务点击弹详情；任务筛选「已完成」后切标签/搜索仍保持选中态。
   - 阻断后端场景（fpRes 失败）pd 板显示空态不崩。