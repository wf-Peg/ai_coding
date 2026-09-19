# 画布 M4「导出 OPML」+ 编辑器↔画布跳转联动 实施方案

> 范围（用户已确认）：① M4-导出 OPML（幕布互通）；② 跳转型联动——画布节点可「用编辑器打开」、编辑器选中文本可「发送到画布」。开发完成后关机。
> 数据真源不变：画布仍 SQLite（canvas_node 等），编辑器仍文件语义；联动不合并两套数据，仅做「跳转 + 落库」。
> 零后端改动；仅 electron/main.js + preload.js + 前端四文件 + 单测。

---

## F1 · 导出 OPML（画布大纲 → .opml）

**改 1 `frontend/js/canvas-outline.js`**
- 新增**纯函数** `opmlSerialize(nodes, title)`（node 可测，挂导出面）：
  - 输入 `[{id,text,parentId,orderIndex,createdAt}]`；同级按 orderIndex（缺省 createdAt）排序；
  - 输出标准 OPML 2.0：`<opml version="2.0"><head><title>…</title></head><body>` + 递归 `<outline text="…">`，每层子节点嵌套；
  - XML 属性转义：`&<>"'` → `&amp;&lt;&gt;&quot;&apos;`；空 text 节点跳过（但保留其非空子树）；
  - 富文本标记（`**`/`==`/`[t](u)`）按原文写入 text；幕布/主流导入器按纯文本接受。
- 新增 `toOPML()`：内部 `normalizeOrders()` + `opmlSerialize(nodes, 文档标题)`，标题取 `opts.getExportName?.replace(/\.md$/,'')` 传入 init 时注好的标题回调，缺省「大纲」。
- 新增 `downloadOPML(filename)`：`Blob(['text/xml'])` 下载 `.opml`。
- 末尾挂载改为 `api` 变量 + `module.exports`（node 单测）/ `window.CanvasOutline`（浏览器）双出口，同 canvas-ai-outline.js 先例。

**改 2 `frontend/canvas.html`**：`.outline-head-actions` 加「导出 OPML」按钮（id `outlineOPMLBtn`，放「导出 MD」旁）。

**改 3 `frontend/canvas.js`**：`initOutline()` 绑定 `outlineOPMLBtn → CanvasOutline.downloadOPML(标题 + '.opml')`（标题复用 `getExportName`，去 `.md` 后缀）。

**单测 `frontend/js/canvas-outline-md.test.js` 增补**（需 1 的 module.exports）：
- 嵌套层级序列化正确；
- XML 转义（text 含 `& < > " '`）；
- 空 text 节点跳过但子树保留；
- 往返：`toOPML` 文本喂给 `CanvasAIOutline.parseMarkdownOutline` 能还原同构树（层级文本一致）。

## F2 · 画布 → 编辑器「在编辑器中打开」（note 节点）

**改 4 `electron/main.js`**：新 IPC `canvas:open-in-editor`（`localIndexGuard` 外，独立 handler）：
  1. 参数 `{nodeId, text, title}`；
  2. 落临时 md：`path.join(app.getPath('temp'), 'cutshelter-canvas', sanitize(nodeId) + '.md')`，自动 `mkdirSync recursive`，存在即覆写；
  3. 显式写入富文本原文（含 `**` 等标记，编辑器里仍是 markdown 可编辑）；
  4. 调 `editorFileService.openPath(filePath)` → 返回其结果（编辑器新标签 + focus，既有 `editor-open-file-by-path` 同链路）；
  5. 失败返回 `{canceled:true,message}`。

**改 5 `electron/preload.js`**：`openCanvasNodeInEditor: (args) => ipcRenderer.invoke('canvas:open-in-editor', args)`。

**改 6 `frontend/canvas.html`**：`nodeMenu`（节点右键菜单）「编辑内容」下新增「在编辑器中打开」（id `nodeOpenInEditorAction`，默认隐藏）。

**改 7 `frontend/canvas.js`**：
- `openNodeMenu` 时：仅 `d.type === 'note'` 显示该按钮；
- nodeMenu 统一点击 handler 增加 `open-in-editor` 分支：`window.electronAPI.openCanvasNodeInEditor({nodeId, text, title})` → 成功 Toast「已在编辑器中打开」，失败 Toast 错误。

## F3 · 编辑器 → 画布「发送选中到画布」

**改 8 `electron/main.js`**：新 IPC `canvas:quick-add`（`localIndexGuard`）→ `canvasNode.createNode(dbConn, {kind:'note', text, title, docId: 默认文档})` → 返回 `{node}`。落「我的画布」根层（追加语义），不指定 view 坐标则 (0,0) 占位。

**改 9 `electron/preload.js`**：`quickAddCanvasNode: (args) => ipcRenderer.invoke('canvas:quick-add', args)`。

**改 10 `frontend/editor.html`**：`editorContextMenu`「编辑操作」区（compare 之后、divider 前）加「发送到画布」（`data-context-action="canvasQuickAdd"`，id `canvasQuickAddContextBtn`，SVG 图标 + 文字，默认隐藏）。

**改 11 `frontend/editor.js`**：
- `elements` 映射加 `canvasQuickAddContextBtn`；
- `openEditorContextMenu()`：`elements.canvasQuickAddContextBtn.hidden = !hasSelection`；
- `data-context-action` 分发加 `canvasQuickAdd`：取 `elements.editorContextMenu.dataset.selectedText` → `window.electronAPI.quickAddCanvasNode({text, title: 首行≤40 字})` → `showToast('已发送到画布「我的画布」')` / 失败 Toast；成功同时自动切换？**不改视图**，仅提示。

**改 12 `frontend/canvas.js`**：画布页加 `window.addEventListener('focus', debounce(loadData))`（300ms 去抖），用户在编辑器发送后切回画布 tab 立即看到新节点（画布 iframe 常驻于主框架，focus 触发最可靠；不加按秒轮询）。

## 边界与坑

- **F2 临时文件**：写入 `temp/cutshelter-canvas/`，不污染用户存储目录；同名 nodeId 覆写，编辑器里改动**不会**回写画布（方向性跳转，写清提示文案「以编辑器打开副本」可选——本轮 Toast 用「已在编辑器中打开」即可，不误导）。
- **F3 目标文档**：固定落「我的画布」（默认文档），避免「发到哪个画布」的选单复杂度；范围明确为 MVP。
- **XML 转义**：OPML `text` 属性必须转义，否则导入器/浏览器解析坏死；`title` 同理。
- **smoke-theme**：F1~F3 全部文件不新增 `--app-*` 令牌（无新样式或仅复用现有），126/126 保持。
- **单测**：`canvas-outline.js` 必须兼容 node require（否则 F1 单测无法跑）。

## 验证

1. `node --check` 全改文件；`node --test frontend/js/canvas-outline-md.test.js`（含 F1 用例）全绿。
2. 单测 F1：分层/转义/空节点/往返。
3. `node scripts/smoke-theme.js` 126/126。
4. 手工（Electron）：画布导出 OPML → 用幕布/文本查看器可开；note 右键「在编辑器中打开」→ 编辑器新标签出现该内容；编辑器选中文本右键「发送到画布」→ Toast 提示 → 切回画布 tab 见新根节点。

（本文件即本批唯一事实来源；按 F1 → F2 → F3 顺序执行，每步后跑对应验证。）