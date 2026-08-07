# 工作台规则弹窗 UI 优化 + 删除工作台修复

## 摘要

对工作台模块的规则弹窗进行 UI 重构，实现字段-操作符的智能映射、自定义 Notion 风格时间选择器、标签多选输入，以及修复删除工作台功能并优化交互反馈。

---

## 当前状态分析

### 要修改的文件
| 文件 | 角色 |
|------|------|
| `frontend/workspace.html` | 工作台前端页面，包含规则弹窗 HTML + CSS + JS |
| `backend/.../WorkspaceController.java` | 后端控制器，包含删除工作台和字段枚举 API |

### 问题清单
1. **删除工作台失败**：后端 delete 端点可能因为异常未被正确捕获或返回格式问题导致前端无法解析错误信息，显示"删除失败：删除失败"
2. **操作符不区分字段**：所有字段共用同一套操作符（equals/contains/in/before/after），不合理的组合（如 type 不应该有 before/after）
3. **值输入控件单一**：时间控件使用原生 `<input type="datetime-local">`，样式丑陋，不符合全局主题
4. **标签字段无多选**：tag 字段应该支持多选输入
5. **缺少交互反馈**：删除、保存等操作缺少 loading 状态和成功/失败提示

---

## 方案设计

### 1. 字段-操作符映射表

| 字段 | 可用操作符 | 值输入控件 | 值来源 |
|------|-----------|-----------|--------|
| `type` | equals, in | 下拉选择框 | 固定值: clip/knowledge/todo/learning-plan |
| `category` | equals, contains, in | 下拉选择框 | 后端 `/api/workspace/field-values` |
| `tag` | equals, contains, in | 标签多选输入 | 后端 `/api/workspace/field-values` |
| `sourcePath` | equals, contains, in | 文本框 | 用户输入 |
| `workflowStatus` | equals, in | 下拉选择框 | 后端 `/api/workspace/field-values` |
| `updatedAt` | before, after | 自定义 Notion 风格时间选择器 | 用户选择 |

### 2. 时间选择器 (Notion 风格)

- 两个独立输入框：日期 + 时间
- 日期输入框：点击弹出日历面板（纯 CSS/HTML 实现，无第三方依赖）
- 时间输入框：简洁的 `HH:mm` 格式输入
- 样式使用全局 design-tokens 变量，支持 light/dark 主题
- 日历面板设计：简洁的网格布局，与 Notion 日期选择器类似

### 3. 标签多选输入

- 输入框内显示已选标签为胶囊（chip/tag 样式）
- 输入文本时从后端枚举值自动补全
- 点击标签右侧 ✕ 可移除
- 支持 Backspace 删除最后一个标签

### 4. 删除工作台修复

- 后端：检查 `deleteWorkspace` 方法，确保异常被正确捕获，返回 JSON 格式错误
- 前端：删除按钮添加 loading 状态，成功后显示反馈并跳转，失败时显示具体错误原因

---

## 具体修改步骤

### Step 1: 修复删除工作台后端

**文件**: `WorkspaceController.java`

- 检查 `@DeleteMapping("/{workspaceId}")` 端点，确认 `deleteWorkspace` 方法能正确处理各种异常情况
- 确保 `errorResponse` 方法返回的 JSON 格式一致（`{ status: "error", message: "..." }`）
- 添加详细的日志输出以便调试

### Step 2: 规则弹窗 HTML 重构

**文件**: `workspace.html` (HTML 部分)

修改规则弹窗中的值输入区域：

```html
<!-- 值输入区域 - 动态切换 -->
<div class="form-group" id="ruleValueGroup">
  <label class="form-label" for="ruleValue">值 <span class="required">*</span></label>
  
  <!-- 下拉选择框 (type/category/workflowStatus) -->
  <select class="form-select" id="ruleValueSelect" style="display:none"></select>
  
  <!-- 文本框 (sourcePath) -->
  <input class="form-input" id="ruleValueInput" type="text" placeholder="输入来源路径" style="display:none">
  
  <!-- 标签多选输入 (tag) -->
  <div class="tag-multi-input" id="ruleValueTags" style="display:none">
    <div class="tag-list" id="tagList"></div>
    <input class="tag-input" id="tagInput" type="text" placeholder="输入标签搜索..." autocomplete="off">
    <div class="tag-suggestions" id="tagSuggestions" style="display:none"></div>
  </div>
  
  <!-- 时间选择器 (updatedAt) - Notion 风格 -->
  <div class="date-time-picker" id="ruleValueDate" style="display:none">
    <div class="date-picker-field">
      <input class="form-input date-input" id="dateInput" type="text" placeholder="选择日期..." readonly>
      <div class="date-calendar" id="dateCalendar" style="display:none">
        <!-- 日历面板由 JS 动态渲染 -->
      </div>
    </div>
    <input class="form-input time-input" id="timeInput" type="text" placeholder="HH:mm" maxlength="5">
  </div>
  
  <p class="form-hint" id="ruleValueHint"></p>
</div>
```

### Step 3: CSS 样式

**文件**: `workspace.html` (CSS 部分)

新增样式：

1. **标签多选输入样式**
   - `.tag-multi-input` - 容器，类似输入框的边框样式
   - `.tag-list` - 已选标签的 flex 容器
   - `.tag-chip` - 单个标签胶囊样式，带 ✕ 删除按钮
   - `.tag-input` - 内联文本输入框
   - `.tag-suggestions` - 自动补全下拉列表

2. **Notion 风格时间选择器样式**
   - `.date-time-picker` - 双字段 flex 容器
   - `.date-picker-field` - 日期输入 + 日历面板容器
   - `.date-input` - 日期文本输入（只读，点击展开日历）
   - `.date-calendar` - 日历面板（绝对定位，阴影，圆角）
   - `.time-input` - 时间文本输入
   - 日历面板内部：导航（年/月切换）、日期网格（七日列头、日期格）

3. **操作符标签样式**
   - 当前选中的操作符用强调色突出显示

### Step 4: JavaScript 逻辑重构

**文件**: `workspace.html` (JS 部分)

#### 4.1 字段-操作符映射

```javascript
const FIELD_OPERATORS = {
  type: ['equals', 'in'],
  category: ['equals', 'contains', 'in'],
  tag: ['equals', 'contains', 'in'],
  sourcePath: ['equals', 'contains', 'in'],
  workflowStatus: ['equals', 'in'],
  updatedAt: ['before', 'after']
};
```

#### 4.2 更新 `switchRuleValueInput(field)` 函数

选择字段时：
1. 更新操作符下拉框（仅显示该字段可用的操作符）
2. 如果当前操作符不在新集合中，自动切换到第一个可用操作符
3. 切换值输入控件

#### 4.3 标签多选实现

```javascript
let selectedTags = [];

function addTag(tag) { /* 添加到 selectedTags，更新 UI */ }
function removeTag(tag) { /* 从 selectedTags 移除，更新 UI */ }
function renderTagSuggestions(query) { /* 从 fieldValuesCache.tag 过滤匹配项 */ }
```

#### 4.4 Notion 风格日历面板

```javascript
let calendarDate = new Date();

function renderCalendar(year, month) {
  // 渲染月份导航（← 年/月 →）
  // 渲染星期列头（一/二/三/四/五/六/日）
  // 渲染日期网格（当月日期 + 前后填充）
  // 高亮今天、选中日期
}

function openCalendar() { /* 显示日历面板 */ }
function closeCalendar() { /* 隐藏日历面板，点击外部关闭 */ }
function selectDate(day) { /* 更新日期输入框，关闭日历 */ }
```

#### 4.5 更新 `openRuleModal` 函数

编辑规则时，根据字段类型正确设置值：
- tag 字段：将存储的逗号分隔值转为标签数组
- updatedAt 字段：解析日期和时间到两个输入框
- 其他字段：不变

#### 4.6 更新 `confirmRule` 处理器

保存规则时，根据字段类型从正确控件读取值：
- tag 字段：将标签数组转为逗号分隔字符串
- updatedAt 字段：合并日期和时间
- 其他字段：不变

### Step 5: 前端交互优化

1. **删除工作台按钮**：添加 loading 状态（禁用按钮 + 文本变为"删除中..."）
2. **成功反馈**：删除成功后使用 `showDetailError` 显示绿色成功提示"工作台已删除"
3. **错误信息**：优化错误信息显示，使用更友好的中文描述
4. **规则操作**：保存/删除规则时添加 loading 状态

---

## 验证步骤

1. **删除工作台测试**：
   - 点击删除 → 弹出确认弹窗 → 确认 → 显示 loading → 成功后跳转概览页
   - 后端检查 `workspace.json`、`workspace-memberships.json`、`workspace-columns.json`、`workspace-rules.json` 中对应数据已清理

2. **规则弹窗测试**：
   - 选择"类型"字段 → 操作符只显示"等于/属于" → 值控件为下拉框（clip/knowledge/todo/learning-plan）
   - 选择"标签"字段 → 操作符显示"等于/包含/属于" → 值控件为标签多选
   - 选择"更新时间"字段 → 操作符只显示"早于/晚于" → 值控件为 Notion 风格时间选择器
   - 选择"来源路径"字段 → 操作符显示"等于/包含/属于" → 值控件为文本框

3. **时间选择器测试**：
   - 点击日期输入框 → 弹出日历面板 → 选择日期 → 面板关闭，日期显示
   - 输入时间 → 格式验证（HH:mm）
   - 主题切换（light/dark）→ 日历面板样式正确

4. **标签多选测试**：
   - 输入文本 → 显示自动补全建议 → 点击/回车选择 → 显示为标签胶囊
   - 点击标签 ✕ → 移除标签
   - 编辑已有规则 → 标签正确回显

---

## 未涉及范围

- 不修改后端规则匹配逻辑（`WorkspaceRuleService.matches()` 方法）
- 不修改字段值接口（`/api/workspace/field-values`）
- 不修改其他页面