# 编辑区模块：右键菜单扩展 + 标签拖拽排序

## 一、概述

在编辑器画布右键菜单中增加"智能入库"和"AI 识别导入密码"两个操作项，同时为标签栏增加拖拽排序能力（类似 Notepad 的标签拖拽重排）。

---

## 二、当前状态分析

### 2.1 编辑器右键菜单

- DOM 定义在 [editor.html:L347-354](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\editor.html#L347-L354)
- 当前菜单项：复制、剪切、粘贴、全选、分隔线、AI 搜索选中内容
- `aiSearchContextBtn` 仅在选中文本时显示（`openEditorContextMenu` 中判断 `selectedText.trim()`）
- 点击分发给 `executeEditorContextAction`，`aiSearch` 走 AI 对话，其余走 `mainEditor.execCommand`
- 样式在 [editor.css:L1452-1467](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\styles\editor.css#L1452-L1467)

### 2.2 智能入库 API

- `POST /api/ingest`，body: `{ text: string }`，返回 `{ success, intent, id, title, redirect }`
- 前端调用示例见 [clip.html:L3028-3070](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\clip.html#L3028-L3070)

### 2.3 密码 AI 识别导入 API

- `POST http://127.0.0.1:8081/api/vault/auto-fill`，body: `{ text: string }`，返回 `{ success, entries: [...] }` 或 `{ error }`
- 前端调用示例见 [vault.html:L1163](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\vault.html#L1163)

### 2.4 标签渲染

- `renderTabBar()` 在 [editor.js:L425-468](file:///l:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\frontend\js\editor.js#L425-L468)
- 标签按 `tabs[]` 数组顺序渲染，不支持拖拽重排
- 每个 `.tab-item` 无 `draggable` 属性

### 2.5 关键文件

| 文件 | 角色 |
|---|---|
| `frontend/editor.html` | 右键菜单 DOM 定义 |
| `frontend/js/editor.js` | 右键菜单打开/关闭/执行逻辑、标签渲染 |
| `frontend/styles/editor.css` | 右键菜单样式、标签栏样式 |

---

## 三、改动方案

### 3.1 编辑器右键菜单新增两项

#### 3.1.1 HTML 改动（editor.html）

在 `#editorContextMenu` 中，现有 `aiSearchContextBtn` 按钮之后、`</div>` 之前，新增两个按钮：

```html
<button type="button" data-context-action="smartIngest" role="menuitem" id="smartIngestContextBtn">📥 智能入库</button>
<button type="button" data-context-action="aiImportPassword" role="menuitem" id="aiImportPasswordContextBtn">🔑 AI 识别导入密码</button>
```

- 两个按钮均添加 `id` 以便 `elements` 对象引用
- 均在 `openEditorContextMenu` 中根据 `selectedText.trim()` 控制显隐
- 紧随 `aiSearchContextBtn` 的逻辑，与 `aiSearch` 共享同一分隔线

#### 3.1.2 JS 改动（editor.js）

**a) `elements` 对象扩展**

在 `elements` 的 `Object.fromEntries` 数组中新增两个 id：
- `'smartIngestContextBtn'`
- `'aiImportPasswordContextBtn'`

**b) `openEditorContextMenu` 函数修改**

在现有 `elements.aiSearchContextBtn.hidden = !selectedText.trim();` 之后，增加：

```javascript
elements.smartIngestContextBtn.hidden = !selectedText.trim();
elements.aiImportPasswordContextBtn.hidden = !selectedText.trim();
```

**c) `executeEditorContextAction` 函数扩展**

在 `aiSearch` 分支之后，新增两个 `action` 处理分支：

- `smartIngest`：调用 `POST /api/ingest`，body `{ text: selectedText }`，成功后 `showToast` 提示结果，失败提示错误
- `aiImportPassword`：调用 `POST /api/vault/auto-fill`（完整 URL `http://127.0.0.1:8081/api/vault/auto-fill`），body `{ text: selectedText }`，成功后 `showToast` 提示识别到的条目数，失败提示错误

**注意**：两个 API 调用都使用 `API_BASE_URL` 推导出后端基址（`http://127.0.0.1:8081`），或直接使用完整 URL。由于 `editor.js` 中已有 `API_BASE_URL = 'http://127.0.0.1:8081/api/clip'`，可以推导出 `http://127.0.0.1:8081`。

#### 3.1.3 行为逻辑

- 右键菜单打开时，只有选中文本才显示"智能入库"和"AI 识别导入密码"
- 点击后先关闭菜单，再发起异步请求
- 请求期间显示加载状态（按钮文字改为"处理中..."，禁用）
- 完成后通过 `showToast` 显示结果
- 密码导入成功后，同时提示用户可以在密码库查看完整内容

### 3.2 标签拖拽排序

#### 3.2.1 原理

利用 HTML5 原生 Drag & Drop API，在 `renderTabBar()` 中为每个 `.tab-item` 添加拖拽能力，通过 `dragstart`/`dragover`/`drop` 事件重新排列 `tabs[]` 数组并重新渲染。

#### 3.2.2 JS 改动（editor.js）

**a) `renderTabBar()` 函数修改**

在 `tabEl.appendChild(closeBtn);` 之后、`tabEl.addEventListener('click', ...)` 之前，插入拖拽事件绑定：

```javascript
// 拖拽排序
tabEl.draggable = true;
tabEl.dataset.tabIndex = index;
tabEl.addEventListener('dragstart', function(e) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(index));
  setTimeout(() => this.classList.add('tab-dragging'), 0);
});
tabEl.addEventListener('dragend', function() {
  this.classList.remove('tab-dragging');
  tabBar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-drop-target'));
});
tabEl.addEventListener('dragover', function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  tabBar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-drop-target'));
  this.classList.add('tab-drop-target');
});
tabEl.addEventListener('drop', function(e) {
  e.preventDefault();
  e.stopPropagation();
  this.classList.remove('tab-drop-target');
  tabBar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-dragging', 'tab-drop-target'));
  const srcIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
  const dstIndex = parseInt(this.dataset.tabIndex, 10);
  if (srcIndex === dstIndex) return;
  // 调整 tabs 数组顺序
  const item = tabs.splice(srcIndex, 1)[0];
  tabs.splice(dstIndex, 0, item);
  // 修正 activeTabIndex
  if (srcIndex < activeTabIndex && dstIndex >= activeTabIndex) {
    activeTabIndex--;
  } else if (srcIndex > activeTabIndex && dstIndex <= activeTabIndex) {
    activeTabIndex++;
  } else if (srcIndex === activeTabIndex) {
    activeTabIndex = dstIndex;
  }
  renderTabBar();
});
```

**b) 标签栏容器**（`tabBar`）- 防止拖拽到空白区域

在 `tabBar` 上注册 `dragover` 和 `drop` 以防止默认行为，保证拖拽体验流畅。在 `renderTabBar()` 外部（初始化阶段）注册一次即可。

#### 3.2.3 CSS 改动（editor.css）

在标签栏样式区块末尾新增：

```css
/* 拖拽排序样式 */
.tab-item.tab-dragging {
  opacity: 0.4;
}
.tab-item.tab-drop-target {
  border-left: 2px solid var(--app-primary);
}
```

#### 3.2.4 注意事项

- **不影响任何侧栏面板**：标签拖拽排序只操作标签栏 DOM 和 `tabs[]` 数组，AI 机器人面板、历史面板、文件树面板、最近文件面板、常用文件面板的显隐/内容/状态完全不受影响
- 拖拽到标签栏空白区域（spacer 或 tabNewBtn）时不做排序处理

- `activeTabIndex` 修正逻辑：当拖拽涉及活跃标签或跨过活跃标签时，需要正确调整索引
- 拖拽结束后需要清理所有拖拽状态 class
- 拖拽到标签栏空白区域（spacer 或 tabNewBtn）时不做排序处理

---

## 四、不涉及的范围

- 不修改后端代码（智能入库和密码导入的后端 API 已存在且稳定）
- 不修改其他模块（clip.html、vault.html 保持不变）
- 不改动标签页切换、关闭、新建等核心逻辑
- 不涉及数据持久化（标签顺序只在当前会话有效，不存 localStorage）

---

## 五、验证方式

1. **右键菜单显隐**：打开编辑器，在空白区域右键 → 只显示复制/剪切/粘贴/全选；选中文字后右键 → 显示 AI 搜索、智能入库、AI 识别导入密码
2. **智能入库功能**：选中一段文字 → 右键 → 智能入库 → 弹出 toast 提示成功/失败
3. **AI 识别导入密码**：选中账号密码文本 → 右键 → AI 识别导入密码 → toast 提示识别到的条目数
4. **标签拖拽排序**：拖拽标签 A 到标签 B 的位置 → 标签顺序交换 → 点击标签验证内容正确切换
5. **活跃标签修正**：拖拽活跃标签到其他位置 → 当前编辑内容不变
6. **边界情况**：只有一个标签时不拖拽（或拖拽不做任何事）；拖拽到自身位置不做任何事