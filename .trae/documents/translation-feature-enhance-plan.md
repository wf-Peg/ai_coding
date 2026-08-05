# 翻译功能增强实施计划

## 一、概述

基于现有翻译功能代码，完成以下三个任务：
1. 离线翻译支持中文转英文
2. 管理自定义词典 → 管理词典，分区为"自定义映射"和"词典库"
3. 右键"添加英文翻译"改为"添加自定义词典"和"添加词典库"两个功能

---

## 二、当前状态分析

### 现有词典体系
| 存储 | 来源 | 用途 | 可编辑 |
|------|------|------|--------|
| `window.DICT` | dict-offline.js（硬编码） | 英→中 | 否 |
| `window.DICT_CN` | dict-offline.js（硬编码） | 中→英 | 否 |
| `window.USER_DICT` | localStorage `editor_user_dict_v1` | 用户自定义映射 | 是 |

### 离线翻译流程（`offlineTranslate`，editor.js:1422-1434）
- 选中文本 → 取第一个单词 → `lookupOfflineWord()` 查找
- `lookupOfflineWord()` 用 `replace(/[^a-z'-]/g, '')` 过滤，中文被完全清除
- 虽然内部有 DICT_CN 检查（line 1482-1484），但仅当中文文本未被过滤掉时才生效
- 实际效果：选中中文文本执行离线翻译，因过滤后为空，永远显示"未找到"

### 添加英文翻译流程（`addEnglishTranslation`，editor.js:1582-1612）
- 正确支持中文→英文查找（USER_DICT → DICT_CN → DICT）
- 但功能是"在光标后追加翻译"，不是"翻译选中文本"

### 词典管理弹窗（`openDictModal`，editor.js:3983）
- 标题："管理自定义词典"
- 只管理 USER_DICT 条目
- 无分区/标签

### 右键菜单（editor.html:348-365）
- `➕ 添加英文翻译` → 调用 `addEnglishTranslation`（追加翻译到编辑器）
- `📚 管理词典` → 打开词典管理弹窗

---

## 三、详细变更方案

### 变更 1：离线翻译支持中文转英文

**涉及文件：** `frontend/js/editor.js`

**修改点：**

#### 1.1 修改 `offlineTranslate` 处理分支（~line 1422-1434）
```js
// 当前逻辑：
var word = selectedText.trim().toLowerCase();
var firstWord = word.split(/[\s,;:!?.\n]+/)[0];
var result = lookupOfflineWord(firstWord);

// 改为：检测中文文本，直接查 DICT_CN 和 USER_DICT
var text = selectedText.trim();
var hasChinese = /[\u4e00-\u9fff]/.test(text);
if (hasChinese) {
  // 直接查 USER_DICT
  if (window.USER_DICT && window.USER_DICT[text]) {
    result = { word: text, meaning: window.USER_DICT[text], matchedAs: '用户词典' };
  }
  // 查 DICT_CN
  if (!result && window.DICT_CN && window.DICT_CN[text]) {
    result = { word: text, meaning: window.DICT_CN[text], matchedAs: '中译英' };
  }
  // 查词典库（DICT_LIB）
  if (!result) { result = lookupDictLib(text); }
} else {
  // 英文走原有 lookupOfflineWord
  var firstWord = text.split(/[\s,;:!?.\n]+/)[0];
  result = lookupOfflineWord(firstWord);
}
```

#### 1.2 修改 `lookupOfflineWord` 函数（~line 1470-1562）
- 无结构性改动，但确保入口处先判断中文，跳过英文词形变化逻辑

---

### 变更 2：管理自定义词典 → 管理词典，分区管理

**涉及文件：** `frontend/editor.html`、`frontend/js/editor.js`、`frontend/styles/editor.css`

#### 2.1 新增词典库存储（DICT_LIB）

在 editor.js 中新增：
- 存储键：`editor_dict_lib_v1`（localStorage）
- 加载/保存/增/删函数，与 USER_DICT 类似
- 离线翻译时同时查 DICT_LIB
- 自动补全时也纳入 DICT_LIB 条目（`collectDictEntries` 函数中增加 DICT_LIB 合并，`registerDictCompleter` 自动生效）

```js
var DICT_LIB_STORAGE_KEY = 'editor_dict_lib_v1';

function loadDictLib() {
  // 从 localStorage 加载
}
function saveDictLib() {
  // 保存到 localStorage
}
function addDictLibEntry(source, target) {
  // 添加条目
}
function removeDictLibEntry(source) {
  // 删除条目
}
function lookupDictLib(word) {
  // 在词典库中查找
}
```

#### 2.2 修改弹窗 HTML（editor.html:369-394）

改为：
```html
<div class="modal-backdrop" id="dictModal">
  <section class="modal-card dict-modal-card">
    <div class="panel-header">
      <div>
        <h2>管理词典</h2>
        <p>管理自定义映射和词典库条目</p>
      </div>
      <button class="icon-close" data-close-modal="dictModal">×</button>
    </div>
    <!-- 标签切换 -->
    <div class="dict-tabs">
      <button class="dict-tab active" data-dict-tab="mapping">自定义映射</button>
      <button class="dict-tab" data-dict-tab="library">词典库</button>
    </div>
    <!-- 自定义映射面板 -->
    <div class="dict-tab-content" id="dictTabMapping" style="display:block">
      <!-- 现有添加条目表单 + USER_DICT 列表 -->
      <div class="form-grid">
        <label class="field-group wide">
          <span class="field-label">源词（中文或英文）</span>
          <input class="field-control" id="dictSourceInput" placeholder="例如：hello 或 你好">
        </label>
        <label class="field-group wide">
          <span class="field-label">目标释义</span>
          <input class="field-control" id="dictTargetInput" placeholder="例如：你好 或 hello">
        </label>
      </div>
      <button class="tool-btn primary" id="dictAddBtn">添加条目</button>
      <div class="dict-list" id="dictList"></div>
    </div>
    <!-- 词典库面板 -->
    <div class="dict-tab-content" id="dictTabLibrary" style="display:none">
      <div class="dict-tab-header">
        <span class="dict-tab-hint">词典库用于存储常用翻译条目，支持快速添加</span>
      </div>
      <div class="dict-list" id="dictLibList"></div>
    </div>
    <div class="panel-actions">
      <button class="tool-btn" data-close-modal="dictModal">关闭</button>
    </div>
  </section>
</div>
```

#### 2.3 新增 CSS 样式（editor.css）

```css
/* 词典标签切换 */
.dict-tabs { display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--app-border); }
.dict-tab { flex: 1; padding: 8px 12px; border: 0; background: transparent; color: var(--app-text-muted); cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; transition: all 120ms ease; }
.dict-tab:hover { color: var(--app-text); background: var(--app-surface-hover); }
.dict-tab.active { color: var(--app-primary); border-bottom-color: var(--app-primary); }
.dict-tab-content { display: none; }
.dict-tab-content.active { display: block; }
.dict-tab-header { margin-bottom: 8px; }
.dict-tab-hint { font-size: 11px; color: var(--app-text-muted); }
```

#### 2.4 修改弹窗逻辑（editor.js）

- `openDictModal`：初始化标签切换、渲染两个列表
- 新增 `renderDictLibList()`：渲染词典库列表
- 修改 `setupDictModal`：绑定标签切换事件
- 新增 `collectAllDictEntries()`：集成 DICT_LIB

---

### 变更 3：右键菜单修改

**涉及文件：** `frontend/editor.html`、`frontend/js/editor.js`

#### 3.1 替换右键菜单按钮（editor.html:360）

```html
<!-- 替换前 -->
<button type="button" data-context-action="addEnglishTranslation" ...>➕ 添加英文翻译</button>

<!-- 替换后 -->
<button type="button" data-context-action="addCustomMapping" ...>📝 添加自定义词典</button>
<button type="button" data-context-action="addToDictLib" ...>📚 添加词典库</button>
```

#### 3.2 新增两个处理分支（editor.js）

```js
// 添加自定义词典：选中文本 → 打开词典弹窗，预填源词并聚焦到释义输入框
if (action === 'addCustomMapping') {
  if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
  openDictModalWithSource(selectedText.trim());
  return;
}

// 添加词典库：选中文本 → 弹出输入框，输入翻译 → 保存到词典库
if (action === 'addToDictLib') {
  if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
  promptAddToDictLib(selectedText.trim());
  return;
}
```

#### 3.3 新增辅助函数

```js
// 打开词典弹窗并预填源词
function openDictModalWithSource(sourceText) {
  elements.dictSourceInput.value = sourceText;
  // 切换到自定义映射标签
  switchDictTab('mapping');
  openDictModal();
  elements.dictTargetInput.focus();
}

// 弹出快速添加对话框，将选中文本添加到词典库
function promptAddToDictLib(sourceText) {
  var translation = prompt('请输入 "' + sourceText + '" 的翻译：');
  if (translation && translation.trim()) {
    if (addDictLibEntry(sourceText, translation.trim())) {
      showToast('✅ 已添加到词典库: ' + sourceText + ' → ' + translation.trim());
    }
  }
}
```

#### 3.4 右键菜单显隐逻辑更新（editor.js ~line 1346）
- `addCustomMapping` 按钮：有选中文本时显示
- `addToDictLib` 按钮：有选中文本时显示
- 移除旧的 `addEnglishTranslationContextBtn` 引用

---

## 四、涉及文件清单

| 文件 | 修改内容 |
|------|----------|
| `frontend/js/editor.js` | ①离线翻译中译英逻辑 ②DICT_LIB存储 ③弹窗标签切换 ④右键菜单新功能 ⑤元素引用更新 |
| `frontend/editor.html` | ①词典弹窗重构为双标签 ②右键菜单替换为两个按钮 |
| `frontend/styles/editor.css` | ①标签切换样式 ②词典库列表样式（复用现有.dict-list） |

---

## 五、验证步骤

1. 选中中文文本 → 右键 → 离线翻译 → 应显示英文翻译
2. 选中英文文本 → 右键 → 离线翻译 → 应显示中文翻译（原有功能不受影响）
3. 右键 → 管理词典 → 弹窗标题为"管理词典"，有"自定义映射"和"词典库"两个标签
4. "自定义映射"标签：可添加/删除自定义映射条目
5. "词典库"标签：可查看/删除词典库条目
6. 右键选中文本 → "添加自定义词典" → 弹窗打开，源词预填，聚焦到释义输入框
7. 右键选中文本 → "添加词典库" → 弹出输入框，输入翻译后保存到词典库
8. 词典库条目在离线翻译中应生效
9. 词典库条目在自动补全中应生效