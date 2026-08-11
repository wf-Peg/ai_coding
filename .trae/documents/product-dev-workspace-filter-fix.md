# 产品开发工作台筛选与数据入库修复计划

## 问题总结

用户在 settings 模块设置了"存储路径"（如 `D:/Data/Clip_Bed`），但：
1. 选择产品开发工作台后，各模块 banner 显示"当前显示工作台 pd-builtin 筛选后的数据"，但实际页面渲染的数据未做筛选（显示全部数据）
2. 产品开发工作台筛选后应显示的数据（从 feature-points.json 导入的剪藏和待办）不存在
3. feature-points.json 已产生，`.imported` 标记已写入，但数据未出现在设置模块的"存储路径"中

## 根因分析

### 问题 1：数据落地路径不一致

**现状（有问题的数据流）：**
```
product-dev-archive skill 写入
  → TODO/{date}/feature-points.json   (默认 ./TODO/)
  → TodoScannerService.scanAndImport() 扫描 ./TODO/
  → ClipService.saveClip() / TodoService.saveTodo()
  → FileStorageService 使用 clip.storage.path 默认 ./clip-storage/
  → 数据写入 ./clip-storage/{category}/yyMMdd.json  (相对 CWD)
```

**但用户设置的存储路径是 `D:/Data/Clip_Bed`，重启后端后：**
- `FileStorageService` 的 `@Value("${clip.storage.path:./clip-storage}")` 可能被配置为 `D:/Data/Clip_Bed/clip-storage`
- 而 `TodoScannerService` 的 `@Value("${product-dev.todo-dir:./TODO}")` 仍为 `./TODO/`（相对 CWD）
- 新的 `feature-points.json` 可能不在 `./TODO/` 下，而是在 `D:/Data/Clip_Bed/TODO/` 或其它位置

**关键冲突：** `product-dev.todo-dir` 和 `clip.storage.path` 是两个独立的 Spring 配置，当用户修改 settings 中的"存储路径"时，`clip.storage.path` 会更新，但 `product-dev.todo-dir` 不会同步更新。

### 问题 2：`ContentRefMapper.fromTodo()` 缺少 tags

[ContentRefMapper.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/index/ContentRefMapper.java#L50-L65) 中 `fromTodo()` 方法：
```java
public ContentRef fromTodo(TodoContent todo) {
    return new ContentRef(
            typedId("todo", todo.getId()),
            "todo",
            ...
            List.of(),  // ← tags 永远为空！
            ...
    );
}
```

而 `TodoContent` 模型本就没有 `tags` 字段。pd-builtin 工作台规则之一是 `tag equals "product-dev"`，todo 无法通过此规则匹配。但可以通过 `category contains "product-dev"` 匹配，所以这不是主要问题。

### 问题 3：`WorkspaceFilterUtils.filterByWorkspace()` 异常时返回空列表

[WorkspaceFilterUtils.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/util/WorkspaceFilterUtils.java#L79-L81)：
```java
} catch (Exception e) {
    log.warn("Workspace filter failed for workspaceId={}: {}", workspaceId, e.getMessage());
    return List.of();  // 异常时返回空列表
}
```

如果 `content-index.json` 不存在、工作台不存在、或规则解析异常，API 会返回空列表。但用户说"数据没做筛选"（能看到全部数据），说明 `workspaceId` 参数可能未正确传递到后端。

### 问题 4：前端 `workspaceChange` 消息与初始化时序

当用户选择产品开发工作台时，[index.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L767-L774) 发送 `workspaceChange` 消息到子页面。子页面 message 监听器内调用 `updateWorkspaceBanner()` 和 `fetchClips()` 等。但此前已修复的 bug（作用域问题）可能导致消息处理失败。

## 修改方案

### 修改 1：`TodoScannerService` 使用 `AppConfigService` 的存储路径

**文件：** [TodoScannerService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/TodoScannerService.java)

**当前问题：** `todoDir` 来自 `@Value("${product-dev.todo-dir:./TODO}")`，与用户设置的存储路径无关。

**解决方案：** 让 `TodoScannerService` 的 `todoDir` 从 `AppConfigService` 的存储路径派生，确保扫描路径与用户设置的存储路径一致。

具体做法：
- 注入 `AppConfigService`
- 从 `appConfigService.getConfig().getStoragePath()` 获取用户设置的存储路径
- `todoDir = storagePath + "/TODO"`

### 修改 2：产品开发工作台初始化时写入存储路径对应位置

**文件：** [ProductDevWorkspaceInitializer.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java)

**当前问题：** `scanAndImport()` 扫描 `./TODO/`，重建索引后数据可能在默认路径下。

**解决方案：** 确保初始化时使用的路径与 `AppConfigService` 的存储路径一致：
- 在 `run()` 方法中，检查用户设置的存储路径，确保 `TodoScannerService` 从正确的路径扫描
- `ContentIndexService.rebuildFromStorage()` 已使用 `FileStorageService`，路径一致无需修改

### 修改 3：`TodoScannerService` 保存的 clip/todo 携带 workspace 标记

**文件：** [TodoScannerService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/TodoScannerService.java)

**当前问题：** 创建的 clip 和 todo 虽然设置了 `tags` 包含 `"product-dev"`、`category` 包含 `"product-dev"`，但当 `appConfigService.getConfig().getStoragePath()` 和 `clip.storage.path` 一致时，索引重建后应能正确匹配。

**解决方案：** 无需修改 — 现有逻辑（tags=["product-dev"]、category="product-dev"）已能匹配 pd-builtin 规则。

### 修改 4：确保 `TodoContent` 能被 workspace 规则正确匹配

**文件：** [ContentRefMapper.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/index/ContentRefMapper.java)

**当前问题：** `fromTodo()` 的 `tags` 为 `List.of()`，`updatedAt` 为 null。

**解决方案：** Todo 通过 `category contains "product-dev"` 匹配，`tags` 为空不影响。但仍然应该尽量填充 `updatedAt` 字段。如果 `TodoContent` 有 `updatedAt` 字段，在 `fromTodo()` 中传入。

但 `TodoContent` 没有 `updatedAt` 字段，所以 `updatedAt` 为 null 是合理的，不会影响匹配。

### 修改 5：前端确认 workspaceId 传递正确

**文件：** 检查 `clip.html`、`todo.html`、`knowledge.js`、`learning-plan.html` 的 API 调用

**当前问题：** 前端已正确传递 `workspaceId` 参数。但需确保 `workspaceChange` 消息处理函数在初始化时调用正确。

**解决方案：** 检查各子页面初始化时是否从 `localStorage` 读取 `active_workspace_id` 并调用 API。这已在之前的修复中完成。

## 实施步骤

### 步骤 1：修改 `TodoScannerService` 使用存储路径

将 `@Value("${product-dev.todo-dir:./TODO}")` 改为从 `AppConfigService` 获取路径：

```java
// 注入 AppConfigService
private final AppConfigService appConfigService;

public TodoScannerService(
        ClipService clipService,
        TodoService todoService,
        AppConfigService appConfigService) {
    this.clipService = clipService;
    this.todoService = todoService;
    this.appConfigService = appConfigService;
    // 从存储路径的父目录派生 TODO 目录
    String basePath = appConfigService.getConfig().getStoragePath();
    this.todoDir = Paths.get(basePath, "TODO").toAbsolutePath().normalize();
    ...
}
```

### 步骤 2：验证 `ProductDevWorkspaceInitializer` 路径一致性

检查 `ProductDevWorkspaceInitializer.run()` 中 `scanAndImport()` 和 `rebuildFromStorage()` 路径一致。

### 步骤 3：验证前端 `workspaceId` 传递

确认各子页面在 `workspaceChange` 消息后正确调用 API 并传递 `workspaceId`。

### 步骤 4：测试

1. 启动后端
2. 检查 `TODO/` 目录下的 `feature-points.json` 是否被正确扫描并导入
3. 检查导入的数据是否出现在 `{storagePath}/clip-storage/` 和 `{storagePath}/clip-storage/todoList/` 下
4. 选择产品开发工作台，确认各模块数据被正确筛选
5. 检查 `content-index.json` 是否包含 product-dev 数据的 ContentRef

## 验证方式

1. 查看后端日志：`[ProductDevWorkspaceInitializer] TODO 扫描结果: ...` 应有非零的 clipsCreated/todosCreated
2. 查看日志：`[ContentIndexService] rebuildFromStorage` 是否包含 product-dev 的 ContentRef
3. 前端选择产品开发工作台后，API 请求 `/api/clip/list?workspaceId=pd-builtin` 应返回匹配的数据
4. API 返回的数据应仅包含 category 含 "product-dev" 或 tags 含 "product-dev" 的 clip/todo