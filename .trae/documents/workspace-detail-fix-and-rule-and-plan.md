# 工作台详情修复 & 规则 AND 支持 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 修复工作台详情视图标题显示为"未命名内容"的问题，并为工作台规则增加 AND 关系支持

**架构:** 后端 Spring Boot 3.2 (Java 21) 文件系统 JSON 存储，前端 vanilla HTML/JS 单页应用。规则引擎通过 `WorkspaceRuleService.resolve()` 实现，当前纯 OR 逻辑；内容索引通过 `ContentIndexAutoSyncService` 定时重建。

**技术栈:** Java 21, Spring Boot 3.2, vanilla HTML/JS, Jackson JSON, Maven 3.5.4

---

## 当前状态分析

### Issue 1: 标题显示 & 规则作用域数据

**"未命名内容" 根因**:
- `ContentRefMapper` 四个 `from*()` 方法直接透传源实体的 `getTitle()`，当 `ClipContent.title` 为 `null` 时（例如手动创建剪藏未填写标题），`ContentRef.title` 即为 `null`
- 前端 4 处使用 `item.title || '未命名内容'` 作为 fallback（`overviewRenderContents` 第 1040 行、`renderDetailContents` 第 1239 行、`renderKanbanCard` 第 1997 行、`renderPdKanban` 第 2400 行）
- `content-index.json` 通过 `ContentIndexAutoSyncService` 定时重建（`@PostConstruct` + 每 5 分钟），非标题缺失根因

**规则作用域验证**:
- `loadDetail()` 第 1189 行已正确调用 `/api/workspace/{workspaceId}/resolution` 端点
- `WorkspaceRuleService.resolve()` 第 85-88 行按规则过滤，第 93-96 行合并规则命中 + 手动成员 + 关系成员后去重去排除
- 用户看到的"额外内容"可能来自手动成员（`WorkspaceMembership`），而非规则过滤失效

### Issue 2: AND 规则支持

- `WorkspaceRuleService.resolve()` 第 85-88 行：**纯 OR** — 任何匹配规则即加入可见集
- `WorkspaceRule` record: `id, workspaceId, field, operator, value, enabled, createdAt, updatedAt`
- `Workspace` record: `id, name, description, color, type, status, createdAt, updatedAt` — **无 `matchAll` 字段**
- 设计选择：**方案 A — Per-workspace `matchAll` 布尔标志**（最小侵入、向后兼容、实现简单）

---

## 变更概览

| 文件 | 操作 | 说明 |
|------|------|------|
| `ContentRefMapper.java` | 修改 | 为 title 增加 content 截断 / ID 兜底 fallback |
| `workspace.html` | 修改 | 4 处 "未命名内容" → "无标题"；新增 matchAll 切换 UI |
| `Workspace.java` | 修改 | 新增 `boolean matchAll` 字段 |
| `WorkspaceRuleService.java` | 修改 | `resolve()` 增加 `matchAll` 参数 + AND 逻辑分支 |
| `WorkspaceIndexService.java` | 修改 | `resolveWorkspace()` 读取 workspace.matchAll 并传入 |
| `WorkspaceController.java` | 修改 | `WorkspaceRequest` 增 `matchAll`；新增 PUT `/settings` 端点 |
| `ContentRefMapperTest.java` | 新增 | 测试 title fallback 行为 |
| `WorkspaceRuleServiceTest.java` | 修改 | 测试 AND 模式 + 手动成员绕过 |
| `ProductDevWorkspaceRulesTest.java` | 修改 | Workspace 构造器增加 `false` 参数 |

---

## 任务分解

### Task 1: ContentRefMapper 增加标题 fallback 策略

**文件:**
- 修改: `backend/src/main/java/com/example/clip/index/ContentRefMapper.java`

- [ ] **Step 1: 新增 `resolveTitle` 辅助方法**

在 `ContentRefMapper` 类中新增：

```java
private static String resolveTitle(String title, String content, String entityType, Long id) {
    if (title != null && !title.isBlank()) {
        return title;
    }
    if (content != null && !content.isBlank()) {
        String truncated = content.replaceAll("<[^>]+>", "").trim();
        if (truncated.length() > 60) {
            truncated = truncated.substring(0, 60) + "...";
        }
        if (!truncated.isBlank()) {
            return truncated;
        }
    }
    String label = switch (entityType) {
        case "clip" -> "剪藏";
        case "todo" -> "待办事项";
        case "knowledge" -> "知识条目";
        case "learning-plan" -> "学习计划";
        default -> "内容";
    };
    return label + " #" + id;
}
```

- [ ] **Step 2: 修改 `fromClip` 第 21 行**

变更前：
```java
clip.getTitle(),
```

变更后：
```java
resolveTitle(clip.getTitle(), clip.getContent(), "clip", clip.getId()),
```

- [ ] **Step 3: 修改 `fromTodo` 第 58 行**

变更前：
```java
todo.getTitle(),
```

变更后：
```java
resolveTitle(todo.getTitle(), null, "todo", todo.getId()),
```

- [ ] **Step 4: 修改 `fromKnowledge` 第 40 行**

变更前：
```java
knowledge.getTitle(),
```

变更后：
```java
resolveTitle(knowledge.getTitle(), null, "knowledge", knowledge.getId()),
```

- [ ] **Step 5: 修改 `fromLearningPlan` 第 76 行**

变更前：
```java
plan.getTitle(),
```

变更后：
```java
resolveTitle(plan.getTitle(), null, "learning-plan", plan.getId()),
```

- [ ] **Step 6: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: BUILD SUCCESS (无错误)

---

### Task 2: 前端统一标题 fallback 文案

**文件:**
- 修改: `frontend/workspace.html`

- [ ] **Step 1: 修改 overviewRenderContents 第 1040 行**

变更前：
```javascript
${escapeHtml(item.title || '未命名内容')}
```

变更后：
```javascript
${escapeHtml(item.title || '无标题')}
```

并将同一行的 `title="${escapeHtml(item.title || '')}"` 改为：
```javascript
title="${escapeHtml(item.title || '无标题')}"
```

- [ ] **Step 2: 修改 renderDetailContents 第 1239 行**

变更前：
```javascript
${escapeHtml(item.title || '未命名内容')}
```

变更后：
```javascript
${escapeHtml(item.title || '无标题')}
```

- [ ] **Step 3: 修改 renderKanbanCard 第 1997 行**

变更前：
```javascript
<h4 class="card-title" title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '未命名内容')}</h4>
```

变更后：
```javascript
<h4 class="card-title" title="${escapeHtml(item.title || '无标题')}">${escapeHtml(item.title || '无标题')}</h4>
```

- [ ] **Step 4: 修改 renderPdKanban 第 2400 行**

变更前：
```javascript
' + escapeHtml(item.title || '未命名') + '
```

变更后：
```javascript
' + escapeHtml(item.title || '无标题') + '
```

- [ ] **Step 5: JS 语法验证**

Run: `& 'C:\Users\pengwenfeng\AppData\Local\nvm\v20.19.5\node.exe' --check 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\workspace.html'`
Expected: 无错误输出 (exit code 0)

---

### Task 3: Workspace record 新增 `matchAll` 字段

**文件:**
- 修改: `backend/src/main/java/com/example/clip/index/Workspace.java`

- [ ] **Step 1: 新增 `boolean matchAll` 字段**

变更前（第 5-6 行）：
```java
public record Workspace(String id, String name, String description, String color, String type, String status,
                        LocalDateTime createdAt, LocalDateTime updatedAt) {
```

变更后：
```java
public record Workspace(String id, String name, String description, String color, String type, String status,
                        boolean matchAll, LocalDateTime createdAt, LocalDateTime updatedAt) {
```

说明：Java record 中 `boolean` 默认 `false`，旧 JSON 反序列化时自动兼容。

- [ ] **Step 2: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: 可能因 Workspace 构造器调用处缺少参数而编译失败，这是预期的，后续 Task 会修复

---

### Task 4: WorkspaceRuleService 增加 AND 逻辑

**文件:**
- 修改: `backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java`

- [ ] **Step 1: 修改 `resolve()` 方法签名，增加 `boolean matchAll` 参数**

变更前（第 78-80 行）：
```java
public synchronized WorkspaceResolution resolve(String workspaceId, Collection<ContentRef> refs,
                                                Collection<WorkspaceMembership> manualMembers,
                                                Collection<WorkspaceMembership> relationMembers) {
```

变更后：
```java
public synchronized WorkspaceResolution resolve(String workspaceId, Collection<ContentRef> refs,
                                                Collection<WorkspaceMembership> manualMembers,
                                                Collection<WorkspaceMembership> relationMembers,
                                                boolean matchAll) {
```

- [ ] **Step 2: 修改规则匹配逻辑（第 84-88 行）**

变更前：
```java
Set<String> ruleIds = new LinkedHashSet<>();
for (WorkspaceRule rule : rules(workspaceId)) {
    if (!rule.enabled()) continue;
    byId.values().stream().filter(ref -> matches(rule, ref)).forEach(ref -> ruleIds.add(ref.id()));
}
```

变更后：
```java
Set<String> ruleIds = new LinkedHashSet<>();
List<WorkspaceRule> enabledRules = rules(workspaceId).stream()
        .filter(WorkspaceRule::enabled).toList();
if (matchAll && !enabledRules.isEmpty()) {
    // AND 模式：内容必须匹配所有启用的规则
    for (ContentRef ref : byId.values()) {
        if (enabledRules.stream().allMatch(rule -> matches(rule, ref))) {
            ruleIds.add(ref.id());
        }
    }
} else {
    // OR 模式（默认）：任何匹配规则即可
    for (WorkspaceRule rule : enabledRules) {
        byId.values().stream().filter(ref -> matches(rule, ref)).forEach(ref -> ruleIds.add(ref.id()));
    }
}
```

- [ ] **Step 3: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: 编译通过，但所有调用 `resolve()` 的地方需要更新签名

---

### Task 5: WorkspaceIndexService 传递 matchAll 参数

**文件:**
- 修改: `backend/src/main/java/com/example/clip/index/WorkspaceIndexService.java`

- [ ] **Step 1: 修改 `resolveWorkspace()` 第 193 行**

变更前（第 193 行）：
```java
WorkspaceResolution resolution = ruleService.resolve(workspaceId, refs, manualMembers, relationMembers);
```

变更后（增加读取 workspace.matchAll 的步骤）：
```java
// 读取 workspace 的 matchAll 标志
boolean matchAll = read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
        .filter(w -> w.id().equals(workspaceId))
        .findFirst()
        .map(Workspace::matchAll)
        .orElse(false);
WorkspaceResolution resolution = ruleService.resolve(workspaceId, refs, manualMembers, relationMembers, matchAll);
```

- [ ] **Step 2: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: 编译通过

---

### Task 6: WorkspaceController 更新

**文件:**
- 修改: `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`

- [ ] **Step 1: 为 `WorkspaceRequest` record 增加 `Boolean matchAll` 字段**

变更前（第 563 行）：
```java
public record WorkspaceRequest(String name, String description, String color, String type) {}
```

变更后：
```java
public record WorkspaceRequest(String name, String description, String color, String type, Boolean matchAll) {}
```

- [ ] **Step 2: 修改 `createWorkspace()` 方法，创建 Workspace 时传入 `matchAll`**

变更前（第 85-86 行）：
```java
Workspace workspace = new Workspace(UUID.randomUUID().toString(), workspaceRequest.name(),
        workspaceRequest.description(), workspaceRequest.color(), type, "active", now, now);
```

变更后：
```java
boolean matchAll = workspaceRequest.matchAll() != null && workspaceRequest.matchAll();
Workspace workspace = new Workspace(UUID.randomUUID().toString(), workspaceRequest.name(),
        workspaceRequest.description(), workspaceRequest.color(), type, "active", matchAll, now, now);
```

- [ ] **Step 3: 新增 `PUT /api/workspace/{workspaceId}/settings` 端点**

在 `WorkspaceController` 类中新增（在 `deleteWorkspace` 方法附近）：

```java
@PutMapping("/{workspaceId}/settings")
public ResponseEntity<?> updateSettings(@PathVariable String workspaceId, @RequestBody WorkspaceSettingsRequest request) {
    try {
        WorkspaceIndexService indexService = workspaceIndexService();
        requireWorkspace(indexService, workspaceId);
        Workspace existing = indexService.readAll().stream()
                .filter(w -> w.id().equals(workspaceId))
                .findFirst()
                .orElseThrow(() -> new WorkspaceNotFoundException("工作台不存在"));
        Workspace updated = new Workspace(workspaceId, existing.name(), existing.description(),
                existing.color(), existing.type(), existing.status(),
                request.matchAll() != null ? request.matchAll() : existing.matchAll(),
                existing.createdAt(), LocalDateTime.now());
        indexService.saveWorkspace(updated);
        return ResponseEntity.ok(updated);
    } catch (RuntimeException error) {
        return errorResponse(error);
    }
}

public record WorkspaceSettingsRequest(Boolean matchAll) {}
```

- [ ] **Step 4: 更新 `Workspace` 构造器调用处 — 检查 Controller 中其他创建 Workspace 的地方**

搜索所有 `new Workspace(` 调用，确认新增 `matchAll` 参数。在 `WorkspaceController.java` 中搜索 `new Workspace`：

Run: 搜索 `WorkspaceController.java` 中所有 `new Workspace` 调用，确保匹配 `false` 参数。

预期：`createWorkspace` 处已修改（Step 2），其他处（如有）一律补 `false`。

- [ ] **Step 5: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: BUILD SUCCESS

---

### Task 7: 前端 UI 增加 matchAll 切换开关

**文件:**
- 修改: `frontend/workspace.html`

- [ ] **Step 1: 新增 CSS 样式**

在 `workspace.html` 的 `<style>` 区块中新增：

```css
.settings-container { padding: 16px 20px; border-top: 1px solid var(--ws-border); margin-top: 12px; }
.settings-section h4 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--ws-text); }
.toggle-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.toggle-slider { width: 36px; height: 20px; background: var(--ws-border); border-radius: 10px; position: relative; transition: background .2s; flex: none; }
.toggle-slider::after { content: ''; position: absolute; width: 16px; height: 16px; background: white; border-radius: 50%; top: 2px; left: 2px; transition: transform .2s; }
.toggle-label input:checked + .toggle-slider { background: var(--ws-primary); }
.toggle-label input:checked + .toggle-slider::after { transform: translateX(16px); }
.toggle-label input { display: none; }
.toggle-text { font-size: 13px; color: var(--ws-text); }
.settings-hint { margin: 8px 0 0; font-size: 12px; color: var(--ws-faint); line-height: 1.5; }
```

- [ ] **Step 2: 在 HTML 中新增设置区域容器**

在规则列表容器 `#rulesList` 之后添加（在 `<div class="rules-section">` 内部）：

```html
<div id="workspaceSettings" class="settings-container"></div>
```

- [ ] **Step 3: 新增 `renderWorkspaceSettings` 函数**

在 `renderRules` 函数附近（约第 1270 行后）新增：

```javascript
/* ── Workspace Settings ── */
function renderWorkspaceSettings(ws) {
  const settingsEl = $('workspaceSettings');
  if (!settingsEl) return;
  settingsEl.innerHTML = `
    <div class="settings-section">
      <h4>规则匹配模式</h4>
      <label class="toggle-label">
        <input type="checkbox" id="matchAllToggle" ${ws.matchAll ? 'checked' : ''}>
        <span class="toggle-slider"></span>
        <span class="toggle-text">${ws.matchAll ? '所有规则必须匹配（AND）' : '任意规则匹配即可（OR）'}</span>
      </label>
      <p class="settings-hint">启用后，内容必须满足工作台所有启用的规则才能被规则命中；手动加入和关系带入的内容不受影响。</p>
    </div>
  `;
  const toggle = $('matchAllToggle');
  if (toggle) {
    toggle.addEventListener('change', async () => {
      const matchAll = toggle.checked;
      try {
        const r = await fetch(`/api/workspace/${encodeURIComponent(activeWsId)}/settings`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchAll })
        });
        if (!r.ok) throw new Error('保存失败');
        toggle.nextElementSibling.nextElementSibling.textContent = matchAll ? '所有规则必须匹配（AND）' : '任意规则匹配即可（OR）';
        loadDetail();
      } catch (e) {
        showDetailError('保存设置失败：' + (e.message || '后端服务不可用'));
        toggle.checked = !matchAll;
      }
    });
  }
}
```

- [ ] **Step 4: 在 `loadDetail()` 中调用 `renderWorkspaceSettings`**

在 `loadDetail()` 函数中，渲染规则列表之后（第 1209 行 `renderRules(rulesData);` 之后）添加：

```javascript
renderWorkspaceSettings(ws);
```

- [ ] **Step 5: JS 语法验证**

Run: `& 'C:\Users\pengwenfeng\AppData\Local\nvm\v20.19.5\node.exe' --check 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\workspace.html'`
Expected: 无错误输出 (exit code 0)

---

### Task 8: 更新所有 Workspace 构造器调用处

**说明:** 由于 `Workspace` record 新增了 `boolean matchAll` 字段，所有 `new Workspace(...)` 调用处都需要补充该参数。

- [ ] **Step 1: 搜索所有 `new Workspace` 调用**

Run: `grep -rn "new Workspace(" --include="*.java" l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend\src\`

- [ ] **Step 2: 修复 ProductDevWorkspaceInitializer.java**

`ProductDevWorkspaceInitializer.java` 中创建 pd-builtin 工作台，在 `false` 位置插入 `false`：
```java
new Workspace(PD_BUILTIN_WORKSPACE_ID, "产品开发", "系统自带的产品开发工作区，自动归集每次编码任务的产出",
        "#2383e2", "project", "active", false, now, now)
```

- [ ] **Step 3: 修复其他调用处**

根据搜索结果，在所有 `new Workspace(...)` 调用的 `status` 参数之后增加 `false` 参数。

- [ ] **Step 4: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: BUILD SUCCESS

---

### Task 9: 单元测试

**文件:**
- 新建: `backend/src/test/java/com/example/clip/index/ContentRefMapperTest.java`
- 修改: `backend/src/test/java/com/example/clip/index/WorkspaceRuleServiceTest.java`
- 修改: `backend/src/test/java/com/example/clip/service/ProductDevWorkspaceRulesTest.java`

- [ ] **Step 1: 创建 ContentRefMapperTest.java**

```java
package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ContentRefMapperTest {

    private ContentRefMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ContentRefMapper();
    }

    @Test
    void mapsClipWithNullTitleUsingContentFallback() {
        ClipContent clip = new ClipContent();
        clip.setId(1003L);
        clip.setContent("这是一段很长的剪藏内容正文，用于测试标题为空时的内容回退策略");

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1003", ref.id());
        assertEquals("这是一段很长的剪藏内容正文，用于测试标题为空时的内容回退策略", ref.title());
    }

    @Test
    void mapsClipWithNullTitleAndNullContentUsingIdFallback() {
        ClipContent clip = new ClipContent();
        clip.setId(1004L);

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1004", ref.id());
        assertEquals("剪藏 #1004", ref.title());
    }

    @Test
    void mapsTodoWithNullTitleUsingIdFallback() {
        TodoContent todo = new TodoContent();
        todo.setId(3002L);

        ContentRef ref = mapper.fromTodo(todo);

        assertEquals("todo:3002", ref.id());
        assertEquals("待办事项 #3002", ref.title());
    }

    @Test
    void mapsClipWithTitlePriority() {
        ClipContent clip = new ClipContent();
        clip.setId(1005L);
        clip.setTitle("已有标题");
        clip.setContent("这是正文内容，不应该被使用");

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("已有标题", ref.title());
    }
}
```

- [ ] **Step 2: 更新 WorkspaceRuleServiceTest 现有测试**

修改 `resolvesUnionDeduplicationDisabledRulesAndExclusionPriorityWithStatistics` 测试，`service.resolve()` 调用增加 `false` 参数（OR 模式）。

- [ ] **Step 3: 新增 AND 模式测试 — `resolvesWithMatchAllAndMode`**

```java
@Test
void resolvesWithMatchAllAndMode() {
    WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
    LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
    List<ContentRef> refs = List.of(
            ref("clip:1", "clip", "Java 后端开发", "开发", List.of("Java", "后端"), now),
            ref("clip:2", "knowledge", "Spring Boot 入门", "开发", List.of("Java"), now.minusDays(2)),
            ref("clip:3", "todo", "采购清单", "生活", List.of("采购"), now.plusDays(1))
    );
    service.saveRule(new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now));
    service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));

    WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of(), true);

    assertEquals(2, resolution.visibleCount(), "clip:1 和 clip:2 都应匹配所有规则");
    assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:1")));
    assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:2")));
    assertTrue(resolution.visible().stream().noneMatch(ref -> ref.id().equals("clip:3")));
}
```

- [ ] **Step 4: 新增 AND 模式手动成员绕过测试 — `resolvesWithMatchAllAndManualMembersBypassRules`**

```java
@Test
void resolvesWithMatchAllAndManualMembersBypassRules() {
    WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
    LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
    List<ContentRef> refs = List.of(
            ref("clip:1", "clip", "Java 开发", "开发", List.of("Java"), now),
            ref("clip:3", "todo", "采购清单", "生活", List.of("采购"), now.plusDays(1))
    );
    service.saveRule(new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now));

    WorkspaceResolution resolution = service.resolve("w", refs,
            List.of(new WorkspaceMembership("w", "clip:3", "manual", "手动", 1.0, "", 1, now, now)),
            List.of(), true);

    assertEquals(2, resolution.visibleCount());
    assertEquals("rule", resolution.contentSources().get("clip:1"));
    assertEquals("manual", resolution.contentSources().get("clip:3"));
}
```

- [ ] **Step 5: 更新 ProductDevWorkspaceRulesTest**

修改 `ProductDevWorkspaceRulesTest.java` 中 `new Workspace(...)` 调用，在 `status` 参数后增加 `false`。

- [ ] **Step 6: 运行所有测试**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd test -q`
Expected: 89+ 测试通过，0 失败（已知的 `ClipControllerTest.testDivergentSummaryGeneratedAndPersisted` 预存失败除外）

---

### Task 10: 整体验证

- [ ] **Step 1: 编译验证**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 2: 前端 JS 语法验证**

Run: `& 'C:\Users\pengwenfeng\AppData\Local\nvm\v20.19.5\node.exe' --check 'l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\workspace.html'`
Expected: 无错误输出

- [ ] **Step 3: 运行完整测试套件**

Run: `cd l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\backend ; $env:JAVA_HOME='K:\jdk\jdk-21.0.10' ; K:\apache-maven-3.5.4\bin\mvn.cmd test`
Expected: 所有测试通过（已知的 1 个预存失败除外）

---

## 假设与决策

1. **AND 模式设计决策**：采用 Per-workspace `matchAll` 布尔标志方案，而非规则分组方案。原因：最小侵入性，向后兼容，用户理解成本低。手动/关系成员始终绕过规则匹配（无论 AND/OR 模式）。

2. **向后兼容性**：`Workspace` record 新增 `boolean matchAll` 字段后，旧 JSON 数据反序列化时 `matchAll` 默认 `false`，无需数据迁移脚本。

3. **空规则场景**：当 `matchAll=true` 且启用的规则列表为空时，`ruleIds` 为空，只有手动/关系成员能进入可见集。前端在切换 AND 模式时应提示用户。

4. **标题 fallback 策略**：优先级依次为 `title` → `content` 截断前 60 字符 → `"{实体类型} #{id}"`。HTML 标签在 content 截断前被去除。

5. **索引重建时机**：`ContentIndexAutoSyncService` 在启动时和每 5 分钟执行一次。本题不涉及修改索引重建逻辑，title fallback 在每次 `ContentRefMapper` 调用时即时生效。