# NoteGen 画布借鉴 & 知识图谱「画布」方案调研（只调研，未定案）

> 范围：只做**调研与写文档**，本节不开发。读完你应该能判断：现在这个到底是不是"画布"、要不要发力、最省 token 的路线是哪条，然后你拍板。

---

## 0. 结论速览（30 秒版）

| 问题 | 结论 |
|---|---|
| 现在这个是"画布"吗 | **不是**。它本质是 **D3 力导向图（force layout）**，节点坐标是"力"凑出来的；只是**额外叠加**了"便签/链接/图片"这类可写节点 + `canvas_*` 持久化。两套语义混在一起，才出现"新增无效/刷新/偏移"。 |
| 三个缺陷好修吗 | 根因都很清楚（见第 2 节），但**因为是架构性冲突**，纯打补丁会越补越乱；需要先决定"要不要把画布和知识图谱解耦"。 |
| 借鉴谁 | **Obsidian Canvas + 开放标准 JSON Canvas**（NodeGen 口径与之一致）。核心一条：**画布 = 绝对坐标的自由摆放卡片，不做力导向自动布局**。 |
| 最省 token 的路线 | **思路 A**：把"可写节点"从 force 图彻底剥离成独立固定坐标画布。改动集中、稳定、省时省 token（细节见第 4 节）。 |

---

## 1. 现状拆解：知识图谱「画布」到底是什么

### 1.1 渲染与布局：D3 force 图（不是画布）
[knowledge-graph.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L302-L306) 用：
`d3.forceSimulation(allNodes).force('link', forceLink).force('charge', -280).force('center', …).force('collide', …)`

大白话：所有节点像一堆"带电的小球"，有斥力（不重叠）、被连线拉着、朝画布中心聚——**位置是每帧算出来的，不是存下来的**。

### 1.2 可写节点：从上面抠出来的"卡片"
节点拖动到某处后，通过右键菜单在 [createCanvasNode](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1258-L1262) 创建"便签(note)/链接(link)/图片(image)/引用(ref)"，经 [canvas-node.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/canvas-node.js) 写入 SQLite 的 `canvas_node + canvas_layout`，再由 [L349-L352](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L349-L352) 的 `renderCanvasNodes(canvasNodes)` 以**卡片样式**画出来。

大白话：普通节点是"力摆放的圆"，可写节点是想"自由摆放的卡片"——**一个页面里同时要"自动排版"又要"手工摆放"，天然打架**。

### 1.3 持久化链路（这条是好的，保留）
```
canvas_node / canvas_edge / canvas_layout（SQLite）
        │
Electron canvas-node.js（读写）
        │
canvas-sync.js（全量快照，双向同步）
        │
后端 CanvasStateService.java（JSON 快照原子写 graph/canvas-state.json）
    + CanvasController.java（/api/canvas GET/POST）
```

### 1.4 与"真正画布"的语义偏差（一句话）
| 真正画布（Obsidian/JSON Canvas） | 本项目现状 |
|---|---|
| 节点坐标**绝对存储**，渲染就按坐标摆 | 坐标被 force 重排覆盖 |
| 交互是"手工摆放 + 缩放平移" | 交互是"自动布局 + 点击连线" |
| 每个节点一个稳定 `id/x/y/width/height` | 可写节点想这么做，但被 force 打回 |

---

## 2. 三大缺陷的根因（代码级）

### 缺陷① 右键新增便签/链接/图片"无效、画布没体现"

**根因（主）**：`createCanvasNode` 要求 `window.electronAPI.localIndex.createCanvasNode` 存在，**没有时直接 `return false` 静默**（[L1258-L1262](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1258-L1262)）。
- 你如果是**用浏览器**打开这个页面（没有 Electron bridge）→ 必然静默无操作 → "好像都无效"。
- 即便 Electron 端，创建后走 `fetchData(currentView)` 重建（[L1320](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1320)），若新节点 `id/type` 没被 [buildGraph](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L146-L197) 收进 `nodeMap`，`isCanvas` 匹配不上，`renderCanvasNodes` 不会画它 → "在画布中没体现"。

修复思路（本轮只给方向）：①给无 bridge 场景一个**前端内存兜底**（不落库也能当场显示）；②创建后**差分插入**该节点而不是整图重建；③校验新节点是否真的进 `allNodes/nodeMap`。

### 缺陷② 每次新增"页面就刷新/重排"

**根因**：创建后 `fetchData` 整图重建 → 重跑 force simulation（视觉=整幅重刷）；且父框架 `postMessage('refresh')` 时至 [L2163](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L2159-L2164) 直接 `location.reload()`（白屏级刷新）。

修复思路：改 **diff 更新**：新增/移动只更新该节点 DOM，绝不再重建整图；`refresh` 消息改为"静默重拉快照"，不要 reload。

### 缺陷③ 节点连线相对"选中的节点"一起偏移

**根因**：force 重跑，节点坐标被重新力导打散，**没有 `fx/fy` 固定"手工摆放位"** → 已存 `canvas_layout` 的坐标作废，"上次视角/选中节点"自然对不上。

修复思路：核心是给可写节点**绝对定位并钉死 `fx/fy`**、把连线也变成记录"从哪到哪"的静态边而非弹簧引力。

> 一句话总根因：**D3 force 是"自动布局"，画布要的是"手工自由摆放"；两套机制混在一个页面里。**

---

## 3. 借鉴主线：Obsidian Canvas / 开放标准 JSON Canvas

**出处**：[Obsidian 官方 Canvas 帮助](https://help.obsidian.md/Plugins/Canvas) / [JSON Canvas 开放规范](https://jsoncanvas.org/) / [Obsidian Canvas 视觉系统](https://deepwiki.com/obsidianmd/obsidian-help/6-canvas-visual-system)。

### 3.1 数据模型（把"画布"落成一个 JSON，而不是一堆"力"）
```jsonc
{
  "nodes": [
    { "id": "n1", "type": "text",  "x": 120, "y": 80, "width": 260, "height": 140, "text": "这是便签" },
    { "id": "n2", "type": "file",  "x": 600, "y": 80, "width": 200, "height": 200, "file": "MyNote.md" },
    { "id": "n3", "type": "web",   "url": "https://…" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "n1", "toNode": "n2", "fromSide": "right", "toSide": "left", "label": "因为" }
  ]
}
```
大白话：**每个节点自己记住它呆在哪（x/y/宽高）**，连线也记住它连着谁、从哪条边出来。渲染时"照坐标摆、照记录连线"，根本不需要力去猜。

### 3.2 交互 & 体验（值得抄的点）
- **无限画布 + 缩放/平移**：不是"图自适应窗口"，而是"你指挥视角去看图"。
- **卡片叠加 HTML**（文本/图片/外链各自一种卡片），**不随着力乱跑**。
- **连线锚在节点"边"**（`fromSide/toSide`），看起来是"画上去的连接线"，不是"弹簧"。
- **Group 分组**：可折叠的框，框住一组节点（本项目已有点 grop/frame 的影子，可对齐该语义）。
- **双击/右键**：空白双击新建文本卡；右键节点可 删/改/换。操作都**即时、无整页刷新**。

### 3.3 与 NoteGen 的关系
NoteGen 作为本地笔记/可视化应用，其画布口径与 Obsidian Canvas 一致（自由摆放 + 开放数据格式）。
本项目不必逐字节对照本地 NoteGen app（反编译不可靠且费时），**直接以已验证的 JSON Canvas / Obsidian 官方为可靠参照**，即可达到"借鉴 NoteGen"的效果。

---

## 4. 引出思路：项目目前没有"真画布"，要不要引？怎么引？

> 前提判断：现在的知识图谱（力导向图）**依然有价值**——它适合"看全貌/自动连线"。真正缺的是**一个自由摆放、可持久化坐标的"画布"形态**。下面是三条路线，**不排序**，供你决策。

### 思路 A：把"可写节点"从 force 图剥离成独立画布（★最省 token、最稳）
**先强调：这条路不重写，几乎全部用现成代码拼装**（见下方"可复用资产盘点"）。

大白话：别让"力"管便签/卡片。把便签/链接/图片这些**手工卡片**当成"固定坐标层"，force 不再挪动它们；知识图谱的"圆点节点+自动连线"保持原样。两者叠加，互不干扰。

**实际改动只有三小块**（都属于"修 bug"，不是重做）：
1. **新增走差分、不走整图重建**：新建卡片后，把返回节点 `push` 进 `allNodes/nodeMap` + 局部 `renderCanvasNodes` 增量，别 `fetchData` 重跑 force → 一并解决 **缺陷②重刷** 与 **缺陷①没体现**。
2. **无 bridge 时加前端内存兜底**：新建先按 `fx/fy` 钉住在内存渲染，落库失败再弹提示 → 解决 **缺陷①浏览器静默无效**。
3. **卡片坐标全程钉死 `fx/fy`，fetchData 后不清掉**：已有 [buildGraph 设 `fx/fy`](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L170-L171)、[拖拽设 `fx/fy`](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L622-L633)，只需保证重建后不覆盖 → 解决 **缺陷③偏移**。

- 收益：不碰力导向老逻辑，回归点可控；卡片不再乱跑，右键新增立即可见；**改动最小、最省 token、bug 最少**。
- 适配现有持久化：直接复用 `canvas_node/canvas_edge/canvas_layout` + `canvas-sync`，后端**零改动**。

#### 可复用资产盘点（都不用重写，已存在）
| 已可复用 | 位置 | 用于 |
|---|---|---|
| 无限画布 zoom/平移 + 视口恢复 | [d3.zoom / currentTransform / preservedTransform](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L221-L300)、[坐标换算 screenToWorld](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L515-L517) | 平移/缩放/落点换算 |
| 拖拽 + 网格吸附 + 坐标钉死 `fx/fy` | [dragBehavior](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L612-L660) | 卡片自由摆放、吸附 |
| 便签/链接/图片卡片渲染 | [renderCanvasNodes](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L474) | 卡片外观 |
| 空白右键菜单 + 新建/编辑弹窗 | [openCanvasMenu](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1155)、canvasModal | 新增/编辑入口 |
| 持久化读写 | electron/sqlite/canvas-node.js（createCanvasNode/updateCanvasNode） | canvas_node+layout 落库 |
| 双端同步 | electron/canvas-sync.js、backend CanvasStateService/CanvasController | 本地/后端一致 |
| 分组 frame 图层 | knowledge-graph.js frames-layer | 后续 group |
| 创建时按坐标钉位 | [buildGraph 设 fx/fy](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L170-L171) | 恢复已存坐标 |

### 思路 B：沿用现架构，只给可写节点 `fx/fy` 钉住 + 差分渲染（改动最小）
大白话：给每个手工卡片一个"钉子"，force 不再挪得动它；新增/移动只更新局部，不重建整图。

- 收益：改动面最小，半小时内能见效；现有 UI 不变。
- 成本/风险：只是"止血"，两套语义仍共存，后续想要"无限画布/分组/缩放"仍要重构；属于"临时缓解"而非"真画布"。

### 思路 C：对标 JSON Canvas 建全新"无限画布"页（体验最佳、工作量最大）
大白话：单独开一个真正的画布（像 Obsidian Canvas）：无限空白 + 缩放平移 + 文本/图片/外链卡片 + 手动连线 + 分组，数据就用 JSON Canvas 格式。知识图谱页面保持"自动布局视图"，画布是新入口。

- 收益：对标 NoteGen/Obsidian 的完整画布体验，一次做对；数据可被其他工具读取（开放标准）。
- 成本/风险：工作量最大（新的渲染引擎：pan/zoom + 多类型卡片 + 连线锚点 + 分组 + 持久化）；token 消耗最高；与现有知识图谱是**两套东西**，需决定入口与数据怎么关联。

---

## 5. 我的一句建议（供参考，非定案）
想**尽快止血 + 稳**：走 **思路 A**；想**彻底做出 NoteGen 那种画布**：走 **思路 C**（但建议先做 1 页的 JSON Canvas 最小可行画布验证，再铺开）。**思路 B 只建议做临时补丁**。

具体先做哪条、做到什么程度，你来定。

---

## 参考链接
- Obsidian Canvas 帮助：https://help.obsidian.md/Plugins/Canvas
- JSON Canvas 开放规范：https://jsoncanvas.org/
- Obsidian Canvas 视觉系统（deepwiki）：https://deepwiki.com/obsidianmd/obsidian-help/6-canvas-visual-system

## 证据索引（本文所有根因均可在以下位置复核）
- 前端渲染/布局：[frontend/knowledge-graph.js#L302-L306](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L302-L306)
- 右键空白菜单绑定：[frontend/knowledge-graph.js#L259-L264](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L259-L264)
- 可写节点卡片渲染：[frontend/knowledge-graph.js#L349-L352](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L349-L352)
- 创建节点（bridge 依赖）：[frontend/knowledge-graph.js#L1258-L1262](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1258-L1262)
- 创建后整图重建：[frontend/knowledge-graph.js#L1320](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1320)
- refresh → reload：[frontend/knowledge-graph.js#L2159-L2164](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L2159-L2164)
- 持久化：electron/sqlite/canvas-node.js、electron/canvas-sync.js、backend CanvasStateService.java / CanvasController.java