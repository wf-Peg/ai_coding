# 密码库修复 + 全局日志系统方案

## 一、问题分析

### 问题 1：点击创建密码库提示"初始化失败，请检查后端服务是否运行"

**根因**：`PasswordVaultController.init()`（[PasswordVaultController.java#L53-L62](file:///workspace/backend/src/main/java/com/example/clip/controller/PasswordVaultController.java#L53-L62)）没有 try-catch。当 `vaultService.init()` 抛出 `RuntimeException`（如密码库名称已存在、文件写入失败等），Spring Boot 默认返回 500 错误，响应体为 `{"timestamp":"...","status":500,"error":"Internal Server Error","path":"/api/vault/init"}`，不包含实际异常信息。前端 `doInit()` 的 `catch` 块（[vault.html#L787-L788](file:///workspace/frontend/vault.html#L787-L788)）捕获到异常后显示"初始化失败，请检查后端服务是否运行"。

**修复方向**：
1. Controller 各端点增加 try-catch 捕获 RuntimeException
2. Service 各方法增加详细的 `log.info`/`log.error` 日志
3. 前端 `doInit()` 在 `!res.ok` 时显示后端返回的实际错误信息

### 问题 2：密码库没有跟随全局主题

**根因**：`vault.html` 只引用了 `theme-notion.css`（[vault.html#L7](file:///workspace/frontend/vault.html#L7)），但 `theme-notion.css` 的深色主题规则（[theme-notion.css#L197-L246](file:///workspace/frontend/styles/theme-notion.css#L197-L246)）依赖 `html[data-theme="dark"]` 选择器，而 `vault.html` 从未设置 `<html>` 的 `data-theme` 属性。对比 `todo.html`（[todo.html#L1266](file:///workspace/frontend/todo.html#L1266)）和 `index.html`（[index.html#L394](file:///workspace/frontend/index.html#L394)），它们都有 `applyTheme()` 函数读取 `localStorage` 并设置 `data-theme`。

**修复方向**：在 `vault.html` 的 `init()` 中添加主题读取逻辑，从 `localStorage` 读取 `THEME_KEY`（值为 `'app_theme_v1'`，与 `index.html` 一致），并设置 `document.documentElement.setAttribute('data-theme', ...)`。同时添加 `storage` 事件监听以响应其他页面的主题切换。

### 问题 3：全局日志系统缺失

**现状**：
- 后端：有 `logback-spring.xml`（[logback-spring.xml](file:///workspace/backend/src/main/resources/logback-spring.xml)）写入 `C:\Users\{用户名}\AppData\Local\CutShelter\logs\`，但 vault 相关代码日志不足
- Electron：大量 `console.log/warn/error`（[main.js](file:///workspace/electron/main.js)），但无文件持久化。后端进程 stdout/stderr 已重定向到 `backend.log`（[main.js#L518-L519](file:///workspace/electron/main.js#L518-L519)），但 Electron 主进程自身的日志只输出到控制台
- 前端：仅有 `console.log/error`，无文件持久化

**修复方向**：
1. 后端：vault Controller/Service 所有关键方法增加 `log.info`/`log.error`
2. Electron：创建 `electron-logger.js` 模块，将 `console.log/warn/error` 重定向到 `{userData}/logs/electron.log`，按天滚动，保留 30 天
3. 前端：创建 `frontend-logger.js` 工具模块，通过 `window.electronAPI` IPC 将日志发送到 Electron 主进程写入文件；同时保留 `console.log` 输出

---

## 二、改动文件清单

| 文件 | 改动 |
|---|---|
| `backend/.../PasswordVaultController.java` | 所有端点增加 try-catch + 详细日志 |
| `backend/.../PasswordVaultService.java` | 所有关键方法增加 `log.info`/`log.error` |
| `frontend/vault.html` | 添加主题初始化逻辑；改进 `doInit()` 错误处理 |
| `electron/logger.js` | **新增**：Electron 日志模块，文件写入 + 控制台双输出 |
| `electron/main.js` | 引入 logger 模块，替换 `console.log` 为 logger |
| `electron/preload.js` | 新增 `logToFile` IPC 通道 |
| `frontend/js/logger.js` | **新增**：前端日志工具，通过 IPC 写入文件 |

---

## 三、详细改动

### 3.1 PasswordVaultController.java

**改动**：所有端点增加 try-catch，捕获 RuntimeException 返回 400 而非 500，增加详细日志。

```java
// init 端点示例
@PostMapping("/init")
public ResponseEntity<Map<String, Object>> init(@RequestBody Map<String, String> body) {
    String desKey = body.get("desKey");
    if (desKey == null || desKey.trim().isEmpty()) {
        log.warn("Init failed: DES Key is empty");
        return ResponseEntity.badRequest().body(Map.of("error", "DES Key 不能为空"));
    }
    String vaultName = body.getOrDefault("vaultName", "default");
    String label = body.getOrDefault("label", "主密码库");
    log.info("Init vault request: vaultName={}, label={}", vaultName, label);
    try {
        Map<String, Object> result = vaultService.init(desKey, vaultName, label);
        log.info("Init vault success: vaultName={}", vaultName);
        return ResponseEntity.ok(result);
    } catch (RuntimeException e) {
        log.error("Init vault failed: vaultName={}, error={}", vaultName, e.getMessage());
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
```

同样模式应用于：unlock、lock、listVaults、switchVault、deleteVault、checkKey、addEntry、updateEntry、deleteEntry、search、audit、importEntries、generatePassword。

### 3.2 PasswordVaultService.java

**改动**：关键方法增加日志。

- `init()`: 入口 `log.info`、文件创建时、异常时 `log.error`
- `unlock()`: 入口、Key 验证失败、解密成功、异常时
- `lock()`: 入口
- `switchVault()`: 入口
- `deleteVault()`: 入口、删除成功
- `checkKey()`: 验证结果
- `saveVault()`: 写入成功、异常时
- `addEntry()`/`updateEntry()`/`deleteEntry()`: 入口日志
- `loadVaultsRegistry()`: 加载成功包含 vault 列表
- `saveVaultsRegistry()`: 写入成功
- `migrateLegacyVault()`: 迁移开始/完成

### 3.3 vault.html — 主题跟随

**改动**：在 `<script>` 顶部添加主题初始化逻辑。

```javascript
// ====== 主题初始化 ======
const THEME_KEY = 'app_theme_v1';
const APPEARANCE_KEY = 'app_appearance_v1';

function getEffectiveTheme() {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  if (appearance === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
  }
  return appearance;
}

function applyTheme() {
  const theme = getEffectiveTheme();
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  if (appearance === 'system') applyTheme();
});

// 监听其他页面的主题切换
window.addEventListener('storage', event => {
  if (event.key === THEME_KEY || event.key === APPEARANCE_KEY) applyTheme();
});

applyTheme();
```

**改动**：`doInit()` 改进错误处理。

```javascript
async function doInit() {
  // ... 参数校验 ...
  try {
    const res = await fetch(API + '/init', { /* ... */ });
    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || '初始化失败');
      return;
    }
    // ... 成功逻辑 ...
  } catch (e) {
    showToast('无法连接后端服务，请确认应用已启动');
  }
}
```

### 3.4 electron/logger.js（新增）

**位置**：`/workspace/electron/logger.js`

**功能**：
- 封装 `log.info()`, `log.warn()`, `log.error()` 方法
- 同时输出到控制台和文件
- 日志文件路径：`{userData}/logs/electron.log`
- 按天滚动：每天生成新文件 `electron.{yyyy-MM-dd}.log`
- 保留 30 天
- 日志格式：`2026-07-03 10:30:00.123 [INFO] message`

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), 'AppData', 'Local', 'CutShelter', 'logs');
const MAX_DAYS = 30;

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `electron.${y}-${m}-${d}.log`;
}

function formatLog(level, ...args) {
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').substring(0, 23);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  return `${ts} [${level}] ${msg}\n`;
}

function writeLog(level, ...args) {
  const line = formatLog(level, ...args);
  // 控制台输出
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(...args);
  // 文件写入
  try {
    fs.appendFileSync(path.join(LOG_DIR, getLogFileName()), line, 'utf-8');
  } catch (e) {
    console.error('Failed to write log file:', e.message);
  }
}

function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (f.startsWith('electron.') && f.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, f);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) { /* ignore */ }
}

module.exports = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  cleanupOldLogs,
  LOG_DIR
};
```

### 3.5 electron/main.js

**改动**：
1. 顶部引入 logger：`const log = require('./logger');`
2. 启动时调用 `log.cleanupOldLogs()`
3. 将关键 `console.log/warn/error` 替换为 `log.info/warn/error`
4. 新增 IPC handle `log-to-file` 接收前端日志

```javascript
const log = require('./logger');

// 启动时清理旧日志
log.cleanupOldLogs();

// 在 app.whenReady() 中替换所有 console.log 为 log.info/warn/error

// 新增 IPC 通道
ipcMain.handle('log-to-file', async (event, payload) => {
  const { level, message } = payload;
  if (level === 'error') log.error('[Frontend]', message);
  else if (level === 'warn') log.warn('[Frontend]', message);
  else log.info('[Frontend]', message);
});
```

### 3.6 electron/preload.js

**改动**：新增 `logToFile` IPC 通道。

```javascript
logToFile: (level, message) => ipcRenderer.invoke('log-to-file', { level, message }),
```

### 3.7 frontend/js/logger.js（新增）

**位置**：`/workspace/frontend/js/logger.js`

```javascript
/**
 * 前端日志工具
 * 同时输出到浏览器控制台和 Electron 主进程日志文件（通过 IPC）
 */
const FrontendLogger = {
  _log(level, ...args) {
    const message = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).join(' ');

    // 控制台输出
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(...args);

    // 通过 IPC 写入文件
    if (window.electronAPI && window.electronAPI.logToFile) {
      window.electronAPI.logToFile(level, message).catch(() => {});
    }
  },

  info(...args) { this._log('info', ...args); },
  warn(...args) { this._log('warn', ...args); },
  error(...args) { this._log('error', ...args); }
};

// 全局异常捕获
window.addEventListener('error', (event) => {
  FrontendLogger.error('Uncaught error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  FrontendLogger.error('Unhandled rejection:', event.reason);
});
```

### 3.8 vault.html 引用

在 `vault.html` 的 `<script>` 标签前引入：

```html
<script src="js/logger.js"></script>
```

---

## 四、日志目录结构

```
C:\Users\{用户名}\AppData\Local\CutShelter\logs\
├── application.log          ← 后端 Spring Boot 日志（已有）
├── application.2026-07-03.log
├── error.log                ← 后端错误日志（已有）
├── error.2026-07-03.log
├── electron.log             ← 新增：Electron 主进程日志（当天）
├── electron.2026-07-02.log  ← 新增：历史日志
└── backend.log              ← 后端 stdout/stderr（已有）
```

---

## 五、验证步骤

1. **密码库初始化**：故意输入已存在的 vaultName → 应显示"密码库名称「xxx」已存在"而非"请检查后端服务"
2. **主题跟随**：在主页面切换深色主题 → 打开 vault.html → 应显示深色主题
3. **日志文件**：
   - 启动应用 → `electron.log` 有启动日志
   - 操作密码库 → `application.log` 有 vault 相关日志
   - 前端操作 → `electron.log` 有 `[Frontend]` 前缀日志
   - 历史日志自动清理（30 天前自动删除）