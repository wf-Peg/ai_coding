# 工作台侧边栏作用域筛选 Bug 修复计划

## 问题概览

| # | 问题 | 根因 | 影响范围 |
|---|------|------|---------|
| 1 | "管理工作台"按钮点击空白页 | `showView('detail')` 后 `loadDetail()` 依赖 API 返回，但缺少兜底 UI | workspace.html 作用域横幅 |
| 2 | 切回"默认工作台"后作用域横幅残留 | 异步 `loadOverview()` 存在竞态，旧响应覆盖新状态 | workspace.html 作用域横幅 |
| 3 | 筛选产品开发工作台无内容 | 后端筛选条件严格（规则+手动成员），无匹配项时返回空 | backend WorkspaceController |

---

## Bug 1：移除"管理工作台"按钮

### 当前代码分析

[workspace.html:L602-L605](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L602-L605) 作用域横幅 HTML：
```html
<div id="overviewScopeBanner" ...>
  <span id="scopeBannerText"></span>
  <button id="scopeManageBtn" class="scope-manage-btn" ...>管理工作台</button>  <!-- ← 问题 -->
</div>
```

[workspace.html:L1043-L1052](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L1043-L1052) onclick 处理器：
```javascript
manageBtn.onclick = function() {
  activeWsId = overviewWorkspaceId;     // 设置 activeWsId
  overviewWorkspaceId = null;            // 清空作用域
  renderWsList();
  showView('detail');                     // 进入详情视图
  loadDetail();                           // 加载详情
};
```

### 根因

1. 用户明确表示"默认工作台不需要'管理工作台'按钮"——"默认工作台"是不过滤的全局视图，不存在"管理"某个工作台的概念
2. 点击后空白页：`loadDetail()` 依赖 API 响应，若工作台无规则/无成员，会显示空列表，用户感知为"空白页"

### 修复方案

**remove**：删除 `#scopeManageBtn` 按钮 HTML 和 `manageBtn.onclick` 处理器。

作用域横幅只保留文本提示，管理入口通过侧边栏双击/右键菜单进入。

---

## Bug 2：作用域横幅状态残留

### 当前代码分析

[workspace.html:L1101-L1127](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L1101-L1127) `loadOverview()` 函数没有请求去重机制：

```javascript
async function loadOverview() {
  if (overviewWorkspaceId) params.set('workspaceId', overviewWorkspaceId);
  const r = await fetch(...);
  overviewState.data = await r.json();
  // 多个并发请求会互相覆盖
  overviewRenderScopeBanner(overviewState.data);  // 可能被旧请求覆盖
}
```

### 根因

`loadOverview()` 是 async 函数，用户快速切换工作台时，多个 API 请求并发。先返回的响应可能被后返回的**旧响应**覆盖，导致横幅显示错误的作用域。

### 修复方案

**add**：引入请求计数器 `overviewRequestId`，在 `loadOverview()` 中校验请求是否过期：

```javascript
let overviewRequestId = 0;

async function loadOverview() {
  const requestId = ++overviewRequestId;
  // ...
  const r = await fetch(...);
  if (requestId !== overviewRequestId) return;  // 丢弃过期响应
  overviewState.data = await r.json();
  // ...
}
```

---

## Bug 3：筛选工作台无内容

### 当前代码分析

[WorkspaceController.java:L105-L117](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/WorkspaceController.java#L105-L117)：
```java
if (workspaceId != null && !workspaceId.isBlank()) {
    WorkspaceResolution resolution = workspaceIndexService().resolveWorkspace(workspaceId,
            new ContentIndexService(indexDir.resolve("content-index.json")).readAll(), List.of());
    result.put("contents", new WorkspaceResolutionView(resolution).body().get("contents"));
    result.put("count", resolution.visibleCount());
    result.put("scoped", true);
}
```

[WorkspaceRuleService.resolve()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java#L171-L221) 筛选逻辑：
```
visible = (ruleMatched ∪ manualMembers ∪ relationMembers) − excluded
```

### 根因分析

**后端逻辑本身无 bug**，筛选结果为空的常见原因：
1. 工作台没有配置任何规则（`ruleIds` 为空）
2. 工作台没有手动添加成员（`manualIds` 为空）
3. `content-index.json` 中无数据或数据格式不匹配

### 修复方案

**不需要改后端代码**。前端增加以下改进：

1. **在 `loadOverview()` 中增加控制台日志**，输出 `overviewWorkspaceId` 和 API 返回的 `count`，方便调试
2. **当筛选返回空时，在空状态提示中增加更明确的信息**，说明"当前工作台规则未命中任何内容" vs "确实没有数据"

---

## 改动清单

### 文件：`frontend/workspace.html`

| 序号 | 改动位置 | 改动内容 | 行号参考 |
|------|---------|---------|---------|
| 1 | HTML 作用域横幅 | 删除 `#scopeManageBtn` 按钮元素 | L602-L605 |
| 2 | `overviewRenderScopeBanner()` | 删除 `manageBtn.onclick` 绑定逻辑 | L1043-L1052 |
| 3 | 全局变量区 | 新增 `let overviewRequestId = 0;` | ~L980 附近 |
| 4 | `loadOverview()` | 加入请求计数器校验，丢弃过期响应 | L1101-L1127 |
| 5 | 空状态提示 | 有 `workspaceId` 且有内容为空时，提示"当前工作台规则未命中任何内容" | L1093-L1094 |

### 后端：无需改动

---

## 验证步骤

1. 点击"默认工作台"→ 不应显示"管理工作台"按钮
2. 快速切换"产品开发工作台"→"默认工作台"→ 横幅不应残留
3. 筛选"产品开发工作台"→ 查看浏览器控制台日志，确认 `workspaceId` 和 `count` 值