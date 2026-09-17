# 工作台自定义组件拼接 MVP 设计

## 一、结论先行（对齐用户意图）

> 用户意图澄清（前两轮已纠正）：不是「做纪念日日历 / 做农历 / 接后端提醒」，而是——
> **把现有「工作台」（`workspace.html` 的「全部概览」视图）改造成一个可自定义拼接区块的面板**：
> 像手机桌面长按组件那样，**拖动调位置、拖拽把手调卡片大小、增删区块**，布局本地持久化（前端 localStorage），数据不上后端。
> **纪念日提醒是其中一个组件区块**（展示今天/临期/已过），无需系统级弹窗，靠工作台组件即可「体现」。
>
> 后端当前不动、不新增接口；后续架构会演进为 TS 实现并移除本 Java 后端，因此本期**所有能力都放在前端 localStorage**。

本 MVP 的核心交付 = 一个**轻量的工作台组件系统（widget board）**，用可自定义拼装的组件网格替换「全部概览」里静态写死的仪表盘行，并把纪念日作为首发组件。

---

## 二、现状分析（Phase 1 探索结论）

| 现状 | 位置 | 说明 |
|---|---|---|
| 工作台「全部概览」静态布局 | [workspace.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/workspace.html#L70-L95) | 固定三段：`#ovDashboardCards`（stat 卡）、`#ovChartRow` 三张图（`#ovTypeChart`/`#ovTrendChart`/`#ovCoverageChart`）、`#contentList`（最近活动）。CSS 见 [workspace.css](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/styles/workspace.css#L580-L593)`.ov-dashboard/.ov-chart-row/.ov-chart-card/.ov-section`。**不支持拖动/调大小/增删**。 |
| 工作台前端逻辑 | [workspace.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/workspace.js) | 负责 `all overview / product-dev / 工作台详情`三套视图的数据拉取与渲染；图表用 `chart.umd.min.js` + `d3.min.js`。 |
| 纪念日共享内核 | [anniversary-shared.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/anniversary-shared.js) | 已提供 `window.AnniversaryShared`：`load()/getUpcoming(entries,today,days)/toReminderState()`。`getUpcoming` 注释明确「**供工作台渲染，只读**」——工作台正是纪念日预期承载点。数据在 `localStorage` 键 `anniversary_data_v1`。**无需任何后端即可渲染。** |
| 纪念日独立页 | [anniversary.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/anniversary.html) | 成熟的 CRUD 页（倒数日/纪念日、分类、提前提醒、置顶）。本期不动，作为数据源与点选跳转目标。 |
| 待办提醒调度器 | [main.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/main.js#L6376-L6420) | 轮询后端 `/api/todo/due-reminders` 弹应用内 Toast。**本期纪念日不接入此链路**（纪念日数据在前端，且用户明确不想接后端）。 |
| 顶栏 | 顶栏第2项为「工作台」，以 iframe 装载工作台页；现有 5 项固定。 | MVP 不新增顶栏项。 |

**关键约束引用（记忆）**：做核心好用功能、避免过度复杂；优先轻量/快/低占用；设计遵循现有 `--app-*` 设计 token 与工作台 `--ws-*` token；改动尽量小。

---

## 三、Trae 模板库 / 个人工作台调研（用户要求部分）

| 来源 | 可参考点 | 与本项目的差异/结论 |
|---|---|---|
| Trae **personal-workbench** 插件（本地已装 0.1.0，[skill](c:\Users\pengwenfeng\.trae-cn\plugins\trae-remote-official\personal-workbench\0.1.0\skills\personal-workbench)） | ① `CONFIG.modules` 组件注册表：每模块 `{id,type,icon,name}`，首页 dashboard 自动汇总进展；② 组件/**字段可扩展**（`fields` 数组声明即渲染表单）；③ `:root` token 一键换肤；④ 卡片 layout 变体（default/feature/quote）。 | 它是**独立单文件 HTML，数据在 localStorage，模块顺序固定，无「长按/拖动/调卡片大小」交互**。我们的 MVP 补上它缺的：**可视化拖拽拼接 + 尺寸可调 + 长按/编辑模式**。组件注册表与 token 思想直接借鉴。 |
| Trae 社区案例（Jotly / 刻记+ / 平行世界 / 家庭管理 LoveLives） | ① 日期规划：倒计时/正计时 + **农历** + 多种卡片样式；② 提醒卡/全屏闹钟/通知渠道；③ 组件卡（选项矩阵、信息卡、打卡累计）。 | 佐证「纪念日」是工作台卡片/组件的常见承载。**本期按用户要求不做农历、不做日历、不做后端通知**，只做阳历快照展示。 |
| 手机桌面组件（用户提到的范式） | 长按进入编辑、拖动换位、拖拽把手调尺寸、右上角删除、右下角加组件、布局持久化。 | 这是本 MVP 的交互范式。桌面端用「编辑模式按钮 + 指针拖拽 + 尺寸把手 + 组件面板」等价实现，不强行模拟长按。 |

**结论**：Trae 模板库的「个人工作台」提供的是**组件注册表 + 主题 token** 的参考，但**没有做可拖拽/可调尺寸/可增删的可视化拼装工作台**——这正是本 MVP 的补位点。方案直接借鉴其注册表与 token 思想。

---

## 四、MVP 方案设计

### 4.1 整体形态

在「全部概览」视图内，用一个**组件网格（widget board）** 替换原来的静态三分段，承载若干个**组件区块**；每个区块可拖动换位、拖右下角把手调大小、编辑模式下可删除，右上角「自定义」进入编辑态并可打开「添加组件」面板新增组件。**布局配置持久化到 `localStorage`，数据源全部读取已有前端存储，零后端改动。**

### 4.2 组件清单（首发 5 个）

| id | 标题 | 尺寸默认(w×h) | 数据源 | 说明 |
|---|---|---|---|---|
| `anniversary` | 纪念日提醒 | 2×2 | `AnniversaryShared.load() + getUpcoming()` | **本期核心亮点**：顶部徽标统计（今天/临期 N 项），列表今天+临期条目；空态提示「去纪念日页添加」。**
| `stat-cards` | 数据概览 | 4×1 | 现有 `#ovDashboardCards` 逻辑 | 存量数据统计卡，直接复用既有 fetch 逻辑 |
| `chart-type` | 内容类型分布 | 2×2 | 现有 `#ovTypeChart` | 存量图表，改为可移动/可调尺寸 |
| `chart-trend` | 近期活跃趋势 | 2×2 | 现有 `#ovTrendChart` | 同上 |
| `recent-activity` | 最近活动 | 4×2 | 现有 `#contentList` | 列表，可调高度 |

> `chart-coverage`（内容覆盖）本期不搬为独立组件，避免 MVP 界面过挤；可随后续「添加组件」面板在需要时加回。

### 4.3 组件引擎（widget engine）

**文件**：新增 `frontend/js/workbench-widgets.js`（引擎 + 注册表），`frontend/styles/workbench-widgets.css`（组件面板样式）。

**核心 API**：
```js
window.WB.register({ id, title, icon, defaultSize:{w,h}, minSize:{w,h}, render(el, ctx) })
window.WB.mount(container, { dashboardId, initialLayout })
window.WB.setEditMode(bool)
window.WB.addWidget(id) / WB.removeWidget(id)
```

**布局模型**（持久化到 `localStorage` 键 `workspace_widget_layout_v1`）：
```json
{ "version": 1, "cols": 4, "widgets": [ { "id":"anniversary", "col":0, "row":0, "w":2, "h":2 } ] }
```
- 网格 **4 列**（响应式：窄屏 2 列）。每个组件占 `(col,row,w,h)` 单元。
- 布局冲突处理：拖放目标被占用时，简单**右移/下移被占组件**（同列推挤），不做复杂自动排布——MVP 够用、不引入重型布局库。
- 渲染：用一个透明的绝对定位层做 `position` 计算（`col*unitW`, `row*unitH`），组件内部用 flex 自适应；chart.js 支持 responsive 重绘，调整尺寸时触发组件 `render` 重跑。

**交互**：
- 常规态：只有 `#ovChartRow` 那类的展示，**只读**，hover 不出操作项。
- 编辑态（点 overview hero 上的「自定义」按钮进入）：每个组件右上角出现 **✕ 删除** + 顶部拖动把手（整卡可拖），右下角出现 **尺寸把手◇**；底部/右上角出现 **「+ 添加组件」** 面板（列出未放置组件，点选即入首位空闲位）。再次点击「完成」退出编辑态并保存布局。
- 拖动与尺寸调整用 Pointer Events（pointerdown/move/up），移动中按指针坐标换算目标 `(col,row)`，松手落位；尺寸调整按指针位移换算 `(w,h)`，受 `minSize` 与网格边界约束。

### 4.4 纪念日提醒组件详情（`anniversary`）

```
┌ 纪念日 提醒                   [今天 1 · 临期 2]
├ 今天    我们在一起          · 今天
├ 临期(2) 项目上线 退休日      · 剩余 3 天
└ …（空态：去「纪念日」页添加第一个）
```
- `render(el)` 内调用 `AnniversaryShared.load()` → `getUpcoming(entries, todayStr, 7)` 取今天+临期（`upcoming` 判定 `diff<=0 && remaining<=remind`），顶部统计由 `toReminderState` 汇总。
- 每条目点击 → 打开「纪念日」工具页（iframe 内跳转该工具入口；具体打开方式复用现有的工具打开机制，见 5 假设#3）。
- **不**调用浏览器 `Notification`、**不**接入主进程 Toast——MVP 以工作台面板「可见即提醒」为准（符合用户「体现到工作台」的诉求）。

### 4.5 存量区块迁移方式

不重写 `workspace.js` 的取数与图表逻辑，**只在入口做适配**：
- 保留现有 `buildDashboardCards() / buildCharts() / buildContentList()` 等函数（它们渲染到已有元素）。
- 增加 `registerOverviewWidgets()`：把上述三块的**渲染函数封装为组件 `render(el, ctx)`**，`render` 时把 `el` 作为容器传入原函数或调用原函数但定位到 `el` 内部元素；组件挂载后首次即渲染。
- 调整尺寸/换位时重新调用对应 `render`（图随容器重绘）。

---

## 五、需改动的文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/js/workbench-widgets.js` | **新增** | 组件注册表 + 网格布局引擎 + 拖拽/调尺寸/编辑态 + localStorage 持久化 |
| `frontend/styles/workbench-widgets.css` | **新增** | 组件卡片、拖动把手、尺寸把手、编辑态高亮、添加面板样式（全用 `--ws-*`/`--app-*` token） |
| `frontend/workspace.html` | 修改 | 「全部概览」里 `#ovDashboardCards`/`#ovChartRow`/`#contentList` 外部包裹一个 `#overviewWidgets` 容器；在 hero 上加「自定义/完成」按钮 + 添加组件面板容器；引入上述两个新文件 |
| `frontend/js/workspace.js` | 修改 | ① `registerOverviewWidgets()` 把存量区块注册为组件并接渲染函数；② 新增 `anniversary` 组件渲染；③ 接线编辑态按钮与添加面板；④ 移除或保留原静态渲染兜底（保留作为非组件环境回退） |
| `frontend/styles/workspace.css` | 修改（少量） | 保障 `.ov-dashboard/.ov-chart-row/.ov-section` 在被组件容器包住时布局不冲突；窄屏断点适配 |

> **明确不做（本期）**：后端新接口、主进程 Toast 接入、农历/日历、产品概览（product-dev）视图组件化、多工作台各自独立布局、图表重排算法优化、组件设置弹窗。

---

## 六、假设与决策（decision list）

1. **数据放前端 localStorage，零后端改动**——后端近期将被 TS 重写并移除，故本期所有能力前置化。（用户已定）
2. **纪念日以「工作台组件」体现，而非系统通知/Toast**——符合「能提醒到工作台、不想接后端」。（用户已定）
3. **组件点击打开「纪念日」页**走现有工具打开机制（iframe 内跳转对应工具路由）；若无现成机制，则本轮退化为「点击高亮/展开详情」，跳转留到下阶段与工具打开方式一起做——实现时以代码里已有的打开方式为准，不新增后端口径。
4. **不做农历**——拖到后续迭代（数据模型已含 `date`，加 `dateType`+农历转换不影响本次）。
5. **布局持久化键**：`workspace_widget_layout_v1`（独立键，避免与记忆里其它配置冲突）。
6. **网格 4 列 / 窄屏 2 列**，组件最小 1×1，最大不超网格；冲突用「同列推挤」处理，不引入重型布局库。
7. **保留存量静态渲染为回退**：组件系统初始化失败时，overview 仍能按原样渲染，避免回归。

---

## 七、验证（Verification）

1. **静态校验**：前端服务（8081）重启后 `GET /` 相关页面 200；`workspace.html` 正常加载无 JS 报错（control-crash 检查）。
2. **功能验收**：
   - 点击「自定义」进入编辑态 → 能拖动 `anniversary` 组件到其它位置、能被右侧/下方组件让位。
   - 拖动右下角把手能把 `anniversary` 调成 1×1 与拉大，超出网格被约束。
   - 编辑态能删除组件；删除后「+ 添加组件」面板可再添加。
   - 刷新页面后布局从 `localStorage` 恢复（不动其它数据）。
   - 「纪念日提醒」组件正确显示今天/临期条目（在 `anniversary.html` 造两条临期数据验证）；空库显示空态文案。
   - 存量三区块（stat / type / trend）作为组件仍正常渲染，切到非编辑态只读良好。
3. **浅色/深色主题下**组件卡片样式协调（沿用 `--ws-*`、`--app-*` token），滚动条沿用全局窄滚动条规范。
4. **回归**：产品概览（product-dev）视图不受影响；待办提醒调度器不动。

---

## 八、MVP 落地状态（2026-09-17）

MVP 已按本设计落地并通过验证，组件系统（`workbench-widgets.js` 引擎 + 5 个首发组件）已上线：

- **已交付**：组件网格引擎（4 列 / localStorage 持久化 `workspace_widget_layout_v1`）、拖动换位、右下角尺寸把手、编辑态增删组件、「自定义/完成」按钮、「添加组件」面板、纪念日提醒组件。
- **修复的缺陷**：初版「添加组件」面板显示为空——根因是 `workspace.html` 把 `workbench-widgets.js` 引入在 `workspace.js` 之后，`init()` 同步注册时 `window.WB` 未定义导致整体早退。已调整脚本加载顺序修复，详见 `TODO/bugs/bug-history.md`（2026-09-17）。
- **交互性能优化**：拖拽/缩放由“每次 pointermove 全量 relayout”改为「rAF 按帧合并 + 拖动中卡片 transform 合成器位移（跟手不重排）+ 被覆盖卡片 **实时让位**（同一 planPush 算法预演，替换感）+ 松手后拖拽卡片 transform 丝滑滑入目标格（scale 回落微反馈）」；编辑态整条卡片头（头部）均可拖动，不再局限于 26px 把手。全局拖拽点审计结论：看板（原生 DnD + classList）与悬浮抽屉（transform 写 `--md-off`，合成器级）本就廉价，无需改动。
- **验证口径**：前端（3001）与后端（8081）重启后 `workspace.html` 正常加载；组件默认布局渲染、「自定义/完成」切换、拖拽换位、调大小、删除/再添加、刷新后从 localStorage 恢复均复验通过；深浅主题用 `--ws-*`/`--app-*` token。

## 九、下一阶段对齐（与《数据层重构与用户习惯聚合开发计划》衔接）

组件系统 API（`WB.register/mount/setEditMode/addWidget/removeWidget/refreshAll`）与布局持久化键向后兼容，下一阶段新增组件与功能无需改引擎。对齐重点：

1. **L2 工作台数据维度组件化**（后端已就绪，前端待开发）：
   - 工作台解析统计「规则命中 / 手动加入 / 关系带入 / 排除 / 最终可见」数量（`/api/workspace/overview` + 解析接口）——可作为新的「工作台漏斗」组件卡进入「添加组件」面板，`render(el, ctx)` 读接口即可，数据不上 localStorage。
2. **本设计「明确不做」清单的接力项**（按优先级排列，均以现有组件 API 承载）：
   - 产品概览（product-dev）视图组件化；
   - 多工作台各自独立布局（`storageKey` 按 workspaceId 域分化）；
   - 图表重排算法优化（目前为同列推挤，可升级为紧凑排布）；
   - 组件设置弹窗（尺寸/标题/数据开关）。
3. **后端演进不阻塞**：当前布局在 localStorage；后续 Java 后端迁移 / 行为事件落库后，可将布局与组件偏好平滑迁移，`WB.mount` 接口保持不变。
4. **回归约束**：new 引擎类脚本（含未来组件）一律在消费方 JS 之前引入（见 bug-history 经验教训），防止再次出现「注册早退」。