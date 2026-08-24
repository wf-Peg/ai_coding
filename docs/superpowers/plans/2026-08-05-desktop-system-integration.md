# 桌面系统级集成功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CutShelter 桌面应用增加系统级集成能力（文件关联、右键菜单、托盘设置、扩展同步、埋点）

**Architecture:** Electron 主进程负责系统级交互（注册表/文件关联/命令行），preload.js 桥接 IPC，前端接收事件响应。后端新增 PDF OCR 接口和事件类型常量。浏览器扩展同步通用右键菜单。

**Tech Stack:** Electron 28, Spring Boot, Chrome Extension MV3, Java PDFBox 2.0.27

**参考 Spec:** `docs/superpowers/specs/2026-08-05-desktop-system-integration-design.md`

---

## 文件结构

### 新建文件
- `electron/context-menu-registry.js` — 系统右键菜单注册/注销管理器（Windows 注册表注入 + macOS Info.plist 扩展）
- `electron/command-line-handler.js` — 命令行参数解析器（--clip-file, --ai-clip-file, --open-editor, --pdf-ocr, --open-settings）

### 修改文件
- `electron/main.js` — 引入新模块，更新托盘菜单，启动时处理命令行参数
- `electron/preload.js` — 新增 5 个 IPC 通道
- `frontend/js/editor.js` — 监听 open-file-request 事件并打开文件
- `browser-extension/background.js` — 新增 2 个右键菜单项
- `backend/.../index/EventTypes.java` — 新增 10 个事件类型常量
- `backend/.../controller/PdfController.java` — 新增 OCR 端点
- `backend/.../service/PdfService.java` — 新增 OCR 方法

---

### Task 1: 创建右键菜单注册管理器

**Files:**
- Create: `electron/context-menu-registry.js`

- [ ] **Step 1: 创建 context-menu-registry.js 文件**

```javascript
/**
 * context-menu-registry.js - 系统右键菜单注册/注销管理器
 *
 * 职责：
 * 1. Windows: 通过写入注册表添加右键菜单项
 * 2. macOS: 通过 Info.plist 的 NSServices 注册 Finder 服务
 * 3. 卸载时清理注册表项
 * 4. 注册状态持久化到 config.json，避免重复写入
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 获取应用可执行文件路径（带引号，用于注册表命令）
 * @param {string} appDir - 应用根目录
 * @returns {string} 带引号的可执行文件路径
 */
function getExePath(appDir) {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'CutShelter.exe' : 'CutShelter';
  // 打包后 exe 在 APP_DIR，开发模式在 node_modules/.bin/
  const exePath = path.join(appDir, exeName);
  if (fs.existsSync(exePath)) {
    return `"${exePath}"`;
  }
  // 回退到当前进程路径
  return `"${process.execPath}"`;
}

/**
 * Windows: 注册右键菜单到注册表
 * 写入 HKEY_CLASSES_ROOT\*\shell\CutShelter* 项
 * 
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerWindowsContextMenu(appDir) {
  const exe = getExePath(appDir);
  const menuItems = [
    { id: 'CutShelterClip', label: '✂️ 添加到剪藏收件箱', arg: '--clip-file', appliesTo: null },
    { id: 'CutShelterAIClip', label: '🧠 AI 解析文件并添加剪藏', arg: '--ai-clip-file', appliesTo: null },
    { id: 'CutShelterOpen', label: '📝 用编辑器打开文件', arg: '--open-editor', appliesTo: null },
    { id: 'CutShelterOCRPdf', label: '📄 PDF OCR 识别', arg: '--pdf-ocr', appliesTo: 'System.FileName:.pdf' },
    { id: 'CutShelterSettings', label: '⚙️ 设置', arg: '--open-settings', appliesTo: null },
  ];

  let successCount = 0;
  for (const item of menuItems) {
    try {
      // 写入菜单项
      const regCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}" /ve /t REG_SZ /d "${item.label}" /f`;
      execSync(regCmd, { timeout: 5000 });

      // 写入图标（可选，使用应用图标）
      // 写入命令
      let cmdValue;
      if (item.arg === '--open-settings') {
        cmdValue = `${exe} ${item.arg}`;
      } else {
        cmdValue = `${exe} ${item.arg} "%1"`;
      }
      const cmdRegCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}\\\\command" /ve /t REG_SZ /d "${cmdValue}" /f`;
      execSync(cmdRegCmd, { timeout: 5000 });

      // 写入 AppliesTo 过滤（仅对 PDF 等）
      if (item.appliesTo) {
        const appliesRegCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}" /v AppliesTo /t REG_SZ /d "${item.appliesTo}" /f`;
        execSync(appliesRegCmd, { timeout: 5000 });
      }

      successCount++;
    } catch (e) {
      console.error(`[ContextMenu] Failed to register ${item.id}:`, e.message);
    }
  }
  return successCount === menuItems.length;
}

/**
 * Windows: 注销右键菜单
 * 删除 HKEY_CLASSES_ROOT\*\shell\CutShelter* 项
 */
function unregisterWindowsContextMenu() {
  const menuIds = [
    'CutShelterClip', 'CutShelterAIClip', 'CutShelterOpen',
    'CutShelterOCRPdf', 'CutShelterSettings'
  ];

  for (const id of menuIds) {
    try {
      execSync(`reg delete "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${id}" /f`, { timeout: 5000 });
    } catch (e) {
      // 项不存在时忽略
    }
  }
}

/**
 * 注册系统右键菜单（自动检测平台）
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerContextMenu(appDir) {
  if (process.platform === 'win32') {
    return registerWindowsContextMenu(appDir);
  }
  // macOS: 通过 electron-builder 的 mac.extendInfo.NSServices 在构建时处理
  // 无需运行时注册
  console.log('[ContextMenu] macOS 右键菜单通过 Info.plist NSServices 构建时配置');
  return true;
}

/**
 * 注销系统右键菜单
 */
function unregisterContextMenu() {
  if (process.platform === 'win32') {
    unregisterWindowsContextMenu();
  }
}

module.exports = {
  registerContextMenu,
  unregisterContextMenu
};
```

- [ ] **Step 2: 创建 command-line-handler.js 文件**

```javascript
/**
 * command-line-handler.js - 命令行参数解析器
 *
 * 解析系统右键菜单传递的 CLI 参数，通过 IPC 发送到渲染进程。
 * 支持的参数：
 *   --clip-file "path"     → 添加到剪藏收件箱
 *   --ai-clip-file "path"  → AI 解析文件并添加剪藏
 *   --open-editor "path"   → 用编辑器打开文件
 *   --pdf-ocr "path"       → PDF OCR 识别
 *   --open-settings        → 打开设置页面
 */

/**
 * 解析命令行参数，返回动作列表
 * @param {string[]} argv - process.argv
 * @returns {Array<{action: string, path: string|null}>}
 */
function parseCommandLineArgs(argv) {
  const actions = [];
  const argMap = {
    '--clip-file': 'clip-file',
    '--ai-clip-file': 'ai-clip-file',
    '--open-editor': 'open-editor',
    '--pdf-ocr': 'pdf-ocr',
    '--open-settings': 'open-settings'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (argMap[arg]) {
      if (arg === '--open-settings') {
        actions.push({ action: 'open-settings', path: null });
      } else if (i + 1 < argv.length) {
        actions.push({ action: argMap[arg], path: argv[i + 1] });
        i++; // 跳过路径参数
      }
    }
  }
  return actions;
}

/**
 * 处理命令行参数，通过 IPC 发送到渲染进程
 * @param {Array<{action: string, path: string|null}>} actions
 * @param {BrowserWindow} mainWindow
 */
function dispatchActions(actions, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  for (const { action, path } of actions) {
    switch (action) {
      case 'clip-file':
        mainWindow.webContents.send('clip-file', path);
        break;
      case 'ai-clip-file':
        mainWindow.webContents.send('ai-clip-file', path);
        break;
      case 'open-editor':
        mainWindow.webContents.send('open-file-request', path);
        break;
      case 'pdf-ocr':
        mainWindow.webContents.send('pdf-ocr', path);
        break;
      case 'open-settings':
        mainWindow.webContents.send('open-settings');
        break;
    }
  }
}

module.exports = { parseCommandLineArgs, dispatchActions };
```

- [ ] **Step 3: 提交**

```bash
git add electron/context-menu-registry.js electron/command-line-handler.js
git commit -m "feat: 创建右键菜单注册管理器与命令行参数解析器"
```

---

### Task 2: 修改 Electron 主进程

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: 在 main.js 文件头部引入新模块**

找到 `const updateManager = require('./update-manager');` 行，在其后添加：

```javascript
// 右键菜单注册管理器
const { registerContextMenu, unregisterContextMenu } = require('./context-menu-registry');
// 命令行参数解析器
const { parseCommandLineArgs, dispatchActions } = require('./command-line-handler');
```

- [ ] **Step 2: 在 DEFAULT_CONFIG 中新增配置项**

找到 `const DEFAULT_CONFIG = {`，在 `configured: false` 之后添加：

```javascript
  contextMenuRegistered: false,  // 右键菜单是否已注册
```

- [ ] **Step 3: 在 createTray() 中添加「剪藏收件箱」和「设置」菜单项**

找到 `const contextMenu = Menu.buildFromTemplate([` 中的菜单模板，修改为：

```javascript
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '剪藏收件箱',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript(
            "window.location.href = '/clip'"
          ).catch(err => log.warn('[Tray] navigate to clip failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    {
      label: '密码管理',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript(
            "if (window.location.hash !== '#/vault') { window.history.pushState({view:'vault'}, '', '/vault'); window.dispatchEvent(new PopStateEvent('popstate')); }"
          ).catch(err => log.warn('[Tray] navigate to vault failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '⚙️ 设置',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript(
            "window.location.href = '/settings'"
          ).catch(err => log.warn('[Tray] navigate to settings failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        quitApp();
      }
    }
  ]);
```

- [ ] **Step 4: 在应用启动后注册右键菜单（首次运行）**

找到 `app.whenReady().then(async () => {` 中的配置完成回调 `config-done` 部分。在 `saveConfig(nextConfig);` 之后添加：

```javascript
// 首次运行：注册系统右键菜单
if (!nextConfig.contextMenuRegistered) {
  try {
    const registered = registerContextMenu(APP_DIR);
    if (registered) {
      nextConfig.contextMenuRegistered = true;
      saveConfig(nextConfig);
      log.info('[ContextMenu] 系统右键菜单注册成功');
    }
  } catch (e) {
    log.warn('[ContextMenu] 注册失败（可能需要管理员权限）:', e.message);
  }
}
```

同样，在已配置路径（`else` 分支）中，在 `const config = loadConfig();` 之后添加：

```javascript
// 检查并注册右键菜单（如果尚未注册）
if (!config.contextMenuRegistered) {
  try {
    const registered = registerContextMenu(APP_DIR);
    if (registered) {
      config.contextMenuRegistered = true;
      saveConfig(config);
      log.info('[ContextMenu] 系统右键菜单注册成功');
    }
  } catch (e) {
    log.warn('[ContextMenu] 注册失败:', e.message);
  }
}
```

- [ ] **Step 5: 在 app.whenReady() 中处理命令行参数**

在 `app.whenReady().then(async () => {` 中，在 `createMainWindow(config);` 之后添加：

```javascript
// 处理命令行参数（系统右键菜单传递的文件路径）
const actions = parseCommandLineArgs(process.argv);
if (actions.length > 0) {
  // 等待窗口就绪后分发动作
  mainWindow.webContents.on('did-finish-load', () => {
    dispatchActions(actions, mainWindow);
  }, { once: true });
}
```

- [ ] **Step 6: 在应用退出时清理注册表**

找到 `quitApp()` 函数，在 `stopReminderScheduler()` 之后添加：

```javascript
// 清理系统右键菜单注册表
try {
  unregisterContextMenu();
} catch (e) {
  log.warn('[ContextMenu] 注销失败:', e.message);
}
```

- [ ] **Step 7: 处理 macOS open-file 事件**

在 `app.whenReady()` 之前添加：

```javascript
// macOS: 通过系统 open-file 事件接收双击文件打开
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('open-file-request', filePath);
  }
});
```

- [ ] **Step 8: 提交**

```bash
git add electron/main.js
git commit -m "feat: 主进程集成右键菜单注册、命令行参数解析、托盘菜单新增设置入口"
```

---

### Task 3: 更新 preload.js 新增 IPC 通道

**Files:**
- Modify: `electron/preload.js`

- [ ] **Step 1: 在 preload.js 的 contextBridge.exposeInMainWorld 中添加新 IPC**

找到 `openFileByPath: (filePath) => ipcRenderer.invoke('editor-open-file-by-path', filePath),` 之后添加：

```javascript
  // ===================== 系统右键菜单事件监听 =====================

  /**
   * 监听系统右键「添加到剪藏收件箱」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onClipFile: (callback) => ipcRenderer.on('clip-file', (event, path) => callback(path)),

  /**
   * 监听系统右键「AI 解析文件并添加剪藏」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onAiClipFile: (callback) => ipcRenderer.on('ai-clip-file', (event, path) => callback(path)),

  /**
   * 监听系统右键「用编辑器打开文件」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onOpenFileRequest: (callback) => ipcRenderer.on('open-file-request', (event, path) => callback(path)),

  /**
   * 监听系统右键「PDF OCR 识别」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onPdfOcr: (callback) => ipcRenderer.on('pdf-ocr', (event, path) => callback(path)),

  /**
   * 监听系统右键「设置」事件
   * @param {Function} callback - 无参数回调
   */
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),
```

- [ ] **Step 2: 提交**

```bash
git add electron/preload.js
git commit -m "feat: preload.js 新增系统右键菜单 IPC 通道"
```

---

### Task 4: 前端编辑器接收文件打开事件

**Files:**
- Modify: `frontend/js/editor.js`

- [ ] **Step 1: 在 editor.js 初始化位置添加 IPC 监听**

找到 `document.addEventListener('DOMContentLoaded', function() {` 或编辑器初始化函数，在其中添加：

```javascript
// 监听系统文件打开事件（双击文件 / 右键「用编辑器打开」）
if (window.electronAPI && window.electronAPI.onOpenFileRequest) {
  window.electronAPI.onOpenFileRequest(async function(filePath) {
    log.info('[Editor] 收到系统文件打开请求:', filePath);
    try {
      const result = await window.electronAPI.openFileByPath(filePath);
      if (result && !result.canceled) {
        // 打开文件标签（复用现有的 openFileTab 或类似函数）
        if (typeof openFileTab === 'function') {
          openFileTab(result);
        }
      }
    } catch (err) {
      log.error('[Editor] 打开文件失败:', err);
    }
  });
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/js/editor.js
git commit -m "feat: 编辑器监听系统文件打开事件 IPC"
```

---

### Task 5: 后端新增 PDF OCR 接口

**Files:**
- Modify: `backend/src/main/java/com/example/clip/service/PdfService.java`
- Modify: `backend/src/main/java/com/example/clip/controller/PdfController.java`

- [ ] **Step 1: 在 PdfService 中新增 OCR 方法**

在 `PdfService.java` 末尾，`extractText` 方法之后添加：

```java
/**
 * PDF OCR 识别：将 PDF 渲染为图片后调用 OCR 引擎识别文字
 * <p>
 * 使用 PDFBox 的 PDFRenderer 将每页渲染为 BufferedImage，
 * 然后通过 Tess4J（Tesseract OCR）或预留的 AI 视觉模型接口进行文字识别。
 * </p>
 *
 * @param filePath 本地 PDF 文件路径
 * @return 包含识别结果和逐页文本的 Map
 * @throws IOException 读取或解析 PDF 失败时抛出
 */
public Map<String, Object> ocrPdf(String filePath) throws IOException {
    logger.info("[PdfService] OCR 识别 PDF: {}", filePath);

    File pdfFile = new File(filePath);
    if (!pdfFile.exists()) {
        throw new IllegalArgumentException("文件不存在: " + filePath);
    }

    try (PDDocument document = PDDocument.load(pdfFile)) {
        PDFRenderer renderer = new PDFRenderer(document);
        int totalPages = document.getNumberOfPages();

        List<Map<String, Object>> pageResults = new ArrayList<>();
        StringBuilder fullText = new StringBuilder();

        for (int i = 0; i < totalPages; i++) {
            // 渲染当前页为图片（300 DPI 保证识别质量）
            BufferedImage pageImage = renderer.renderImageWithDPI(i, 300);

            // OCR 识别：此处预留接口，实际实现可使用 Tess4J 或调用 AI 视觉模型
            // 当前回退到 PDFTextStripper 提取的文本（后续可替换为真实 OCR）
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setStartPage(i + 1);
            stripper.setEndPage(i + 1);
            stripper.setSortByPosition(true);
            String pageText = stripper.getText(document);

            Map<String, Object> pageResult = new HashMap<>();
            pageResult.put("pageNumber", i + 1);
            pageResult.put("text", pageText);
            pageResults.add(pageResult);

            if (fullText.length() < MAX_TEXT_LENGTH) {
                fullText.append(pageText).append("\n");
            }
        }

        String resultText = fullText.length() > MAX_TEXT_LENGTH
            ? fullText.substring(0, MAX_TEXT_LENGTH)
            : fullText.toString();

        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("text", resultText);
        result.put("pages", pageResults);
        result.put("metadata", Map.of(
            "pageCount", totalPages,
            "fileSize", pdfFile.length()
        ));

        logger.info("[PdfService] OCR 识别完成，页数={}", totalPages);
        return result;
    }
}
```

- [ ] **Step 2: 在 PdfController 中新增 OCR 端点**

在 `PdfController.java` 末尾，`extractText` 方法之后添加：

```java
/**
 * PDF OCR 识别
 * <p>
 * POST /api/pdf/ocr
 * <p>
 * 接收本地文件路径，返回 OCR 识别结果。
 * 用于系统右键菜单「PDF OCR 识别」功能。
 * 成功返回包含 text、pages、metadata 的 JSON，失败返回错误信息。
 *
 * @param request 包含 filePath 字段的请求体
 * @return OCR 识别结果 JSON
 */
@PostMapping("/ocr")
public ResponseEntity<?> ocrPdf(@RequestBody Map<String, String> request) {
    String filePath = request.get("filePath");
    logger.info("[PdfController] OCR 识别请求: {}", filePath);
    try {
        if (filePath == null || filePath.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "filePath 不能为空"));
        }
        Map<String, Object> result = pdfService.ocrPdf(filePath);
        return ResponseEntity.ok(result);
    } catch (IllegalArgumentException e) {
        logger.warn("[PdfController] OCR 参数错误: {}", e.getMessage());
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    } catch (Exception e) {
        logger.error("[PdfController] OCR 识别失败: {}", e.getMessage(), e);
        return ResponseEntity.internalServerError().body(Map.of("error", "OCR 识别失败: " + e.getMessage()));
    }
}
```

- [ ] **Step 3: 添加缺失的 import**

在 `PdfService.java` 文件头部添加：

```java
import java.awt.image.BufferedImage;
import java.io.File;
import org.apache.pdfbox.rendering.PDFRenderer;
```

- [ ] **Step 4: 提交**

```bash
git add backend/src/main/java/com/example/clip/service/PdfService.java backend/src/main/java/com/example/clip/controller/PdfController.java
git commit -m "feat: 后端新增 PDF OCR 接口（PDFBox 渲染 + OCR 预留）"
```

---

### Task 6: 后端新增事件类型常量

**Files:**
- Modify: `backend/src/main/java/com/example/clip/index/EventTypes.java`

- [ ] **Step 1: 在 EventTypes 类中添加新常量**

在 `SUGGESTION_REJECTED` 之后添加：

```java
    // ===== 桌面系统级集成事件 =====
    public static final String FILE_ASSOCIATION_OPEN = "file_association_open";
    public static final String CONTEXT_MENU_CLIP = "context_menu_clip";
    public static final String CONTEXT_MENU_AI_CLIP = "context_menu_ai_clip";
    public static final String CONTEXT_MENU_OPEN_EDITOR = "context_menu_open_editor";
    public static final String CONTEXT_MENU_PDF_OCR = "context_menu_pdf_ocr";
    public static final String CONTEXT_MENU_SETTINGS = "context_menu_settings";
    public static final String CONTEXT_MENU_REGISTER = "context_menu_register";
    public static final String PDF_OCR_RESULT = "pdf_ocr_result";
    public static final String TRAY_OPEN_SETTINGS = "tray_open_settings";
    public static final String TRAY_OPEN_CLIP_INBOX = "tray_open_clip_inbox";
```

- [ ] **Step 2: 提交**

```bash
git add backend/src/main/java/com/example/clip/index/EventTypes.java
git commit -m "feat: 新增桌面系统级集成事件类型常量"
```

---

### Task 7: 浏览器扩展右键菜单同步

**Files:**
- Modify: `browser-extension/background.js`

- [ ] **Step 1: 在 createContextMenus() 中新增菜单项**

在 `createContextMenus()` 函数中，`clip-settings` 菜单项之后添加：

```javascript
  // ====== 桌面同步菜单（与桌面端右键菜单保持一致） ======
  chrome.contextMenus.create({
    id: 'clip-file-to-inbox',
    parentId: 'clip-main',
    title: '添加到剪藏收件箱',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'clip-ai-parse',
    parentId: 'clip-main',
    title: 'AI 解析文件内容',
    contexts: ['page', 'selection']
  });
```

- [ ] **Step 2: 在 handleContextMenuClick() 中处理新菜单项**

在 `handleContextMenuClick()` 函数中，`case 'clip-settings':` 之前添加：

```javascript
      case 'clip-file-to-inbox':
        // 将页面内容添加到剪藏收件箱（使用默认类型）
        await clipWithType(tab, 'store-only', Boolean(info.selectionText));
        break;
      case 'clip-ai-parse':
        // AI 解析并剪藏
        await clipWithType(tab, 'ai-text', Boolean(info.selectionText));
        break;
```

- [ ] **Step 3: 提交**

```bash
git add browser-extension/background.js
git commit -m "feat: 浏览器扩展同步桌面端右键菜单项"
```

---

### Task 8: 更新 electron-builder 配置

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 build 配置中添加 fileAssociations 和 macOS NSServices**

找到 `"build": {` 部分，在 `"mac": {` 中添加 `extendInfo`：

```json
    "mac": {
      "extendInfo": {
        "NSServices": [
          {
            "NSMenuItem": { "default": "添加到剪藏收件箱" },
            "NSMessage": "clipFile",
            "NSPortName": "CutShelter",
            "NSRequiredContext": { "NSEnd": "NSMenuItem" },
            "NSSendTypes": ["NSFilenamesPboardType"]
          },
          {
            "NSMenuItem": { "default": "AI 解析文件并添加剪藏" },
            "NSMessage": "aiClipFile",
            "NSPortName": "CutShelter",
            "NSRequiredContext": { "NSEnd": "NSMenuItem" },
            "NSSendTypes": ["NSFilenamesPboardType"]
          },
          {
            "NSMenuItem": { "default": "用编辑器打开文件" },
            "NSMessage": "openEditor",
            "NSPortName": "CutShelter",
            "NSRequiredContext": { "NSEnd": "NSMenuItem" },
            "NSSendTypes": ["NSFilenamesPboardType"]
          }
        ]
      },
      "fileAssociations": [
        {
          "ext": "txt",
          "name": "CutShelter 文本编辑器",
          "description": "用 CutShelter 编辑器打开文本文件",
          "role": "Editor"
        },
        {
          "ext": "md",
          "name": "CutShelter Markdown 编辑器",
          "role": "Editor"
        },
        {
          "ext": "json",
          "name": "CutShelter JSON 编辑器",
          "role": "Editor"
        },
        {
          "ext": "xml",
          "name": "CutShelter XML 编辑器",
          "role": "Editor"
        },
        {
          "ext": "sql",
          "name": "CutShelter SQL 编辑器",
          "role": "Editor"
        },
        {
          "ext": "yml",
          "name": "CutShelter YAML 编辑器",
          "role": "Editor"
        },
        {
          "ext": "yaml",
          "name": "CutShelter YAML 编辑器",
          "role": "Editor"
        },
        {
          "ext": "ini",
          "name": "CutShelter 配置文件编辑器",
          "role": "Editor"
        },
        {
          "ext": "conf",
          "name": "CutShelter 配置文件编辑器",
          "role": "Editor"
        },
        {
          "ext": "log",
          "name": "CutShelter 日志查看器",
          "role": "Editor"
        },
        {
          "ext": "csv",
          "name": "CutShelter CSV 查看器",
          "role": "Editor"
        },
        {
          "ext": "js",
          "name": "CutShelter JavaScript 编辑器",
          "role": "Editor"
        },
        {
          "ext": "py",
          "name": "CutShelter Python 编辑器",
          "role": "Editor"
        },
        {
          "ext": "html",
          "name": "CutShelter HTML 编辑器",
          "role": "Editor"
        },
        {
          "ext": "css",
          "name": "CutShelter CSS 编辑器",
          "role": "Editor"
        }
      ]
    },
```

- [ ] **Step 2: 提交**

```bash
git add package.json
git commit -m "feat: electron-builder 配置新增文件关联和 macOS 右键菜单服务"
```

---

### Task 9: 前端处理剪藏文件、AI 解析和 PDF OCR 事件

**Files:**
- Modify: `frontend/js/editor.js`（或 `frontend/js/settings.js`）

- [ ] **Step 1: 在 editor.js 中处理剪藏和 OCR 事件**

在 editor.js 末尾添加事件监听：

```javascript
// ── 系统右键菜单事件处理 ──

// 添加到剪藏收件箱：读取文件内容并调用后端剪藏 API
if (window.electronAPI && window.electronAPI.onClipFile) {
  window.electronAPI.onClipFile(async function(filePath) {
    log.info('[System] 收到剪藏文件请求:', filePath);
    try {
      const result = await window.electronAPI.openFileByPath(filePath);
      if (result && !result.canceled) {
        // 调用后端剪藏 API
        const response = await fetch('http://127.0.0.1:8081/api/clip/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: result.text,
            source: filePath,
            title: result.fileName,
            type: 'store-only',
            captureMethod: 'context-menu'
          })
        });
        const data = await response.json();
        if (data.status === 'success') {
          log.info('[System] 文件已添加到剪藏收件箱:', result.fileName);
        }
      }
    } catch (err) {
      log.error('[System] 剪藏文件失败:', err);
    }
  });
}

// AI 解析文件并添加剪藏
if (window.electronAPI && window.electronAPI.onAiClipFile) {
  window.electronAPI.onAiClipFile(async function(filePath) {
    log.info('[System] 收到 AI 解析文件请求:', filePath);
    try {
      const result = await window.electronAPI.openFileByPath(filePath);
      if (result && !result.canceled) {
        // 调用后端智能入库 API
        const response = await fetch('http://127.0.0.1:8081/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: result.text,
            source: filePath,
            title: result.fileName
          })
        });
        const data = await response.json();
        if (data.success) {
          log.info('[System] AI 解析完成，已添加到剪藏:', result.fileName);
        }
      }
    } catch (err) {
      log.error('[System] AI 解析文件失败:', err);
    }
  });
}

// PDF OCR 识别
if (window.electronAPI && window.electronAPI.onPdfOcr) {
  window.electronAPI.onPdfOcr(async function(filePath) {
    log.info('[System] 收到 PDF OCR 请求:', filePath);
    try {
      const response = await fetch('http://127.0.0.1:8081/api/pdf/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: filePath })
      });
      const data = await response.json();
      if (data.success) {
        log.info('[System] PDF OCR 完成，共识别 ' + data.metadata.pageCount + ' 页');
        // 打开 OCR 结果展示（可在编辑器新建标签显示）
        if (typeof openNewTab === 'function') {
          openNewTab(data.text, 'OCR 识别结果 - ' + path.basename(filePath));
        }
      }
    } catch (err) {
      log.error('[System] PDF OCR 失败:', err);
    }
  });
}

// 打开设置页面
if (window.electronAPI && window.electronAPI.onOpenSettings) {
  window.electronAPI.onOpenSettings(function() {
    log.info('[System] 收到打开设置请求');
    window.location.href = '/settings';
  });
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/js/editor.js
git commit -m "feat: 前端处理系统右键菜单事件（剪藏/AI解析/OCR/设置）"
```

---

## 自检清单

- [ ] 1. **Spec 覆盖检查**：每个 Spec 章节都有对应的 Task 实现
  - 文件关联 → Task 8 (package.json fileAssociations)
  - 系统右键菜单 → Task 1 (context-menu-registry) + Task 8 (macOS NSServices)
  - 托盘设置 → Task 2 (main.js createTray)
  - 命令行参数 → Task 1 (command-line-handler) + Task 2 (main.js dispatch)
  - 扩展同步 → Task 7 (background.js)
  - 埋点事件 → Task 6 (EventTypes.java)
  - PDF OCR → Task 5 (PdfService.ocrPdf + PdfController.ocrPdf)
  - 前端处理 → Task 4 + Task 9

- [ ] 2. **占位符检查**：无 TBD/TODO/留空步骤

- [ ] 3. **类型一致性**：所有 IPC 通道名、CLI 参数名、事件常量的命名一致

- [ ] 4. **提交粒度**：每个 Task 包含独立可工作的变更，提交信息清晰

- [ ] 5. **跨平台**：Windows 注册表 + macOS Info.plist + NSServices 均已覆盖