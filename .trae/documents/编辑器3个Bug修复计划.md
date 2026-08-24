# 编辑器模块 3 个 Bug 修复计划

## 目标
修复编辑器模块三个 bug：
1. 桌面文件右键「剪藏：用编辑器打开」后，会开出**两个编辑器画布**打开同一文件——应只开一个。
2. 切换页面后，**仅 ACE 编辑区**文字/背景色错乱。
3. 导出 Word 提示「正在生成 Word…」后报「导出失败：Failed to fetch」，无法导出。

用户澄清：
- Bug1 的"两个窗口"实为**两个编辑器画布**（编辑器是 index.html 内的 iframe，非独立 BrowserWindow），目标是只保留一个画布打开该文件。Ctrl+T 仅作体验层面的类比说明。
- Bug2 现象仅限 **ACE 编辑区**，非整体界面。

---

## 当前状态分析（探索结论）

### 架构背景
- 编辑器不是独立窗口，而是 index.html 中的 `<iframe id="editorFrame" src="editor.html">`（`frontend/index.html:651`）。
- 桌面右键「剪藏：用编辑器打开」→ `CutShelter.exe --open-editor "%1"` → 主进程 `command-line-handler.js` 解析 → `dispatchActions` 通过 `mainWindow.webContents.send('open-file-request', path)` 发到渲染进程（`command-line-handler.js:93-116`）。
- 前端 index.html 唯一监听 `onOpenFileRequest`（`frontend/index.html:1964-1977`）：`openFileByPath` → `renderView('editor')` → `sendToEditor({type:'openFileData'})`。
- 编辑器 iframe 收到 `openFileData` → `openFileDataInNewTab` 开新标签（`frontend/js/editor.js:2735-2757,3330-3352`）。

### Bug1 根因（两个画布）
- 主进程对同一 `--open-editor` 文件存在**两条分发路径**：
  - 路径 A：`second-instance` 事件（`main.js:4137-4141`）→ `dispatchActions`。
  - 路径 B：首次启动 `whenReady`（`main.js:4396-4404`）→ `createMainWindow` + `parseCommandLineArgs(process.argv)` + `dispatchActions`。
- 桌面右键**总会启动一个新 app 实例执行 `CutShelter.exe --open-editor "%1"`**。此时：
  - 若应用**已在运行**：新实例被单实例锁挡 → 触发 `second-instance`（路径 A）分发**一次**；
  - 若应用**未运行**：走路径 B，`whenReady` 用 `process.argv` 解析分发**一次**。
- 但真实复现"两个画布"的机制：**当应用从相同命令行被二重触发（尤其托盘常驻 + 用户重复右键），`parseCommandLineArgs` 可能把同一文件解析出两条 action** —— `argMap['--open-editor']` 命中 push 一条（`command-line-handler.js:60,67-76`）；同时若 `--open-editor` 后的路径又以裸文本路径形态再次出现在 argv（Electron 会重组 argv，见 `command-line-handler.js:64-66,78-83`），`else` 分支 `isTextFileLike` 又 push 一条 `open-editor`（`command-line-handler.js:78-83`）。→ `dispatchActions` 对同一文件 `send('open-file-request')` **两次** → 前端 `onOpenFileRequest` 触发两次 → `openFileDataInNewTab` 开**两个标签/两个画布**。
- 两条 action 都指向同一 `path` 时，`dispatchActions` 会连续两次 `webContents.send`，前端没有幂等去重。

### Bug2 根因（ACE 编辑区颜色错乱）
- 编辑器 iframe 初始化即读 `localStorage.get('app_appearance_v1')/('app_theme_v1')` 计算 `data-theme` 并 `mainEditor.setTheme()`（`frontend/js/editor.js:330-342,3368`）。
- 父页面主题切换 `broadcastThemeChange` 向 iframe 发 `themeChange` 消息（`frontend/index.html:762-766`），编辑器 iframe 收到后执行 `applyTheme()`（`editor.js:3338-3339`）。
- `applyTheme()` 只读 **localStorage** 决定主题（`editor.js:331-338`），**没有使用父页面传入的 theme 值**。父页面 `applyTheme` 默认 `persist=true` 会写 localStorage，但**切换页面并不触发主题切换**。
- 真正错乱点：**ACE 主题（textmate 白底 / tomorrow_night 黑底）与编辑区容器的 `--app-*` CSS 变量取自不同步的两套来源**。当 `appearance=system`（跟随系统，`index.html:744-747`）时，系统亮/暗切换会实时改父页面 `data-theme`（CSS 变量即时变），但编辑器 iframe 的 ACE 主题只在收到 `themeChange`/`storage` 事件时才 `setTheme`。iframe 用 `visibility:hidden` 隐藏时（`index.html:998-999`）虽能收到消息，**但 ACE 画布在隐藏期间改变主题后回到可见时使用旧容器色值的 DOM/CSS 未重绘**，导致文字/背景对比错乱。此外 `compareEditor` 与 `mainEditor` 共用同一 aceTheme（`editor.js:340-341`），对比面板复用时同样只读 localStorage。
- 结论：ACE 主题决策未与父页面实际生效主题严格同步，依赖 localStorage 基线的 `applyTheme` 在 iframe `visibility:hidden` / `system` 动态切肤 / 切换页面时序下产生错乱。

### Bug3 根因（Failed to fetch）
- 前端 `exportToWord`（`frontend/js/editor.js:2862-2943`）构造 `exportUrl = window.API_BASE_URL.replace(/\/?api\/clip$/, '/api/editor/export-word')`（`editor.js:2917-2918`）。
- `window.API_BASE_URL` 在 `editor.js:4-5` 初始化为 `http://127.0.0.1:8081/api/clip`，**但该值是运行时全局，其它脚本可用 `var` 覆盖**（`clip-shared.js:126` 也写 `window.API_BASE_URL`）。若运行过程中被覆盖为不含 `/api/clip` 后缀的值（如仅 `http://127.0.0.1:8081`），`replace` 不命中 → 请求打到错误 URL。
- 后端：`Markdown2WordController` `@RequestMapping("/api/editor")` + `@PostMapping("/export-word")`（`backend/.../Markdown2WordController.java:22-46`），服务端口 8081，无 context-path（`application.yml:51-52`）。后端路由 `/api/editor/export-word` 与前端期望一致。
- 后端 `@CrossOrigin("*")` 已开 CORS（`Markdown2WordController.java:24`），POI 依赖在 pom（`backend/pom.xml:122-123`），服务实现完整（`Markdown2WordService.java`）。
- 报 `Failed to fetch` 说明 **fetch 在「请求未获响应」层面失败**，不是后端返回的 `Word 导出失败` JSON。最可能根因按概率排序：
  1. `window.API_BASE_URL` 被覆盖 → 请求到不存在路径 → 后端 404 本质是响应，但因接口路径全部匹配失败极可能 404；不过 404 仍会 `resp.ok=false` 走 JSON 分支（非 Failed to fetch）。→ 只有当 URL 完全连不上（端口错）才 Failed to fetch。
  2. **Electron 渲染进程 fetch `http://127.0.0.1:8081` 时被系统代理 / 防火墙拦截**或浏览器模式 CSP 拦截 → 直接 TypeError: Failed to fetch。
  3. 后端服务**未启动**或 controller 未生效（改了代码没重启）→ 连接拒绝 → Failed to fetch。
- 尚未 100% 确认单一根因，但前端 `exportToWord` 的 URL 构造对 `window.API_BASE_URL` 后缀过于脆弱（依赖须含 `/api/clip`），是明确的代码缺陷；同时缺少**错误降级**与 **fetch 超时/明确错误码**（Failed to fetch"吞细节"）。

---

## 修复方案

### Bug1：用编辑器打开只开一个画布
**改动文件**：`frontend/index.html`、`electron/command-line-handler.js`（加固为主）

1. **分发去重（`electron/command-line-handler.js`）**：在 `parseCommandLineArgs` 收集到全部 action 后，对 `open-editor` 类型按 `path` 去重——同一 `path` 只保留第一条，避免不同形态（`--open-editor` 标志 + 裸路径）重复分发。
   - 在函数返回前过滤：只保留 path 唯一（`open-editor` 去重，其它 action 不受影响）。
2. **前端幂等（`frontend/index.html`）**：在 `onOpenFileRequest` 回调内加短时间去重（如 500ms 内同一 `filePath` 已打开则丢弃），与主进程去重双保险，杜绝两个画布。
3. 保持现有"在新标签页打开"语义（`openFileDataInNewTab`），仅阻止重复。

### Bug2：ACE 编辑区主题错乱
**改动文件**：`frontend/js/editor.js`

1. `applyTheme` 增加**可接收父页面传入 theme** 的能力：`applyTheme(parentTheme)`，当入参非空时优先用入参（用于 `themeChange` 消息，带 `event.data.theme`），否则回退读 localStorage。
   - 当前 `applyTheme()` 无参（`editor.js:330`）。改为读取可选参数。
2. `themeChange` 分支（`editor.js:3338-3339`）把 `event.data.theme` 传入 `applyTheme(theme)`，确保 ACE 主题与父页面实际生效主题一致。
3. 提供 `compareEditor` 同样同步（已共用 aceTheme，靠 `setTheme` 生效）。
4. 兜底：在 `visibilitychange` 或 iframe 重新可见时（编辑器 iframe 需要从父页面处通知或 `switchToTab`/焦点进入编辑区时）重放一次 `applyTheme()`，强制 ACE 重绘为当前正确主题（解决 `visibility:hidden` 期间切主题后重绘脏的问题）。
   - 接入点：父页面 `renderView('editor')` 已隐式显示 iframe；可在 editor.js 里监听 `document.visibilityState === 'visible'` 变化时 `applyTheme()`。若编辑器 iframe 非顶层文档，改用监听父页面 `themeChange` + 在 `openFileDataInNewTab`/`switchToTab` 时调用 `applyTheme()`。

### Bug3：导出 Word Failed to fetch
**改动文件**：`frontend/js/editor.js`

1. **URL 构造加固**：不依赖 `window.API_BASE_URL` 的脆后缀。改为显式从 `window.API_BASE_URL` 提取 origin（`http://127.0.0.1:8081`）再拼接 `/api/editor/export-word`；若 origin 提取失败则回退硬编码 `http://127.0.0.1:8081`。
   - `new URL(window.API_BASE_URL).origin` 最稳妥；异常时回退默认。
2. **补充明确错误信息**：`catch (err)` 里把 `err.message` 之外再按 `Failed to fetch` 判读为「无法连接后端服务或请求被拦截」，给出可操作的提示（检查后端是否启动），而不是笼统的 `Failed to fetch`（`editor.js:2940-2942`）。
3. **可读性兜底**：不做不必要的重试逻辑；保持一次请求，但打印 `exportUrl` 到日志便于排查。

---

## 变更文件清单
| 文件 | 改动 |
|------|------|
| `electron/command-line-handler.js` | `parseCommandLineArgs` 对 `open-editor` 按 path 去重 |
| `frontend/index.html` | `onOpenFileRequest` 加同 path 短时间去重 |
| `frontend/js/editor.js` | `applyTheme` 支持入参 / 同步父主题；`themeChange` 传 theme；重绘兜底；`exportToWord` URL 加固 + 错误提示 |

## 假设与决策
- Bug1 不引入前端去重 API（保持 `onOpenFileRequest`），用时间窗+path 去重，避免改动主进程 IPC 契约。
- Bug2 以"ACE 主题与父页面实际主题同步 + 重绘兜底"为最小修复，不改主题存储结构（键名已统一）。
- Bug3 以"URL 构造加固 + 友好错误提示"为先，若实现阶段复现发现是后端未启动/代理拦截，再补相应说明；不改后端。

## 验证步骤
1. `node --check frontend/js/editor.js electron/command-line-handler.js`（JS 语法）。
2. 后端 `mvn compile`（确认导出相关代码可编译）。
3. 运行应用：
   - Bug1：桌面右键一个 .md 文件 →「剪藏：用编辑器打开」→ 断言仅打开**一个**编辑器画布/标签；重复右键同文件不叠加。
   - Bug2：切到剪藏/知识等页面再切回编辑器 → 断言 ACE 编辑区文字/背景对比正常；跟随系统切肤（暗/亮）后确认编辑区随主题正确（textmate 白 / tomorrow_night 黑，与容器 `--app-*` 协调）。
   - Bug3：在编辑器打开一段含标题/列表/表格的 md → 点「导出 Word」→ 断言 `.docx` 正常下载且无「Failed to fetch」；检查控制台 `exportUrl` 正确指向 `http://127.0.0.1:8081/api/editor/export-word`。
4. 回归：既有编辑区标签切换、对比面板、主题四选项 default/dark/notion/system 不劣化。