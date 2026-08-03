# 编辑模块增强：右键打开目录 + 路径双击打开 + 历史回退 + 快捷键调整

## 一、概述

1. 文件树/最近文件/标签栏右键菜单增加"打开文件所在目录"
2. 文件名下方路径栏支持双击打开目录
3. 历史面板支持点击条目回退到指定状态，默认保留 200 条
4. 全局唤醒快捷键从 `Ctrl+Shift+Z` 改为 `Alt+X`

---

## 二、当前状态分析

| 功能 | 当前状态 |
|---|---|
| 右键菜单（文件树/最近/标签栏） | 仅有"收藏/取消收藏"一项，无"打开目录" |
| 路径栏 `#documentPath` | 展示 `state.displayPath`，无交互事件 |
| 历史面板 | 仅展示撤销/重做栈，`maxHistoryEntries` 未使用，不能点击回退 |
| 全局快捷键 | `CommandOrControl+Shift+Z`（main.js 默认值） |
| 编辑器内撤销/重做 | ACE 默认 Ctrl+Z 撤销、Ctrl+Shift+Z 重做，无需改动 |

### 关键文件

| 文件 | 角色 |
|---|---|
| `electron/main.js` | 全局快捷键注册、IPC handler |
| `electron/preload.js` | electronAPI 暴露 |
| `frontend/editor.html` | 路径栏 DOM |
| `frontend/js/editor.js` | 右键菜单、历史面板、路径栏交互 |
| `frontend/styles/editor.css` | 历史条目样式 |

---

## 三、改动方案

### 3.1 右键菜单 + 路径栏打开文件所在目录

#### 原理

Electron 主进程提供 `shell.showItemInFolder(filePath)`，通过 IPC 暴露给渲染进程。前端通过 `window.parent.electronAPI` 调用。

#### 3.1.1 main.js — 新增 IPC

在 `setupIPC()` 中现有的 `ipcMain.handle` 区块末尾新增：

```javascript
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    await shell.showItemInFolder(filePath);
  } catch (e) {
    log.warn('[show-item-in-folder] Failed:', filePath, e.message);
  }
});
```

#### 3.1.2 preload.js — 暴露方法

在 `electronAPI` 对象中，与现有文件操作方法（`openTextFile` 等）同区域新增：

```javascript
showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
```

#### 3.1.3 editor.js — 三个右键菜单新增项

三个菜单函数（`showTabContextMenu`、`showFileTreeContextMenu`、`showRecentContextMenu`）均在现有收藏按钮之后新增第二个按钮：

```html
<button type="button" class="tab-context-open-folder" role="menuitem">📂 打开文件所在目录</button>
```

点击逻辑：获取 `filePath` → 调用 `getElectronAPI().showItemInFolder(filePath)` → 如果无 electronAPI 则 `showToast('仅在桌面模式下可用')`。

**注意**：`showTabContextMenu` 的 `filePath` 来自 `tab.displayPath || tab.fileToken`（`fileToken` 不是路径，所以仅当 `displayPath` 存在时显示该按钮）。`showFileTreeContextMenu` 的 `filePath` 来自 `file.path`。`showRecentContextMenu` 的 `filePath` 来自 `item.path`。

按钮显隐：`filePath` 为空时隐藏该按钮（例如未保存的标签不显示"打开目录"）。

#### 3.1.4 editor.js — 路径栏双击事件

在初始化阶段（`initializeAiChat()` 之后）注册：

```javascript
elements.documentPath.addEventListener('dblclick', function() {
  const path = state && state.displayPath;
  if (!path) { showToast('文件尚未保存，无法打开目录', true); return; }
  const api = getElectronAPI();
  if (api && api.showItemInFolder) {
    api.showItemInFolder(path);
  } else {
    showToast('仅在桌面模式下可用', true);
  }
});
```

同时添加 CSS 样式提示可双击：

```css
.document-path { cursor: pointer; }
.document-path:hover { text-decoration: underline; }
```

---

### 3.2 历史面板增强：点击回退 + 200 条限制

#### 原理

ACE UndoManager 内部维护 `$undoStack`（已撤销栈）、`$redoStack`（已重做栈）和 `$stackPosition`（当前在栈中的位置索引）。通过计算目标条目在栈中的位置与当前 `$stackPosition` 的差值，循环执行 `undo()` / `redo()` 跳转到目标状态。

#### 3.2.1 editor.js — 设置 `maxHistoryEntries = 200`

在 `updateHistoryPanel()` 函数中增加限制逻辑：`if (undoStack.length + redoStack.length > 200)` 时截断多余的底层条目（保留最近的 200 条）。

#### 3.2.2 editor.js — 历史条目点击回退

修改 `createHistoryItem()` 或 `updateHistoryPanel()` 中的渲染逻辑，为每个历史条目添加 `click` 事件：

- 计算当前 `$stackPosition`（即 `$undoStack.length`）
- 计算目标条目的 position 索引
- 差值 > 0：执行 `mainEditor.undo()` 差值次
- 差值 < 0：执行 `mainEditor.redo()` 绝对值次
- 每次操作后延迟一小段时间（50ms）再执行下一次，以保证 ACE 有足够时间处理
- 完成后刷新历史面板

#### 3.2.3 editor.js — 历史条目样式区分

为每个条目添加 `data-history-index` 标识当前位置，当前条目（即 `$stackPosition` 所在位置）加特殊样式，方便用户感知当前状态。

---

### 3.3 全局快捷键调整

#### 3.3.1 main.js — 修改默认值

将 `shortcutAccelerator` 的默认值从 `'CommandOrControl+Shift+Z'` 改为 `'Alt+X'`：

```javascript
let shortcutAccelerator = 'Alt+X';
```

#### 3.3.2 设置页同步

如果设置页有快捷键配置 UI，需要同步更新默认显示值。搜索 `settings.html` 和 `settings.js` 中是否有 `shortcut` 相关 UI。

---

## 四、不涉及的范围

- 不修改后端代码
- 不改动 ACE 编辑器核心配置
- 不修改历史面板的撤销/重做/清空按钮现有逻辑
- 不修改标签页切换、关闭、新建等核心逻辑
- 历史记录仍为内存存储，不持久化

---

## 五、验证方式

1. **右键打开目录**：文件树/最近文件/标签栏右键 → 点击"打开文件所在目录" → 系统文件管理器打开对应目录
2. **路径栏双击**：双击文件名下方的路径文字 → 打开文件所在目录
3. **历史回退**：打开历史面板 → 点击某条历史记录 → 编辑器内容回退到该状态 → 历史面板同步刷新
4. **历史上限**：连续编辑超过 200 次 → 最早的记录被截断
5. **快捷键**：按 `Alt+X` → 窗口显示/隐藏；编辑器内 `Ctrl+Z` 撤销、`Ctrl+Shift+Z` 重做正常