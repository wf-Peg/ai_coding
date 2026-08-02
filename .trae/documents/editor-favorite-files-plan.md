# 编辑器常用文件收藏功能实现计划

## 一、需求概述

在编辑器模块右下角状态栏新增一个"收藏"按钮，点击后从左侧滑出收藏面板。用户可手动收藏/取消收藏文件，支持拖拽排序，不限数量上限。交互和动效参考大厂产品标准。

---

## 二、数据结构

### localStorage 存储

**键名**: `editor_favorite_files`

**值格式**:
```json
[
  { "id": "uuid", "path": "C:/path/to/file.md", "name": "file.md", "addTime": 1692000000000 }
]
```

- 数组顺序即为用户拖拽排序后的顺序，无需额外 `order` 字段
- `id` 为唯一标识，用于区分同路径不同版本（未来扩展）
- 无数量上限

---

## 三、涉及文件及改动

### 1. `frontend/editor.html` — 新增收藏面板 HTML

在 `recentPane` 之后添加 `favPane`:

```html
<div class="editor-pane fav-pane" id="favPane" aria-hidden="true">
  <div class="filetree-header">
    <span>常用文件</span>
    <div class="filetree-header-actions">
      <button class="inline-btn" id="clearFavBtn">清空</button>
      <button class="inline-btn" id="closeFavBtn">关闭</button>
    </div>
  </div>
  <div class="fav-list" id="favList"></div>
</div>
```

### 2. `frontend/editor.js` — 核心逻辑

**新增模块**（约 200 行，在 recent files 模块之后）：

#### a) 数据层
- `FAVORITE_FILES_KEY = 'editor_favorite_files'`
- `getFavoriteFiles()` — 读取 localStorage
- `saveFavoriteFiles(list)` — 写入 localStorage
- `addFavoriteFile(filePath, fileName)` — 添加（去重检查）
- `removeFavoriteFile(filePath)` — 移除
- `isFavoriteFile(filePath)` — 判断是否已收藏
- `reorderFavoriteFiles(list)` — 拖拽排序后直接替换数组

#### b) 面板层
- `renderFavPanel()` — 渲染收藏列表
  - 空状态显示"暂无收藏文件，右键文件树或标签栏可收藏"
  - 每项结构：`[拖拽手柄] [文件名] [路径] [取消收藏 ×]`
  - 拖拽手柄使用 `☰` 图标，hover 时显示
- `toggleFavPanel()` — 切换收藏面板（互斥关闭文件树/历史/最近）
- `closeFavPanel()` — 关闭收藏面板

#### c) 拖拽排序
实现 HTML5 原生拖拽 API，不引入第三方库：

- 在 `fav-list` 上监听 `dragstart` / `dragover` / `dragend` / `drop`
- 拖拽时显示拖拽幽灵图（`e.dataTransfer.setDragImage`）
- 拖拽经过时目标项上方显示插入指示线（`drag-over` 类控制）
- 拖拽结束后更新数组顺序并保存到 localStorage
- 动画：使用 `transform: translateY()` + CSS transition 实现平滑位移

#### d) 收藏入口集成
- 文件树右键菜单（`openFileTreeContextMenu` 中）添加"收藏到常用"选项
- 编辑器标签栏右键菜单（`openTabContextMenu` 中）添加"收藏到常用"选项
- 右键菜单中已收藏的显示"取消收藏"
- 当前标签右键菜单也添加"收藏到常用"

#### e) 状态栏按钮
- 创建 `favBtn` 按钮，放在 `recentBtn` 旁边
- 按钮样式：`status-btn` + 收藏图标（`☆` 未激活 / `★` 已激活）
- 点击切换收藏面板

#### f) 面板互斥逻辑
- `toggleFavPanel` 中关闭文件树/历史/最近面板
- 类似 `toggleRecentPanel` 的互斥模式

### 3. `frontend/styles/editor.css` — 样式与动效

#### 新增选择器块：

| 选择器 | 用途 |
|--------|------|
| `.fav-pane` | 收藏面板容器，与 recent-pane 共用布局 |
| `.fav-pane[aria-hidden="true/false"]` | 显示/隐藏动画 |
| `.fav-list` | 列表容器 |
| `.fav-item` | 每项容器，hover 显示拖拽手柄和删除按钮 |
| `.fav-item .fav-drag-handle` | 拖拽手柄（`☰`），默认透明，hover 时显示 |
| `.fav-item .fav-name` | 文件名 |
| `.fav-item .fav-meta` | 文件路径 |
| `.fav-item .fav-remove-btn` | 取消收藏按钮，hover 显示 |
| `.fav-item.dragging` | 拖拽中状态，半透明 + 降低阴影 |
| `.fav-item.drag-over` | 拖拽经过目标，上方插入指示线 |
| `.fav-empty` | 空状态提示 |

#### 动效设计（参考大厂标准）：

| 场景 | 动效 |
|------|------|
| 面板滑入 | 240ms ease-out，从左向右位移 + 淡入（与现有面板一致） |
| 列表项 hover | 背景色 120ms 过渡 + 左侧主色指示条 180ms 滑出（与现有一致） |
| 拖拽排序 | 使用 `transform: translateY(0)` 过渡实现平滑位移，不放 opacity |
| 拖拽指示线 | 目标项上方 2px 主色线，配合 `drag-over` 类 150ms 淡入 |
| 拖拽幽灵 | 使用浏览器默认半透明幽灵图 |
| 添加/删除项 | 新项 200ms fadeInUp，删除项 200ms fadeOut 后移除 DOM |
| 按钮状态切换 | 收藏/取消收藏图标 200ms 缩放过渡 |

### 4. 右键菜单集成（`frontend/editor.js`）

在文件树右键菜单和标签栏右键菜单中添加"收藏到常用"菜单项：

- 已收藏的显示"★ 取消收藏"，未收藏的显示"☆ 收藏到常用"
- 点击后执行对应操作并刷新收藏面板（如果已打开）

---

## 四、交互流程

### 收藏流程
1. 用户在文件树右键 → 点击"收藏到常用"
2. 或标签栏右键 → 点击"收藏到常用"
3. 文件被添加到 `editor_favorite_files` 末尾
4. 如果收藏面板已打开，自动刷新列表
5. Toast 提示"已收藏到常用"

### 取消收藏流程
1. 在收藏面板中点击 `×` 按钮
2. 或右键菜单中点击"取消收藏"
3. 文件从列表中移除
4. 列表自动刷新（带淡出动画）
5. Toast 提示"已取消收藏"

### 打开文件流程
1. 点击收藏列表中的文件项
2. 调用 `openRecentFile(filePath)` 复用逻辑（与打开最近文件一致）
3. 如果文件不存在，自动从收藏列表中移除并提示

### 拖拽排序流程
1. 鼠标悬停在文件项上，左侧出现 `☰` 拖拽手柄
2. 按住拖拽手柄开始拖拽
3. 经过其他项时，目标项上方显示插入指示线
4. 松开鼠标，文件插入到新位置
5. 列表重新排序并保存到 localStorage
6. 使用 `transform` 过渡动画实现平滑位移

---

## 五、设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储方式 | localStorage | 与最近文件一致，无需后端介入 |
| 排序方式 | 手动拖拽 | 用户已确认 |
| 数量上限 | 无 | 用户已确认 |
| 拖拽实现 | HTML5 原生 DnD API | 不引入第三方库，减少依赖 |
| 面板位置 | 左侧抽屉（与文件树/最近/历史一致） | 复用现有面板机制 |
| 文件打开逻辑 | 复用 `openRecentFile` | 与最近文件一致，代码复用 |
| 收藏入口 | 右键菜单（文件树+标签栏） | 操作路径最短，符合用户预期 |

---

## 六、验证步骤

1. 启动应用，确认状态栏出现"收藏"按钮
2. 点击"收藏"按钮，左侧滑出收藏面板（240ms 动画）
3. 文件树右键文件 → "收藏到常用" → 文件出现在收藏列表中
4. 标签栏右键 → "收藏到常用" → 文件出现在收藏列表中
5. 在收藏面板中点击文件 → 在编辑器中打开
6. 点击 `×` 取消收藏 → 文件从列表中移除（200ms 淡出）
7. 拖拽文件项排序 → 松开后顺序保持
8. 清空所有收藏 → 显示空状态提示
9. 收藏面板与文件树/历史/最近面板互斥切换
10. 关闭应用重新打开 → 收藏数据持久化