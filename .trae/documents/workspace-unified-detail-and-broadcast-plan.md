# 工作台模块修复与统一页面改造计划

## 摘要

本次改造涉及 3 个目标：
1. 修复产品开发工作区的模块（标签）筛选无效问题
2. 非默认工作台统一为"内容/规则/排除/建议"详情页，并在内容区添加类型筛选
3. 移除全局的"当前显示工作台"横幅提示，改用广播机制通知各模块重新渲染

---

## 1. 当前状态分析

### 1.1 产品开发工作区（pd-builtin）
- 文件: `frontend/workspace.html` 
- 标签筛选条 `pd-tag-filter` 位于 `productDevView` 内
- 筛选逻辑: `loadProductDev()` 获取 `/api/workspace/pd-builtin/resolution` 后，用 `activePdTag` 本地过滤
- **问题**: 缺少类型筛选维度，仅支持标签筛选

### 1.2 工作台页面结构
- **Overview 视图** (`overviewView`): 默认工作台展示，包含搜索、类型筛选、内容列表、项目面板
- **Detail 视图** (`detailView`): 非默认工作台，包含"内容/规则/排除/建议"4 个 Tab
  - 内容 Tab 之前缺少类型筛选（剪藏/知识/待办/学习），已修复
- **Product Dev 视图** (`productDevView`): 独立的产品开发工作区，包含总览/需求看板/归档等子 Tab

### 1.3 工作台筛选横幅
- 横幅原存在于 4 个模块: `clip.html`、`todo.html`、`knowledge.js`、`learning-plan.html`
- 广播机制已存在: `index.html` 的 `notifyAllFrames()` 向所有 iframe 发送 `workspaceChange` 消息
- 各子页面通过 `message` 事件监听 `workspaceChange` 消息，直接重载数据

---

## 2. 已完成改动

### 2.1 ✅ 修复产品开发工作区标签筛选（Bug 1）

**文件**: `frontend/workspace.html`

**改动**:
- `renderPdTagFilter()` 增加类型筛选按钮行
- 添加 `activePdType` 变量，与 `activePdTag` 共同过滤
- `loadProductDev()` 中联合使用 `activePdTag` 和 `activePdType` 进行过滤
- `pdUrl()` 辅助函数根据 `activePdTag` 和 `activePdType` 构建 API 请求路径

### 2.2 ✅ 非默认工作台详情页添加类型筛选（Bug 2）

**文件**: `frontend/workspace.html`

**改动**:
- 在 `detailView` 内容 Tab 添加 `<div class="filters" id="detailTypeFilters">`
- 新增 `renderDetailTypeFilters()` 函数，渲染类型筛选按钮
- 修改 `renderDetailContents()` 在列表渲染前应用 `detailState.types` 筛选
- 在 `loadDetail()` 的 `resData.contents` 赋值后，调用 `renderDetailTypeFilters()`

### 2.3 ✅ 移除工作台筛选横幅 — clip.html / todo.html / knowledge.js

**文件**: `frontend/clip.html`、`frontend/todo.html`、`frontend/knowledge.js`

**改动**:
- 删除 `workspaceBanner` HTML 元素
- 删除 `updateWorkspaceBanner()` 和 `clearWorkspaceFilter()` 函数
- 修改 `workspaceChange` 消息处理：从 `updateWorkspaceBanner()` 改为直接调用数据加载函数

---

## 3. 剩余待完成改动

### 3.1 ❌ learning-plan.html — 移除工作台横幅

**文件**: `frontend/learning-plan.html`

**需删除的内容**:
1. **HTML 横幅**（第 734~738 行）:
   ```html
   <div id="workspaceBanner" style="display:none; ...">
       当前显示工作台 <strong id="wsBannerName">...</strong> 筛选后的数据
       <button onclick="clearWorkspaceFilter()" ...>显示全部</button>
   </div>
   ```

2. **`updateWorkspaceBanner()` 调用**（第 879 行）:
   ```javascript
   updateWorkspaceBanner();
   ```

3. **`updateWorkspaceBanner()` 函数**（第 885~898 行）

4. **`clearWorkspaceFilter()` 函数**（第 899~904 行）

5. **初始化调用**（第 1446 行）:
   ```javascript
   updateWorkspaceBanner();
   ```

**需保留并修改**:
- `workspaceChange` 消息监听（第 872~882 行）：将 `updateWorkspaceBanner()` 改为直接 `loadPlans()`

### 3.2 ❌ clip.html — 移除残留的 `updateWorkspaceBanner()` 调用

**文件**: `frontend/clip.html`

**需删除**:
- 第 3137 行: `updateWorkspaceBanner();`（DOMContentLoaded 初始化中的调用）

---

## 4. 假设与决策

- **产品开发工作区标签筛选**: 本地过滤，不涉及后端改动。增加类型筛选作为补充维度。
- **Detail 视图类型筛选**: 复刻 overview 的 `overviewRenderFilters` 模式，不修改后端 API。
- **横幅移除**: 各模块的 `workspaceChange` 消息监听已存在，将回调改为重载数据函数。
- **overview 作用域横幅**: workspace.html 中的 `overviewScopeBanner` 是工作台自身 overview 视图的上下文指示器，与子模块的"当前显示工作台"横幅不同，予以保留。
- **overview 页面**: 作为默认工作台的概览视图保留，与 detail 视图职责不同，不可删除。

---

## 5. 验证步骤

1. 打开工作台 → 选择产品开发工作区 → 点击标签/类型筛选 → 确认内容正确过滤
2. 点击非默认工作台 → 确认进入"内容/规则/排除/建议"详情页
3. 在详情页内容 Tab → 点击类型筛选按钮 → 确认内容按类型过滤
4. 切换到剪藏/待办/知识/学习计划模块 → 确认无横幅显示
5. 在工作台切换工作台 → 确认各模块自动重新加载数据