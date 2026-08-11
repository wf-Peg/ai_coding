# 工作台内容自动归属实施计划

## 1. 概述

**目标**：用户在选中工作台后新增的剪藏/待办/知识/学习计划等数据，自动关联到当前工作台，并区分来源（规则匹配 vs 工作台输入）。

**方案**：采用轻量级方案——新增内容时自动创建 `WorkspaceMembership`（成员关系），不修改现有数据模型，保持索引驱动的筛选架构不变。

**设计原则**：
- 不改 ContentRef、ClipContent、TodoContent 等核心数据模型
- 利用已有的 `workspace-memberships.json` 成员关系机制
- 前端只需传递 `active_workspace_id`，后端负责成员关系创建
- 来源区分：`"rule"`（规则命中）、`"manual_input"`（工作台输入）、`"manual"`（手动拖拽/指派）

## 2. 数据流图

```
┌─────────────────────────────────────────────────────────┐
│ 用户在 工作台A 下创建内容                                  │
│ 1. 前端从 localStorage 读取 active_workspace_id          │
│ 2. 在请求体中带上 workspaceId                             │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/clip/add { workspaceId: "A", ... }
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 后端 Controller 层                                        │
│ 1. 保存内容（现有逻辑不变）                                  │
│ 2. 如果 workspaceId 非空 → 调用 WorkspaceIndexService    │
│    .addMember() 创建成员关系（source="manual_input"）     │
│ 3. 重建 content-index.json（增量更新）                    │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 查询时（现有逻辑不变）                                      │
│ WorkspaceRuleService.resolve() 合并三种来源：              │
│   - ruleIds: 规则命中的内容                                │
│   - manualIds: 手动成员（含 manual_input）                │
│   - relationIds: 关系成员                                  │
│ contentSources: contentId → "rule"|"manual_input"|"manual" │
└─────────────────────────────────────────────────────────┘
```

## 3. 实施步骤

### Step 1: 后端 ClipRequest 增加 workspaceId 字段

**文件**：[ClipRequest.java](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\main\java\com\example\clip\dto\ClipRequest.java)

- 新增字段 `private String workspaceId;`
- 新增 getter/setter

### Step 2: 后端 TodoRequest（或 TodoContent 直接接收）增加 workspaceId 支持

**文件**：需确认是否有 TodoRequest DTO，若无则直接在 Controller 层通过 `@RequestParam` 或包装对象接收。

**方案 A**（推荐）：新增 `TodoRequest` DTO，包含全部 TodoContent 字段 + workspaceId。
**方案 B**：在 `TodoController.addTodo()` 中增加 `@RequestParam(required = false) String workspaceId` 参数，由前端拼接。

### Step 3: ClipController 创建内容后自动关联工作台

**文件**：[ClipController.java](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\main\java\com\example\clip\controller\ClipController.java)

在 `addClip()` 方法中，保存内容后增加：

```java
// 如果请求中携带了 workspaceId，自动创建成员关系
if (request.getWorkspaceId() != null && !request.getWorkspaceId().isBlank()) {
    WorkspaceMembership membership = new WorkspaceMembership(
        request.getWorkspaceId(),
        "clip:" + clip.getId(),
        "manual_input",
        "工作台输入",
        1.0,
        null, 0,
        LocalDateTime.now(), LocalDateTime.now()
    );
    workspaceIndexService.addMember(membership);
}
```

> 注意：需要在 ClipController 中注入 `WorkspaceIndexService`。

### Step 4: TodoController 创建待办后自动关联工作台

**文件**：[TodoController.java](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\main\java\com\example\clip\controller\TodoController.java)

同理，在 `addTodo()` 中增加 workspaceId 接收和成员关系创建逻辑。

### Step 5: 来源标记扩展

**文件**：[WorkspaceRuleService.java](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\main\java\com\example\clip\index\WorkspaceRuleService.java)

在 `resolve()` 方法的 `contentSources` 构建逻辑中，增加对 `"manual_input"` 来源的识别：

```java
// 在构建 contentSources 时，增加对 manual_input 来源的判断
// 当前 manualIds 中包含了 manual + manual_input 两种
// 需要区分：如果 membership.source == "manual_input" 则标记为 "manual_input"
```

具体实现：在 `resolve()` 方法中，遍历 `manualMembers` 参数，按 `source` 字段区分是 `"manual"`（拖拽）还是 `"manual_input"`（工作台输入）。

### Step 6: 前端剪藏创建时传递 workspaceId

**文件**：`frontend/clip.html`（或相关的剪藏创建逻辑）

在创建剪藏的 API 调用中，从 localStorage 读取 `active_workspace_id` 并加入请求体：

```javascript
const wsId = localStorage.getItem('active_workspace_id');
const requestBody = {
    content: clipContent,
    type: 'text',
    // ... 其他字段
};
if (wsId) {
    requestBody.workspaceId = wsId;
}
await axios.post(`${API_BASE_URL}/add`, requestBody);
```

### Step 7: 前端待办创建时传递 workspaceId

**文件**：[todo.html](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\todo.html#L1756)

在 `addTodo()` 函数中，构建 todo 对象时增加 workspaceId：

```javascript
const todo = {
    title,
    priority: inputPriority.value,
    // ... 其他字段
};
const wsId = localStorage.getItem('active_workspace_id');
if (wsId) {
    todo.workspaceId = wsId;
}
```

### Step 8: 浏览器扩展剪藏传递 workspaceId（可选）

**文件**：`browser-extension/clip.html` 或相关扩展代码

如果浏览器扩展也支持工作台筛选，需要同步传递 `active_workspace_id`。

### Step 9: WorkspaceFilterUtils 更新

**文件**：[WorkspaceFilterUtils.java](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\main\java\com\example\clip\util\WorkspaceFilterUtils.java)

当前筛选逻辑无需修改，因为成员关系（含 `manual_input`）已通过 `WorkspaceRuleService.resolve()` 合并到 `visible` 列表中。

### Step 10: 测试用例

**新建文件**：`backend/src/test/java/com/example/clip/index/WorkspaceContentAutoAssociationTest.java`

测试场景：
1. 创建内容时传递 workspaceId → 验证成员关系自动创建
2. 查询时该内容出现在工作台可见列表中
3. contentSources 中标记为 `"manual_input"`
4. 不传递 workspaceId → 不创建成员关系（向后兼容）
5. 浏览器扩展创建剪藏 + workspaceId → 同样关联

## 4. 接口变更清单

| 接口 | 变更 | 说明 |
|------|------|------|
| POST /api/clip/add | 请求体增加 `workspaceId` 字段（可选） | 向后兼容 |
| POST /api/todo/add | 请求体增加 `workspaceId` 字段（可选） | 向后兼容 |
| GET /api/clip/list | 不变 | 已有 workspaceId 筛选 |
| GET /api/todo/list | 不变 | 已有 workspaceId 筛选 |

所有接口变更均为**可选字段**，旧版本前端不传 workspaceId 不影响现有功能。

## 5. 数据一致性说明

### 重建索引场景
- 定时扫描重建 `content-index.json` 时，`WorkspaceMembership` 数据独立存储于 `workspace-memberships.json`
- 索引重建不影响成员关系数据
- 新增的 `manual_input` 成员关系在重建后依然有效

### 删除内容场景
- 删除剪藏/待办时，需要同步清理对应的 `WorkspaceMembership` 记录（当前已有 `removeMember` 方法，但需在删除业务逻辑中调用）

## 6. 前端 UI 无变更

本方案为纯数据层改动，**不需要修改任何前端 UI 组件**：
- 工作台切换逻辑不变
- 内容列表渲染逻辑不变
- 来源区分通过 contentSources 透传，未来可在 UI 上展示来源标签（可后续迭代）

## 7. 工作量估算

| 步骤 | 文件 | 改动量 | 预估工时 |
|------|------|--------|---------|
| 1 | ClipRequest.java | +2 行 | 5min |
| 2 | TodoRequest 或 Controller 参数 | +2 行 | 5min |
| 3 | ClipController.java | +10 行 | 15min |
| 4 | TodoController.java | +10 行 | 15min |
| 5 | WorkspaceRuleService.java | +5 行 | 10min |
| 6 | clip.html 创建逻辑 | +4 行 | 10min |
| 7 | todo.html addTodo() | +4 行 | 10min |
| 9 | 注入 WorkspaceIndexService 到 Controller | +2 行/文件 | 5min |
| 10 | 测试用例 | ~50 行 | 20min |
| **合计** | | | **~1.5h** |