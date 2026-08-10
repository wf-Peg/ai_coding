# 产品开发工作台：标签维度筛选 + 功能按钮点击标签埋点 + 全局悬浮提示

## 一、Summary（目标）

本次改造围绕「产品开发工作台流程」做三件事：

1. **补充标签维度筛选**：产品开发工作区目前**没有**按标签（`ProductDevRecord.tags`）筛选的能力，需要补上，且做到**全子视图联动**（总览/需求看板/知识图谱/时间线/归档 5 个 tab 一起响应）。
2. **功能按钮点击埋点为标签**：产品开发工作台流程中每个功能按钮点击都记录为一个「功能标签」，复用现有 `ActionEvent` 埋点体系（新增 `button_clicked` 事件类型 + 前端 POST 上报接口）。功能标签的**设计逻辑后续再补**，本轮只做数据采集与通道，为后续「学习模块细化到具体功能点」铺垫。
3. **全局悬浮提示**：为工作台页（`workspace.html`）与主应用导航（`index.html`）中**稍复杂的功能按钮**补充鼠标悬浮 `title` 说明。

## 二、Current State Analysis（现状）

### 2.1 标签筛选现状

- 通用工作台规则系统已支持 `tag` 维度：`WorkspaceRule.FIELDS` 含 `"tag"`（[WorkspaceRule.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/index/WorkspaceRule.java) L9），`WorkspaceRuleService.matches()` 按 `ref.tags()` 匹配（L124）。
- **产品开发工作区没有标签筛选**：`ProductDevController` 的 9 个 GET 接口（stats / phase-distribution / todo-completion / knowledge-trend / activities / requirements / graph / timeline / archives）均不接受 `tag` 参数；`ProductDevService` 各统计方法只按 `type`/`source` 硬编码过滤（见 [ProductDevController.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/ProductDevController.java)）。
- `ProductDevRecord` 已含 `tags: List<String>` 字段（[ProductDevRecord.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/model/ProductDevRecord.java) L22），前端看板/归档中已展示 tags，但不可筛选。

### 2.2 按钮点击埋点现状

- `ActionEvent` 体系只由后端内部调用：`UserActionEventRecorder`（Spring Service，[UserActionEventRecorder.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/UserActionEventRecorder.java) L16-41）写入 `{configDir}/index/action-events.jsonl`。
- `DataObservabilityController`（`/api/data`）只有**读取/聚合**接口（habits/trends/insights），以及异常上报 `POST /api/data/exception-logs`，**没有前端事件上报接口**。
- `EventTypes` 无按钮点击类事件常量。

### 2.3 前端结构现状

- 工作台页全部实现在单文件 [workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html)（2972 行，原生 JS）。
- 产品开发工作区视图：`#productDevView`（L646-742），5 个 tab（总览/需求看板/知识图谱/时间线/归档）。
- `loadProductDev()`（L2190-2218）用 `Promise.all` 并行 fetch 9 个产品开发接口后一次性渲染所有 tab；tab 切换只显隐不重拉数据。
- 看板搜索（L2883）与甘特图缩放（L2896）各自独立 refetch，**不经过** `loadProductDev`。
- 悬浮提示：部分按钮已有 `title`（刷新索引 L566、历史迁移 L656、列表/看板切换 L607-608、规则编辑/删除、看板列操作等），但**新建需求、5 个产品开发 tab、甘特图缩放、侧边栏折叠、添加规则、主应用导航按钮等缺提示**。
- 主应用导航 [index.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/index.html) 的 `nav-btn`（L484-549）均无 `title`。

## 三、Proposed Changes（改动方案）

### Part A：产品开发工作区标签维度筛选（全子视图联动）

#### A1. 后端 `ProductDevService.java`

- 新增私有过滤助手：
  ```java
  private List<ProductDevRecord> filterByTag(List<ProductDevRecord> records, String tag) {
      if (tag == null || tag.isBlank()) return records;
      return records.stream()
          .filter(r -> r.getTags() != null && r.getTags().contains(tag))
          .toList();
  }
  ```
- 新增 `public List<String> getTags()`：对 `readAllRecords()` 收集所有非空标签去重后按字典序返回（供前端筛选条渲染，不受当前筛选影响）。
- 给 9 个聚合方法增加 `String tag` 参数（`getStats` / `getPhaseDistribution` / `getTodoCompletion` / `getKnowledgeTrend` / `getActivities` / `getRequirements` / `getGraph` / `getTimeline` / `getArchives`），方法体第一步改为 `List<ProductDevRecord> records = filterByTag(readAllRecords(), tag);` 再走原有 type/source 分组逻辑。
- 语义：`tags.contains(tag)` **精确匹配**；`tag` 为空/null 时不过滤（兼容现有调用）。

#### A2. 后端 `ProductDevController.java`

- 给 9 个 GET 接口方法增加 `@RequestParam(required = false) String tag` 并透传给 service。
- 新增 `GET /api/product-dev/tags`，返回 `List<String>` 去重标签。
- 更新类头部端点汇总 Javadoc。

#### A3. 前端 `workspace.html`

- 新增状态变量 `var activePdTag = '';`。
- 在 `.pd-tabs`（L668）之后插入标签筛选条容器：`<div class="pd-tag-filter" id="pdTagFilter" aria-label="标签筛选"></div>`，并补 `.pd-tag-filter` / `.pd-tag-pill` / `.active` 的 CSS（仿 `#filters` 现有 pill 样式，见 L78-80）。
- 改造 `loadProductDev()`（L2190-2218）：
  - `Promise.all` 中新增 `fetch('/api/product-dev/tags')`；
  - 9 个接口 URL 在 `activePdTag` 非空时追加 `?tag=` + `encodeURIComponent(activePdTag)`；
  - 用 tags 响应渲染筛选条（"全部" + 各标签 pill，当前选中高亮）；
  - pill 点击：设置 `activePdTag`、刷新 pill 高亮、调用 `loadProductDev()` 重新拉取。
- 同步让看板搜索（L2883）与甘特图缩放（L2896）的独立 refetch 也带上 `activePdTag`，保证筛选状态下切换操作不丢筛选。

### Part B：功能按钮点击 → 功能标签埋点

#### B1. 后端 `EventTypes.java`

- 新增常量：`public static final String BUTTON_CLICKED = "button_clicked";`（归入内容/工作区事件组附近）。

#### B2. 后端 `DataObservabilityController.java`

- 注入 `UserActionEventRecorder`（Spring Service，构造器注入）。
- 新增 `POST /api/data/action-events`：
  - 请求体 `{ tag, label, buttonId, page }`（`page` 默认 `"workspace"`，`source` 取 `"frontend"`）；
  - 组装 `metadata`（含 tag/label/buttonId/page），调用 `userActionEventRecorder.record(EventTypes.BUTTON_CLICKED, null, null, source, metadata)`；
  - 返回 `{success: true, message: "已记录"}`；异常时同样吞掉（沿用 best-effort 原则，参考 [UserActionEventRecorder.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/UserActionEventRecorder.java) L38-40）。

#### B3. 前端 `workspace.html`

- 新增埋点助手与事件委托（页面底部脚本区）：
  ```js
  function trackFunctionClick(btn) {
    var tag = btn.dataset.funcTag;
    if (!tag) return;
    fetch('/api/data/action-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag, label: btn.dataset.funcLabel || tag,
        buttonId: btn.id || btn.className || '', page: 'workspace' })
    }).catch(function() {});
  }
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-func-tag]');
    if (btn) trackFunctionClick(btn);
  });
  ```
- 给功能按钮补 `data-func-tag` 属性，命名规范 **`功能:<功能名>`**（与内容标签区分，具体设计逻辑后续补充）。覆盖：
  - 侧边栏：全部概览、产品开发、新建工作台；
  - 概览/详情：刷新索引、内容类型筛选、详情 tab（内容/规则/排除/建议）、添加规则、列表/看板切换；
  - 产品开发工作区：历史迁移、新建需求、5 个 tab（总览/需求看板/知识图谱/时间线/归档）、甘特图 3 个缩放按钮；
  - 动态渲染按钮：在对应 JS 模板字符串（排除按钮 L1230、规则卡片操作 L1267、建议操作 L1755-1758、恢复排除 L1709、看板列操作 L1918-1926 等）中补 `data-func-tag`。
- 埋点为 fire-and-forget，失败静默，不影响业务。

### Part C：全局悬浮提示（title）

#### C1. `workspace.html` 补充缺失 title

| 位置 | 元素 | title 文案 |
|---|---|---|
| L534 | sidebarCollapse | 收起侧边栏 |
| L548 | newWsBtn | 新建工作台 |
| L559 / L590 / L650 | sidebarToggle / sidebarToggle2 / pdSidebarToggle | 展开侧边栏 |
| L595-598 | detail-tabs | 内容：查看可见内容与排除入口；规则：管理自动筛选规则；排除：已排除内容；建议：基于使用习惯的候选推荐 |
| L619 | addRuleBtn | 为当前工作台添加自动筛选规则 |
| L657 | pdNewRequirementBtn | 创建一条新需求并进入需求池 |
| L663-667 | pd-tabs ×5 | 总览：数据仪表盘与最近活动；需求看板：按阶段拖拽管理需求；知识图谱：需求-知识关联网络；时间线：甘特图展示开发周期；归档：历史需求归档记录 |
| L717-719 | pd-gantt-zoom-btn ×3 | 日视图（按天展示）；周视图（按周展示）；月视图（按月展示） |
| 动态模板 | 缺失 title 的按钮 | 逐个检查排除按钮、建议接受/忽略/拒绝、恢复排除、看板列操作等，缺则补 |

#### C2. `index.html` 补充缺失 title

- `nav-btn`（L484-549，共 10 个）：编辑（编辑器主页）、工作台（工作台与产品开发工作区）、剪藏（剪藏与待办）、知识（知识库管理）、Wiki（Wiki 知识库）、密码（密码保险库）、学习（学习计划）、PDF（PDF 工具）、观测（数据观测台）、设置（应用设置）。
- `backendGlobalStartBtn`（L481）：启动本地后端服务。
- 窗口控制按钮（最小化/最大化/关闭）已有 title，不动。

## 四、Assumptions & Decisions（假设与决策）

1. 标签筛选对象是 `ProductDevRecord.tags`，精确匹配（`tags.contains(tag)`），与现有通用工作台 tag 规则语义一致。
2. 标签筛选做**后端过滤**（各 GET 接口加 `tag` 参数），保证 5 个 tab 数据一致；前端只负责传参与渲染 pill。
3. "全部" pill 即清除筛选；`/api/product-dev/tags` 永远返回全量去重标签，保证筛选状态下 pill 不消失。
4. 功能标签命名统一 **`功能:<功能名>`** 前缀，仅作采集；其与记录/学习模块的关联设计逻辑本轮**不做**，仅留数据通道。
5. 埋点走 `UserActionEventRecorder`（best-effort），失败静默不阻断业务。
6. 范围界定：标签筛选与按钮埋点只覆盖工作台页 `workspace.html` 的产品开发流程按钮；悬浮提示覆盖 `workspace.html` + `index.html`（用户已确认）。

## 五、Verification（验证步骤）

1. **编译**：在 `backend/` 执行 `mvn -q compile`，确认无编译错误。
2. **接口冒烟**（启动后端后）：
   - `GET /api/product-dev/tags` 返回去重标签列表；
   - `GET /api/product-dev/requirements?tag=<某标签>` 只返回含该标签的需求分组，`tag` 缺失时行为与原来一致；
   - `POST /api/data/action-events` 携带 `{tag:"功能:历史迁移", label:"历史迁移", buttonId:"pdHistoryMigrateBtn"}`，随后检查 `{configDir}/index/action-events.jsonl` 追加 `button_clicked` 记录。
3. **前端手工验证**（打开工作台 → 产品开发工作区）：
   - 顶部出现标签筛选条，点击标签后 5 个 tab（总览统计卡/看板/图谱/时间线/归档）数据同步收窄，点"全部"恢复；
   - 点击若干功能按钮后，`action-events.jsonl` 出现对应 `button_clicked` 事件；
   - 鼠标悬浮新建需求、5 个产品开发 tab、甘特图缩放、侧边栏折叠、主应用导航等按钮均显示说明文字。
4. **回归**：确认未加标签时产品开发工作区展示与改造前一致（筛选为空即不过滤）；工作台页其余交互（看板拖拽、规则 CRUD、排除/恢复）不受影响。
