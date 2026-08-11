# 工作台数据入库与全局筛选实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 feature-points.json 扫描入库后索引重建缺失问题，并为所有内容模块增加工作台规则筛选能力

**Architecture:** 后端通过 `WorkspaceRuleService.resolve()` 计算内容归属于哪个工作台，各模块 `/list` 接口增加可选 `workspaceId` 参数实现服务端筛选；前端通过 `localStorage` 跨页面传递工作台 ID，各模块页面在加载时自动应用筛选

**Tech Stack:** Java 21, Spring Boot 3.2, Jackson, vanilla HTML+JS, localStorage

---

## 当前状态分析

### 问题 1: feature-points.json 扫描入库后前端不显示

**根因是索引重建时序问题，而非扫描缺失：**

- `ProductDevWorkspaceInitializer` 是 `CommandLineRunner`，在 `ContentIndexAutoSyncService.@PostConstruct` 之后执行
- `scanAndImport()` 导入的剪藏/待办要等到首次定时任务（默认 30 秒后）才能进入 `content-index.json`
- 前端各模块都读 `content-index.json`，所以导入后立即切到前端看不到数据
- 此外 TODO 目录没有文件监听（WatchService 或定时轮询），Agent 增量写入新 `feature-points.json` 后必须重启后端或手动点"立即扫描"

### 问题 2: 工作台筛选只局限于 Overview 页面

**现状：** 工作台规则筛选只在 `WorkspaceController.overview()` 中通过 `content-index.json` 解析实现，各模块原生 `/list` 接口全量返回，无任何 workspaceId 参数。

**前端：** clip.html/todo.html/knowledge.html/learning-plan.html 均为独立 iframe 页面，没有跨页面工作台状态共享机制（localStorage 仅存主题），加载时 URL 不带 `?workspaceId=` 参数，消息监听也不传递工作台状态。

---

## 设计决策

### 决策 1: 不修改数据模型，复用已有规则引擎

用户建议的"给所有内容模块增加工作台标识的 tag"方案会侵入所有数据模型（ClipContent、TodoContent、Knowledge、LearningPlan），且需要迁移存量数据。

**选择方案：** 利用已有的 `WorkspaceRuleService.resolve()` 机制（基于 content-index.json + 规则表达式 + 手动成员 + 排除项），在各模块控制器层根据 workspaceId 过滤结果。优势：不改变数据模型，复用已有规则引擎，无需数据迁移。

### 决策 2: 控制器层过滤，而非 Service 层

在 Controller 中注入 `WorkspaceIndexService` 或 `WorkspaceRuleService`，在 `getList()` 方法中先获取全量数据，再调用 `resolveWorkspace()` 获取可见 ID 列表，然后过滤。

原因：`ClipService` / `TodoService` 等业务 Service 与工作台模块无耦合，控制器层做过滤是正交关注点分离。

### 决策 3: localStorage 跨页面传递工作台状态

前端通过 `localStorage.setItem('active_workspace_id', workspaceId)` 在 index.html 中存储，各模块 iframe 页面在 `load` 时读取并附加到 API 请求参数。

---

## Proposed Changes

### Task 1: 修复 ProductDevWorkspaceInitializer 索引重建缺失

**文件:** `backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java`

- [ ] **Step 1: 注入 ContentIndexService 和 FileStorageService**

在 `ProductDevWorkspaceInitializer` 中新增两个字段并注入：

```java
private final ContentIndexService contentIndexService;
private final FileStorageService fileStorageService;

public ProductDevWorkspaceInitializer(
        TodoScannerService todoScannerService,
        AppConfigService appConfigService,
        ContentIndexService contentIndexService,
        FileStorageService fileStorageService) {
    this.todoScannerService = todoScannerService;
    this.appConfigService = appConfigService;
    this.contentIndexService = contentIndexService;
    this.fileStorageService = fileStorageService;
}
```

- [ ] **Step 2: 在 scanAndImport() 后添加索引重建**

在 `run()` 方法中，`scanAndImport()` 调用之后，`ensureBuiltinWorkspace()` 之前，添加：

```java
// 扫描完成后立即重建索引，确保导入的数据立即可见
try {
    contentIndexService.rebuildFromStorage(fileStorageService);
    log.info("[ProductDevWorkspaceInitializer] 内容索引已重建");
} catch (Exception e) {
    log.error("[ProductDevWorkspaceInitializer] 索引重建异常", e);
}
```

- [ ] **Step 3: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 2: 添加 TODO 目录定时扫描（增强）

**文件:** `backend/src/main/java/com/example/clip/core/ScheduledTasks.java`

- [ ] **Step 1: 注入 TodoScannerService 并添加定时扫描方法**

```java
private final TodoScannerService todoScannerService;

// 在已有构造器中注入 todoScannerService

/**
 * 每 5 分钟扫描 TODO 目录下的 feature-points.json，增量导入新功能点。
 * 幂等设计：已导入的 featurePointId 记录在 .imported 标记中，不会重复导入。
 */
@Scheduled(fixedDelay = 300000, initialDelay = 60000)  // 首次延迟 60 秒，之后每 5 分钟
public void scanTodoDirectory() {
    try {
        TodoScannerService.ScanResult result = todoScannerService.scanAndImport();
        if (result.dirsImported() > 0 || result.clipsCreated() > 0 || result.todosCreated() > 0) {
            log.info("[ScheduledTasks] TODO 扫描完成: dirs={}, clips={}, todos={}",
                    result.dirsImported(), result.clipsCreated(), result.todosCreated());
        }
    } catch (Exception e) {
        log.warn("[ScheduledTasks] TODO 扫描异常: {}", e.getMessage());
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 3: ClipController 增加 workspaceId 筛选参数

**文件:** `backend/src/main/java/com/example/clip/controller/ClipController.java`

- [ ] **Step 1: 注入 WorkspaceIndexService**

```java
private final WorkspaceIndexService workspaceIndexService;

// 在构造器中新增参数
```

- [ ] **Step 2: 修改 getClipList() 方法**

```java
@GetMapping("/list")
public ResponseEntity<List<ClipContent>> getClipList(
        @RequestParam(required = false) String workflowStatus,
        @RequestParam(required = false) String workspaceId) {
    List<ClipContent> clips = (workflowStatus == null || workflowStatus.isBlank())
            ? clipService.getAllClips()
            : clipService.getClipsByWorkflowStatus(workflowStatus);
    if (workspaceId != null && !workspaceId.isBlank()) {
        clips = filterByWorkspace(clips, workspaceId, "clip");
    }
    return ResponseEntity.ok(clips);
}

private List<ClipContent> filterByWorkspace(List<ClipContent> clips, String workspaceId, String type) {
    Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
    ContentIndexService contentIndexService = new ContentIndexService(indexDir.resolve("content-index.json"));
    List<ContentRef> allRefs = contentIndexService.readAll();
    WorkspaceResolution resolution = new WorkspaceIndexService(indexDir)
            .resolveWorkspace(workspaceId, allRefs, List.of());
    Set<String> allowedIds = resolution.visible().stream()
            .map(ContentRef::id)
            .collect(Collectors.toSet());
    return clips.stream()
            .filter(c -> allowedIds.contains(type + ":" + c.getId()))
            .collect(Collectors.toList());
}
```

- [ ] **Step 3: 添加必要的 import 语句**

```java
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceResolution;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
```

- [ ] **Step 4: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 4: TodoController 增加 workspaceId 筛选参数

**文件:** `backend/src/main/java/com/example/clip/controller/TodoController.java`

- [ ] **Step 1: 注入 AppConfigService 和 WorkspaceIndexService**

```java
private final AppConfigService appConfigService;
private final WorkspaceIndexService workspaceIndexService;

// 在构造器中新增参数
```

- [ ] **Step 2: 修改 getTodoList() 方法**

```java
@GetMapping("/list")
public ResponseEntity<List<TodoContent>> getTodoList(
        @RequestParam(required = false) String workspaceId) {
    List<TodoContent> todos = todoService.getAllTodos();
    if (workspaceId != null && !workspaceId.isBlank()) {
        todos = filterByWorkspace(todos, workspaceId, "todo");
    }
    return ResponseEntity.ok(todos);
}

private List<TodoContent> filterByWorkspace(List<TodoContent> items, String workspaceId, String type) {
    Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
    ContentIndexService contentIndexService = new ContentIndexService(indexDir.resolve("content-index.json"));
    List<ContentRef> allRefs = contentIndexService.readAll();
    WorkspaceResolution resolution = new WorkspaceIndexService(indexDir)
            .resolveWorkspace(workspaceId, allRefs, List.of());
    Set<String> allowedIds = resolution.visible().stream()
            .map(ContentRef::id)
            .collect(Collectors.toSet());
    return items.stream()
            .filter(c -> allowedIds.contains(type + ":" + c.getId()))
            .collect(Collectors.toList());
}
```

- [ ] **Step 3: 添加必要的 import 语句**

```java
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceResolution;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
```

- [ ] **Step 4: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 5: KnowledgeController 增加 workspaceId 筛选参数

**文件:** `backend/src/main/java/com/example/clip/controller/KnowledgeController.java`

- [ ] **Step 1: 同上注入 AppConfigService 和 WorkspaceIndexService**

- [ ] **Step 2: 修改 listKnowledge() 方法，增加 workspaceId 参数**

```java
@GetMapping("/list")
public ResponseEntity<List<KnowledgeResponse>> listKnowledge(
        @RequestParam(required = false) String category,
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String workspaceId) {
    List<Knowledge> knowledges;
    // ... existing logic ...
    if (workspaceId != null && !workspaceId.isBlank()) {
        // filterByWorkspace similar to Task 3/4, type = "knowledge"
    }
    return ResponseEntity.ok(knowledges.stream().map(this::toResponse).collect(Collectors.toList()));
}
```

- [ ] **Step 3: 添加 worksapce 过滤逻辑（与 Task 3 的 filterByWorkspace 一致，type="knowledge"）**

- [ ] **Step 4: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 6: LearningPlanController 增加 workspaceId 筛选参数

**文件:** `backend/src/main/java/com/example/clip/controller/LearningPlanController.java`

- [ ] **Step 1: 同上注入 AppConfigService 和 WorkspaceIndexService**

- [ ] **Step 2: 修改 getAllPlans() 方法，增加 workspaceId 参数**

```java
@GetMapping
public ResponseEntity<List<LearningPlan>> getAllPlans(
        @RequestParam(required = false) String workspaceId) {
    List<LearningPlan> plans = learningPlanService.getAllPlans();
    if (workspaceId != null && !workspaceId.isBlank()) {
        // filterByWorkspace similar to Task 3/4, type = "learning-plan"
    }
    return ResponseEntity.ok(plans);
}
```

- [ ] **Step 3: 编译验证**

Run: `mvn compile -q -pl backend`
Expected: BUILD SUCCESS

---

### Task 7: 后端测试 — 验证 workspaceId 筛选

**文件:** 新建 `backend/src/test/java/com/example/clip/controller/WorkspaceFilterTest.java`

- [ ] **Step 1: 编写测试验证各模块列表接口的 workspaceId 筛选**

```java
package com.example.clip.controller;

// 测试内容：
// 1. 无 workspaceId 参数时返回全量数据（向后兼容）
// 2. 有 workspaceId 参数时返回过滤后的数据
// 3. workspaceId 对应的工作台不存在时返回空列表
```

- [ ] **Step 2: 运行测试**

Run: `mvn test -q -pl backend -Dtest=WorkspaceFilterTest`
Expected: BUILD SUCCESS

---

### Task 8: 前端 index.html — 全局工作台状态管理

**文件:** `frontend/index.html`

- [ ] **Step 1: 添加工作台状态管理变量**

```js
// 在全局变量定义区域添加
let activeWorkspaceId = localStorage.getItem('active_workspace_id') || '';
```

- [ ] **Step 2: 添加工作台选择到顶部导航或侧边栏**

在导航栏添加一个工作台选择器，当用户在工作台页面选择了工作台后，该选择器显示当前选中的工作台名称，并提供"全部概览"选项。

```html
<!-- 在导航栏合适位置添加 -->
<select id="workspaceGlobalSelect" class="workspace-select" style="display:none;">
    <option value="">全部概览</option>
</select>
```

- [ ] **Step 3: 监听 localStorage 变化（跨页面通信）**

在 index.html 的 `storage` 事件监听器中，添加对 `active_workspace_id` 的监听：

```js
// 在现有的 storage 事件监听中添加
window.addEventListener('storage', (e) => {
    if (e.key === 'active_workspace_id') {
        activeWorkspaceId = e.newValue || '';
        updateWorkspaceSelect();
        // 通知所有子 iframe 刷新
        notifyAllFrames({ action: 'workspaceChange', workspaceId: activeWorkspaceId });
    }
});
```

- [ ] **Step 4: 添加 notifyAllFrames 函数和 iframe 刷新逻辑**

```js
function notifyAllFrames(message) {
    document.querySelectorAll('iframe').forEach(iframe => {
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(message, '*');
        }
    });
}
```

- [ ] **Step 5: 当切换工作台页面时，更新全局状态**

在 `renderView()` 中，当切换到 workspace 页面时，先读取 `activeWorkspaceId`，恢复之前的选择状态（通过 postMessage 传递给 workspace.html）。

---

### Task 9: 前端 workspace.html — 写入全局工作台状态

**文件:** `frontend/workspace.html`

- [ ] **Step 1: 在概览工作台选择时写入 localStorage**

在 `overviewScopeSelect.onchange` 回调中，添加：

```js
overviewScopeSelect.onchange = function () {
    overviewWorkspaceId = this.value || null;
    localStorage.setItem('active_workspace_id', overviewWorkspaceId || '');
    loadOverview();
};
```

- [ ] **Step 2: 启动时从 localStorage 恢复状态**

在 `loadWorkspaces()` 成功后，读取 localStorage 恢复选择：

```js
const savedWsId = localStorage.getItem('active_workspace_id');
if (savedWsId) {
    overviewScopeSelect.value = savedWsId;
    overviewWorkspaceId = savedWsId;
    // 触发数据加载
}
```

---

### Task 10: 前端各模块页面 — 接收工作台状态并筛选

**文件:** `frontend/clip.html`、`frontend/todo.html`、`frontend/knowledge.html`、`frontend/learning-plan.html`

每个模块页面的修改模式一致：

- [ ] **Step 1: 添加消息监听处理 workspaceChange**

在各页面现有的 `window.addEventListener('message', ...)` 中添加：

```js
else if (e.data.action === 'workspaceChange') {
    const wsId = e.data.workspaceId;
    if (wsId) {
        localStorage.setItem('active_workspace_id', wsId);
    } else {
        localStorage.removeItem('active_workspace_id');
    }
    // 重新加载列表数据
    loadData(); // 或对应的数据加载函数
}
```

- [ ] **Step 2: 修改列表请求，附加 workspaceId 参数**

各页面加载列表数据时，从 localStorage 读取 `active_workspace_id`，如果不为空，则附加到 URL 参数：

```js
// clip.html 示例 - 在 loadClips() 或类似函数中
async function loadClips() {
    let url = `${API_BASE_URL}/list`;
    const params = new URLSearchParams();
    const wsId = localStorage.getItem('active_workspace_id');
    if (wsId) {
        params.set('workspaceId', wsId);
    }
    const paramsStr = params.toString();
    if (paramsStr) url += '?' + paramsStr;
    const response = await axios.get(url);
    // ...
}
```

- [ ] **Step 3: 添加"显示全部"重置按钮**

在每个模块页面顶部添加一个横幅提示，当有工作台筛选激活时显示：

```html
<!-- 在页面顶部添加 -->
<div id="workspaceBanner" style="display:none; padding:8px 16px; background:#e3f2fd; border-radius:4px; margin-bottom:12px; font-size:13px;">
    当前显示工作台 <strong id="wsBannerName">...</strong> 筛选后的数据
    <button onclick="clearWorkspaceFilter()" style="margin-left:12px; padding:2px 8px;">显示全部</button>
</div>
```

```js
function clearWorkspaceFilter() {
    localStorage.removeItem('active_workspace_id');
    document.getElementById('workspaceBanner').style.display = 'none';
    loadData(); // 重新加载
}
```

---

### Task 11: 构建与验证

- [ ] **Step 1: 编译后端**

Run: `mvn package -q -DskipTests -pl backend`
Expected: BUILD SUCCESS

- [ ] **Step 2: 复制 JAR 到 Electron 目录**

Run: `Copy-Item backend\target\clip-demo-0.0.1-SNAPSHOT.jar backend\clip-demo-0.0.1-SNAPSHOT.jar -Force`
Expected: 文件复制成功

- [ ] **Step 3: 启动后端进行集成测试**

Run: `cd backend ; mvn spring-boot:run`
Expected: 后端启动成功，日志显示 TODO 扫描和索引重建

- [ ] **Step 4: 验证 API 端点**

```bash
# 1. 验证 feature-points.json 导入后索引重建（clip + todo 数量正确）
curl http://localhost:8081/api/workspace/overview

# 2. 验证各模块列表接口的 workspaceId 筛选
curl "http://localhost:8081/api/clip/list?workspaceId=pd-builtin"
curl "http://localhost:8081/api/todo/list?workspaceId=pd-builtin"
curl "http://localhost:8081/api/knowledge/list?workspaceId=pd-builtin"
curl "http://localhost:8081/api/learning-plan?workspaceId=pd-builtin"

# 3. 验证无 workspaceId 参数时返回全量数据（向后兼容）
curl "http://localhost:8081/api/clip/list"
curl "http://localhost:8081/api/todo/list"
```

- [ ] **Step 5: 前端语法检查**

Run: `node --check frontend\clip.html` (以及 todo.html, knowledge.html, learning-plan.html, index.html, workspace.html)
Expected: 全部通过

---

## 假设与风险

| 假设/风险 | 说明 |
|-----------|------|
| WorkspaceRuleService.resolve() 已正确实现 | 前一轮已完成嵌套分组表达式（AND/OR 两级），resolve() 经过测试验证 |
| 各模块 Controller 已注入 AppConfigService | 需要检查各 Controller 的构造器签名，有些可能没有 AppConfigService |
| 前端各模块页面加载函数的命名 | 各页面的数据加载函数名不同（clip.html 可能叫 loadClips()，todo.html 可能叫 loadTodos()），需根据实际代码调整 |
| 无 workspaceId 时的向后兼容 | 所有接口在 workspaceId 为 null/空时返回全量数据，不影响现有功能 |
| 前端跨页面 localStorage 通信 | 通过 `storage` 事件实现，但同一页面内的 iframe 需用 postMessage 通知 |

---

## 验证清单

1. [ ] ProductDevWorkspaceInitializer 启动时扫描 TODO 目录后即时重建索引，导入的数据在 content-index.json 中立即可见
2. [ ] 各模块 `/list` 接口支持 workspaceId 参数，返回筛选后的数据
3. [ ] 无 workspaceId 参数时返回全量数据（向后兼容）
4. [ ] 前端各模块页面在加载时自动读取 localStorage 中的工作台 ID，附加到 API 请求
5. [ ] 前端页面显示工作台筛选横幅，并提供"显示全部"按钮
6. [ ] 从 workspace.html 切换到其他模块页面时，工作台筛选状态保持一致
7. [ ] 定时扫描 TODO 目录（每 5 分钟），增量导入新的 feature-points.json