# 画布智能创建（AI 大纲生成器）MVP 方案

> 用户输入：`/plan review下，按优先级排序，做重点开发内容，另外参考幕布增加智能创建功能：提供示例，生成大纲节点一键作为画布，做小而美的mvp，注意交互设计，对用户友好性，参考优秀实现`
> 澄清结论：**本计划只做「智能创建 MVP」**这一件重点开发内容；其余画布待办仅做优先级排序记录，另行开工。
> 已确认决策：① 生成结果**新建文档承载**（自动新建画布文档并填充整棵大纲树，同时保留「插入当前文档」）；② 交互采用**可编辑预览 → 一键应用**（生成后可改可再生成，确认后落库排版）。

---

## 一、Summary（要做什么）

在画布页新增「智能创建」入口：用户输入主题或从**示例**点选，AI 以**流式**生成一棵 Markdown 层级大纲 → 边生成边预览 → 落成可编辑文本 → 一键「作为新画布」或「插入当前文档」落库，并按现有 `layoutByOutline` 排版展示。小而美 MVP：只做一个功能点；后端新增一个只读流式端点以支持自定大纲 prompt + 打字机体验，其余复用既有 `LlmProvider.streamChat` 与大纲建树链路。

**验收范围红线**：不动 `index.html`、不动知识图谱模块；后端仅**新增一个只读流式端点**（不改 `LlmProvider` 接口、不碰既有服务/接口逻辑）；新建代码沿用既有 IIFE + `window.X` 全局风格与 `--app-*` 主题令牌。

---

## 二、Current State Analysis（已核实的事实，含文件/行号）

### 2.1 可复用的 AI 流式能力（复用 core，新增 1 个 thin controller）

- **`LlmProvider.streamChat(List<ChatMessage>, ChatStreamListener)`** 是现成的流式引擎：[LlmProvider.java#L80](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/LlmProvider.java#L80) 与 [RoutingLlmProvider.java#L212](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java#L212)（含降级）。**无 tier 参数，走默认模型**；`ChatMessage` 为 `{role, content}`，`streamChat` 本身不拦 system 角色。
- **坑**：现成 `/api/ai/chat/stream` 不能直接用 —— [AiChatService.validateAndBuildMessages](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/AiChatService.java#L16-L46) 把 system 硬编码为「代码与文本编辑助手」，且角色只允许 user/assistant，塞不进大纲约束。
- **结论**：新增只读 controller `/api/ai/outline/stream`，**绕过 AiChatService**，自己组装 `List<ChatMessage>`（system=大纲约束 + user=主题）→ 直接 `llmProvider.streamChat` → SSE。SSE 生命周期（heartbeat/delta/done/error/降级）照抄 [AiChatController.java#L40-L169](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/AiChatController.java#L40-L169) 的 `StreamLifecycle`。

### 2.2 前端取后端地址的既有范式

- [editor.js#L4-L6](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L4-L6)：`const API_BASE_URL='http://127.0.0.1:8081/api/clip'; ... replace('/api/clip','/api/ai/chat/stream')`。
- 画布页 [canvas.js#L8](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/canvas.js#L8) 已有硬编码 `const API_GRAPH='http://127.0.0.1:8081/api/graph'` → `API_GRAPH.replace('/api/graph','/api/ai/outline/stream')` 即新流式端点地址；前端流式消费写法照抄 [editor.js#L2906-L2918](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L2906-L2918) 的 `fetch + getReader`。

### 2.3 画布侧可直接复用的接线点

- **建树/排版**：[computeOutlineLayout / layoutByOutline / fitToContent](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/canvas.js#L2469-L2555)——生成结果落库后直接调用 `layoutByOutline()` 即可对齐到幕布“大纲↔思维导图”外观。
- **大纲回写链**：[initOutline](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/canvas.js#L2084-L2154) 里 `onCreate`/`onStructure` —— 智能生成的节点落库后复用它刷新大纲与画布。
- **单据节点落库**：`canvas-node.createNode` 单条插入（[canvas-node.js#L80-L107](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/sqlite/canvas-node.js#L80-L107)，含 `docId/parentId/orderIndex`）。
- **弹层范式**：画布内已有 `#docListMask` 遮罩弹层（[canvas.html#L565](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/canvas.html#L565)），智能创建弹层沿用同款结构。
- **空态与入口**：大纲面板空态 `#outlineEmpty`（[canvas.html#L507-L509](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/canvas.html#L507-L509))）、画布空态 `#emptyEl`（#L517-L521）——均为“用 AI 生成大纲”的自然入口；大纲头部操作钮区 `.outline-head-actions`（#L500-L504）可加“✨ 智能生成”。
- **多文档切换**：`switchDoc(id)`（canvas.js 内，文档列表/切换器已用），新文档生成后切过去即可。

### 2.4 主进程 IPC 现况

- 已有 `local-index:canvas:create-doc / rename-doc / delete-doc / state / update-structure`、`create-node` 等 handler（main.js，预案 L3434 段附近）。**但无“一次插入整棵子树”的批量接口** —— 逐节点调 `create-node` 需 N 次 IPC 往返、且非原子。为保持“小而美”且单事务原子，需新增一个批量导入 handler（见下）。

### 2.5 画布待办全量排序（本次只做 #1）

| 优先级 | 待办 | 说明 |
|---|---|---|
| **P0（本次）** | **智能创建 MVP（AI 大纲生成器）** | 主题/示例 → 生成 → 可编辑预览 → 一键作为画布 |
| P1 | 富文本行内样式（加粗/高亮/链接） | 对标幕布样式能力 |
| P1 | Markdown / OPML 导入建树 | 可复用本次 `importTree` 建树链路 |
| P1 | 大纲全文搜索定位 | 提升编辑效率 |
| P2 | 大纲行拖拽排序（SortableJS） | 交互补强 |
| P2 | 大纲⇄画布位置反向同步 | 拖动后回写层级次序 |
| P3 | 多选批量缩进/移动、跨文档剪切粘贴 | |
| P3 | 折叠状态持久化、虚拟滚动/窗口化、画布增量渲染 | 性能/完善 |
| P4 | LaTeX 公式渲染（需新增 KaTeX 第三方） | 排期最末 |
| — | ⚠️ 真机复验项（非代码 TODO） | 排版视口适配、PNG 导出、旧库/跨设备升级，见旧验收清单 |

---

## 三、Proposed Changes（文件级改动清单）

### 0) `backend/src/main/java/com/example/clip/controller/AiOutlineController.java`（新建，唯一后端改动）

`@RestController @RequestMapping("/api/ai/outline")`，提供 `@PostMapping(value="/stream", produces=MediaType.TEXT_EVENT_STREAM_VALUE)`：
- 入参 `{systemPrompt, userMessage, requestId?}`（map 或新 DTO）。自己组装 `List<ChatMessage>`：`new ChatMessage("system", systemPrompt)` + `new ChatMessage("user", userMessage)`。
- 直接 `llmProvider.streamChat(messages, listener)`，SSE 事件 `delta/done/error/heartbeat`；生命周期/超时(120s)/降级逻辑照抄 `AiChatController.StreamLifecycle`（**不调用 `AiChatService`**）。
- 容错：`llmProvider == null || !isAvailable()` 时发 `error(NOT_CONFIGURED)`；`systemPrompt`/`userMessage` 为空则 400。
- **Why**：既拿到流式打字机体验，又能传前端自定大纲 system prompt；薄透传且通用，`LlmProvider` 接口零改动（`streamChat` 无 tier，用默认模型）。

### 1) `electron/sqlite/canvas-node.js`（改）— 批量导入

新增 `importTree(dbConn, { docId, tree, kind = 'note' })`：
- `tree` 为嵌套数组 `[{ text, children: [] }]`。
- 单事务（`BEGIN`/`COMMIT`，失败 `ROLLBACK`）内按**自顶向下**递归插入：父节点先插拿到 `id`，再以其为 `parentId` 插子节点；`orderIndex` 用现成 `nextOrderIndex` 或同父内递增计数。
- 复用 `KINDS` 校验、`randomUUID`、`now()`、`canvasDoc.touch(db, docId)`（事务收尾只 touch 一次）。
- 返回 `{ created: [{ id, text, parentId, orderIndex, kind, x, y }], docId }`；内置空树/非法 kind 容错。
- **Why**：避免 N 次 IPC 往返、保证整棵生成一次性原子落库。

### 2) `electron/main.js`（改）— 新增 IPC handler

- 新增 `local-index:canvas:import-tree`：入参 `{docId, tree}` → `canvasNode.importTree(db, {docId, tree})` → 成功则 `canvasSync.schedulePush()` 一次（沿用“一写一防抖 push”节律），返回 `{success, created, docId}`；失败返回 `{success:false, message}`。
- 不改任何现有 handler 语义。

### 3) `electron/preload.js`（改）— 暴露桥方法

- `localIndex` 下新增 `importCanvasTree({docId, tree})`，转发 `local-index:canvas:import-tree`，补 JSDoc。

### 4) `frontend/js/canvas-ai-outline.js`（新建，核心新模块）

IIFE 暴露 `window.CanvasAIOutline`（沿用 canvas-outline.js 风格，唯一新增全局）。对外 `open(callbacks)`，内部含：

- **Prompt 设计（背景支撑，MVP 用常量，不接 Prompt 库）**：
  - `OUTLINE_SYSTEM_PROMPT`（常量字符串）：明确约束输出格式，保证可稳定解析 —— ①只输出**纯缩进式 Markdown 列表**（`. ` 列表 + 2 空格的子项缩进）；②层级**≤4**、总条数**≤60**；③**不做前后说明文字、不用 ``` 代码块围栏、不加加粗/斜体标记、每行不带编号序号**；④主题来自用户，写给人类看、具体可落地的中文条目。
  - `generate(topic)`：POST `/api/ai/outline/stream`，body `{systemPrompt: OUTLINE_SYSTEM_PROMPT, userMessage: topic}`，用 `fetch + getReader` 消费 SSE（`delta` 累积、`done` 结束、`error` 显示错误）；边收边把增量文本填进预览 textarea（打字机），收满后 `parseMarkdownOutline` 出树。
  - `parseMarkdownOutline(md)` 依据上述契约按行缩进解析；**降级兜底**：若返回被 ``` 包裹或夹带说明，剥离围栏/非列表行后再解析；仍失败则“每行一个根节点”兜底。
- **打开弹层**：`open({ getDocTitle, onCreateDoc, onImportTree, onInsertToCurrent, onReload })`。
- **主题与会**：主题输入框 + 3 个**具体示例主题 chips**（如「📖《三体》读书笔记」「🚀 一次产品发布复盘」「🌱 新员工入职 30 天成长计划」）——点 chip 即用该主题直接生成，零门槛感受效果；空白输入框仍支持自由主题；「生成大纲」按钮触发。
- **调用 AI（流式）**：`generate(topic)` 用 `AbortController` + `fetch(API_GRAPH.replace('/api/graph','/api/ai/outline/stream'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({systemPrompt: OUTLINE_SYSTEM_PROMPT, userMessage: topic})})` + `response.body.getReader()` 逐块收 `delta`；先显示“正在构建大纲…”占位，随 delta 把文本逐块填进预览 textarea（打字机），收到 `done` 后自动 `parseMarkdownOutline` 出树；`error`/网络失败/超时 → 友好提示（`NOT_CONFIGURED` → 提示去「设置」配置模型），不崩溃；「取消」= abort 丢弃。
- **解析**：`parseMarkdownOutline(md)` 按行缩进（Tab 或 2~4 空格）解析为 `[{text,children}]`；非列表行视为父标题；**HTML 转义**防注入；节点数上限（如 ≤60）超出截断并提示。
- **可编辑预览（textarea 编辑 Markdown）**：生成结果写入一个 `textarea`（预填 Markdown 源码），旁侧/下方实时 `parseMarkdownOutline` 渲染**只读树预览**；用户直接改文本与缩进（Tab/空格）。应用时回读 textarea 文本重新 parse 成树，保证预览改动被采纳。避免嵌套 `contenteditable` 的选区/缩进/回读复杂度。
- **应用动作**：footer 提供「✨ 作为新画布」（主）「插入当前文档」「重新生成」「取消」。

### 5) `frontend/canvas.js`（改）— 接线与应用

- 引入 `CanvasAIOutline` 并在 DOMContentLoaded 时初始化入口。
- 新增 `applyOutlineAsNewDoc(tree)`（**Promise 链保证时序**）：`await createCanvasDoc({title})` → 得 `docId` → `await importCanvasTree({docId, tree})` → `await switchDoc(docId)`（等其内部 `loadData` 完成）→ `layoutByOutline()` → `fitToContent()`。避免排版作用在旧数据上。
- 新增 `applyOutlineToCurrent(tree)`（**Promise 链**）：`await importCanvasTree({docId: currentDocId, tree})` → `await` 重载当前文档（含 `CanvasOutline.setNodes`）→ `layoutByOutline()`。
- 入口绑定：大纲头部「✨ 智能生成」、`#outlineEmpty`、`#emptyEl` 的“用 AI 生成大纲”动作。

### 6) `frontend/canvas.html`（改）— 弹层与入口

- `.outline-head-actions` 加“✨ 智能生成”按钮；`#outlineEmpty`、`#emptyEl` 各加“用 AI 生成大纲”动作。
- 新增 `<div class="ai-composer-mask" id="aiComposerMask" style="display:none;">`：头部（标题+关闭）、主题输入 + 示例 chips、生成按钮、骨架屏区、可编辑预览容器、footer 操作。
- `<body>` 底部引入 `<script src="js/canvas-ai-outline.js">`（在 `canvas.js` 之前）。

### 7) `frontend/styles/canvas.css`（改）— 样式

- 新增 `.ai-composer-*`（遮罩/面板/头部/footer）、`.ai-example-chip`、`.ai-skeleton`（骨架屏动画）、`.ai-preview-row` 等；全部用 `--app-bg/surface/border/text/primary` 等既有令牌，**无硬编码颜色**（满足 `scripts/smoke-theme.js`）。

### 8) 收尾（文档/归档约定）

- 更新 `TODO/画布对标幕布（大纲与画布）/03-实施任务.md` 追加 fp-010（智能创建）并逐条勾选；`04-验收清单.md` 补对应走查项；`feature-points.json` 追加 fp-010 功能点。
- git 提交后按仓库约定同步 `commit_history.log`。

> 后端仅新增 `AiOutlineController`（薄透传流式端点）；`LlmProvider` 接口、既有 AI 接口/服务、`index.html`、知识图谱模块**零改动**。

---

## 四、Assumptions & Decisions（已定）

1. **新增只读流式端点 `/api/ai/outline/stream`**：薄透传 systemPrompt+userMessage，绕过 `AiChatService` 直接 `llmProvider.streamChat`，用**默认模型**（`streamChat` 无 tier；如需指定 simple 档需另扩 `LlmProvider.streamChatForTier`，本批不做）。前端 `getReader` 消费 SSE，prompt 常量留在前端可迭代。
2. **新建文档承载**（主）+ 保留**插入当前文档**；新建文档标题取用户主题，空则默认「未命名画布」。
3. **新增批量 IPC `import-tree`** 保证整棵生成单事务原子落库，避免 N 次往返。
4. **预览 = textarea 编辑 Markdown**：应用动作回读 textarea 文本重新 parse 成树，旁侧树预览仅作参考，保证改动被采纳。
5. **示例 = 具体主题种子 chips**（点选即用该主题直接生成，非内置成稿大纲）；空白输入框支持自由主题。
6. **AI 不可用不阻塞**：弹层给友好提示去「设置」配置，页面其余功能不受影响。
7. 折叠/视图、文档切换、排版、导出等既有能力**不回退**。

---

## 五、Verification（怎么验收）

### 自动化
1. `node --check`：`canvas-node.js`、`main.js`、`preload.js`、`canvas-ai-outline.js`、`canvas.js`。
2. `electron/sqlite/canvas-node.test.js` 新增 `importTree` 用例：嵌套建树、`parentId/orderIndex` 正确连续、按 `docId` 隔离、空树/非法 kind 容错、单事务（中途失败回滚不留脏节点）→ `node --test electron/sqlite/*.test.js` 全绿。
3. 全量回归 `node --test` 无**新增**失败；`node scripts/smoke-theme.js` 通过（新增样式无硬编码颜色）。
4. `canvas.html` 标签平衡校验（新增 `div`/`aside` 计数）。
5. 后端编译通过；`AiOutlineController` 端点注册成功（`curl -N -X POST localhost:8081/api/ai/outline/stream` 冒烟，确认 SSE `error`/`delta` 事件能回）。

### 手工（浏览器注入式 IPC mock 或真机）
- [ ] 打开画布，空态/大纲头部出现「智能生成」入口，点击弹出 composer。
- [ ] 点示例 chip → 预填主题 → 生成 → 文本**逐块流式**填进预览 textarea（打字机）→ 收满自动解析出大纲树预览（层级正确、可改、可删行）。
- [ ] 编辑预览 → 「作为新画布」→ 自动新建文档、节点落库、`layoutByOutline` 分层排版、切到新文档视图居中。
- [ ] 「插入当前文档」→ 追加到当前大纲并排版，不与已有节点冲突。
- [ ] AI 未配置/接口失败 → 弹层友好提示，不崩溃、不影响既有画布。
- [ ] 暗/亮主题下 composer 与预览样式正常（`--app-*` 令牌）。

### 回归红线
- 知识图谱、画布右键/手绘/小地图/分组/导出图片、大纲键盘范式、多文档切换**全部不回退**。