# 工作台视图交互统一：产品开发工作区保留侧边栏修复计划

> **注意**：本文档已根据 MVP 重新设计更新。产品开发工作区不再使用独立 `ProductDevController` 数据源，而是复用 workspace 规则系统 + 剪藏/待办模块。

## Summary

修复产品开发工作区「全屏覆盖侧边栏导致无法回退」的交互问题。将 `product-dev-view` 从 `.shell` 外部的 fixed 全屏覆盖层改造为 `.main-area` 内部的普通视图（与 overview/detail 同级的显示切换），从而始终保留左侧面板，并统一三个视图的切换交互逻辑。

**MVP 更新**：产品开发工作区视图的数据源从独立 `/api/product-dev/*` 接口切换为复用 workspace 系统（`/api/workspace/{id}/resolve`），前端仪表盘和看板数据从 `WorkspaceResolution` 获取。

## 当前状态分析

### 现状结构（frontend/workspace.html）

```
.shell
├── .sidebar                    ← 侧边栏（240px，含导航项 + 工作台列表 + 新建按钮）
└── main.main-area              ← 主区域（flex:1, overflow-y:auto）
    ├── #overviewView           ← 全部概览
    └── #detailView             ← 工作台详情
（product-dev-view 在 </main> 之外）
```

### 存在的问题

1. **`.product-dev-view` 使用 `position: fixed; inset: 0; z-index: 60` 全屏覆盖**，覆盖整个 `.shell`（含侧边栏）。进入产品开发工作区后侧边栏被遮挡不可点击。
2. **`pdSidebarToggle` 按钮未绑定事件**。移动端（<820px）侧边栏为抽屉时无法用它打开侧边栏。
3. **视图切换逻辑分散**：三个入口各自独立编写显隐与高亮逻辑，重复且不一致。

### MVP 数据源变化

| 组件 | 旧数据源 | 新数据源（MVP） |
|------|---------|----------------|
| 仪表盘统计卡片 | `/api/product-dev/stats` | `WorkspaceResolution` 统计 |
| 需求看板 | `/api/product-dev/requirements` | `WorkspaceMembership` 看板 |
| 知识图谱 | `/api/product-dev/relation-graph` | 隐藏（二期） |
| 甘特图 | `/api/product-dev/timeline` | 隐藏（二期） |
| 归档列表 | `/api/product-dev/archives` | TODO 目录扫描结果 |

## 修改方案（仅改 frontend/workspace.html）

### 1. HTML：将 product-dev-view 移入 .main-area

将 `<div class="product-dev-view" id="productDevView">…</div>` 整块移动到 `<main class="main-area">` 内部、`#detailView` 结束之后、`</main>` 之前。

### 2. CSS：改为普通视图显隐切换

```css
.product-dev-view { display: none; }
.product-dev-view.visible { display: block; }
```

- 删除：`position: fixed; inset: 0; z-index: 60; overflow-y: auto;`
- 保留：`background: var(--ws-bg);`
- 知识图谱和甘特图 tab 隐藏（`display: none`）

### 3. JS：统一视图切换逻辑

引入统一的 `showView(view)` 函数：
- `navOverview` 点击 → `showView('overview')`
- `navProductDev` 点击 → `showView('product-dev')` → 加载 workspace `pd-builtin` 数据
- `selectWorkspace(id)` → `showView('detail')` → 加载对应 workspace 数据
- 绑定 `pdSidebarToggle` 事件

### 4. 数据加载（MVP 改造）

`loadProductDev()` 改为：
1. 调用 `/api/workspace/pd-builtin/resolve` 获取 workspace 解析结果
2. 从解析结果中提取剪藏和待办列表
3. 按功能点标签分组渲染到各子视图
4. 隐藏知识图谱和甘特图 tab

## 验证步骤

1. **语法校验**：提取 `workspace.html` 内联 `<script>` 块语法检查
2. **桌面端验证**：
   - 点击「产品开发」→ 工作区正常显示，侧边栏仍可见可点击
   - 点击「全部概览」→ 成功回到默认工作台
   - 产品开发视图内 Tab 切换正常
3. **移动端验证**：汉堡按钮可打开侧边栏抽屉
4. **回归验证**：`refresh` 广播后数据正常刷新