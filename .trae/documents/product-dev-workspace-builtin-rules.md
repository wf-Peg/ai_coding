# 产品开发工作台内置规则设计

## 概述

产品开发工作台是系统内置的 workspace，在应用首次启动时自动创建。通过内置规则自动筛选 `tag=product-dev` 的剪藏和待办，实现全链路数据展示。

## 工作台创建

### 时机

应用启动时（`ProductDevWorkspaceInitializer`，CommandLineRunner），检查是否存在固定 ID 为 `pd-builtin` 的 workspace，如果不存在则自动创建。

### 属性

| 属性 | 值 | 说明 |
|------|-----|------|
| `id` | `pd-builtin` | 固定 ID，避免重复创建 |
| `name` | `产品开发` | 工作台名称 |
| `description` | `系统自带的产品开发工作区，自动归集每次编码任务的产出` | 工作台描述 |
| `color` | `#2383e2` | 主题色（蓝色） |
| `type` | `project` | 工作台类型 |
| `status` | `active` | 状态 |
| `createdAt` | 当前时间 | 创建时间 |
| `updatedAt` | 当前时间 | 更新时间 |

## 内置规则

### 规则一：tag 筛选

| 属性 | 值 |
|------|-----|
| `field` | `tag` |
| `operator` | `equals` |
| `value` | `product-dev` |
| `enabled` | `true` |
| `description` | `自动筛选产品开发标签` |

**作用**：所有标记了 `product-dev` 标签的内容（剪藏、待办）都会被此规则命中。

### 规则二：type 筛选

| 属性 | 值 |
|------|-----|
| `field` | `type` |
| `operator` | `in` |
| `value` | `clip,todo` |
| `enabled` | `true` |
| `description` | `限定剪藏和待办类型` |

**作用**：只展示剪藏和待办类型的内容，排除知识、Wiki 等（后续扩展时调整）。

### 规则三：category 筛选

| 属性 | 值 |
|------|-----|
| `field` | `category` |
| `operator` | `contains` |
| `value` | `product-dev` |
| `enabled` | `true` |
| `description` | `分类包含 product-dev` |

**作用**：进一步限定分类包含 `product-dev` 的内容，防止误匹配其他模块的同名标签。

## 规则组合逻辑

三条规则是 **AND** 关系，即同时满足：
- `tag` 包含 `product-dev` **且**
- `type` 是 `clip` 或 `todo` **且**
- `category` 包含 `product-dev`

## 与现有工作台规则系统的兼容

### WorkspaceRule 模型

复用现有的 `WorkspaceRule` 模型：

```java
public class WorkspaceRule {
    String id;
    String workspaceId;    // → "pd-builtin"
    String field;          // → "tag" / "type" / "category"
    String operator;       // → "equals" / "in" / "contains"
    String value;          // → "product-dev" / "clip,todo" / "product-dev"
    boolean enabled;       // → true
    String description;    // → 规则描述
    int order;             // → 排序
    String createdAt;
    String updatedAt;
}
```

### WorkspaceRuleService

复用现有的 `WorkspaceRuleService`：
- `saveRule(WorkspaceRule rule)` — 创建规则
- `findByWorkspaceId(String workspaceId)` — 查询工作台的规则
- `matches(WorkspaceRule rule, ContentRef ref)` — 判断内容是否匹配规则

### 工作台解析

`WorkspaceResolution` 解析时，自动应用三条内置规则，筛选出符合条件的内容。

## 创建逻辑（伪代码）

```java
// 在 AppStartupRunner 中
public void ensureProductDevWorkspace() {
    List<Workspace> allWorkspaces = workspaceIndexService.readAll();
    boolean exists = allWorkspaces.stream()
        .anyMatch(w -> "pd-builtin".equals(w.getId()));

    if (!exists) {
        // 创建工作台
        Workspace pdWs = new Workspace();
        pdWs.setId("pd-builtin");
        pdWs.setName("产品开发");
        pdWs.setDescription("系统自带的产品开发工作区，自动归集每次编码任务的产出");
        pdWs.setColor("#2383e2");
        pdWs.setType("project");
        pdWs.setStatus("active");
        pdWs.setCreatedAt(now());
        pdWs.setUpdatedAt(now());
        workspaceIndexService.saveWorkspace(pdWs);

        // 创建规则
        workspaceRuleService.saveRule(new WorkspaceRule(
            null, "pd-builtin", "tag", "equals", "product-dev",
            true, "自动筛选产品开发标签", 1, now(), now()
        ));
        workspaceRuleService.saveRule(new WorkspaceRule(
            null, "pd-builtin", "type", "in", "clip,todo",
            true, "限定剪藏和待办类型", 2, now(), now()
        ));
        workspaceRuleService.saveRule(new WorkspaceRule(
            null, "pd-builtin", "category", "contains", "product-dev",
            true, "分类包含 product-dev", 3, now(), now()
        ));

        log.info("产品开发工作台已创建（pd-builtin）");
    }
}
```

## 规则效果

### 工作台筛选

- 用户在侧边栏选择「产品开发」工作台后
- 导览页和看板只显示满足上述三条规则的内容
- 剪藏模块和知识模块也只会出现该工作台的数据（通过 workspace 上下文过滤）

### 用户手动添加

- 用户手动加入「产品开发」工作台的内容，不受规则限制，始终保留
- 用户手动添加的内容如果不符合规则，仍会显示（规则是自动筛选，不排除手动添加）

### 规则可编辑

- 内置规则在 UI 中显示为可编辑（用户可以根据需要调整或禁用）
- 修改后的规则持久化到 `{configDir}/index/workspace-rules.json`
- 删除后不会自动恢复（除非删除整个工作台后重新创建）

## 扩展性

### 后续规则扩展

- 二期接入知识（Knowledge）时，调整规则二的 `value` 为 `clip,todo,knowledge`
- 后续接入 Wiki 时，继续追加 `type` 值
- 新的工作台类型（如"数据开发"）可复用此模式，只需修改 `autoTag` 值

### 规则模板

可为后续新增的"类型工作台"提供规则模板：

```json
{
  "product-dev": {
    "autoTag": "product-dev",
    "typeField": "in:clip,todo",
    "categoryField": "contains:product-dev"
  }
}
```

## 实施说明

1. **创建时机**：应用首次启动（`AppStartupRunner`），不是每次启动
2. **幂等性**：通过固定 ID `pd-builtin` 判断，避免重复创建
3. **数据存储**：工作台和规则复用现有 `WorkspaceIndexService` 和 `WorkspaceRuleService` 的存储机制
4. **前端展示**：侧边栏自动显示「产品开发」工作台（与其他工作台一样）