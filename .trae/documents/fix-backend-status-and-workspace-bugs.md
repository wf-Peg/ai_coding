# 修复后端状态同步 / 工作台产品开发页 / 健康检查与异常日志 Bug 方案

> **For agentic workers:** 请按任务逐步实施，每完成一个任务勾选复选框（`- [ ]`）。

**目标：** 修复三个关联问题：
1. 标题栏"后端已就绪"与编辑器底部"后端启动态"不同步 → 删除编辑器底部重复指示器，改为后端就绪后**自动刷新各子页面数据**（不再需要手动刷新）。
2. 工作台「产品开发」页面渲染位置异常 + 顶部 Tab（总览/需求看板/知识图谱/时间线/归档）点击无响应。
3. `GET http://127.0.0.1:8081/api/health net::ERR_FAILED 500`（后端日志 "No static resource api/health."）CORS/健康检查问题；前端异常未统一上报到观测模块「异常日志-前端」筛选。

---

## 一、现状分析（根因）

### 问题 1：后端状态指示器重复 + 数据不自动刷新
- 全局指示器：[index.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/index.html#L478-L482) 标题栏 `#backendGlobalIndicator`（含启动按钮），状态由 index.html 内联脚本统一管理。
- 底部重复指示器：[editor.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L179-L186) 状态栏 `#backendStatusBtn / #backendIndicator / #backendStatusLabel / #startBackendBtn`，由 [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4986-L5129) 独立维护一套状态机。两套状态互不同步（editor 是 iframe，启动时若后端事件已发完，则错过 `onBackendReady`，只能靠 15s 轮询兜底）。
- **不自动刷新根因**：各子页面（clip/todo/knowledge/workspace/wiki/vault 等）在 iframe 加载时拉取数据；在 `frontend-only` / `frontend-async-backend` 模式下后端尚未就绪 → 请求失败。index.html 的 `onBackendReady` 处理器只更新标题栏指示器，**没有向所有子 iframe 广播 refresh**，导致必须手动刷新。
- **额外问题**：editor.js 的 `startBackendHealthCheck()` 每 15s 用**绝对地址** `http://127.0.0.1:8081/api/health` 轮询（[editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5050-L5071)），后端只有 `/health` 没有 `/api/health` → 500 + CORS 报错。

### 问题 2：工作台产品开发页
- `.product-dev-view` 是 `.shell` 的**兄弟节点且位于其后**（[workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L640)）。`visible` 时 `display:block` 会在 `.shell`（含左侧栏"新建工作台"）**下方**渲染 → 必须滚动才能看到页面。
- `.pd-tab` 五个 Tab 按钮（[workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L656-L662)）**完全没有 JS 点击绑定**，`.pd-tab-content` 切换逻辑缺失（对比 `.detail-tab` 有绑定，[workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L1845-L1857)）。

### 问题 3：健康检查 500 / CORS + 前端异常未统一上报
- 后端 [HealthController.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/HealthController.java) 只有 `GET /health`，无 `/api/health`，且无 `@CrossOrigin` → 前端请求 `/api/health` 时 Spring 落到静态资源处理，返回 500 "No static resource api/health."，响应无 CORS 头 → 浏览器报 CORS 错。
- 前端异常上报：只有 [editor.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L471) 和 [vault.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/vault.html#L747) 引入了 `js/logger.js`（[logger.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/logger.js) 会把 error 级经 `/api/data/exception-logs` 上报到观测模块）。其余页面（clip/todo/knowledge/wiki/workspace/learning-plan/pdf/data-observability/settings）均未引入 → uncaught error / unhandled rejection 不会进入「异常日志-前端」。
- 具体报错的 `xhr.send()`（editor.js:5069）走 onerror 静默路径，也未被记录。

---

## 二、修改方案

### Task 1: 后端健康检查端点补全（`/api/health` + CORS）

**文件：** `backend/src/main/java/com/example/clip/controller/HealthController.java`

- [ ] **Step 1**: 类上新增 `@CrossOrigin(origins = "*")`。
- [ ] **Step 2**: 新增 `@GetMapping("/api/health")` 方法，复用与 `/health` 相同的返回体（`{status: UP, timestamp}`）。建议抽取私有方法 `buildHealth()` 供两个端点复用。

> 说明：`/api/health` 同时满足「前端代理路径」和「绝对地址直连」两种访问方式；修复后即使有页面仍直连 `:8081/api/health` 也不再 500 / 无 CORS 头。

---

### Task 2: 删除编辑器底部后端状态指示器（重复 UI）

**文件：** `frontend/editor.html`、`frontend/js/editor.js`

- [ ] **Step 1**: [editor.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L178-L186) 删除状态栏中：
  - `<span class="status-separator"></span>`（若仅服务后端指示器）
  - `#backendStatusBtn`（含 `#backendIndicator`、`#backendStatusLabel`）
  - `#startBackendBtn`
- [ ] **Step 2**: [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4986-L5129) 删除整段「后端服务状态管理」代码：
  - `BACKEND_STATE` 常量、`backendState` 变量、`backendIndicator/backendStatusLabel/startBackendBtn` DOM 引用
  - `setBackendState()`、`handleStartBackend()`、`startBackendHealthCheck()`、`initBackendStatus()`、`setTimeout(initBackendStatus, 1000)`
  - 保留下方「系统右键菜单事件处理」注释块。
- [ ] **Step 3**: 确认删除后 `showToast`（定义于 [editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L2706)）仍被自动保存等其它逻辑正常使用，无残留引用报错。

> 效果：健康轮询移除后，editor.js:5069 的 CORS/500 报错从源头消失；后端启动/状态统一由标题栏全局指示器负责。

---

### Task 3: 后端就绪后自动刷新前端数据（index.html）

**文件：** `frontend/index.html`

- [ ] **Step 1**: 新增共享函数（放在全局后端状态管理区）：

```javascript
// 最近一次后端就绪刷新的时间戳（去重：多个 onBackendReady 回调只触发一次刷新）
var lastBackendRefreshAt = 0;
function handleBackendReady() {
  backendReadyFlag = true;
  setGlobalBackendState(BACKEND_STATE.READY, '后端已就绪');
  showGlobalNotification('后端服务已就绪，所有功能可用', 'success');
  // 去重保护：5 秒内只广播一次
  var now = Date.now();
  if (now - lastBackendRefreshAt < 5000) return;
  lastBackendRefreshAt = now;
  refreshAllSubPages();
}
function refreshAllSubPages() {
  // 注意：不刷新 editorFrame（避免打断用户正在编辑的内容）
  [workspaceFrame, todoFrame, clipFrame, knowledgeFrame, wikiFrame, vaultFrame, learningPlanFrame, pdfFrame, dataObservabilityFrame, settingsFrame].forEach(function(frame) {
    try { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ action: 'refresh' }, '*'); } catch (e) {}
  });
}
```

- [ ] **Step 2**: 将三处 `onBackendReady` 回调统一改为调用 `handleBackendReady()`：
  - full 模式回调（原 L1101-1105）：保留 `dismissStartupOverlay()` 后再调 `handleBackendReady()`；
  - frontend-async-backend 模式回调（原 L1124-1128）：直接替换为 `handleBackendReady()`；
  - 统一监听回调（原 L1163-1169）：替换为 `handleBackendReady()`。
- [ ] **Step 3**: `isBackendRunning()` 返回 true 的分支（原 L1141-1149）：`backendReadyFlag = true` 处改为调用 `handleBackendReady()`。
- [ ] **Step 4**: 处理时序竞态——若子页面 iframe 在 `backend-ready` 事件之后才加载完，补发刷新。为除 `editorFrame` 外的各子 frame 添加 `load` 监听：

```javascript
[workspaceFrame, todoFrame, clipFrame, knowledgeFrame, wikiFrame, vaultFrame, learningPlanFrame, pdfFrame, dataObservabilityFrame, settingsFrame].forEach(function(frame) {
  if (!frame) return;
  frame.addEventListener('load', function() {
    try { if (backendReadyFlag && frame.contentWindow) frame.contentWindow.postMessage({ action: 'refresh' }, '*'); } catch (e) {}
  });
});
```

> 覆盖场景：`full` 模式（窗口加载晚于后端就绪）、`frontend-async-backend` 模式（后端后启动完成时广播）、`frontend-only` 模式手动点击「启动后端」成功后广播。

---

### Task 4: 子页面支持 refresh 消息 + 引入前端异常上报

**目标：** 所有子页面都能响应 `{action:'refresh'}`；所有子页面引入 `js/logger.js` 以统一上报前端异常到观测模块。

**Step 1：引入 `js/logger.js`（在对应页面的 `<script>` 区域追加一行）**

- [ ] `frontend/clip.html`（现有脚本区：`libs/axios.min.js` 之后）
- [ ] `frontend/todo.html`
- [ ] `frontend/knowledge.html`（`<script src="knowledge.js">` 之前）
- [ ] `frontend/wiki.html`（`libs/marked.min.js` 之后）
- [ ] `frontend/workspace.html`（底部内联 `<script>` 之前）
- [ ] `frontend/learning-plan.html`
- [ ] `frontend/pdf.html`
- [ ] `frontend/data-observability.html`（`js/data-observability.js` 之前）
- [ ] `frontend/settings.html`（`js/settings.js` 之前）

**Step 2：补 refresh 消息监听（已支持 refresh 的页面保持不变）**

- [ ] `knowledge.html`：新增 `window.addEventListener('message', ...)`，`e.data.action === 'refresh'` 时 `location.reload()`。
- [ ] `wiki.html`：新增同样监听（refresh → `location.reload()`）。
- [ ] `pdf.html`：在现有 `message` 监听（[pdf.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/pdf.html#L507-L511)）中追加 `refresh` 分支 → `location.reload()`。
- [ ] `data-observability.html`：新增监听（refresh → `location.reload()`）。
- [ ] `settings.html`：新增监听（refresh → `location.reload()`）。
- [ ] `workspace.html`：扩展现有监听（[workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L2135-L2138)）为：`refresh` → `loadOverview(); loadWorkspaces();` 且若 `productDevView` 处于可见状态则额外调用 `loadProductDev()`。
- [ ] `learning-plan.html`：保持 `loadPlans()` 即可（已支持）。

> 说明：`todo.html / vault.html / clip.html` 现有 refresh 实现为 `location.reload()`，保持不变即可。

---

### Task 5: 修复工作台产品开发页布局 + Tab 无响应

**文件：** `frontend/workspace.html`

- [ ] **Step 1**: 修复渲染位置——`.product-dev-view` 改为全屏覆盖（[workspace.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L242-L243)）：

```css
.product-dev-view {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 60;            /* 覆盖 .shell 及其侧边栏 */
  background: var(--ws-bg);
  overflow-y: auto;       /* 页面内容自身滚动 */
}
.product-dev-view.visible { display: block; }
```

> 效果：点击「产品开发」后整页替换 .shell（不再出现"左侧新建工作台在上、页面在下需滚动"的错位）。

- [ ] **Step 2**: 新增 `.pd-tab` 点击切换逻辑（放在「需求看板搜索」或产品开发工作区 JS 区块内，参照 `.detail-tab` 写法）：

```javascript
/* ── 产品开发 Tab 切换 ── */
document.querySelectorAll('.pd-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.pd-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.pd-tab-content').forEach(function(c) { c.classList.remove('visible'); });
    tab.classList.add('active');
    var content = document.querySelector('.pd-tab-content[data-pd-content="' + tab.dataset.pdTab + '"]');
    if (content) content.classList.add('visible');
  });
});
```

---

## 三、假设与决策

| 决策点 | 结论 |
|--------|------|
| 编辑器底部后端指示器 | 直接删除，保留标题栏全局指示器（用户明确要求） |
| 数据自动刷新方式 | 复用现有 `{action:'refresh'}` postMessage 机制 + 帧 load 竞态补发；不刷新 editorFrame |
| refresh 去重 | `handleBackendReady` 内 5 秒时间窗去重，避免多路 `onBackendReady` 重复刷新 |
| 未支持 refresh 的页面 | 统一用 `location.reload()`，简单可靠 |
| 健康检查 | 删除 editor.js 轮询（随指示器一起移除），后端补 `/api/health` + CORS 兜底 |
| 异常上报 | 所有子页面引入 logger.js，利用其全局 error/unhandledrejection 上报；不改造各页面的 fetch 失败分支（保持改动最小） |

## 四、验证步骤

1. **后端编译**：`cd backend && mvn compile` 通过。
2. **健康检查**：后端启动后访问 `http://127.0.0.1:8081/api/health` 返回 200 `{status:"UP"}`；`/health` 仍正常。
3. **状态指示器**：启动应用（`frontend-only` 或 `frontend-async-backend` 模式）：
   - 标题栏左上角显示"后端未启动"→ 点击「启动后端」→ 显示"后端已就绪"；
   - 编辑器状态栏不再出现「后端启动态 / 启动后端」按钮；
   - 开发者工具 Network 中不再出现 `api/health` 500 / CORS 报错。
4. **自动刷新**：`frontend-async-backend` 模式下，后端就绪后**无需手动刷新**：剪藏列表、待办、知识、工作台等页面数据自动加载/刷新（观察 Network 出现新请求，页面出现数据）。
5. **产品开发页**：工作台 → 点击「产品开发」：
   - 页面整屏显示（左侧"新建工作台"侧边栏被覆盖，无需滚动）；
   - 依次点击 总览 / 需求看板 / 知识图谱 / 时间线 / 归档，各 Tab 内容正确切换并加载对应数据。
6. **异常日志**：在任意子页面制造一个未捕获异常（或打开观测 → 异常日志 → 来源筛选「前端」），确认存在 source=frontend 的记录；确认 `ExceptionLogService` 目录下新增对应 jsonl 记录。
