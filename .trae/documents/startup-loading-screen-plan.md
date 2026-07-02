# 桌面应用启动优化：先显示窗口 + 加载遮罩

## 1. 当前状态分析

### 现有启动流程（`electron/main.js` L1476-1490）

```
app.whenReady()
  → startFrontendServer(config)     // 快（~1s）
  → startBackend(config)            // 慢（轮询端口，最多 120s）
  → await 3 秒额外等待
  → createMainWindow(config)        // 才创建窗口
```

**问题**：窗口在 `startBackend` 完成后才创建，用户看到空白桌面/任务栏 10-30 秒，体验很差。

### 相关文件

| 文件 | 角色 |
|------|------|
| [electron/main.js](file:///workspace/electron/main.js#L1476-L1490) | 主进程启动逻辑 |
| [electron/main.js](file:///workspace/electron/main.js#L460-L549) | `startBackend()` 函数，轮询检测端口 |
| [electron/main.js](file:///workspace/electron/main.js#L690-L756) | `startFrontendServer()` 函数 |
| [electron/main.js](file:///workspace/electron/main.js#L879-L1010) | `createMainWindow()` 函数 |
| [electron/main.js](file:///workspace/electron/main.js#L1074-L1289) | `setupIPC()` IPC 注册 |
| [electron/preload.js](file:///workspace/electron/preload.js#L100-L116) | `onStartupProgress` / `onStartupError` 已有 |
| [frontend/index.html](file:///workspace/frontend/index.html) | 主窗口 SPA 页面 |
| [electron/config.html](file:///workspace/electron/config.html#L126-L140) | 已有 startup-overlay 样式（可复用） |

### 已有基础设施

- `preload.js` 已暴露 `onStartupProgress`（L107）和 `onStartupError`（L115）
- `config.html` 已有 `startup-overlay` 的 CSS 和 JS 函数（`showStartupOverlay`/`hideStartupOverlay`）
- `createMainWindow` 已有 `loadWithRetry` 重试机制（L898-908）

---

## 2. 方案设计

### 核心思路：先显示窗口，后端异步启动

```
app.whenReady()
  → startFrontendServer(config)          // 并行启动
  → startBackend(config)                 // 并行启动（不 await）
  → createMainWindow(config)             // 立即创建窗口
  → 前端 index.html 加载 → 显示遮罩 "应用启动中..."
  → 后端就绪 → IPC 事件 → 隐藏遮罩
```

### 2.1 主进程改造 (`electron/main.js`)

**改动点 1：启动流程改为并行**

```diff
  // 已配置完成：直接启动服务
  try {
    await startFrontendServer(config);
-   await startBackend(config);
-   await new Promise(resolve => setTimeout(resolve, 3000));
+   // 后端异步启动，不阻塞窗口创建
+   startBackend(config).then(() => {
+     console.log('Backend ready, notifying renderer');
+     if (mainWindow && !mainWindow.isDestroyed()) {
+       mainWindow.webContents.send('backend-ready');
+     }
+   }).catch(e => {
+     console.error('Backend start failed:', e);
+     if (mainWindow && !mainWindow.isDestroyed()) {
+       mainWindow.webContents.send('backend-error', e.message);
+     }
+   });

    createMainWindow(config);
```

**改动点 2：`startBackend` 增加进度推送**

在 `startBackend` 函数中，轮询期间通过 `mainWindow` 向渲染进程发送进度：

```javascript
// 在 pollInterval 中
if (mainWindow && !mainWindow.isDestroyed()) {
  mainWindow.webContents.send('backend-progress', {
    message: '正在启动后端服务...',
    elapsed: elapsedSeconds
  });
}
```

### 2.2 Preload 改造 (`electron/preload.js`)

新增两个 IPC 监听器：

```javascript
// 监听后端就绪事件
onBackendReady: (callback) => ipcRenderer.on('backend-ready', () => callback()),

// 监听后端启动失败
onBackendError: (callback) => ipcRenderer.on('backend-error', (event, msg) => callback(msg)),

// 监听后端启动进度
onBackendProgress: (callback) => ipcRenderer.on('backend-progress', (event, data) => callback(data)),
```

### 2.3 前端遮罩层 (`frontend/index.html`)

**新增 CSS：加载遮罩**

```css
.startup-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.4s ease;
}
.startup-overlay.hidden {
  opacity: 0; pointer-events: none;
}
.startup-logo {
  width: 60px; height: 60px;
  margin-bottom: 20px;
}
.startup-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border-light);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.startup-text {
  font-size: 14px; color: var(--text-secondary);
}
.startup-subtext {
  font-size: 12px; color: var(--fg-muted);
  margin-top: 6px;
}
```

**新增 HTML：遮罩层**

```html
<div class="startup-overlay" id="startupOverlay">
  <div class="startup-spinner"></div>
  <div class="startup-text">应用启动中，请稍等...</div>
  <div class="startup-subtext" id="startupSubtext">正在启动后端服务</div>
</div>
```

**新增 JS：遮罩控制逻辑**

```javascript
// 仅 Electron 环境下显示遮罩
if (window.electronAPI) {
  const overlay = document.getElementById('startupOverlay');
  const subtext = document.getElementById('startupSubtext');

  // 监听后端启动进度
  window.electronAPI.onBackendProgress((data) => {
    subtext.textContent = data.message;
  });

  // 后端就绪 → 隐藏遮罩
  window.electronAPI.onBackendReady(() => {
    subtext.textContent = '启动完成';
    setTimeout(() => overlay.classList.add('hidden'), 600);
  });

  // 后端启动失败 → 显示错误 + 重试按钮
  window.electronAPI.onBackendError((msg) => {
    subtext.innerHTML = `启动失败: ${msg} <br><button onclick="location.reload()">重试</button>`;
    document.querySelector('.startup-spinner').style.display = 'none';
  });
}
```

---

## 3. 其他优化建议

### 3.1 高优先级（建议同步实施）

| 优化点 | 说明 | 改动 |
|--------|------|------|
| 移除 3 秒额外等待 | `await new Promise(resolve => setTimeout(resolve, 3000))` 在 L1483 是多余等待，端口轮询已足够 | 删除该行 |
| 并行启动前后端 | 当前 `await startFrontendServer` 后才 `await startBackend`，改为并行 | 见 2.1 |
| 健康检查端点 | 当前用 `/api/clip/list` 检测端口，应该用专用的轻量端点避免数据库查询 | 在 `backend` 加一个 `GET /api/health` 返回 `{status: "UP"}` |

### 3.2 中优先级（后续优化）

| 优化点 | 说明 | 改动 |
|--------|------|------|
| 后端 JVM 参数优化 | 加 `-Xms64m -Xmx256m -XX:+UseG1GC` 减少内存占用和启动时间 | `main.js` 中 `spawn` 参数 |
| 前端 iframe 懒加载 | `index.html` 中 `todo.html` 和 `clip.html` iframe 在启动时同时加载，可改为后端就绪后再加载 | `index.html` JS |
| Spring Boot 懒加载 | `application.yml` 添加 `spring.main.lazy-initialization: true` 加快启动 | backend 配置 |
| 本地缓存版本信息 | 避免每次启动都请求 GitHub API | `update-manager.js` |

### 3.3 低优先级（可选）

| 优化点 | 说明 |
|--------|------|
| 托盘图标预创建 | 在 `app.whenReady()` 立即创建托盘，而非等 `createMainWindow` |
| 后台静默启动 | 支持开机自启到系统托盘，用户点击才显示窗口 |

---

## 4. 改动的文件清单

| 文件 | 改动内容 |
|------|----------|
| `electron/main.js` | 启动流程改为并行 + 移除 3s 等待 + 后端就绪后 IPC 通知 |
| `electron/preload.js` | 新增 `onBackendReady`、`onBackendError`、`onBackendProgress` |
| `frontend/index.html` | 新增 loading overlay CSS + HTML + JS 逻辑 |

---

## 5. 验证步骤

1. 启动应用 → 窗口应立即出现，显示 loading 遮罩和 spinner
2. 遮罩显示 "应用启动中，请稍等..." + "正在启动后端服务"
3. 后端启动完成后 → 遮罩消失，正常显示主界面
4. 如果后端启动失败 → 遮罩显示错误信息 + 重试按钮
5. 浏览器环境下不显示遮罩（`window.electronAPI` 不存在时跳过）