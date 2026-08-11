# 工作台规则引擎升级（SQL 式分组表达式）与数据展示修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作台规则从"全局 OR / 全局 AND"升级为两级 SQL 式分组表达式（组间 AND/OR × 组内 AND/OR），并修复 matchAll 开关点击无效、overview 不按规则作用域过滤、TODO 导入数据前端不可见（后端 JAR 缺失）三类问题。

**Architecture:** 后端在 index 目录新增 `workspace-rule-expressions.json` 作为分组结构唯一事实源（规则定义仍存于 `workspace-rules.json`）。表达式 = 根 relation（组间 AND/OR）+ 组列表（组内 relation + ruleIds）。`WorkspaceRuleService.resolve()` 改为按表达式对每个 ContentRef 做逐条求值（组内折叠 → 组间折叠），空表达式不产生规则命中，manual/relation 成员仍旁路。前端 `workspace.html` 将 matchAll 开关改造为"组间关系"选择器（修复陈旧状态回弹 bug），规则面板按组渲染，overview 支持 `?workspaceId=` 作用域。最后 `mvn package` 构建 JAR 供 Electron 启动后端。

**Tech Stack:** Java 21 / Spring Boot 3.2 / Jackson / 文件 JSON 存储 / vanilla HTML+JS / Electron / Maven 3.5.4

---

## 一、摘要与根因

| 问题 | 根因（已验证） | 修复 |
|---|---|---|
| 规则仅支持全局 OR/AND | `WorkspaceRuleService.resolve()` 对全部启用规则做单一折叠，规则平铺 | 两级分组表达式 + 逐条求值 |
| matchAll 开关点击无效 | `PUT /settings` 成功后 `loadDetail()` 用**陈旧 `workspaces` 数组**重渲染，开关回弹 | 开关改造为组间关系选择器，PUT `/rule-expression` 后用响应刷新本地状态 |
| 其它页面不按规则过滤 | `GET /api/workspace/overview` 返回全部 index 内容，无 workspace 参数 | overview 增加可选 `workspaceId` 作用域 |
| TODO 数据前端不可见 | 后端 JAR `backend/clip-demo-0.0.1-SNAPSHOT.jar` 不存在，Electron 无法启动后端（API 已验证 54 条数据存在） | `mvn package` 构建 JAR 至 Electron 期望路径，端到端验证 |

## 二、现状分析（已验证事实）

- `WorkspaceRule` record `(id, workspaceId, field, operator, value, enabled, createdAt, updatedAt)`，`FIELDS = {type, category, tag, sourcePath, workflowStatus, updatedAt}`，`OPERATORS = {equals, contains, in, before, after}`，`validate()` 校验 — **本计划不改动**。
- `WorkspaceRuleService(Path indexDir)` 构造时 `rulesPath = indexDir.resolve("workspace-rules.json")`、`exclusionsPath = ...workspace-exclusions.json`；私有 `read/write` 使用 `objectMapper`（含 JavaTimeModule）。`matches(rule, ref)` 字段/操作符匹配逻辑不变。`deleteWorkspaceData(workspaceId)` 清理 rules + exclusions（需补充清理表达式）。
- `WorkspaceRuleService.resolve(workspaceId, refs, manualMembers, relationMembers, matchAll)` 返回 `WorkspaceResolution(visible, ruleMatchedCount, manualCount, relationCount, excludedCount, visibleCount, columns, memberColumnMap, contentSources)`。内部先算 `ruleIds`（OR/AND 折叠），再 `visible = ruleIds ∪ manualIds ∪ relationIds − excludedIds`，并构建 `contentSources`（rule/manual/relation）。
- 调用点：`WorkspaceIndexService.resolveWorkspace` 第 199 行 `ruleService.resolve(workspaceId, refs, manualMembers, relationMembers, matchAll)`（其中 matchAll 来自 workspace.json，pd-builtin 当前为 `true`，AND 语义下 todo 无 tag 被排除 → 即用户看到的"局部数据"）。
- `WorkspaceController`：规则 CRUD 经私有静态包装类 `WorkspaceRuleServiceView` 调 `service.rules/saveRule/removeRule`；`RuleRequest(field, operator, value, enabled)`（record，第 580 行）；`GET /{workspaceId}/resolution` 用 `WorkspaceResolutionView` 转 body（contents/columns/ruleMatchedCount/manualCount/relationCount/excludedCount/visibleCount，content 含 id/type/sourceId/title/category/tags/sourcePath/createdAt/updatedAt/source/boardColumnId）；`GET /overview` 返回全量 contents + count + contentTypes + projects + workspaceSummary（第 95-134 行，参数 `types` 与 `query`）；`PUT /settings` 持久化 matchAll（保留不删）。
- 前端 `frontend/workspace.html`：`loadDetail()`（第 1147 行）拉 resolution+rules+exclusions，`renderRules(rules)`（第 1284 行）渲染平铺规则卡片，`renderWorkspaceSettings(ws)`（第 1298 行）渲染 matchAll 开关（bug 点：`ws` 来自陈旧 `workspaces` 数组）；规则弹窗 `openRuleModal(ruleId)`（第 1584 行）/保存（第 1690 行起，POST/PUT `/rules`，body `{field, operator, value, enabled}`）；`loadOverview()`（第 1056 行）拉全量 overview；`showView('overview')` 置 `activeWsId=null`。
- `ProductDevWorkspaceInitializer`（CommandLineRunner，`service` 包）：注入 `TodoScannerService`、`AppConfigService`；`ensureBuiltinWorkspace()` 内建 `WorkspaceRuleService`（`Path.of(configDir, "index")`），创建 pd-builtin + 3 条内置规则（pd-rule-tag / pd-rule-type / pd-rule-category），调用 `saveRule(rule)` 单参版与 `rules(workspaceId)`。
- Electron `electron/main.js`：`startupMode` 默认 `'frontend-only'`，dev 模式查找 `backend/clip-demo-0.0.1-SNAPSHOT.jar`（缺失）。
- 测试：`WorkspaceRuleServiceTest` 用 `saveRule(new WorkspaceRule(...))` + `resolve(..., false/true)`；`ProductDevWorkspaceRulesTest` 验证 3 条内置规则命中；共 92 个测试，1 个既有失败（`ClipControllerTest.testDivergentSummaryGeneratedAndPersisted`）。

## 三、锁定设计决策

1. **两级表达式模型（SQL 式）**：`RuleExpression(workspaceId, relation, groups)`，`RuleGroup(id, relation, ruleIds)`；relation 仅 `AND`/`OR`（归一化，非法值默认 OR）。语义示例 `(tag=product-dev OR category contains product-dev) AND type in (clip,todo)` = 根 relation AND + 组1 OR（两条规则）+ 组2 AND（一条规则）。
2. **存储**：规则定义仍存 `workspace-rules.json`（`WorkspaceRule` 不变）；分组结构存新文件 `workspace-rule-expressions.json`（`{"expressions":[{workspaceId, relation, groups:[{id, relation, ruleIds}]}]}`，原子写：临时文件 + rename）。
3. **求值语义（逐条 ref 求值，非聚合）**：对每个 ContentRef，空组跳过；组结果 = 组内**启用规则**按组 relation 折叠；最终 = 各非空组结果按根 relation 折叠；整体为 true 才把该 ref 加入 `ruleIds`。空表达式/全空组 → 不产生规则命中（仅 manual/relation 旁路），与旧版"无规则只显示旁路成员"一致。
4. **迁移**：`getExpression(workspaceId)` 惰性迁移（幂等）— 无表达式但有旧平铺规则时，建一个组（组 relation = 旧 matchAll ? AND : OR，根 relation = OR）。pd-builtin 由 `ProductDevWorkspaceInitializer` 显式 `saveExpression` 覆盖为内置结构（决策 6）。旧 `matchAll` 字段与 `PUT /settings` 端点保留但不再驱动解析。
5. **API 扩展**：新增 `GET/PUT /{workspaceId}/rule-expression`；`RuleRequest` 增加可选 `groupId`（POST /rules 透传，PUT/DELETE 忽略）；`GET /overview` 增加可选 `workspaceId`。
6. **pd-builtin 内置表达式**：根 AND；组1 OR [pd-rule-tag, pd-rule-category]；组2 AND [pd-rule-type]。效果：todo（无 tag）经 category 规则命中组1、type 命中组2 → 可见；clip 全命中 → 可见。
7. **前端**：matchAll 开关改造为"组间关系"选择器（`currentExpression.relation`），PUT `/rule-expression` 后以响应刷新 `currentExpression` 再 `loadDetail()`（修复回弹）；规则面板按组渲染（组卡片：组内 AND/OR 下拉 + 规则行启停/编辑/删除 + 添加规则到组）；规则弹窗加"目标组"下拉；overview 加作用域选择器 + 横幅。
8. **构建**：`mvn package` 产出 JAR，复制到 `backend/clip-demo-0.0.1-SNAPSHOT.jar`（Electron dev 模式期望路径）。

## 四、文件结构

| 文件 | 动作 | 责任 |
|---|---|---|
| `backend/src/main/java/com/example/clip/index/RuleGroup.java` | 新建 | 组模型 + relation 归一化 |
| `backend/src/main/java/com/example/clip/index/RuleExpression.java` | 新建 | 表达式模型 + empty 工厂 |
| `backend/src/main/java/com/example/clip/index/RuleExpressionUpdateRequest.java` | 新建 | PUT 请求体 |
| `backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java` | 修改 | 表达式存储/迁移/逐条求值/saveRule/removeRule/deleteWorkspaceData |
| `backend/src/main/java/com/example/clip/index/WorkspaceIndexService.java` | 修改 | resolveWorkspace 去 matchAll 传递 |
| `backend/src/main/java/com/example/clip/controller/WorkspaceController.java` | 修改 | 表达式端点 + groupId + overview 作用域 + wrapper 扩展 |
| `backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java` | 修改 | 写入内置表达式 |
| `backend/src/test/java/com/example/clip/index/WorkspaceRuleServiceTest.java` | 修改 | 表达式语义测试 |
| `backend/src/test/java/com/example/clip/service/ProductDevWorkspaceRulesTest.java` | 修改 | 内置表达式测试 |
| `frontend/workspace.html` | 修改 | 开关修复、分组渲染、overview 作用域 |
| `backend/clip-demo-0.0.1-SNAPSHOT.jar` | 产出 | Electron 启动用 |

---

## Task 1: 后端模型（RuleGroup / RuleExpression / 请求体）

**Files:**
- Create: `backend/src/main/java/com/example/clip/index/RuleGroup.java`
- Create: `backend/src/main/java/com/example/clip/index/RuleExpression.java`
- Create: `backend/src/main/java/com/example/clip/index/RuleExpressionUpdateRequest.java`

- [ ] **Step 1: 创建 `RuleGroup.java`**

```java
package com.example.clip.index;

import java.util.List;
import java.util.UUID;

public record RuleGroup(String id, String relation, List<String> ruleIds) {

    public static final String AND = "AND";
    public static final String OR = "OR";

    public RuleGroup {
        if (id == null || id.isBlank()) id = UUID.randomUUID().toString();
        relation = normalizeRelation(relation);
        ruleIds = ruleIds == null ? List.of() : List.copyOf(ruleIds);
    }

    public static String normalizeRelation(String relation) {
        return (relation != null && "AND".equalsIgnoreCase(relation.trim())) ? AND : OR;
    }
}
```

- [ ] **Step 2: 创建 `RuleExpression.java`**

```java
package com.example.clip.index;

import java.util.List;
import java.util.UUID;

public record RuleExpression(String workspaceId, String relation, List<RuleGroup> groups) {

    public RuleExpression {
        relation = RuleGroup.normalizeRelation(relation);
        groups = groups == null ? List.of() : List.copyOf(groups);
    }

    public static RuleExpression empty(String workspaceId) {
        return new RuleExpression(workspaceId, RuleGroup.OR,
                List.of(new RuleGroup(UUID.randomUUID().toString(), RuleGroup.OR, List.of())));
    }
}
```

- [ ] **Step 3: 创建 `RuleExpressionUpdateRequest.java`**

```java
package com.example.clip.index;

import java.util.List;

public record RuleExpressionUpdateRequest(String relation, List<RuleGroup> groups) {
}
```

- [ ] **Step 4: 编译验证**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' compile -q`
Expected: BUILD SUCCESS（无输出、退出码 0）

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/example/clip/index/RuleGroup.java backend/src/main/java/com/example/clip/index/RuleExpression.java backend/src/main/java/com/example/clip/index/RuleExpressionUpdateRequest.java
git commit -m "feat(rule): add RuleExpression/RuleGroup models for nested rule groups"
```

---

## Task 2: WorkspaceRuleService — 表达式存储、迁移、逐条求值

**Files:**
- Modify: `backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java`

- [ ] **Step 1: 新增表达式路径常量、读写与公开 API**

在类中新增常量与字段：

```java
private static final String EXPRESSION_FILE = "workspace-rule-expressions.json";
private final Path expressionPath; // 构造器中：expressionPath = indexDir.resolve(EXPRESSION_FILE);
```

构造器改为：

```java
public WorkspaceRuleService(Path indexDir) {
    this.rulesPath = indexDir.resolve("workspace-rules.json");
    this.exclusionsPath = indexDir.resolve("workspace-exclusions.json");
    this.expressionPath = indexDir.resolve(EXPRESSION_FILE);
}
```

新增方法（追加到类中）：

```java
// ---- 表达式存储 ----
private Map<String, RuleExpression> readExpressions() {
    if (!Files.exists(expressionPath)) return new LinkedHashMap<>();
    try {
        JsonNode root = objectMapper.readTree(expressionPath.toFile());
        Map<String, RuleExpression> map = new LinkedHashMap<>();
        for (JsonNode node : root.path("expressions")) {
            RuleExpression expr = objectMapper.treeToValue(node, RuleExpression.class);
            map.put(expr.workspaceId(), expr);
        }
        return map;
    } catch (IOException e) {
        throw new IllegalStateException("读取规则表达式失败: " + expressionPath, e);
    }
}

private void writeExpressions(Map<String, RuleExpression> all) {
    Path tmp = expressionPath.resolveSibling(expressionPath.getFileName() + ".tmp");
    Map<String, List<RuleExpression>> wrapper = Map.of("expressions", new ArrayList<>(all.values()));
    try {
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), wrapper);
        Files.move(tmp, expressionPath, StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException e) {
        throw new IllegalStateException("写入规则表达式失败: " + expressionPath, e);
    }
}

/** 惰性迁移（幂等）：无表达式但有旧平铺规则时，建一个组（组 relation = legacyMatchAll ? AND : OR，根 relation = OR）。 */
public RuleExpression getExpression(String workspaceId) {
    Map<String, RuleExpression> all = readExpressions();
    if (all.containsKey(workspaceId)) return all.get(workspaceId);
    List<WorkspaceRule> legacy = readRules(workspaceId);
    if (legacy.isEmpty()) return null;
    RuleGroup group = new RuleGroup(UUID.randomUUID().toString(), "OR",
            legacy.stream().map(WorkspaceRule::id).toList());
    RuleExpression expr = new RuleExpression(workspaceId, "OR", List.of(group));
    all.put(workspaceId, expr);
    writeExpressions(all);
    return expr;
}

public RuleExpression saveExpression(RuleExpression expression) {
    Map<String, RuleExpression> all = readExpressions();
    all.put(expression.workspaceId(), expression);
    writeExpressions(all);
    return expression;
}
```

说明：`readRules(workspaceId)` = 现有 `rulesPath` 读取并按 workspaceId 过滤的私有方法（将现有 `rules(workspaceId)` 的读取体抽取为 `readRules`，公开 `rules(workspaceId)` 继续直接返回 `readRules` 结果以保持 GET /rules 行为不变）。若 `objectMapper` 缺少 `JsonNode`/`treeToValue` 所需 import，补充 `import com.fasterxml.jackson.databind.JsonNode;`。

- [ ] **Step 2: 重写 `resolve()` 为逐条求值（去掉 matchAll 参数）**

```java
public synchronized WorkspaceResolution resolve(String workspaceId, Collection<ContentRef> refs,
                                                Collection<WorkspaceMembership> manualMembers,
                                                Collection<WorkspaceMembership> relationMembers) {
    requireText(workspaceId, "workspaceId");
    Map<String, ContentRef> byId = new LinkedHashMap<>();
    if (refs != null) refs.forEach(ref -> { if (ref != null && ref.id() != null) byId.put(ref.id(), ref); });

    // 表达式逐条求值：内容须让整个表达式为 true 才被规则命中
    Set<String> ruleIds = new LinkedHashSet<>();
    RuleExpression expr = getExpression(workspaceId);
    if (expr != null && expr.groups() != null && !expr.groups().isEmpty()) {
        for (ContentRef ref : byId.values()) {
            List<Boolean> groupResults = new ArrayList<>();
            for (RuleGroup group : expr.groups()) {
                if (group.ruleIds() == null || group.ruleIds().isEmpty()) continue;
                List<Boolean> ruleResults = new ArrayList<>();
                for (String ruleId : group.ruleIds()) {
                    WorkspaceRule rule = findRule(workspaceId, ruleId);
                    if (rule != null && rule.enabled()) ruleResults.add(matches(rule, ref));
                }
                if (!ruleResults.isEmpty()) groupResults.add(fold(group.relation(), ruleResults));
            }
            if (!groupResults.isEmpty() && fold(expr.relation(), groupResults)) {
                ruleIds.add(ref.id());
            }
        }
    }

    Set<String> manualIds = memberIds(workspaceId, manualMembers);
    Set<String> relationIds = memberIds(workspaceId, relationMembers);
    Set<String> excludedIds = new LinkedHashSet<>();
    exclusions(workspaceId).forEach(item -> excludedIds.add(item.contentId()));
    Set<String> candidates = new LinkedHashSet<>(ruleIds);
    candidates.addAll(manualIds);
    candidates.addAll(relationIds);
    candidates.removeAll(excludedIds);
    List<ContentRef> visible = candidates.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();
    Map<String, String> contentSources = new LinkedHashMap<>();
    for (ContentRef ref : visible) {
        if (ruleIds.contains(ref.id())) contentSources.put(ref.id(), "rule");
        else if (manualIds.contains(ref.id())) contentSources.put(ref.id(), "manual");
        else if (relationIds.contains(ref.id())) contentSources.put(ref.id(), "relation");
    }
    return new WorkspaceResolution(visible, ruleIds.size(), manualIds.size(), relationIds.size(),
            (int) excludedIds.stream().filter(byId::containsKey).count(), visible.size(),
            List.of(), Map.of(), contentSources);
}

/** 布尔折叠：acc op value，首项直接取 value */
private boolean fold(String relation, List<Boolean> values) {
    boolean acc = values.get(0);
    boolean and = RuleGroup.AND.equalsIgnoreCase(relation);
    for (int i = 1; i < values.size(); i++) acc = and ? (acc && values.get(i)) : (acc || values.get(i));
    return acc;
}

/** 按 ruleId 从规则文件中查找（现有 rules(workspaceId) 过滤逻辑的复用） */
private WorkspaceRule findRule(String workspaceId, String ruleId) {
    return readRules(workspaceId).stream()
            .filter(r -> r.id().equals(ruleId)).findFirst().orElse(null);
}
```

说明：原 `resolve` 中 `rules(workspaceId)` 循环与 `matchAll` 分支被删除；`matches`、`memberIds`、`readRules`、`writeRules` 保持原样。

- [ ] **Step 3: 改造 `saveRule` / `removeRule` / `deleteWorkspaceData`**

保留单参 `saveRule(WorkspaceRule)`（groupId 缺省 null），新增三参版：

```java
public synchronized void saveRule(WorkspaceRule rule) {
    saveRule(rule, null);
}

public synchronized void saveRule(WorkspaceRule rule, String groupId) {
    rule.validate();
    List<WorkspaceRule> values = readRules(rule.workspaceId());
    values.removeIf(item -> item.id().equals(rule.id()));
    values.add(rule);
    writeRules(values); // 现有写入逻辑（写到 rulesPath 全量）

    RuleExpression expr = getExpression(rule.workspaceId());
    if (expr == null) expr = RuleExpression.empty(rule.workspaceId());
    List<RuleGroup> groups = new ArrayList<>(expr.groups());
    if (groups.isEmpty()) groups.add(new RuleGroup(UUID.randomUUID().toString(), "OR", List.of()));
    int target = 0;
    if (groupId != null && !groupId.isBlank()) {
        for (int i = 0; i < groups.size(); i++) {
            if (groupId.equals(groups.get(i).id())) { target = i; break; }
        }
    }
    List<String> ids = new ArrayList<>(groups.get(target).ruleIds());
    if (!ids.contains(rule.id())) ids.add(rule.id());
    groups.set(target, new RuleGroup(groups.get(target).id(), groups.get(target).relation(), ids));
    saveExpression(new RuleExpression(rule.workspaceId(), expr.relation(), groups));
}
```

`removeRule` 改造为同时从表达式移除并清理空组（兜底默认组）：

```java
public synchronized void removeRule(String ruleId) {
    requireText(ruleId, "ruleId");
    List<WorkspaceRule> all = readAllRules();
    all.removeIf(item -> item.id().equals(ruleId));
    writeRules(all);

    Map<String, RuleExpression> exprs = readExpressions();
    Map<String, RuleExpression> updated = new LinkedHashMap<>();
    for (RuleExpression expr : exprs.values()) {
        List<RuleGroup> groups = new ArrayList<>();
        for (RuleGroup g : expr.groups()) {
            List<String> ids = new ArrayList<>(g.ruleIds());
            ids.remove(ruleId);
            if (!ids.isEmpty()) groups.add(new RuleGroup(g.id(), g.relation(), ids));
        }
        if (groups.isEmpty()) groups.add(new RuleGroup(UUID.randomUUID().toString(), "OR", List.of()));
        updated.put(expr.workspaceId(), new RuleExpression(expr.workspaceId(), expr.relation(), groups));
    }
    if (!updated.isEmpty()) writeExpressions(updated);
}
```

说明：`readAllRules()` = 现有 `read(rulesPath, ...)` 全量读取的抽取（原 `removeRule` 直接操作全量，语义不变）。`deleteWorkspaceData` 末尾追加删除表达式：

```java
public synchronized void deleteWorkspaceData(String workspaceId) {
    // ...现有 rules/exclusions 清理不变...
    Map<String, RuleExpression> exprs = readExpressions();
    if (exprs.remove(workspaceId) != null) writeExpressions(exprs);
}
```

- [ ] **Step 4: 编译，收集旧签名调用点**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' compile -q`
Expected: 唯一报错为旧 `resolve(..., matchAll)` 调用点（`WorkspaceIndexService.java:199` 与测试文件），Task 4 / Task 6 修复。

- [ ] **Step 5: Commit（若编译未通过，先完成 Task 4/6 再回提）**

```bash
git add backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java
git commit -m "feat(rule): expression storage, per-ref nested-group resolve, rule CRUD sync"
```

---

## Task 3: WorkspaceController — 表达式端点 + groupId + overview 作用域

**Files:**
- Modify: `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`

- [ ] **Step 1: 扩展 `WorkspaceRuleServiceView` 包装类**

在第 592-605 行 `WorkspaceRuleServiceView` 内新增：

```java
private RuleExpression getExpression(String workspaceId) { return service.getExpression(workspaceId); }
private RuleExpression saveExpression(RuleExpression expression) { return service.saveExpression(expression); }
private void saveRule(WorkspaceRule rule, String groupId) { service.saveRule(rule, groupId); }
```

- [ ] **Step 2: 新增表达式端点（放在 `/rules` 相关端点附近）**

```java
@GetMapping("/{workspaceId}/rule-expression")
public ResponseEntity<?> ruleExpression(@PathVariable String workspaceId) {
    try {
        WorkspaceIndexService indexService = workspaceIndexService();
        requireWorkspace(indexService, workspaceId);
        RuleExpression expr = new WorkspaceRuleServiceView(indexDir()).getExpression(workspaceId);
        return ResponseEntity.ok(expr != null ? expr : RuleExpression.empty(workspaceId));
    } catch (RuntimeException error) {
        return errorResponse(error);
    }
}

@PutMapping("/{workspaceId}/rule-expression")
public ResponseEntity<?> updateRuleExpression(@PathVariable String workspaceId,
                                              @RequestBody RuleExpressionUpdateRequest request) {
    try {
        WorkspaceIndexService indexService = workspaceIndexService();
        requireWorkspace(indexService, workspaceId);
        if (request == null) throw new IllegalArgumentException("请求不能为空");
        List<RuleGroup> groups = request.groups() == null ? List.of()
                : request.groups().stream()
                    .map(g -> new RuleGroup(g.id(), RuleGroup.normalizeRelation(g.relation()), g.ruleIds()))
                    .toList();
        RuleExpression saved = new WorkspaceRuleServiceView(indexDir())
                .saveExpression(new RuleExpression(workspaceId, request.relation(), groups));
        return ResponseEntity.ok(saved);
    } catch (RuntimeException error) {
        return errorResponse(error);
    }
}
```

- [ ] **Step 3: `RuleRequest` 增加 `groupId`，POST /rules 透传**

第 580 行改为：

```java
public record RuleRequest(String field, String operator, String value, boolean enabled, String groupId) {}
```

`createRule`（第 240-254 行）中 `new WorkspaceRuleServiceView(indexDir()).saveRule(rule);` 改为：

```java
new WorkspaceRuleServiceView(indexDir()).saveRule(rule, request.groupId());
```

`validate(RuleRequest)`（第 505 行）不变（groupId 可选，不校验）。前端现有 POST body 不含 groupId → `request.groupId()` 为 null → 挂入首组，向后兼容。

- [ ] **Step 4: `GET /overview` 增加可选 `workspaceId`**

第 95-134 行方法签名与逻辑改为：当 `workspaceId` 非空时走作用域分支，否则走现有全量逻辑：

```java
@GetMapping("/overview")
public ResponseEntity<Map<String, Object>> overview(
        @RequestParam(required = false) String workspaceId,
        @RequestParam(required = false) List<String> types,
        @RequestParam(required = false, defaultValue = "") String query) {
    try {
        Path indexDir = indexDir();
        if (workspaceId != null && !workspaceId.isBlank()) {
            WorkspaceResolution resolution = workspaceIndexService().resolveWorkspace(workspaceId,
                    new ContentIndexService(indexDir.resolve("content-index.json")).readAll(), List.of());
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("contents", new WorkspaceResolutionView(resolution).body().get("contents"));
            result.put("count", resolution.visibleCount());
            result.put("scoped", true);
            result.put("workspaceId", workspaceId);
            result.put("contentTypes", CONTENT_TYPES);
            result.put("projects", List.of());
            result.put("workspaceSummary", workspaceSummaryOf(indexDir));
            return ResponseEntity.ok(result);
        }
        return ResponseEntity.ok(overviewAll(indexDir, types, query));
    } catch (IllegalStateException error) {
        return serviceUnavailable("无法读取工作台索引数据");
    }
}
```

将原 overview 方法体（类型过滤 + 关键词过滤 + projects + workspaceSummary）抽取为私有 `overviewAll(Path indexDir, List<String> types, String query)`，并把 workspaceSummary 组装抽取为私有 `workspaceSummaryOf(Path indexDir)` 供两分支复用。`WorkspaceResolutionView` 为已存在的私有 record（第 607 行），`resolution` 字段为 public accessor，可用。

- [ ] **Step 5: 编译**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' compile -q`
Expected: 除 `WorkspaceIndexService` 旧签名（Task 4 修复）与测试（Task 6 修复）外无其他错误。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/example/clip/controller/WorkspaceController.java
git commit -m "feat(rule): rule-expression endpoints, rule groupId, scoped overview"
```

---

## Task 4: WorkspaceIndexService — resolveWorkspace 去掉 matchAll 传递

**Files:**
- Modify: `backend/src/main/java/com/example/clip/index/WorkspaceIndexService.java`

- [ ] **Step 1: 删除 matchAll 读取与传参**

第 193-199 行改为：

```java
WorkspaceResolution resolution = ruleService.resolve(workspaceId, refs, manualMembers, relationMembers);
```

并删除其上方的 matchAll 读取代码块（第 193-198 行 `boolean matchAll = ...`）。方法签名 `resolveWorkspace(String workspaceId, Collection<ContentRef> refs, Collection<WorkspaceMembership> relationMembers)` 不变。

- [ ] **Step 2: 编译**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' compile -q`
Expected: BUILD SUCCESS（残留错误仅测试文件）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/example/clip/index/WorkspaceIndexService.java
git commit -m "refactor(rule): resolveWorkspace uses expression, drop matchAll passthrough"
```

---

## Task 5: ProductDevWorkspaceInitializer — 写入内置表达式

**Files:**
- Modify: `backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java`

- [ ] **Step 1: `ensureBuiltinWorkspace` 末尾追加表达式写入**

在 `ensureBuiltinRules(ruleService)` 调用之后追加：

```java
// 写入内置规则表达式：(tag=product-dev OR category contains product-dev) AND type in (clip,todo)
RuleExpression builtin = new RuleExpression(
        PD_BUILTIN_WORKSPACE_ID, "AND",
        List.of(
                new RuleGroup("pd-group-1", "OR", List.of("pd-rule-tag", "pd-rule-category")),
                new RuleGroup("pd-group-2", "AND", List.of("pd-rule-type"))));
ruleService.saveExpression(builtin);
log.info("[ProductDevWorkspaceInitializer] 内置规则表达式已写入: {}", builtin);
```

需补充 import：`com.example.clip.index.RuleExpression`、`com.example.clip.index.RuleGroup`。注意 `ensureBuiltinWorkspace` 的"已存在"分支（第 93-98 行）也在 `ensureBuiltinRules` 后执行同一写入，保证幂等覆盖（`saveExpression` 以 workspaceId 为 key 覆盖写，重复启动安全）。

- [ ] **Step 2: 编译**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' compile -q`
Expected: BUILD SUCCESS。

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java
git commit -m "feat(rule): seed pd-builtin nested expression (AND of OR-group and AND-group)"
```

---

## Task 6: 后端测试（TDD 补强）

**Files:**
- Modify: `backend/src/test/java/com/example/clip/index/WorkspaceRuleServiceTest.java`
- Modify: `backend/src/test/java/com/example/clip/service/ProductDevWorkspaceRulesTest.java`

- [ ] **Step 1: 更新 `WorkspaceRuleServiceTest` 的 resolve 用例**

将现有 `resolve(..., false/true)` 调用改为新签名；删除原单层 OR/AND 用例，替换为表达式语义用例（保留原有去重/排除/统计用例，仅改 resolve 调用为 4 参，并把 `saveRule` 调用改为兼容写法——单参版仍可用）：

```java
@Test
void resolve_withNestedGroups() {
    WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
    LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
    service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "java", true, now, now));
    service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));
    service.saveRule(new WorkspaceRule("r3", "w", "type", "in", "clip,todo", true, now, now));
    service.saveExpression(new RuleExpression("w", "AND",
            List.of(new RuleGroup("g1", "OR", List.of("r1", "r2")),
                    new RuleGroup("g2", "AND", List.of("r3")))));

    List<ContentRef> refs = List.of(
            ref("clip:1", "clip", "Java 后端开发", "开发", List.of("Java"), now),
            ref("clip:2", "knowledge", "Spring Boot 入门", "开发", List.of("Java"), now.minusDays(2)),
            ref("clip:3", "todo", "采购清单", "生活", List.of("采购"), now.plusDays(1))
    );
    // r1: tag=java（clip:1, clip:2 命中）; r2: category=开发（clip:1, clip:2 命中）; r3: type in clip,todo（clip:1, clip:3 命中）
    // AND: 组1 OR 命中 && 组2 AND 命中 → clip:1 通过（组1 r1/r2 命中、组2 r3 命中）；clip:2 组2 失败；clip:3 组1 失败
    WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());

    assertEquals(1, resolution.visibleCount(), "仅 clip:1 使整个表达式为 true");
    assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:1")));
    assertFalse(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:2")));
    assertFalse(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:3")));
    assertEquals("rule", resolution.contentSources().get("clip:1"));
}

@Test
void resolve_emptyExpression_onlyBypassMembers() {
    WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
    LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
    List<ContentRef> refs = List.of(
            ref("clip:1", "clip", "Java 开发", "开发", List.of("Java"), now));
    WorkspaceResolution resolution = service.resolve("w", refs,
            List.of(new WorkspaceMembership("w", "clip:1", "manual", "手动", 1.0, "", 1, now, now)),
            List.of());
    assertEquals(1, resolution.visibleCount(), "无表达式时仅 manual 成员可见");
    assertEquals("manual", resolution.contentSources().get("clip:1"));
}

@Test
void resolve_legacyRules_migrateToSingleOrGroup() {
    WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
    LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
    service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "java", true, now, now));
    service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));
    // 未写表达式 → getExpression 惰性迁移为单组 OR
    List<ContentRef> refs = List.of(
            ref("clip:1", "clip", "Java 后端", "其他", List.of("Java"), now),
            ref("clip:3", "todo", "采购", "生活", List.of("采购"), now));
    WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
    assertEquals(2, resolution.visibleCount(), "迁移后单组 OR：任一规则命中即可见");
}
```

说明：`ref(id, type, title, category, tags, updatedAt)` 为测试类现有工厂方法；`saveRule` 单参版保留，上述用例可直接使用。

- [ ] **Step 2: 扩展 `ProductDevWorkspaceRulesTest`**

在现有测试后追加：

```java
@Test
void builtinExpression_structureAndResolution() {
    Path indexDir = tempDir.resolve("index");
    WorkspaceIndexService wsService = new WorkspaceIndexService(indexDir);
    WorkspaceRuleService ruleService = new WorkspaceRuleService(indexDir);
    // 复用现有 setup 中 pd-builtin 工作台 + 3 条内置规则的创建逻辑，然后：
    ruleService.saveExpression(new RuleExpression("pd-builtin", "AND",
            List.of(new RuleGroup("pd-group-1", "OR", List.of("pd-rule-tag", "pd-rule-category")),
                    new RuleGroup("pd-group-2", "AND", List.of("pd-rule-type")))));

    RuleExpression expr = ruleService.getExpression("pd-builtin");
    assertNotNull(expr);
    assertEquals("AND", expr.relation());
    assertEquals(2, expr.groups().size());
    assertEquals("OR", expr.groups().get(0).relation());
    assertEquals(List.of("pd-rule-tag", "pd-rule-category"), expr.groups().get(0).ruleIds());
    assertEquals("AND", expr.groups().get(1).relation());
    assertEquals(List.of("pd-rule-type"), expr.groups().get(1).ruleIds());

    // todo 无 tag 但 category=product-dev、type=todo → 命中；clip tag+category+type 全命中
    List<ContentRef> refs = List.of(
            new ContentRef("clip:1", "clip", "1", "设计", "product-dev/design",
                    List.of("product-dev"), null, now, now, "body"),
            new ContentRef("todo:1", "todo", "1", "任务", "product-dev",
                    List.of(), null, now, now, "body"));
    WorkspaceResolution resolution = ruleService.resolve("pd-builtin", refs, List.of(), List.of());
    assertEquals(2, resolution.visibleCount(), "todo 经 category 规则命中，clip 全命中");
}
```

- [ ] **Step 3: 运行全部后端测试**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' test`
Expected: 除 1 个既有失败（`ClipControllerTest.testDivergentSummaryGeneratedAndPersisted`）外全部通过；因签名变更失效的旧 resolve 用例已全部改写。

- [ ] **Step 4: Commit**

```bash
git add backend/src/test
git commit -m "test(rule): nested-group semantics, migration fallback, builtin expression"
```

---

## Task 7: 前端 workspace.html — 开关修复 + 表达式状态

**Files:**
- Modify: `frontend/workspace.html`

- [ ] **Step 1: 新增全局状态并让 `loadDetail()` 拉取表达式**

在 `let workspaces = [];` 附近声明：

```javascript
let currentExpression = null;
```

在 `loadDetail()` 中，`renderRules(rulesData)` 之前追加：

```javascript
const exprResp = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, { headers: { Accept: 'application/json' } });
currentExpression = exprResp.ok ? await exprResp.json() : { workspaceId: activeWsId, relation: 'OR', groups: [] };
```

- [ ] **Step 2: 重写 `renderWorkspaceSettings`（开关 = 组间关系选择器，修复回弹）**

将现有 `renderWorkspaceSettings(ws)`（第 1298-1330 行）整体替换为：

```javascript
function renderWorkspaceSettings(ws) {
  const settingsEl = $('workspaceSettings');
  if (!settingsEl) return;
  const rootRelation = (currentExpression && currentExpression.relation) || 'OR';
  settingsEl.innerHTML = `
    <div class="settings-section">
      <h4>规则匹配模式（组间关系）</h4>
      <label class="toggle-label">
        <input type="checkbox" id="matchAllToggle" ${rootRelation === 'AND' ? 'checked' : ''}>
        <span class="toggle-slider"></span>
        <span class="toggle-text">${rootRelation === 'AND' ? '所有分组必须全部命中（组间 AND）' : '任一分组命中即可（组间 OR）'}</span>
      </label>
      <p class="settings-hint">组间关系控制分组之间的连接方式；每个分组内部还可单独设置 AND/OR（见下方规则分组）。手动加入和关系带入的内容不受影响。</p>
    </div>
  `;
  const toggle = $('matchAllToggle');
  if (toggle) {
    toggle.addEventListener('change', async () => {
      const newRelation = toggle.checked ? 'AND' : 'OR';
      const groups = (currentExpression && currentExpression.groups) || [];
      try {
        const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relation: newRelation, groups })
        });
        if (!r.ok) throw new Error('保存失败');
        currentExpression = await r.json();
        await loadDetail();
      } catch (e) {
        showDetailError('保存设置失败：' + (e.message || '后端服务不可用'));
        toggle.checked = newRelation !== 'AND';
      }
    });
  }
}
```

关键修复点：保存后以 `PUT` 响应覆盖 `currentExpression`，再 `loadDetail()` 重拉（`loadDetail` 会重新 GET 表达式），不再依赖陈旧 `workspaces` 数组，开关不再回弹；且开关不再调用 `PUT /settings`。

- [ ] **Step 3: JS 语法预检（命令见 Task 10 Step 2），通过后 Commit**

```bash
git add frontend/workspace.html
git commit -m "fix(ui): repurpose matchAll toggle to expression root relation, fix stale re-render"
```

---

## Task 8: 前端 workspace.html — 规则面板按组渲染 + 弹窗组下拉

**Files:**
- Modify: `frontend/workspace.html`

- [ ] **Step 1: 用 `renderExpression()` 替换 `renderRules()` 的渲染体**

`loadDetail()` 中 `renderRules(rulesData);` 改为 `renderExpression(rulesData);`。`renderRules` 改名并重写：

```javascript
/* ── Rules（分组渲染）── */
function renderExpression(rulesData) {
  const rules = rulesData || [];
  const rulesById = {};
  rules.forEach(r => { rulesById[r.id] = r; });
  const container = $('rulesList');
  if (!currentExpression || !currentExpression.groups || !currentExpression.groups.length) {
    container.innerHTML = '<div class="empty-state">暂无规则，点击上方添加。</div>';
    return;
  }
  container.innerHTML = currentExpression.groups.map((group, gi) => {
    const rows = (group.ruleIds || [])
      .map(rid => rulesById[rid])
      .filter(Boolean)
      .map((r, ri) => `
        <div class="rule-row">
          <span class="rule-field">${escapeHtml(FIELD_LABELS[r.field] || r.field)}</span>
          <span class="rule-operator">${escapeHtml(OPERATOR_LABELS[r.operator] || r.operator)}</span>
          <span class="rule-value" title="${escapeHtml(r.value)}">${escapeHtml(r.value)}</span>
          <button class="toggle-switch ${r.enabled ? 'on' : ''}" data-rule-id="${escapeHtml(r.id)}" data-enabled="${r.enabled}" type="button" aria-label="切换启用状态" data-func-tag="功能:规则开关" title="启用/禁用规则"></button>
          <button class="rule-edit-btn" data-rule-id="${escapeHtml(r.id)}" data-group-id="${escapeHtml(group.id)}" type="button" title="编辑" data-func-tag="功能:编辑规则">&#9998;</button>
          <button class="rule-del-btn" data-rule-id="${escapeHtml(r.id)}" type="button" title="删除" data-func-tag="功能:删除规则">&times;</button>
        </div>`)
      .join('');
    return `
      <div class="rule-group">
        <div class="rule-group-header">
          <span class="rule-group-title">分组 ${gi + 1}</span>
          <select class="rule-group-relation" data-group-id="${escapeHtml(group.id)}">
            <option value="OR" ${group.relation === 'OR' ? 'selected' : ''}>组内任一命中（OR）</option>
            <option value="AND" ${group.relation === 'AND' ? 'selected' : ''}>组内全部命中（AND）</option>
          </select>
          <button class="rule-group-add" data-group-id="${escapeHtml(group.id)}" type="button" title="向此分组添加规则" data-func-tag="功能:添加规则到分组">+ 添加规则</button>
        </div>
        <div class="rule-group-list">${rows || '<span class="rule-group-empty">空分组（不参与匹配）</span>'}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.toggle-switch').forEach(btn => btn.addEventListener('click', () => toggleRule(btn.dataset.ruleId, btn.dataset.enabled === 'true')));
  container.querySelectorAll('.rule-edit-btn').forEach(btn => btn.addEventListener('click', () => openRuleModal(btn.dataset.ruleId, btn.dataset.groupId)));
  container.querySelectorAll('.rule-del-btn').forEach(btn => btn.addEventListener('click', () => deleteRule(btn.dataset.ruleId)));
  container.querySelectorAll('.rule-group-relation').forEach(sel => sel.addEventListener('change', () => updateGroupRelation(sel.dataset.groupId, sel.value)));
  container.querySelectorAll('.rule-group-add').forEach(btn => btn.addEventListener('click', () => openRuleModal(null, btn.dataset.groupId)));
}

async function updateGroupRelation(groupId, relation) {
  if (!currentExpression) return;
  const groups = currentExpression.groups.map(g =>
    g.id === groupId ? { id: g.id, relation, ruleIds: g.ruleIds } : g);
  try {
    const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/rule-expression`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relation: currentExpression.relation, groups })
    });
    if (!r.ok) throw new Error('保存失败');
    currentExpression = await r.json();
    await loadDetail();
  } catch (e) {
    showDetailError('保存分组关系失败：' + (e.message || '后端服务不可用'));
  }
}
```

说明：`toggleRule` / `deleteRule` 现有实现复用；`openRuleModal` 签名在 Step 2 扩展。原 `renderRules` 删除。

- [ ] **Step 2: 规则弹窗增加"目标组"下拉**

`openRuleModal(ruleId, groupId)` 签名扩展为 `openRuleModal(ruleId, groupId)`（第二参可选）。在函数体开头（重置状态后）追加：

```javascript
const groupSelect = $('ruleModalGroup');
if (groupSelect && currentExpression && currentExpression.groups && currentExpression.groups.length) {
  groupSelect.innerHTML = currentExpression.groups.map((g, i) =>
    `<option value="${escapeHtml(g.id)}">分组 ${i + 1}（${g.relation === 'AND' ? 'AND' : 'OR'}，${(g.ruleIds || []).length} 条）</option>`).join('');
  groupSelect.value = groupId || currentExpression.groups[0].id || '';
} else if (groupSelect) {
  groupSelect.innerHTML = '<option value="">（自动创建分组）</option>';
  groupSelect.value = '';
}
```

弹窗内规则保存逻辑（第 1714-1722 行 fetch 之前）的 body 增加 groupId（仅新增规则时携带）：

```javascript
const body = { field, operator, value, enabled };
if (!editingRuleId && $('ruleModalGroup')) {
  body.groupId = $('ruleModalGroup').value;
}
// 后续 fetch POST /rules 或 PUT /rules/{id}，body 改为 JSON.stringify(body)
```

HTML 中在 `ruleModal` 内、规则字段区之前新增：

```html
<div class="form-row">
  <label for="ruleModalGroup">目标分组</label>
  <select id="ruleModalGroup"></select>
</div>
```

- [ ] **Step 3: JS 语法预检（Task 10 Step 2），通过后 Commit**

```bash
git add frontend/workspace.html
git commit -m "feat(ui): render rule groups with inner AND/OR, rule modal group picker"
```

---

## Task 9: 前端 workspace.html — overview 作用域选择器与横幅

**Files:**
- Modify: `frontend/workspace.html`

- [ ] **Step 1: 新增作用域状态并改造 `loadOverview()`**

在 `overviewState` 附近新增：

```javascript
let overviewWorkspaceId = null;
```

`loadOverview()`（第 1056 行）的 params 构造处改为：

```javascript
if (overviewWorkspaceId) params.set('workspaceId', overviewWorkspaceId);
```

并在渲染 contents 后追加横幅渲染：

```javascript
renderOverviewScopeBanner(overviewState.data);
```

新增函数（放在 `overviewRenderContents` 附近）：

```javascript
function renderOverviewScopeBanner(data) {
  const banner = $('overviewScopeBanner');
  if (!banner) return;
  if (data && data.scoped) {
    const ws = workspaces.find(w => w.id === data.workspaceId);
    banner.hidden = false;
    banner.textContent = '当前作用域：' + (ws ? ws.name : data.workspaceId) + '（仅显示该工作区规则命中的内容）';
  } else {
    banner.hidden = true;
  }
}
```

- [ ] **Step 2: 新增作用域选择控件 HTML**

在 overview 视图内容列表上方（`#contentList` 之前）新增：

```html
<div id="overviewScopeBar" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
  <label>作用域：
    <select id="overviewScopeSelect" style="padding:4px 8px;border:1px solid var(--ws-border);border-radius:6px">
      <option value="">全部内容</option>
    </select>
  </label>
  <span id="overviewScopeBanner" class="banner" hidden style="font-size:12px;color:var(--ws-faint)"></span>
</div>
```

在 `loadWorkspaces()`（第 1083 行）内 `renderWsList();` 之后追加填充：

```javascript
const scopeSelect = $('overviewScopeSelect');
if (scopeSelect) {
  scopeSelect.innerHTML = '<option value="">全部内容</option>' + workspaces.map(w =>
    `<option value="${escapeHtml(w.id)}" ${overviewWorkspaceId === w.id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
  scopeSelect.onchange = () => { overviewWorkspaceId = scopeSelect.value || null; loadOverview(); };
}
```

- [ ] **Step 3: `showView('overview')` 不丢失作用域，并刷新数据**

第 1116-1134 行 `showView` 的 `view === 'overview'` 分支保留 `activeWsId = null`，追加 `loadOverview();`（若尚未在调用处执行）。

- [ ] **Step 4: JS 语法预检（Task 10 Step 2），通过后 Commit**

```bash
git add frontend/workspace.html
git commit -m "feat(ui): overview workspace scope selector and scope banner"
```

---

## Task 10: 构建 JAR 与整体验证

**Files:**
- 产出: `backend/target/clip-demo-0.0.1-SNAPSHOT.jar`、`backend/clip-demo-0.0.1-SNAPSHOT.jar`

- [ ] **Step 1: 编译 + 全部测试 + 打包**

Run: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; & 'K:\apache-maven-3.5.4\bin\mvn.cmd' -f 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\pom.xml' clean package`
Expected: BUILD SUCCESS；测试除 1 个既有失败外全绿。

- [ ] **Step 2: 前端 JS 语法校验（node --check，抽取内联 script）**

Run:

```powershell
$html = Get-Content -Raw 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\workspace.html'
$matches = [regex]::Matches($html, '(?s)<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>')
$out = ($matches | ForEach-Object { $_.Groups[1].Value }) -join "`r`n"
Set-Content -Path 'C:\Users\pengwenfeng\.trae-cn\work\6a79f45518ce0c0d0f93e493\workspace-check.js' -Value $out -Encoding UTF8
& 'C:\Users\pengwenfeng\AppData\Local\nvm\v20.19.5\node.exe' --check 'C:\Users\pengwenfeng\.trae-cn\work\6a79f45518ce0c0d0f93e493\workspace-check.js'
```

Expected: 无输出、退出码 0。

- [ ] **Step 3: JAR 就位 Electron 期望路径**

Run: `Copy-Item 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\target\clip-demo-0.0.1-SNAPSHOT.jar' 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\clip-demo-0.0.1-SNAPSHOT.jar' -Force; Test-Path 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\clip-demo-0.0.1-SNAPSHOT.jar'`
Expected: `True`。

- [ ] **Step 4: 启动后端并做 API 冒烟**

启动（非阻塞）: `$env:JAVA_HOME='K:\jdk\jdk-21.0.10'; Set-Location 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend'; K:\apache-maven-3.5.4\bin\mvn.cmd spring-boot:run`（或运行 JAR），等待端口就绪后执行：

```powershell
# 1) 表达式结构：期望 relation=AND、2 组、组1 OR [pd-rule-tag,pd-rule-category]、组2 AND [pd-rule-type]
(Invoke-RestMethod 'http://localhost:8081/api/workspace/pd-builtin/rule-expression') | ConvertTo-Json -Depth 4

# 2) 分辨率：期望 contents 同时含 clip 与 todo（todo 经 category 规则命中）
(Invoke-RestMethod 'http://localhost:8081/api/workspace/pd-builtin/resolution').contents | Group-Object type | ForEach-Object { "$($_.Name): $($_.Count)" }

# 3) 作用域 overview：期望 scoped=true 且 contents 与 resolution 一致
(Invoke-RestMethod 'http://localhost:8081/api/workspace/overview?workspaceId=pd-builtin').scoped

# 4) 带 groupId 新增规则：期望新规则进入 pd-group-1
Invoke-RestMethod 'http://localhost:8081/api/workspace/pd-builtin/rules' -Method Post -ContentType 'application/json' -Body '{"field":"tag","operator":"contains","value":"java","enabled":true,"groupId":"pd-group-1"}'

# 5) 全量结构更新（跨组调整）
Invoke-RestMethod 'http://localhost:8081/api/workspace/pd-builtin/rule-expression' -Method Put -ContentType 'application/json' -Body '{"relation":"AND","groups":[{"id":"pd-group-1","relation":"OR","ruleIds":["pd-rule-tag","pd-rule-category"]},{"id":"pd-group-2","relation":"AND","ruleIds":["pd-rule-type"]}]}'
```

注意：端口以实际 `application.yml` 为准（此前验证为 8081）。

- [ ] **Step 5: 界面验证清单（用户操作确认）**

- [ ] 详情页：切换"组间关系"开关（AND/OR）→ 开关不回弹，resolution 的 visibleCount 随之变化。
- [ ] 规则面板：显示 2 个分组卡片；组内 AND/OR 下拉可切换；"添加规则"可选定目标组；启停/编辑/删除规则后列表与 resolution 同步刷新。
- [ ] overview 页：选择"产品开发"作用域 → 数据变为规则命中集 + 横幅提示；选"全部内容"恢复全量。
- [ ] 产品开发工作区：可见 clip 与 todo 两类数据（此前因 matchAll=true AND 语义 + JAR 缺失，todo 不可见）。
- [ ] 核对生成文件 `C:\Users\pengwenfeng\.cut-shelter\config\index\workspace-rule-expressions.json` 包含 pd-builtin 条目且结构正确。

- [ ] **Step 6: 收尾 Commit（如有遗留改动）**

```bash
git add -A
git commit -m "chore: finalize rule expression feature"
```

---

## 五、风险与注意

1. **Maven 3.5.4 + JDK 21**：若 Maven 本体在 JDK 21 下报错，先试 `-Dmaven.compiler.release=21`；仍失败则临时改用较新 Maven 执行同一 `pom.xml`（构建产物不变）。
2. **旧签名调用点**：`resolve(...)` 与 `saveRule(...)` 的调用点以编译错误清单为准（已知：`WorkspaceIndexService:199`、两个测试文件）。
3. **逐条求值语义**：表达式求值必须按"每个 ref 独立求值"实现（Task 2 Step 2 代码），不可按"任意 ref 命中即整组通过"实现，否则 AND 分组语义错误。
4. **空表达式语义**：无表达式/全空组 → 不产生规则命中（仅 manual/relation 旁路），与旧版一致；前端空态文案已体现。
5. **matchAll 遗留**：`workspace.json` 中 pd-builtin 的 `matchAll:true` 为历史值，表达式接管后不再读取，无需迁移清理。
6. **JAR 不入库**：构建产物仅复制到运行路径，不进 git。
7. **`</script>` 字面量**：若 workspace.html JS 字符串含 `</script>`，node --check 抽取会提前截断，需按改动区间单独抽取校验。
