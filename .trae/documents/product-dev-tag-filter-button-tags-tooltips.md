# 产品开发工作台：标签维度筛选 + 功能按钮点击埋点 + 全局悬浮提示

> **注意**：本文档已根据 MVP 重新设计更新。产品开发工作区不再使用独立 `ProductDevController`/`ProductDevService` 数据源，而是复用 workspace 规则系统 + 剪藏/待办模块。

## 一、Summary（目标）

1. **补充标签维度筛选**：产品开发工作区需要按标签筛选内容，且做到**全子视图联动**（总览/需求看板/归档等 tab 一起响应）。
2. **功能按钮点击埋点为标签**：产品开发工作台流程中每个功能按钮点击都记录为一个「功能标签」，复用现有 `ActionEvent` 埋点体系。
3. **全局悬浮提示**：为工作台页（`workspace.html`）与主应用导航（`index.html`）中**稍复杂的功能按钮**补充鼠标悬浮 `title` 说明。

## 二、Current State Analysis（现状）

### 2.1 数据源变化（MVP 重新设计后）

- **旧设计**：产品开发工作区使用独立 `ProductDevController`（9 个 GET 接口），数据存储在 `{configDir}/index/product-dev.json`
- **新设计（MVP）**：
  - 产品开发工作台是系统内置 workspace（`pd-builtin`），通过三条内置规则筛选 `tag=product-dev` 的内容
  - 数据来自剪藏（Clip）和待办（Todo）模块，通过 `WorkspaceResolution` 解析
  - 前端视图从独立数据源切换为复用 `/api/workspace/{id}/resolve` 接口
  - 标签筛选现在是**对 workspace 解析结果的本地过滤**，而非后端 API 参数

### 2.2 标签筛选现状

- 通用工作台规则系统已支持 `tag` 维度：`WorkspaceRule.FIELDS` 含 `"tag"`
- **产品开发工作台内置规则**：`tag equals product-dev`（自动筛选）
- 标签筛选需要在前端做**本地过滤**：从 `WorkspaceResolution` 返回的内容列表中按 tags 筛选
- 筛选状态需要同步到所有子视图（总览/看板/归档）

### 2.3 按钮点击埋点现状

- `ActionEvent` 体系由后端 `UserActionEventRecorder` 管理
- `DataObservabilityController` 有读取/聚合接口，但**缺少前端事件上报接口**
- 需要新增 `POST /api/data/action-events` 接口

## 三、Proposed Changes（改动方案）

### Part A：标签维度筛选（本地过滤，全子视图联动）

#### A1. 前端 `workspace.html`

- 新增状态变量 `var activePdTag = '';`
- 在标签筛选条容器中渲染标签 pill（从 workspace 解析结果中提取所有不重复的 tags）
- pill 点击：设置 `activePdTag`，触发本地过滤，刷新所有子视图
- "全部" pill 清除筛选
- 筛选逻辑：对 `WorkspaceResolution` 返回的内容列表，按 `tags.contains(activePdTag)` 过滤

#### A2. 全子视图联动

- 总览统计卡片：基于筛选后的数据重新计算
- 需求看板（Kanban）：基于筛选后的数据重新渲染
- 归档列表：基于筛选后的数据重新渲染
- 所有子视图共享同一个 `activePdTag` 状态

### Part B：功能按钮点击 → 功能标签埋点

#### B1. 后端 `DataObservabilityController.java`

- 新增 `POST /api/data/action-events` 接口
- 请求体：`{ tag, label, buttonId, page }`
- 调用 `UserActionEventRecorder.record()` 写入 `action-events.jsonl`
- 埋点为 fire-and-forget，失败静默

#### B2. 前端 `workspace.html`

- 新增 `trackFunctionClick(btn)` 埋点助手
- 全局 click 事件委托：`[data-func-tag]` 元素自动上报
- 功能标签命名规范：**`功能:<功能名>`**
- 覆盖按钮：侧边栏导航、产品开发 tab、新建需求、历史迁移、甘特图缩放等

### Part C：全局悬浮提示（title）

- `workspace.html`：补充缺失 title 的按钮（侧边栏折叠、新建工作台、产品开发 tab、甘特图缩放等）
- `index.html`：主应用导航按钮补充 title

## 四、Assumptions & Decisions（假设与决策）

1. **标签筛选做前端本地过滤**（而非后端 API 参数），因为数据已通过 `WorkspaceResolution` 全部加载
2. "全部" pill 即清除筛选
3. 功能标签命名统一 **`功能:<功能名>`** 前缀，仅作采集
4. 埋点走 `UserActionEventRecorder`（best-effort），失败静默不阻断业务
5. 范围界定：标签筛选与按钮埋点只覆盖工作台页 `workspace.html`

## 五、Verification（验证步骤）

1. **编译**：`mvn -q compile` 确认无编译错误
2. **接口冒烟**：`POST /api/data/action-events` 正常写入 `action-events.jsonl`
3. **前端验证**：
   - 标签筛选条渲染正确，点击标签后子视图数据同步收窄
   - 点击功能按钮后 `action-events.jsonl` 出现对应记录
   - 鼠标悬浮按钮显示说明文字
4. **回归**：工作台页其余交互不受影响