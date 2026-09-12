# 规划：调研「知识图谱画布」缺陷根因 + 借鉴 NoteGen/Obsidian 画布思路（只写文档，不开发）

## 一、目标（本轮范围）
只产出**一份调研/借鉴文档**，不做任何功能开发。文档回答三件事：
1. 当前知识图谱画布那三个缺陷（右键新增无效 / 新增即刷新 / 节点与选中偏移）的**代码级根因**；
2. NoteGen 可借鉴的画布实现口径（以 Obsidian Canvas + 开放标准 **JSON Canvas** 为主线，并说明与 NoteGen 的关联）；
3. 基于"项目目前没有真正画布功能"这一现状，**引出可选思路**（供后续某轮再决策是否开发）。

## 二、现状分析（已用真实代码核实的事实）
### 核心矛盾：D3 force 自动布局 vs "画布自由摆放 + 持久化坐标"
知识图谱 [knowledge-graph.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js) 本质是 **D3 force 图布局**（[L302-L306](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L302-L306) `forceLink/charge/center/collide`），节点坐标是被力导凑出来的，**没有用 `fx/fy` 固定的"自由摆放位"**。而项目又新增了"画布可写节点"（便签/链接/图片/引用）与 canvas_* 持久化——两者语义冲突。

### 三个缺陷的根因
1. **右键新增"无效"**：新建入口走 `createCanvasNode`（[L1258-L1262](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1258-L1262)），要求 `window.electronAPI.localIndex.createCanvasNode` 存在，**没有时直接 `return false` 静默无操作**。网页端（无 Electron bridge）测试必然"在画布中没体现"；Electron 端则依赖 bridge 写入 SQLite 后 `fetchData` 重建，任一节点 id/type 未进入 `buildGraph` 的 `nodeMap` 就不显示。
2. **"新增就刷新/重排"**：创建后 `fetchData(currentView)`（[L1320](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L1320)）重建整图 → **重跑 force simulation**，视觉等于"整幅重刷"；父框架 `postMessage('refresh')` 时甚至 `location.reload()`（[L2159-L2164](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-graph.js#L2159-L2164)）。
3. **偏移**：force 重跑又无位置固定 → 已保存的 `canvas_layout` 坐标被重新打散，节点相对选中节点（或上次视角）出现偏移。核心是**缺少"节点坐标绝对化、不参与自动布局"的机制**。

### 持久化链路（文档里要写清）
`canvas_node/canvas_edge/canvas_layout` → Electron [canvas-node.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/sqlite/canvas-node.js)，快照 [canvas-sync.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/canvas-sync.js)，后端 [CanvasStateService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/CanvasStateService.java) / [CanvasController.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/controller/CanvasController.java)。

## 三、借鉴参考主线：Obsidian Canvas / JSON Canvas（开放标准）
- Obsidian Canvas 是**非 force 的自由摆放画布**：节点绝对坐标 `x/y + width/height`，连线记录 `fromNode/toNode` 及**从哪个边出发** `fromSide/toSide`，另有可折叠 `groups`。
- 数据为单个 `.canvas` JSON：[jsoncanvas.org](https://jsoncanvas.org/) 规范 `nodes[]/edges[]`，类型含 `text/file/media/web`——与项目"便签/链接/图片/引用"一一对应，**可平移/缩放/无限空白**。
- NoteGen 作为本地笔记应用，其画布能力与 Obsidian Canvas 口径一致（文档内说明"NoteGen 可借鉴点 = JSON Canvas 数据模型 + 绝对定位 + 无限画布交互"）。由于 NoteGen 本地 app 的字节级细节不便逐一核对，文档以**已验证的 JSON Canvas / Obsidian 官方文档**为可靠参照。

## 四、拟产出的调研文档结构（执行阶段将写入 `.trae/documents/notegen画布借鉴与知识图谱画布方案.md`）
1. **结论速览**（一页：现状是不是画布、要不要发力、最省 token 的路线）
2. **现状：知识图谱画布拆解**（D3 force 架构、可写节点、持久化链路、与"画布"语义的偏差）
3. **三大缺陷的根因与修复思路**（每个：根因→可选修复→代价/风险；本轮**只给思路不给补丁**）
4. **NoteGen / Obsidian Canvas 借鉴要点**（JSON Canvas 数据模型、绝对定位、无限画布、连线锚边、group；附出处）
5. **引出思路（废话版 + 技术版）**：是否需要独立画布形态？
   - 思路 A：把"画布可写节点"彻底从 force 图**剥离**成独立固定坐标画布（最省 token、最稳）
   - 思路 B：沿用现架构，仅给可写节点用 `fx/fy` 钉住 + 差分渲染（改动最小）
   - 思路 C：对标 JSON Canvas 建全新无限画布页（体验最佳、工作量最大）
   - 每思路给"大白话收益 + 成本/token/风险"，最后不做优先级排序（留待用户决策）
6. **参考链接/出处**

## 五、假设与决策
- 本轮**只写文档、不开发、不建 Todo 实施项**。
- 借鉴参照以 **JSON Canvas / Obsidian 官方文档**为主线；不逐字节反编译本地 NoteGen app（不具可靠性、也费时），仅在文档中给出"与 NoteGen 口径一致"的定性说明。
- 文档**不做最终选型定案**，只并列思路供用户后续决策（与用户"先调研写文档"意图一致）。

## 六、验证
- 文档内容每一条根因/引用都有真实文件+行号背书（已在上方核实）。
- 交由用户通读确认"思路是否覆盖、是否需要再深挖某一条"，无需编译/运行。