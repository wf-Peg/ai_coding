# 工作台视图交互统一：产品开发工作区保留侧边栏修复计划

## Summary

修复产品开发工作区「全屏覆盖侧边栏导致无法回退」的交互问题。将 `product-dev-view` 从 `.shell` 外部的 fixed 全屏覆盖层改造为 `.main-area` 内部的普通视图（与 overview/detail 同级的显示切换），从而始终保留左侧面板（含「+ 新建工作台」区域），并统一三个视图（全部概览 / 工作台详情 / 产品开发）的切换交互逻辑。

## 当前状态分析

### 现状结构（frontend/workspace.html）

```
.shell
├── .sidebar                    ← 侧边栏（240px，含导航项 + 工作台列表 + 新建按钮）
└── main.main-area              ← 主区域（flex:1, overflow-y:auto）
    ├── #overviewView           ← 全部概览（display block/hidden 切换）
    └── #detailView             ← 工作台详情（display none/visible 切换）
（product-dev-view 在 </main> 之外）
```

### 存在的问题

1. **`.product-dev-view` 使用 `position: fixed; inset: 0; z-index: 60` 全屏覆盖**（第 242-249 行），覆盖整个 `.shell`（含侧边栏）。进入产品开发工作区后侧边栏被遮挡不可点击，无法回到默认工作台页面。这是「回退不到默认工作台」的直接根因。
2. **`pdSidebarToggle` 按钮未绑定事件**（第 651 行有按钮，JS 中无任何 addEventListener）。移动端（<820px）侧边栏为抽屉时无法用它打开侧边栏。
3. **视图切换逻辑分散**：`navOverview` / `navProductDev` / `selectWorkspace` 三个入口各自独立编写显隐与高亮逻辑（第 1094-1121 行），重复且不一致。

### 关键代码引用

- 视图切换：[workspace.html:L1080-L1121](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L1080-L1121)
- product-dev-view CSS：[workspace.html:L241-L250](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L241-L250)
- product-dev-view HTML：[workspace.html:L646-L743](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L646-L743)
- pdSidebarToggle 按钮（无绑定）：[workspace.html:L651](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L651)
- Sidebar 开合：[workspace.html:L977-L988](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L977-L988)
- refresh 监听（保留）：[workspace.html:L2142-L2149](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L2142-L2149)

## 修改方案（仅改 frontend/workspace.html）

### 1. HTML：将 product-dev-view 移入 .main-area

将 `<div class="product-dev-view" id="productDevView">…</div>` 整块（当前位于 `</main>` 之后、shell 内）移动到 `<main class="main-area">` 内部、`#detailView` 结束之后、`</main>` 之前。内部结构保持不变。

- 改动位置：第 646-743 行移动至第 642 行（detailView 结束）与第 643 行（`</main>`）之间。
- 结果结构：
  ```
  main.main-area
      ├── #overviewView
      ├── #detailView
      └── #productDevView       ← 移入，作为第三视图
  ```

### 2. CSS：改为普通视图显隐切换

`.product-dev-view` 移除 fixed 全屏定位，改为与 `.detail-view` 一致的模式：

```css
.product-dev-view { display: none; }
.product-dev-view.visible { display: block; }
```

- 删除：`position: fixed; inset: 0; z-index: 60; overflow-y: auto;`（滚动交给 `.main-area` 统一处理）
- 保留：`background: var(--ws-bg);`
- `.pd-shell` 及内部所有 `pd-*` 样式保持不变，移动端 media query（第 383-389 行）继续生效。

### 3. JS：统一视图切换逻辑

引入统一的 `showView(view)` 函数替代分散逻辑：

```js
function showView(view) {
  hideAllViews();
  if (view === 'overview') {
    activeWsId = null;
    navOverview.classList.add('active');
    overviewView.classList.remove('hidden');
    renderWsList();
  } else if (view === 'product-dev') {
    activeWsId = null;
    navProductDev.classList.add('active');
    productDevView.classList.add('visible');
    loadProductDev();
  } else if (view === 'detail') {
    activeWsId = null;   // 下方 selectWorkspace 会设置 activeWsId
    navOverview.classList.add('active');
    renderWsList();
    detailView.classList.add('visible');
  }
  closeSidebar();
}
```

- `navOverview` 点击：`() => showView('overview')`
- `navProductDev` 点击：`() => showView('product-dev')`
- `selectWorkspace(id)`：`activeWsId = id; showView('detail'); loadDetail();`
- 移除旧的 `navOverview.addEventListener` / `navProductDev.addEventListener` 独立实现，避免重复。
- **绑定 `pdSidebarToggle`**：在 sidebar 事件绑定处（第 985-988 行附近）新增：
  ```js
  $('pdSidebarToggle')?.addEventListener('click', openSidebar);
  ```
- `hideAllViews()` 保持现状（它已同时处理 overviewView / detailView / productDevView / nav 高亮）。

### 4. 不变项

- `refresh` 消息监听（第 2144-2148 行）中 `productDevView.classList.contains('visible')` 判断逻辑不变，类名未改，继续有效。
- `.detail-view` / `.overview-view` 的显隐类逻辑不变。
- `loadProductDev()` 及其渲染函数不变。

## 假设与决策

1. **产品开发工作区作为 main-area 内第三视图**，侧边栏始终可见，符合用户「保留左侧面板」的要求。
2. 保留产品开发视图顶部 `pdSidebarToggle` 汉堡按钮（移动端抽屉侧边栏的开关），桌面端该按钮通过既有 `.sidebar-toggle { display: none }` 规则隐藏，无需额外处理。
3. 工作台详情激活「全部概览」导航高亮，维持现有语义（工作台详情属于概览区域入口）。
4. 不做路由/URL 状态改造，保持纯前端视图状态切换，改动最小、风险最低。

## 验证步骤

1. **语法校验**：用 node 提取 `workspace.html` 内联 `<script>` 块执行 `new Function()` 语法检查，确保无语法错误。
2. **桌面端手动验证**：
   - 点击侧边栏「产品开发」→ 产品开发工作区正常显示，且左侧侧边栏仍可见、可点击。
   - 点击侧边栏「全部概览」→ 成功回到默认工作台页面。
   - 点击侧边栏某个工作台 → 工作台详情正常显示，导航高亮正确。
   - 产品开发视图内 Tab（总览/需求看板/知识图谱/时间线/归档）切换正常。
3. **移动端验证（<820px）**：
   - 产品开发视图顶部汉堡按钮可打开侧边栏抽屉。
   - 打开侧边栏后点击「全部概览」可返回默认工作台。
4. **回归验证**：全局 `refresh` 广播后，产品开发视图在可见时数据正常刷新。
