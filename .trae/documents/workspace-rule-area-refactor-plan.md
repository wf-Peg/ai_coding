# 工作台规则区重构实施计划

## 1. 概述

**目标**：重构工作台规则区，使其支持 SQL 式布尔表达式——多分组可添加/删除、组内 AND/OR、组间 AND/OR（如 `(A OR B) AND (C OR D)`）。同步修正 pd-builtin 默认规则被每次启动强制覆盖的问题，并让"全部"工作台隐藏规则/排除 Tab。

**范围决策**：本次**不加入 NOT 否定条件**（用户已确认），聚焦多分组 + 两级 AND/OR。

**设计参考**：Notion / Airtable / Jira JQL 的筛选器——根级"所有条件满足(AND) / 任一条件满足(OR)" + 多个可增删的分组，每个分组内部独立 AND/OR。

## 2. 现状分析

### 已具备的能力（无需改动）
- 后端 `RuleExpression(workspaceId, relation, groups)` + `RuleGroup(id, relation, ruleIds)` 数据模型完整
- `WorkspaceRuleService.resolve()` 已实现两级 fold 求值：组内 `fold(group.relation)` → 组间 `fold(root.relation)`
- 前端 `renderExpression()` 已按 `groups` 数组渲染多分组，每组头部已有组内关系下拉（OR/AND）和"＋ 添加规则"
- 组间关系已有 `matchAllToggle`（在规则区底部）
- pd-builtin 默认表达式已是两组：`(tag=product-dev OR category⊇product-dev) AND type∈(clip,todo)`

### 缺失/缺陷（本次修复）
1. **前端无"添加分组"入口** → 普通工作台永远只有 1 个 OR 组
2. **前端无"删除分组"入口** → 分组只增不减
3. **后端无分组 CRUD API** → 只能通过 PUT `/rule-expression` 整体覆盖，前端无法让后端生成新分组 ID
4. **pd-builtin 表达式每次启动强制覆盖**（`ProductDevWorkspaceInitializer.ensureBuiltinExpression`）→ 用户在 pd-builtin 上对规则/分组的修改重启后丢失
5. **"全部"工作台不隐藏规则/排除 Tab** → 只是不加载数据，空 tab 可点击（体验缺陷）

## 3. 变更设计

### 3.1 后端：`WorkspaceRuleService.java`

新增两个方法：

**`addGroup(String workspaceId, String relation)`** — 新建空分组：
- `expr = getExpression(workspaceId)`，null 则 `RuleExpression.empty(workspaceId)`
- 追加 `new RuleGroup(UUID.randomUUID().toString(), RuleGroup.normalizeRelation(relation), List.of())`
- `saveExpression` 后返回更新后的表达式

**`deleteGroup(String workspaceId, String groupId)`** — 删除分组及组内规则：
- 表达式不存在 → 返回 `RuleExpression.empty(workspaceId)`
- 分组不存在 → 幂等返回当前表达式
- 从 `workspace-rules.json` 移除该 workspace 下、groupId 组内引用的所有规则（`readAllRules()` + `removeIf` + `writeRules`）
- 从表达式移除该分组；groups 为空时补 1 个空 OR 组（保持与 `RuleExpression.empty` 一致）
- `saveExpression` 后返回更新后的表达式

> 注意：删除分组**连带删除组内规则**（决策 3.4-①），因此直接操作 rules 文件，不复用 `removeRule()`（避免其"删空组收敛单组"的副作用）。

### 3.2 后端：`WorkspaceController.java`

新增 2 个端点 + 1 个 record：

| 端点 | 方法 | 说明 |
|------|------|------|
| `POST /api/workspace/{workspaceId}/rule-expression/groups` | addRuleGroup | body `{"relation":"OR"}`（可选，默认 OR），返回更新后表达式，201 |
| `DELETE /api/workspace/{workspaceId}/rule-expression/groups/{groupId}` | deleteRuleGroup | 返回更新后表达式 |

- 内部类新增 `public record GroupCreateRequest(String relation) {}`（与现有 `RuleRequest` 同级）
- 均需 `requireWorkspace(workspaceIndexService(), workspaceId)` 校验 + `errorResponse` 兜底
- 需要给内部类 `WorkspaceRuleServiceView` 增加 `addGroup` / `deleteGroup` 两个代理方法（该内部类代理到 `WorkspaceRuleService`，模式与现有 `rules()` / `saveExpression()` 一致）

### 3.3 前端：`frontend/workspace.html`

#### a) 规则区 HTML 结构调整（约 464-480 行区域）

```
rules-header: [筛选规则 h3] [＋ 添加分组(secondary)] [＋ 添加规则]
rulesRootRelation  ← 新增根关系 segmented 控件容器
rulesError
rulesList          ← 分组卡片列表
workspaceSettings  ← 移除（原组间关系 toggle 上移）
```

#### b) 新增 `renderRootRelation()` — 根关系控件

```js
function renderRootRelation() {
  const el = $('rulesRootRelation');
  const rel = (currentExpression && currentExpression.relation) || 'OR';
  el.innerHTML = `
    <span class="root-label">匹配模式</span>
    <button class="root-rel-btn ${rel === 'AND' ? 'active' : ''}" data-rel="AND" type="button">所有条件满足（AND）</button>
    <button class="root-rel-btn ${rel === 'OR' ? 'active' : ''}" data-rel="OR" type="button">任一条件满足（OR）</button>`;
  el.querySelectorAll('.root-rel-btn').forEach(btn =>
    btn.addEventListener('click', () => updateRootRelation(btn.dataset.rel)));
}
```

- `updateRootRelation(newRelation)`：PUT `/rule-expression`（body 同现有 `updateGroupRelation` 模式），成功后 `currentExpression = r.json()` + `loadDetail()`
- 删除现有 `renderWorkspaceSettings()` 中的 toggle 逻辑（或直接废弃该函数，根关系逻辑迁移到顶部）

#### c) `renderExpression()` 分组卡片增强（约 985-1018 行）

分组头部新增"删除分组"按钮，保留现有"组内关系下拉"与"＋ 添加规则"：

```js
<button class="rule-group-del" data-group-id="${escapeHtml(group.id)}"
        data-count="${(group.ruleIds || []).length}" type="button" title="删除分组（连同组内规则）">删除分组</button>
```

事件绑定追加：`.rule-group-del` → `deleteGroup(btn.dataset.groupId, parseInt(btn.dataset.count || '0'))`

#### d) 新增 `addGroup()` / `deleteGroup()` 函数

- `addGroup()`：POST `/api/workspace/{id}/rule-expression/groups`，body `{relation:'OR'}`，成功后 `currentExpression = await r.json()` + `loadDetail()`
- `deleteGroup(groupId, count)`：复用现有 `confirmModal`，提示"删除分组将同时删除组内 N 条规则，不可恢复"，确认后 DELETE 对应分组端点

#### e) 事件绑定

- `$('addGroupBtn').addEventListener('click', addGroup)`（新增按钮）
- 原 `$('addRuleBtn')` 事件保留

#### f) "全部"工作台隐藏 Tab

新增 `updateTabVisibility()`：

```js
function updateTabVisibility() {
  const isAll = activeWsId === 'all' || !activeWsId;
  document.querySelectorAll('.detail-tab[data-tab="rules"], .detail-tab[data-tab="exclusions"]')
    .forEach(t => { t.style.display = isAll ? 'none' : ''; });
}
```

调用点：
- `selectWorkspace(id)` 的"全部"分支和真实工作台分支各调用一次
- `switchToTab(tabName)` 开头调用；且当 `isAll && (tabName === 'rules' || tabName === 'exclusions')` 时强制切回 `'overview'`
- 页面初始化（`loadWorkspaces` 或启动流程）后调用一次，保证刷新/初始加载时正确

#### g) 样式（CSS，约 140-156 行区域）

```css
.rules-root-relation { display:flex; align-items:center; gap:8px; margin-bottom:14px;
  padding:10px 14px; background:var(--ws-subtle); border:1px solid var(--ws-border);
  border-radius:var(--app-radius); }
.root-label { font-size:12px; color:var(--ws-faint); }
.root-rel-btn { padding:5px 12px; border:1px solid var(--ws-border); border-radius:6px;
  background:var(--ws-surface); font-size:12px; color:var(--ws-text); cursor:pointer; }
.root-rel-btn.active { background:var(--ws-primary); color:#fff; border-color:var(--ws-primary); }
.rule-group-del { padding:3px 8px; border:1px solid var(--danger,#e5484d); border-radius:6px;
  font-size:12px; color:var(--danger,#e5484d); background:var(--ws-surface); cursor:pointer; }
.add-rule-btn.secondary { background:var(--ws-surface); color:var(--ws-primary);
  border:1px solid var(--ws-primary); }
```

> 实现时确认全局危险色变量名（如 `--danger` / `--app-danger`），优先复用现有变量。

### 3.4 pd-builtin 默认规则修正：`ProductDevWorkspaceInitializer.java`

**问题**：`ensureBuiltinWorkspace()` 在工作台已存在时，每次启动都调用 `ensureBuiltinExpression()` **覆盖写**默认表达式，用户对 pd-builtin 规则/分组的修改重启即丢失。

**修正**（约 109-115 行区域）：

```java
if (exists) {
    log.info("[ProductDevWorkspaceInitializer] 产品开发工作台已存在，跳过创建");
    // 仅在表达式缺失时整体自愈（补规则 + 写默认表达式），用户已修改过则不再干预
    RuleExpression expr = ruleService.getExpression(PD_BUILTIN_WORKSPACE_ID);
    if (expr == null) {
        ensureBuiltinRules(ruleService);
        ensureBuiltinExpression(ruleService);
    }
    return;
}
```

- 删除原 `exists` 分支中对 `ensureBuiltinRules` / `ensureBuiltinExpression` 的无条件调用
- 保留创建时（工作台不存在）的 `ensureBuiltinRules` → `ensureBuiltinExpression` 顺序（先建规则再写两组表达式，与现状一致）
- 默认表达式内容不变：`(pd-group-1: tag=product-dev OR category⊇product-dev) AND (pd-group-2: type∈(clip,todo))`，恰好作为新规则区的示例

## 4. 假设与决策

1. **删除分组连带删除组内规则**（Notion 行为），confirm 弹窗明确提示数量
2. **根关系控件移到规则区顶部**（"所有条件满足 AND / 任一条件满足 OR" segmented），替代底部 toggle，更直观
3. **空分组允许存在且不参与匹配**（后端 `resolve` 已有此行为，不改变）
4. **本次不做 NOT 否定条件**（用户已确认），留作后续迭代
5. **pd-builtin 表达式只在缺失时自愈**，用户修改后重启不重置
6. **新增分组的组内关系默认 OR**，用户可在分组头下拉切换

## 5. 测试计划

**新建** `backend/src/test/java/com/example/clip/index/WorkspaceRuleGroupTest.java`：

1. `addGroup_appendsEmptyGroupAndNormalizesRelation` — 新分组追加、relation 默认 OR、非 AND 归一化为 OR
2. `deleteGroup_removesGroupAndItsRules` — 删除分组后组内规则从规则文件移除、分组从表达式移除、返回正确表达式
3. `deleteGroup_keepsAtLeastOneGroup` — 删除唯一分组后补 1 个空 OR 组
4. `deleteGroup_nonexistentIsIdempotent` — 删除不存在的分组返回当前表达式不报错
5. `deleteGroup_otherGroupsAndRulesUntouched` — 多分组时只删目标组，其他组及规则保留

## 6. 验证步骤

1. `cd backend && mvn -q compile` — 编译通过
2. `mvn -q test -Dtest=WorkspaceRuleGroupTest` — 新增测试通过
3. `mvn -q test` — 全量测试，确认无回归（非 WebMvc 测试应全绿；ClipControllerTest 12 个错误为预存问题，与本改动无关）
4. 手动验证（启动后端 + 前端）：
   - 新建/选中一个普通工作台 → 规则区顶部出现"匹配模式"控件和"＋ 添加分组"
   - 添加 2 个分组，分别设组内 AND/OR，组间切 AND/OR → 内容列表按预期过滤
   - 删除分组 → 组内规则一并删除，confirm 提示数量正确
   - 切到"全部" → 规则/排除 Tab 隐藏；切回真实工作台 → 恢复显示
   - 修改 pd-builtin 规则后重启后端 → 修改保留，未被覆盖

## 7. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `backend/src/main/java/com/example/clip/index/WorkspaceRuleService.java` | 新增 `addGroup` / `deleteGroup` |
| `backend/src/main/java/com/example/clip/controller/WorkspaceController.java` | 新增 2 端点 + `GroupCreateRequest` record + View 代理方法 |
| `backend/src/main/java/com/example/clip/service/ProductDevWorkspaceInitializer.java` | 表达式仅在缺失时自愈 |
| `frontend/workspace.html` | 规则区重构 + 分组增删 + 根关系控件 + Tab 隐藏 |
| `backend/src/test/java/com/example/clip/index/WorkspaceRuleGroupTest.java` | 新建测试 |
