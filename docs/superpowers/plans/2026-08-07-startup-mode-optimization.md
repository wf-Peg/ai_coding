# 启动模式优化与 Lite 版本移除实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消 Lite 版本维护，改为应用默认启动前端，后端通过编辑器按钮手动或异步启动，配置三种启动模式降低启动时间优化用户体验。

**Architecture:** 在 Electron 主进程配置中新增 `startupMode` 字段（`full` / `frontend-only` / `frontend-async-backend`），主进程启动时根据模式决定后端行为；前端编辑器状态栏增加后端状态指示与启动按钮；设置页面增加启动模式选择；后端启动/就绪/失败通过系统通知（复用 Electron Notification API）告知用户。

**Tech Stack:** Electron IPC, Electron Notification API, Spring Boot Health endpoint, serve-static

---

### Task 1: 配置层 — 新增启动模式字段

**Files:**
- Modify: `electron/main.js:142-164`
- Modify: `electron/preload.js`
- Verify: `electron/main.js:200-210` (loadConfig merge)

- [ ] **Step 1: 在 DEFAULT_CONFIG 中新增 `startupMode` 字段**

```js
// electron/main.js L142-164，在 DEFAULT_CONFIG 中追加
const DEFAULT_CONFIG = {
  // ... 现有字段保持不变 ...
  autoStart: false,
  // 新增：启动模式
  // 'full'                  = 完全启动（前后端同时启动，当前行为）
  // 'frontend-only'         = 只启动前端（默认），用户手动异步启动后端
  // 'frontend-async-backend' = 启动前端后异步启动后端，后端就绪后系统通知
  startupMode: 'frontend-only',
  // ... 其余字段 ...
};
```

- [ ] **Step 2: 在 preload.js 中新增后端控制的 IPC 通道**

```js
// electron/preload.js，在 // ===================== 后端启动状态 ===================== 区域追加

/**
 * 手动启动后端服务（由前端按钮触发）
 * @returns {Promise<{success: boolean, message: string}>}
 */
startBackend: () => ipcRenderer.invoke('start-backend'),

/**
 * 检查后端是否正在运行
 * @returns {Promise<boolean>}
 */
isBackendRunning: () => ipcRenderer.invoke('is-backend-running'),

/**
 * 获取当前启动模式
 * @returns {Promise<string>} 'full' | 'frontend-only' | 'frontend-async-backend'
 */
getStartupMode: () => ipcRenderer.invoke('get-startup-mode'),
```

- [ ] **Step 3: 验证**

运行: `node -c electron/main.js && node -c electron/preload.js`，确保无语法错误。

---

### Task 2: 主进程启动流程改造 — 按模式分路

**Files:**
- Modify: `electron/main.js:3026-3105`

- [ ] **Step 1: 重构 `app.whenReady()` 中的启动逻辑**

将 `// ===== 已配置完成：直接启动服务 =====` 区块改造为根据 `startupMode` 分路：

```js
// ===== 已配置完成：直接启动服务 =====
try {
  syncModelConfigJson(config);
  ensureContextMenuRegistered(config);

  // 始终启动前端
  await startFrontendServer(config);

  // 根据启动模式决定后端行为
  if (config.startupMode === 'full') {
    // 模式1: 完全启动 — 后端同步启动，阻塞窗口创建
    await startBackend(config);
    backendStarted = true;
    const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
      ? config.storagePath
      : path.join(config.storagePath, 'clip-storage');
    log.initExceptionLogger(clipStoragePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready');
    }
    startReminderScheduler();
  } else if (config.startupMode === 'frontend-async-backend') {
    // 模式2: 启动前端后异步启动后端，就绪后系统通知
    startBackend(config).then(() => {
      backendStarted = true;
      const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
        ? config.storagePath
        : path.join(config.storagePath, 'clip-storage');
      log.initExceptionLogger(clipStoragePath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-ready');
      }
      // 后端就绪后弹出系统通知
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-notification', {
          title: '后端服务已就绪',
          body: '所有功能现在可以使用，包括 AI 对话、剪藏、知识库等'
        });
      }
      startReminderScheduler();
    }).catch(e => {
      log.error('Backend async start failed:', e);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-error', e.message);
        mainWindow.webContents.send('show-notification', {
          title: '后端启动失败',
          body: '请检查配置后重试，或在编辑器状态栏点击启动按钮手动启动'
        });
      }
    });
  } else {
    // 模式3: frontend-only — 只启动前端，不启动后端
    log.info('Startup mode: frontend-only, backend will be started manually');
  }

  createMainWindow(config);
  // ... 其余代码不变 ...
} catch (e) {
  // ... 错误处理不变 ...
}
```

- [ ] **Step 2: 在 electron/main.js 中新增 IPC 处理函数**

在 `ipcMain.handle` 区域（约 L2500 附近）添加：

```js
/**
 * 手动启动后端（由 frontend-only 模式下的按钮触发）
 */
ipcMain.handle('start-backend', async () => {
  if (backendStarted) {
    return { success: true, message: '后端服务已在运行中' };
  }
  const config = loadConfig();
  try {
    await startBackend(config);
    backendStarted = true;
    const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
      ? config.storagePath
      : path.join(config.storagePath, 'clip-storage');
    log.initExceptionLogger(clipStoragePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready');
    }
    startReminderScheduler();
    return { success: true, message: '后端服务启动成功' };
  } catch (e) {
    log.error('Manual backend start failed:', e);
    return { success: false, message: e.message };
  }
});

/**
 * 检查后端是否在运行
 */
ipcMain.handle('is-backend-running', () => {
  return backendStarted;
});

/**
 * 获取当前启动模式
 */
ipcMain.handle('get-startup-mode', () => {
  const config = loadConfig();
  return config.startupMode || 'frontend-only';
});
```

- [ ] **Step 3: 在 preload.js 中新增系统通知监听通道**

```js
// preload.js，在 onBackendError 附近追加

/**
 * 监听系统通知事件（后端就绪/失败等）
 * @param {Function} callback - 接收 { title, body } 对象
 */
onShowNotification: (callback) => ipcRenderer.on('show-notification', (event, data) => callback(data)),
```

- [ ] **Step 4: 验证**

运行：`node -c electron/main.js && node -c electron/preload.js`，确保无语法错误。

---

### Task 3: 前端编辑器 — 后端状态指示与启动按钮

**Files:**
- Modify: `frontend/editor.html`
- Modify: `frontend/js/editor.js`
- Modify: `frontend/styles/editor.css`

- [ ] **Step 1: 在 editor.html 状态栏区域追加后端状态指示和启动按钮**

在 `editor.html` 的状态栏（`<footer class="editor-statusbar">` 内，约 L160-170）追加：

```html
<!-- 后端状态指示 + 启动按钮 -->
<span class="status-separator"></span>
<button class="status-btn" id="backendStatusBtn" title="后端服务状态">
  <span class="status-btn-icon backend-indicator" id="backendIndicator"></span>
  <span class="status-btn-label" id="backendStatusLabel">后端未启动</span>
</button>
<button class="status-btn" id="startBackendBtn" title="手动启动后端服务" style="display:none">
  <span class="status-btn-icon">▶</span>
  <span class="status-btn-label">启动后端</span>
</button>
```

- [ ] **Step 2: 在 editor.css 中新增后端状态样式**

在 `/* ── 编辑器状态栏 ──` 区域追加：

```css
/* ── 后端状态指示 ── */
.status-separator {
  width: 1px;
  height: 14px;
  background: var(--app-border);
  flex-shrink: 0;
}

.backend-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background 0.3s ease, box-shadow 0.3s ease;
}

.backend-indicator.stopped {
  background: var(--app-text-muted);
  box-shadow: none;
}

.backend-indicator.starting {
  background: #f59e0b;
  box-shadow: 0 0 4px rgba(245, 158, 11, 0.5);
  animation: backend-pulse 1.2s ease-in-out infinite;
}

.backend-indicator.ready {
  background: #10b981;
  box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
}

.backend-indicator.error {
  background: #ef4444;
  box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
}

@keyframes backend-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

- [ ] **Step 3: 在 editor.js 中实现后端状态管理逻辑**

在 `// 跨标签共享状态` 区域（约 L60）添加后端状态变量：

```js
// 后端服务状态
const BACKEND_STATE = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  READY: 'ready',
  ERROR: 'error'
};
let backendState = BACKEND_STATE.STOPPED;
let backendHealthTimer = null;
```

在 `// 对比按钮事件` 附近（约 L2610）添加后端状态初始化：

```js
// ===== 后端服务状态管理 =====
var backendStatusBtn = document.getElementById('backendStatusBtn');
var backendIndicator = document.getElementById('backendIndicator');
var backendStatusLabel = document.getElementById('backendStatusLabel');
var startBackendBtn = document.getElementById('startBackendBtn');

function setBackendState(state, label) {
  backendState = state;
  backendIndicator.className = 'status-btn-icon backend-indicator ' + state;
  backendStatusLabel.textContent = label || state;
  // 仅 frontend-only 模式下显示启动按钮
  if (state === BACKEND_STATE.STOPPED) {
    startBackendBtn.style.display = '';
    backendStatusBtn.title = '后端服务未启动，点击启动按钮启动';
  } else {
    startBackendBtn.style.display = 'none';
    backendStatusBtn.title = label || state;
  }
}

// 启动后端按钮点击事件
startBackendBtn.addEventListener('click', async function() {
  if (backendState === BACKEND_STATE.STARTING) return;
  setBackendState(BACKEND_STATE.STARTING, '后端启动中...');
  startBackendBtn.style.display = 'none';
  if (window.electronAPI && typeof window.electronAPI.startBackend === 'function') {
    var result = await window.electronAPI.startBackend();
    if (!result.success) {
      setBackendState(BACKEND_STATE.ERROR, '后端启动失败');
      showToast('后端启动失败: ' + result.message, true);
    }
  } else {
    showToast('非桌面环境，无法启动后端服务', true);
    setBackendState(BACKEND_STATE.STOPPED, '后端未启动');
  }
});

// 监听后端就绪事件
if (window.electronAPI && typeof window.electronAPI.onBackendReady === 'function') {
  window.electronAPI.onBackendReady(function() {
    setBackendState(BACKEND_STATE.READY, '后端已就绪');
    showToast('后端服务已就绪，所有功能可用');
  });
  window.electronAPI.onBackendError(function(msg) {
    setBackendState(BACKEND_STATE.ERROR, '后端异常');
    showToast('后端服务异常: ' + msg, true);
  });
  window.electronAPI.onBackendProgress(function(data) {
    if (data && data.message) {
      setBackendState(BACKEND_STATE.STARTING, data.message);
    }
  });
}

// 初始化后端状态：检查启动模式
(async function initBackendStatus() {
  if (window.electronAPI && typeof window.electronAPI.getStartupMode === 'function') {
    var mode = await window.electronAPI.getStartupMode();
    if (mode === 'full' || mode === 'frontend-async-backend') {
      // 这两种模式后端会自动启动，状态设为 starting
      setBackendState(BACKEND_STATE.STARTING, '后端启动中...');
    } else {
      // frontend-only 模式，检查是否已经运行
      if (typeof window.electronAPI.isBackendRunning === 'function') {
        var running = await window.electronAPI.isBackendRunning();
        if (running) {
          setBackendState(BACKEND_STATE.READY, '后端已就绪');
        } else {
          setBackendState(BACKEND_STATE.STOPPED, '后端未启动');
        }
      }
    }
  }
})();

// 前端健康检查兜底：每 30 秒检测一次后端的 /health 端点
function startBackendHealthCheck() {
  if (backendHealthTimer) clearInterval(backendHealthTimer);
  backendHealthTimer = setInterval(async function() {
    if (backendState === BACKEND_STATE.READY) return;
    try {
      var resp = await fetch('http://127.0.0.1:8081/health');
      if (resp.ok) {
        setBackendState(BACKEND_STATE.READY, '后端已就绪');
        if (window.electronAPI && typeof window.electronAPI.showToast !== 'function') {
          showToast('后端服务已就绪');
        }
      }
    } catch (_) {
      // 后端未就绪，保持当前状态
    }
  }, 30000);
}
startBackendHealthCheck();
```

- [ ] **Step 4: 验证**

运行：`node -c frontend/js/editor.js`，确保无语法错误。

---

### Task 4: 设置页面 — 启动模式配置

**Files:**
- Modify: `frontend/settings.html`
- Modify: `frontend/js/settings.js`

- [ ] **Step 1: 在 settings.html 的「启动行为」区域添加启动模式选择**

在 `frontend/settings.html` 的 `<!-- 启动行为 -->` section（约 L648-665）中，在开机自启下方追加：

```html
<div class="setting-row" style="border-bottom: none; margin-top: 12px;">
  <div class="setting-label">
    <div class="setting-title">启动模式</div>
    <div class="setting-desc">控制应用启动时后端服务的启动方式，修改后需重启应用生效</div>
  </div>
  <div class="setting-control">
    <select id="startupModeSelect" onchange="onStartupModeChange()" style="width: 100%;">
      <option value="frontend-only">只启动前端（默认，手动启动后端）</option>
      <option value="frontend-async-backend">启动前端后异步启动后端</option>
      <option value="full">完全启动（前后端同时启动）</option>
    </select>
  </div>
</div>
<div class="setting-hint" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; padding: 8px 12px; background: #f0f7ff; border-radius: 6px; border-left: 3px solid var(--primary);">
  <strong>模式说明：</strong><br>
  • <strong>只启动前端</strong> — 应用秒开，编辑器功能可用。在编辑器状态栏点击「启动后端」按钮手动启动后端服务，启动完成后系统通知。<br>
  • <strong>异步启动后端</strong> — 前端快速打开，后端在后台自动启动，启动完成后系统通知。<br>
  • <strong>完全启动</strong> — 等待前后端全部就绪后才显示窗口（原启动方式），启动较慢。
</div>
```

- [ ] **Step 2: 在 settings.js 中实现启动模式加载与保存逻辑**

在 `settings.js` 的 `onAutoStartChange` 函数附近添加：

```js
// 启动模式加载
function loadStartupMode() {
  if (window.electronAPI && typeof window.electronAPI.getStartupMode === 'function') {
    window.electronAPI.getStartupMode().then(function(mode) {
      document.getElementById('startupModeSelect').value = mode || 'frontend-only';
    });
  }
}

// 启动模式变更
function onStartupModeChange() {
  var mode = document.getElementById('startupModeSelect').value;
  if (window.electronAPI && typeof window.electronAPI.saveConfig === 'function') {
    window.electronAPI.saveConfig({ startupMode: mode }).then(function() {
      showToast('启动模式已保存，重启应用后生效');
    }).catch(function() {
      showToast('保存失败，请重试', true);
    });
  }
}

// 在初始化时调用
(function initStartupSettings() {
  loadStartupMode();
})();
```

- [ ] **Step 3: 在 preload.js 中新增 saveConfig IPC 通道**

```js
// preload.js，在 readClipboard 附近追加

/**
 * 保存配置项
 * @param {Object} partialConfig - 部分配置对象，会合并到现有配置中
 * @returns {Promise<{success: boolean}>}
 */
saveConfig: (partialConfig) => ipcRenderer.invoke('save-config', partialConfig),
```

- [ ] **Step 4: 在 electron/main.js 中新增 save-config IPC handler**

```js
// 在 ipcMain.handle 区域添加
ipcMain.handle('save-config', (event, partialConfig) => {
  const config = loadConfig();
  const merged = { ...config, ...partialConfig };
  saveConfig(merged);
  return { success: true };
});
```

- [ ] **Step 5: 验证**

运行：`node -c electron/main.js && node -c electron/preload.js && node -c frontend/js/settings.js`，确保无语法错误。

---

### Task 5: 系统通知实现 — 后端就绪/失败通知

**Files:**
- Modify: `electron/main.js:2552-2600`
- Modify: `frontend/js/editor.js`

- [ ] **Step 1: 在 electron/main.js 中新增 show-notification IPC 事件处理**

在 `ipcMain.handle` 区域追加：

```js
/**
 * 渲染进程请求显示系统通知
 */
ipcMain.on('show-notification', (event, { title, body }) => {
  showNotification(title, body);
});
```

同时在 `showNotification` 函数（约 L2552）中确保通知窗口的 `focusable` 设为 `false`，避免干扰用户当前操作（已设置）。

- [ ] **Step 2: 在 editor.js 中监听系统通知事件**

在 `// 监听后端就绪事件` 代码块（Task 3 Step 3 已添加）中补充：

```js
// 监听系统通知事件
if (window.electronAPI && typeof window.electronAPI.onShowNotification === 'function') {
  window.electronAPI.onShowNotification(function(data) {
    // 在前端也显示 toast 通知
    if (data && data.body) {
      showToast(data.body);
    }
  });
}
```

- [ ] **Step 3: 验证**

运行：`node -c electron/main.js && node -c frontend/js/editor.js`，确保无语法错误。

---

### Task 6: 移除 Lite 版本

**Files:**
- Delete: `lite/` 目录（整个目录）

- [ ] **Step 1: 删除 lite 目录**

```bash
rm -rf /workspace/lite/
```

- [ ] **Step 2: 确认删除完成**

运行：`ls /workspace/lite/`，预期输出 `ls: cannot access '/workspace/lite/': No such file or directory`

- [ ] **Step 3: 更新 commit_history.log**

```bash
echo "2026-08-07 10:20 | 移除 Lite 版本，改为启动模式配置" >> /workspace/commit_history.log
```

---

### Task 7: 提交并推送

**Files:**
- All modified files

- [ ] **Step 1: 暂存所有改动**

```bash
git add electron/main.js electron/preload.js frontend/editor.html frontend/js/editor.js frontend/styles/editor.css frontend/settings.html frontend/js/settings.js
```

- [ ] **Step 2: 提交代码**

```bash
git commit -m "feat: 启动模式优化 - 移除Lite版，新增三种启动模式(frontend-only/frontend-async-backend/full)，编辑器状态栏后端状态指示与启动按钮，设置页启动模式配置，系统通知"
```

- [ ] **Step 3: 推送到远程**

```bash
git push origin feature-simple-codex
```

---

## Self-Review

**1. 需求覆盖检查：**
- 取消 Lite 版本开发维护 → Task 6
- 默认启动前端 → Task 2 (startupMode 默认 `frontend-only`)
- 编辑器增加启动后端按钮 → Task 3
- 设置页面三种启动模式配置 → Task 4
- 异步后端启动系统通知 → Task 5 (Task 2 已包含后端就绪通知)
- 后端启动态前端识别 → Task 3 (30 秒健康检查兜底)
- 参考剪藏模块待办区通知 → Task 5 (复用 Electron Notification API)

**2. 占位符检查：** 无 TBD/TODO 占位符，所有代码段均为完整实现。

**3. 类型一致性检查：** `startupMode` 字段名在 Task 1-5 中保持一致，IPC 通道名 `start-backend` / `is-backend-running` / `get-startup-mode` / `save-config` / `show-notification` 在 preload.js 和 main.js 中成对匹配。