# 工作台侧边栏改进实施计划

## 概要
本计划涵盖 4 项改进：修复知识模块首次点击无数据、默认工作台改名"全部"、默认工作台可配置（右键/设置+绿点标识）、侧边栏拖拽排序。

## 当前状态分析

### 1. 知识模块点击无数据
- **文件**: `frontend/knowledge.js`
- **问题**: `DOMContentLoaded` 时调用 `fetchTopics()`，此时 `active_workspace_id` 从 localStorage 读取。但 `index.html` 中导航到知识视图时，不会主动发送 `workspaceChange` 消息给知识 frame。如果知识 iframe 加载时序与 localStorage 状态不同步，可能导致首次加载数据为空。
- **现状**: 仅 `workspaceChanged` 事件触发时 `index.html` 才向所有 frame 广播 `workspaceChange`；知识 iframe 首次加载时仅依赖 `DOMContentLoaded` 的 `fetchTopics()`。

### 2. 默认工作台改为"全部"
- **文件**: `frontend/workspace.html`，`renderWsList()` 函数（第 1151 行）
- **现状**: 硬编码 `<span class="ws-name">默认工作台</span><span class="ws-type-tag">全部</span>`，`active_workspace_id = ''` 时表示"全部"。

### 3. 默认工作台可配置 + 绿点标识
- **后端模型** (`Workspace.java`): 当前无 `isDefault` 字段，仅有 `id, name, description, color, type, status, matchAll, createdAt, updatedAt`。
- **后端 API** (`WorkspaceController.java`): `GET /api/workspace/list` 返回所有工作台，无默认标识字段；`PUT /{workspaceId}/settings` 仅更新 `matchAll` 字段。
- **前端渲染** (`renderWsList()`): 硬编码"默认工作台"项，无绿点标识。
- **后端状态指示器**: `index.html` 中已有 `backend-global-dot.ready` 样式（绿点 + 发光阴影），可直接复用。

### 4. 侧边栏拖拽排序
- **前端**: `sidebar-list` 元素 (`#wsList`) 使用 `renderWsList()` 生成静态 HTML，无拖拽逻辑。
- **后端**: `Workspace` 模型无 `sortOrder` 字段，`WorkspaceIndexService.saveWorkspace()` 按添加顺序存储。
- **现有拖拽**: 看板（kanban）已有基于 HTML5 Drag and Drop API 的拖拽实现，可参考。

---

## 详细改动方案

### 任务 1: 修复知识模块首次点击无数据

**问题根因**: 用户点击"知识"导航按钮时，`renderView('knowledge')` 加载知识 iframe，但此时不会主动发送 `workspaceChange` 消息。如果 `active_workspace_id` 在 iframe 加载时尚未正确同步，`fetchTopics()` 使用空参数请求 API，可能返回空数据。

**修复**:
- 修改 `frontend/index.html` 的 `renderView()` 函数，在切换到 `knowledge` 视图时，向 `knowledgeFrame` 发送 `workspaceChange` 消息（类似 clip 视图的 `refreshKnowledge` 逻辑）。

**具体改动** (`index.html`):
```javascript
// 在 renderView 函数末尾，clip 视图的 refreshKnowledge 之后添加：
if (normalizedView === 'knowledge' && knowledgeFrame && knowledgeFrame.contentWindow) {
  knowledgeFrame.contentWindow.postMessage({ 
    action: 'workspaceChange', 
    workspaceId: activeWorkspaceId 
  }, '*');
}
```

**涉及文件**: `frontend/index.html`（仅 1 处改动）

---

### 任务 2: 默认工作台改为"全部"

**改动**: 将 `renderWsList()` 中的"默认工作台"文本改为"全部"。

**具体改动** (`workspace.html` 第 1151 行):
```javascript
// 修改前
const defaultHtml = `...<span class="ws-name">默认工作台</span><span class="ws-type-tag">全部</span>...`;
// 修改后
const defaultHtml = `...<span class="ws-name">全部</span><span class="ws-type-tag">全部内容</span>...`;
```

**涉及文件**: `frontend/workspace.html`（仅 1 处改动）

---

### 任务 3: 默认工作台可配置 + 绿点标识

#### 3a. 后端: 添加 `isDefault` 字段 + API

**模型改动** (`Workspace.java`):
- 在 `record` 中添加 `boolean isDefault` 字段，默认 `false`。

**API 新增** (`WorkspaceController.java`):
- `PUT /api/workspace/{id}/set-default` — 将指定工作台设为默认，同时将其他工作台的 `isDefault` 置为 `false`。
- 响应: `{ "success": true, "workspace": { ... } }`。

**API 修改** (`WorkspaceController.java`):
- `PUT /{workspaceId}/settings` — 扩展支持 `isDefault` 字段。

**涉及文件**:
- `backend/.../index/Workspace.java`
- `backend/.../controller/WorkspaceController.java`
- （可选）`WorkspaceRequest / WorkspaceSettingsRequest` 中添加 `isDefault` 字段

#### 3b. 前端: 渲染绿点 + 移除硬编码"全部"项

**改动** (`workspace.html` 的 `renderWsList()`):
- 保留"全部"项（任务 2 已改名），作为无筛选的入口。
- 对每个工作台项，添加 `isDefault` 判断：
  ```javascript
  // 在 ws-dot 后面添加绿点标识
  const defaultDot = ws.isDefault ? '<span class="default-indicator" title="默认工作台"></span>' : '';
  ```
- 添加 `.default-indicator` CSS 样式，复用 `backend-global-dot.ready` 的绿点样式：
  ```css
  .sidebar-item .default-indicator {
    width: 7px; height: 7px; border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
    flex: none;
    margin-left: 4px;
  }
  ```
- 在 `workspace.html` 中，`loadWorkspaces()` 的 API 响应处理中，识别 `isDefault` 字段。
- 默认工作台选择逻辑：`loadWorkspaces()` 中，如果 `savedWsId` 为空且存在 `isDefault: true` 的工作台，则默认选中该工作台。

#### 3c. 右键菜单设置默认工作台

**改动** (`workspace.html`):
- 为每个 `.sidebar-item` 添加 `contextmenu` 事件监听：
  ```javascript
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const wsId = btn.dataset.wsid;
    if (!wsId) return; // "全部"项不设右键
    showContextMenu(e.clientX, e.clientY, wsId);
  });
  ```
- 创建上下文菜单函数 `showContextMenu(x, y, wsId)`，渲染一个自定义浮层菜单：
  ```html
  <div class="ws-context-menu" style="position:fixed;left:Xpx;top:Ypx;z-index:9999">
    <button data-action="set-default">设为默认工作台</button>
  </div>
  ```
- 点击"设为默认工作台"时，调用 `PUT /api/workspace/{id}/set-default`，然后刷新工作台列表。

#### 3d. 工作台详情页"设为默认"按钮

**改动** (`workspace.html` 的 `renderWorkspaceSettings()`):
- 在设置区域添加"设为默认工作台"按钮：
  ```javascript
  settingsEl.innerHTML += `
    <div class="settings-section">
      <button class="set-default-btn" id="setDefaultBtn" type="button">
        ${ws.isDefault ? '✓ 当前为默认工作台' : '设为默认工作台'}
      </button>
    </div>`;
  ```
- 如果 `ws.isDefault` 为 `true`，按钮禁用 + 显示"当前为默认工作台"。
- 点击时调用 `PUT /api/workspace/{id}/set-default`，成功后刷新。

**涉及文件**:
- `frontend/workspace.html`（renderWsList、contextmenu、renderWorkspaceSettings）
- `backend/.../index/Workspace.java`
- `backend/.../controller/WorkspaceController.java`

---

### 任务 4: 工作台侧边栏拖拽排序

#### 4a. 后端: 添加 `sortOrder` 字段

**模型改动** (`Workspace.java`):
- 添加 `int sortOrder` 字段，默认 `0`。

**API 改动** (`WorkspaceController.java`):
- `PUT /api/workspace/reorder` — 接收排序后的工作台 ID 列表：
  ```json
  { "workspaceIds": ["id1", "id2", "id3"] }
  ```
  后端按数组顺序更新每个工作台的 `sortOrder`。

**`WorkspaceIndexService.java`**:
- 添加 `reorderWorkspaces(List<String> workspaceIds)` 方法。

#### 4b. 前端: 拖拽排序

**改动** (`workspace.html`):
- 在 `renderWsList()` 中为每个工作台项添加 `draggable="true"` 属性。
- 添加拖拽事件监听：
  ```javascript
  function setupDragSort() {
    const items = wsList.querySelectorAll('.sidebar-item[data-wsid]:not([data-wsid=""])');
    items.forEach(item => {
      item.draggable = true;
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragend', onDragEnd);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('drop', onDrop);
    });
  }
  ```
- 拖拽完成后，收集新的排序顺序，保存到 `localStorage`（键: `workspace_sort_order`），并调用 `PUT /api/workspace/reorder` 同步到后端。
- 在 `loadWorkspaces()` 中，如果 `localStorage` 中有排序记录，按该顺序渲染；否则按后端返回的顺序。

**涉及文件**:
- `frontend/workspace.html`
- `backend/.../index/Workspace.java`
- `backend/.../index/WorkspaceIndexService.java`
- `backend/.../controller/WorkspaceController.java`

---

## 涉及文件清单

| 文件 | 改动内容 |
|------|---------|
| `frontend/index.html` | 知识视图切换时发送 workspaceChange 消息 |
| `frontend/workspace.html` | "默认工作台"→"全部"、绿点标识、右键菜单、拖拽排序、设置按钮 |
| `frontend/knowledge.js` | 无需改动（仅依赖 index.html 补发消息） |
| `backend/.../index/Workspace.java` | 添加 `isDefault`、`sortOrder` 字段 |
| `backend/.../controller/WorkspaceController.java` | 新增 `set-default`、`reorder` API |
| `backend/.../index/WorkspaceIndexService.java` | 新增 `reorderWorkspaces()` 方法 |

---

## 假设与决策

1. **排序持久化**: 排序顺序同时保存在 `localStorage` 和后端，优先使用 `localStorage` 顺序（因为用户可能离线使用）。
2. **权限**: 所有工作台操作不区分用户，所有用户共享同一份工作台配置。
3. **"全部"项**: 保留在列表顶部，不可拖拽、不可设为默认。它始终代表"查看所有内容"。
4. **默认工作台**: 每个工作台只能有一个默认工作台。设置新的默认工作台会自动取消之前的默认工作台。
5. **绿点样式**: 复用 `backend-global-dot.ready` 的样式（`#10b981` 绿色 + 发光阴影），保持一致性。

---

## 验证步骤

1. 点击知识模块，确认首次加载即显示数据（与工作台选择一致）
2. 查看侧边栏，"全部"替代了"默认工作台"文本
3. 右键工作台 → "设为默认工作台"，绿点出现，刷新后绿点保留
4. 工作台详情页 → 设置区 → "设为默认工作台"按钮正常工作
5. 拖拽侧边栏工作台项，顺序改变，刷新后顺序保留
6. 后端编译：`mvn compile` 无错误
7. 后端测试：`mvn test` 全部通过