# 工具模块「灵感橱窗」：URL 工具导入 / 自适应渲染 / 克隆缓存页面方案

## 一、Summary

工具模块（Tools Hub）面向「收集各产品灵感的橱窗」场景，新增支持以**网站地址（URL）**作为工具入口（保留现有 HTML 文件入口）；点击工具后**自适应渲染**目标页面；并为 URL 类工具提供**「克隆为缓存页面」**能力——接入 Electron `webContents.savePage` 原生另存（HTMLComplete 文件夹），存到本地，由后端静态伺服，即使原网站停止服务仍可在应用内离线查看。

已确认的两个决策：
- 在线渲染策略：**后端探测内嵌可用性 + overlay iframe 渲染 + 受限时「克隆为缓存页面 / 外部打开」兜底**。
- 克隆快照格式：**HTMLComplete 文件夹**（`index.html` + `snapshot_files/`），后端可注入主题桥、按相对路径静态服务。

## 二、现状分析（基于实际代码）

| 层 | 现状 | 关键文件 |
|---|---|---|
| 注册表 | 工具元数据存 `~/.cut-shelter/tools/registry.json`；每个工具 = 自包含 HTML（`<id>.html`）；内置工具 seed 自 classpath `resources/tools/` | `backend/.../service/ToolRegistryService.java` |
| REST API | `GET /api/tools`、`GET /api/tools/{id}/page`（读 HTML + 自动注入主题桥脚本）、`GET /api/tools/{id}/prompt`、`POST`（multipart 上传 html）、`DELETE`、`PATCH enabled`、`PUT /reorder`；另有 image-convert / csv-json 业务接口 | `backend/.../controller/ToolController.java` |
| 前端 | 卡片网格 + chips + 顶部「+ 导入工具」Modal（仅 HTML 文件上传）；点击卡片 → overlay iframe：`frame.src = /api/tools/{id}/page`；iframe `onload` 补发主题 | `frontend/tools.html`、`frontend/js/tools-core.js`、`frontend/styles/tools.css` |
| 主进程 | 前端静态服务器 `http://127.0.0.1:3001`（serve-static），`/api/*` 全部代理到后端 `8081`；preload 经 `contextBridge` 暴露 `electronAPI`（大量 `ipcRenderer.invoke`）；主窗口 `setWindowOpenHandler` 拦截外部链接 → `shell.openExternal` | `electron/main.js`（`startFrontendServer`）、`electron/preload.js` |
| 存储 | 工具目录硬编码 `~/.cut-shelter/tools`（基于 `user.home`），与 `clip.storage.path` 配置无关 | `ToolRegistryService.getToolsDir()` |

关键机制复用点：
- **主题桥注入**：`ToolRegistryService.injectThemeBridge()` 已成熟（`</body>` 前插脚本，监听 `themeChange` postMessage）——缓存页 `index.html` 走同一注入即可保持工具内主题跟随全局。
- **前端服务器代理**：新增后端接口一律走 `/api/` 前缀即自动被 Electron 代理，前端无需关心端口。
- **IPC 模式**：preload 暴露 `electronAPI.xxx = () => ipcRenderer.invoke('xxx', ...)`，新增能力照此扩展。

## 三、实现方式探索结论

### 3.1 在线「点击渲染」：iframe + 探测 + 克隆兜底

目标站普遍设置 `X-Frame-Options` / CSP `frame-ancestors` 拒绝内嵌，**纯 iframe 会被浏览器静默拦截**（无可靠 load/error 回调可判定）。因此：

1. **导入时探测**：后端 `GET` 目标 URL（跟随重定向，30s 超时），检查响应头：
   - `x-frame-options`（DENY / SAMEORIGIN）→ 不可内嵌；
   - CSP 头 `frame-ancestors` 含 `'none'` 或不含本来源（`http://127.0.0.1:*`、`file:` 调试模式）→ 不可内嵌；
   - 其它（或探测失败/超时）→ `embeddable=true`（保守放行，失败再兜底）。
   - 探测结果 `embeddable` 存进注册表，避免每次点开重复探测；菜单提供「重新检测内嵌状态」。
2. **渲染分支**（`openTool`）：
   - `cached=true` → 一律走**缓存页**（见 3.2），`iframe src = /api/tools/{id}/cache/index.html`，可靠且离线可用；
   - 否则 `embeddable` → overlay iframe 直连 `url`；
   - 否则 → iframe 区域渲染**兜底面板**：「目标网站禁止内嵌预览」，提供「💾 克隆为缓存页面（离线可看）」与「🌐 外部打开」两个按钮，overlay 头部同时常驻「🌐 外部打开」按钮。
3. 浏览器调试模式（无 Electron）：克隆按钮隐藏并提示需桌面端；iframe 直连照常可用。

### 3.2 克隆为缓存页面：Electron `savePage(HTMLComplete)`

`webContents.savePage(fullPath, 'HTMLComplete')` 是 Chromium 原生「另存网页」：生成 `index.html` + `snapshot_files/` 资源目录，**捕捉已 JS 渲染后的当前 DOM**，静态资源一并落地。

1. **触发**：前端导入 URL 工具后（勾选「克隆为缓存页面」，默认勾选）或菜单「重新克隆」→ 调 `electronAPI.cloneUrlPage({url, toolId})`。
2. **主进程执行**：
   - 创建隐藏 BrowserWindow（复用默认 session 以便继承已登录 Cookie；`show:false`、`webSecurity` 默认、`nodeIntegration:false`）；
   - `loadURL(url)` → 等待 `did-finish-load` + 可配 `settleMs`（默认 3000，让懒加载/图片稳定）；
   - `webContents.savePage(<cacheDir>/index.html, 'HTMLComplete')`；
   - 目录：`~/.cut-shelter/tools-cache/<toolId>/`（与后端 `getToolsDir` 同级，同样基于 `user.home`）；
   - 超时兜底 60s；失败返回 `{ok:false, error}`。
3. **落库**：克隆成功后前端 `PATCH /api/tools/{id}/cache {cached:true, cachedAt}`；失败置 `cached:false` 并 toast 原因。
4. **离线读取**：后端新增静态服务 `GET /api/tools/{id}/cache/{path}`，从缓存目录读取：
   - `index.html` 复用 `injectThemeBridge()` 注入主题桥后返回（`text/html`）；
   - 其余资源按扩展名给 MIME 直接返回（图片/css/js/json 等）；
   - **路径穿越防护**：`normalize()` 后必须 `startsWith(cacheDir)`，含 `..` 一律 404。
5. **删除工具**：`DELETE /api/tools/{id}` 时后端删除注册项，前端再调 `electronAPI.removeToolCache(toolId)` 主进程递归清理缓存目录（同样做根目录越界防护）。
6. 已知边界：
   - 站点有严格 CSP `<meta>` 时主题桥内联脚本可能被拒，页面仍可用但主题不跟随（记录在案，后续可用 `webContents.insertCSS` 兜底）；
   - 需登录态的内容克隆到的是「登录后」渲染结果，属预期；
   - 克隆体积可设上限（默认 200MB），超出中止并提示。

## 四、Proposed Changes

### 4.1 后端 `backend/.../service/ToolRegistryService.java`

- **注册表 schema 扩展**：新增字段 `type`（`html` | `url`）、`url`、`embeddable`（Boolean，探测结果）、`cached`（Boolean）、`cachedAt`（String yyyy-MM-dd HH:mm:ss）。旧记录 `type` 缺省补 `html`。
- `importToolWithUrl(name, category, description, prompt, url, embeddable)`：id 同 `tool-<8位>`，不写 html 文件，登记 `type:"url"`、`url`。
- `getCacheDir()`：`~/.cut-shelter/tools-cache`；`getToolCacheEntry(id)`：返回 `<id>/index.html` 是否存在 + 路径。
- `resolveCachePath(id, relativePath)`：路径穿越防护（`normalize` + `startsWith`）。
- `updateToolCache(id, cached, cachedAt)`：更新元数据（用于克隆结果写回）。
- `updateToolEmbeddable(id, embeddable)`：重新探测结果写回。
- `deleteTool`：追加清空 `<toolId>/` 缓存目录（`FileUtils` 递归删除，仅限 `tools-cache` 根内）。
- `listTools` 对 `type` 缺省补 `html`。

### 4.2 后端 `backend/.../controller/ToolController.java`

- `POST /api/tools`：改为 `type` 参数分支——
  - `type=html`（默认）：维持现状 multipart `html`；
  - `type=url`：校验 `url` 为 `http(s)://`，参数带 `embeddable`（由导入前置探测给出），调用 `importToolWithUrl`。
- 新增 `GET /api/tools/{id}/probe`：探测 URL 内嵌可用性，返回 `{embeddable, status, finalUrl, title?}`（title 用于导入时自动填名），并写回注册表。
- 新增 `GET /api/tools/{id}/cache/{path}`：静态伺服缓存目录；`index.html` 注入主题桥；404 处理；MIME 映射（html/css/js/json/png/jpg/webp/gif/svg/woff2/ttf 等）。
- 新增 `PATCH /api/tools/{id}/cache`：body `{cached, cachedAt}`，写回注册表并返回更新后元数据。

### 4.3 Electron `electron/main.js`

- 新增常量/工具函数：`toolsCacheBase()` = `path.join(os.homedir(), '.cut-shelter', 'tools-cache')`（与后端一致）。
- 新增 IPC handler：
  - `tools:clone-url-page`（`{url, toolId, settleMs}`）：隐藏窗口加载 → `savePage` → 校验产物存在 → resolve `{ok:true, entry:'index.html'}` / `{ok:false, error}`；60s 超时；窗口 `destroy()` 兜底。复用默认 session（继承 Cookie）。
  - `tools:remove-tool-cache`（`{toolId}`）：递归删除 `<toolsCacheBase>/<toolId>`，先 `path.resolve` 校验在根内。
  - `tools:open-external`（`{url}`）：`shell.openExternal`（复用现有正则归一化逻辑）。
- 说明：`savePage` 需页面完成加载；对 `data:`/非法 URL 直接拒绝；主窗口 `webPreferences` 不新增开关（不做 webview）。

### 4.4 Electron `electron/preload.js`

- `electronAPI` 扩展：
  - `cloneUrlPage: (payload) => ipcRenderer.invoke('tools:clone-url-page', payload)`
  - `removeToolCache: (toolId) => ipcRenderer.invoke('tools:remove-tool-cache', {toolId})`
  - `openExternal: (url) => ipcRenderer.invoke('tools:open-external', {url})`

### 4.5 前端 `frontend/tools.html`

- 导入 Modal 增加**入口类型切换**（`html | url` 两个 tab/radio）：
  - `html`：现有表单（名称/分类/描述/提示词/HTML 文件）；
  - `url`：URL 输入（失焦自动补 `https://`）+「检测内嵌」状态提示 + 「克隆为缓存页面」勾选框（默认勾选，需桌面端）+ 名称/分类/描述/提示词（名称可被探测到的 `<title>` 自动填充）。
- overlay 头部 actions：URL 工具追加「🌐 外部打开」按钮。
- 兜底面板容器（`#liveBlockPanel`，含克隆/外部打开按钮）。

### 4.6 前端 `frontend/js/tools-core.js`

- **导入流程**：`type=url` 时：
  1. 调 `GET /api/tools/{id}/probe`（可复用 URL 先探测再 POST，或将探测并入导入）→ 得 `embeddable` 与 title；
  2. `POST /api/tools {type,url,name,..}`；
  3. 勾选克隆且桌面端 → toast「正在克隆缓存页面…」→ `await electronAPI.cloneUrlPage(...)` → `PATCH /api/tools/{id}/cache`；
  4. `loadTools()` 刷新。
- **卡片渲染**：URL 工具 badge 显示「🌐」，已缓存加「📥 已缓存 + cachedAt」。
- **卡片菜单**（URL 工具追加）：「📸 克隆/重新克隆缓存页面」（`confirmAction` 确认后走克隆流程）、「🌐 外部打开」、「🔄 重新检测内嵌状态」；删除时先 `removeToolCache`（失败仅 toast 提示，不阻塞）。
- **`openTool` 分支**：
  ```text
  if type === 'url':
      if cached → frame.src = /api/tools/{id}/cache/index.html   // 离线可靠渲染 + 主题桥
      elif embeddable !== false → frame.src = url                // 直连
      else → 隐藏 iframe，显示兜底面板（克隆 / 外部打开）
  else → 现有 /api/tools/{id}/page
  ```
- overlay 关闭时隐藏兜底面板、清空 iframe（沿用 `closeOverlay`）。
- `refreshOpenTool`/`forwardThemeToTool` 对缓存 URL 天然兼容（frame.use same src reload；主题桥由后端注入）。

### 4.7 前端 `frontend/styles/tools.css`

- URL 导入表单区、tab 切换样式；兜底面板（居中卡片、主/次按钮）；「已缓存」角标样式。补齐现有设计令牌变量。

## 五、Assumptions & Decisions

- **克隆仅针对 `type=url` 工具**：HTML 文件入口本身就是离线自包含，无需克隆。
- **离线可看的前提是本地后端运行**：快照由本地 `127.0.0.1` 后端静态伺服；「网站停止服务」不影响，断网也不影响（资源已本地化）。
- 探测结果存注册表减少重复请求；`embeddable` 未知时保守尝试直连。
- 主题桥注入对缓存页 `index.html` 复用现有函数；严格 CSP meta 站点主题跟随失效作为已知限制。
- 克隆默认勾选、用户可取消；克隆生命周期由前端编排（IPC 成功后 PATCH 落库）。
- 不做 WebContentsView / webview（按用户确认的简单方案）。

## 六、Verification

1. **后端单元**（`mvn test` / curl）：
   - `POST /api/tools` `type=url` 正常登记，无 html 文件；
   - `GET /api/tools/{id}/cache/index.html` 返回注入主题桥的 HTML；`..` 路径返回 404；缺省 MIME 正确；
   - 删除工具后 `tools-cache/<id>/` 被清空；
   - `PATCH /api/tools/{id}/cache` 写回成功。
2. **主进程 IPC**：`tools:clone-url-page` 对允许抓取的站点（如本地起一个静态站点 / 文档站）产物完整（含 `snapshot_files/`）；非法 URL 拒绝；60s 超时兜底生效。
3. **手动 E2E**：
   - 导入一个允许内嵌的网站 → 点卡片 iframe 直连渲染、主题跟随、缩放自适应；
   - 导入一个禁止内嵌的网站（如 Awwwards）→ 显示兜底面板 → 点「克隆」→ 变为「已缓存」→ 点卡片走缓存页渲染；
   - **断网模拟**：断开网络后点开已缓存工具仍可完整渲染（本地后端 + 本地快照）；
   - 重新克隆 → cachedAt 更新；删除 URL 工具 → 注册表与缓存目录均清除。
4. **回归**：HTML 文件导入/运行、拖拽排序、主题切换、后端就绪刷新（`refreshOpenTool` 重载缓存页不报错）。

## 七、实施顺序

1. 后端：schema 扩展 + url 导入 + probe + cache 静态伺服 + PATCH cache + delete 清缓存；
2. Electron：IPC（clone / remove-cache / open-external）+ 隐藏窗口 savePage；
3. preload 暴露 API；
4. 前端：导入 Modal 类型切换 + 卡片/菜单 + openTool 渲染分支 + 兜底面板 + CSS；
5. 主题桥注入缓存页 index.html（复用现有函数）；
6. 按第六节验证清单逐项验证。