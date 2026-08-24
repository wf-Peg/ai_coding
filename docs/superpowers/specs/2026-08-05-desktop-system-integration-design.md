# 桌面系统级集成功能设计 Spec

## 概述

为 CutShelter 桌面应用增加系统级集成能力，包括文件关联、系统右键菜单、托盘快捷设置、浏览器扩展同步，以及配套的埋点数据上报。

## 1. 文件关联（默认打开方式）

### 目标
安装后，系统将文本/代码文件双击默认用 CutShelter 编辑器模块打开。

### 关联文件类型
全部 16 种：`txt`, `md`, `log`, `csv`, `json`, `xml`, `sql`, `yaml`, `yml`, `ini`, `conf`, `js`, `py`, `html`, `css`

### 实现方式

#### electron-builder 配置（`package.json`）

```json
"build": {
  "fileAssociations": {
    "ext": ["txt", "md", "log", "csv", "json", "xml", "sql", "yaml", "yml", "ini", "conf", "js", "py", "html", "css"],
    "name": "CutShelter 文本编辑器",
    "description": "用 CutShelter 编辑器打开文本文件",
    "icon": "electron/app-icon.png",
    "role": "editor"
  }
}
```

#### 主进程处理

```js
// macOS: 通过系统 open-file 事件接收
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  mainWindow.webContents.send('open-file-request', filePath);
});

// Windows: 启动时解析进程参数
const fileToOpen = process.argv.find(arg => !arg.startsWith('-') && fs.existsSync(arg));
if (fileToOpen) {
  app.whenReady().then(() => {
    mainWindow.webContents.send('open-file-request', fileToOpen);
  });
}
```

#### preload.js 新增 IPC

```js
openFileRequest: (callback) => ipcRenderer.on('open-file-request', (event, path) => callback(path))
```

### 埋点

| 事件名 | 触发时机 | 携带数据 |
|-------|---------|---------|
| `file_association_open` | 通过文件关联打开文件 | `{ fileType, fileSize, source: 'double_click' }` |

---

## 2. 系统级右键菜单

### 目标
在 Windows 资源管理器 / macOS Finder 中，对文件/文件夹右键时显示 CutShelter 菜单项。

### 菜单结构

```
CutShelter
├── ✂️ 添加到剪藏收件箱        → --clip-file
├── 🧠 AI 解析文件并添加剪藏     → --ai-clip-file
├── 📝 用编辑器打开文件         → --open-editor
├── 📄 PDF OCR 识别            → --pdf-ocr（仅 .pdf 显示）
└── ⚙️ 设置                  → --open-settings
```

### 可见性规则

| 选项 | 文件 | 文件夹 | 多文件 | PDF |
|------|------|--------|-------|-----|
| 添加到剪藏收件箱 | ✅ | ✅ | ✅ | ✅ |
| AI 解析文件并添加剪藏 | ✅ | ❌ | ❌ | ✅ |
| 用编辑器打开文件 | ✅ | ❌ | ❌ | ❌ |
| PDF OCR 识别 | ❌ | ❌ | ❌ | ✅ |
| 设置 | ✅ | ✅ | ✅ | ✅ |

### Windows 实现：注册表注入

在 `electron/main.js` 中通过 `reg.exe` 在首次启动时写入：

```
HKEY_CLASSES_ROOT\*\shell\CutShelterClip
  @="添加到剪藏收件箱"
  "Icon"="...app-icon.ico"

HKEY_CLASSES_ROOT\*\shell\CutShelterClip\command
  @="\"...exe\" --clip-file \"%1\""

HKEY_CLASSES_ROOT\*\shell\CutShelterAIClip
  @="AI 解析文件并添加剪藏"
  "Icon"="..."

HKEY_CLASSES_ROOT\*\shell\CutShelterAIClip\command
  @="\"...exe\" --ai-clip-file \"%1\""

HKEY_CLASSES_ROOT\*\shell\CutShelterOpen
  @="用编辑器打开文件"
  "Icon"="..."

HKEY_CLASSES_ROOT\*\shell\CutShelterOpen\command
  @="\"...exe\" --open-editor \"%1\""

HKEY_CLASSES_ROOT\*\shell\CutShelterOCRPdf
  @="PDF OCR 识别"
  "Icon"="..."
  "AppliesTo"="System.FileName:.pdf"

HKEY_CLASSES_ROOT\*\shell\CutShelterOCRPdf\command
  @="\"...exe\" --pdf-ocr \"%1\""

HKEY_CLASSES_ROOT\*\shell\CutShelterSettings
  @="设置"
  "Icon"="..."

HKEY_CLASSES_ROOT\*\shell\CutShelterSettings\command
  @="\"...exe\" --open-settings"
```

### macOS 实现：Info.plist 扩展

```json
"mac": {
  "extendInfo": {
    "NSServices": [
      {
        "NSMenuItem": { "default": "添加到剪藏收件箱" },
        "NSMessage": "clipFile",
        "NSPortName": "CutShelter",
        "NSSendTypes": ["NSFilenamesPboardType"]
      },
      {
        "NSMenuItem": { "default": "AI 解析文件并添加剪藏" },
        "NSMessage": "aiClipFile",
        "NSPortName": "CutShelter",
        "NSSendTypes": ["NSFilenamesPboardType"]
      },
      {
        "NSMenuItem": { "default": "用编辑器打开文件" },
        "NSMessage": "openEditor",
        "NSPortName": "CutShelter",
        "NSSendTypes": ["NSFilenamesPboardType"]
      }
    ]
  }
}
```

### 命令行参数处理

```js
function handleCommandLineArgs(argv) {
  if (argv.includes('--clip-file')) {
    const idx = argv.indexOf('--clip-file') + 1;
    mainWindow.webContents.send('clip-file', argv[idx]);
  } else if (argv.includes('--ai-clip-file')) {
    const idx = argv.indexOf('--ai-clip-file') + 1;
    mainWindow.webContents.send('ai-clip-file', argv[idx]);
  } else if (argv.includes('--open-editor')) {
    const idx = argv.indexOf('--open-editor') + 1;
    mainWindow.webContents.send('open-file-request', argv[idx]);
  } else if (argv.includes('--pdf-ocr')) {
    const idx = argv.indexOf('--pdf-ocr') + 1;
    mainWindow.webContents.send('pdf-ocr', argv[idx]);
  } else if (argv.includes('--open-settings')) {
    mainWindow.webContents.send('open-settings');
  }
}
```

### 前端的 IPC 处理

```js
// preload.js 新增
clipFile: (callback) => ipcRenderer.on('clip-file', (event, path) => callback(path)),
aiClipFile: (callback) => ipcRenderer.on('ai-clip-file', (event, path) => callback(path)),
pdfOcr: (callback) => ipcRenderer.on('pdf-ocr', (event, path) => callback(path)),
openSettings: (callback) => ipcRenderer.on('open-settings', () => callback())
```

### PDF OCR 流程

```
右键 .pdf → 点击「PDF OCR 识别」
  → 主进程 --pdf-ocr "file.pdf"
  → 调用后端 POST /api/pdf/ocr { filePath }
  → 后端：PDFBox 渲染 → Tesseract/AI 视觉模型 OCR
  → 返回 { text, pages: [{pageNumber, text}], metadata }
  → 前端弹出结果面板（保存为剪藏 / 复制 / 编辑器打开）
```

### 埋点

| 事件名 | 触发时机 | 携带数据 |
|-------|---------|---------|
| `context_menu_clip` | 右键「添加到剪藏收件箱」 | `{ fileType, fileSize, source: 'context_menu' }` |
| `context_menu_ai_clip` | 右键「AI 解析文件」 | `{ fileType, fileSize }` |
| `context_menu_open_editor` | 右键「用编辑器打开」 | `{ fileType, fileSize }` |
| `context_menu_pdf_ocr` | 右键「PDF OCR」 | `{ fileSize, pageCount }` |
| `context_menu_settings` | 右键「设置」 | `{ }` |
| `context_menu_register` | 注册表写入成功 | `{ platform, menuCount }` |
| `pdf_ocr_result` | OCR 识别完成 | `{ success, duration, pageCount }` |

---

## 3. 托盘菜单改进

### 目标
桌面最小化图标右键菜单新增「设置」一键入口。

### 改动位置
`electron/main.js` — `createTray()` 函数

### 改造后菜单

```
显示主窗口
───────
剪藏收件箱          ← 新增
密码管理
───────
⚙️ 设置            ← 新增
───────
退出
```

### 关键代码

```js
{
  label: '⚙️ 设置',
  click: () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.executeJavaScript(
        "window.location.href = '/settings'"
      ).catch(() => {});
    } else {
      const config = loadConfig();
      createMainWindow(config);
    }
  }
}
```

### 埋点

| 事件名 | 触发时机 | 携带数据 |
|-------|---------|---------|
| `tray_open_settings` | 托盘右键「设置」 | `{ }` |
| `tray_open_clip_inbox` | 托盘右键「剪藏收件箱」 | `{ }` |

---

## 4. 浏览器扩展同步

### 同步原则
- 桌面端通用功能 → 同步到扩展
- 桌面端独有功能（PDF OCR、编辑器打开文件）→ 不同步

### 扩展右键菜单改动

`browser-extension/background.js` — `createContextMenus()` 中新增：

```js
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

### 统一菜单 ID 映射表

| 功能 | 桌面 CLI 参数 | 扩展菜单 ID | 埋点事件名 |
|------|-------------|-------------|-----------|
| 添加到剪藏收件箱 | `--clip-file` | `clip-file-to-inbox` | `context_menu_clip` |
| AI 解析剪藏 | `--ai-clip-file` | `clip-ai-parse` | `context_menu_ai_clip` |
| 用编辑器打开 | `--open-editor` | —（不同步） | `context_menu_open_editor` |
| PDF OCR | `--pdf-ocr` | —（不同步） | `context_menu_pdf_ocr` |
| 设置 | `--open-settings` | `clip-settings` | `context_menu_settings` |

---

## 5. 埋点数据结构与工作台对接

### 统一事件上报接口

所有埋点通过 `POST /api/action/event` 上报，桌面端和浏览器扩展使用相同结构：

```json
{
  "event": "context_menu_clip",
  "source": "desktop",     // "desktop" | "extension"
  "timestamp": "2026-08-05T10:00:00Z",
  "sessionId": "uuid",
  "payload": {
    "fileType": "pdf",
    "fileSize": 1024000,
    "platform": "win32"
  }
}
```

### 数据流向

```
桌面右键 / 扩展右键
  → 主进程 / background.js
  → 后端 POST /api/action/event
  → 后端写入 ActionEventService
  → 工作台模块（ContentIndexService）消费分析
```

### 后端变更

`ActionEventService` 已在 `backend/src/main/java/com/example/clip/index/ActionEventService.java` 中，新增事件类型常量：

```java
public class EventTypes {
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
}
```

---

## 6. 配置文件变更

### 新增配置项

在 `electron/main.js` 的 `DEFAULT_CONFIG` 中新增：

```js
const DEFAULT_CONFIG = {
  // ... 现有配置
  contextMenuRegistered: false,  // 右键菜单是否已注册
  fileAssociations: true         // 是否注册文件关联
};
```

### 注册状态持久化

首次注册右键菜单后，将 `contextMenuRegistered: true` 写入 `config.json`，避免重复写入注册表。

---

## 7. 验收标准

| # | 验收项 | 验证方式 |
|---|-------|---------|
| 1 | 安装后双击 .txt 文件用 CutShelter 编辑器打开 | 手动测试 |
| 2 | 右键文件显示「添加到剪藏收件箱」并可用 | 手动测试 |
| 3 | 右键文件显示「AI 解析文件并添加剪藏」并可用 | 手动测试 |
| 4 | 右键文件显示「用编辑器打开文件」并可用 | 手动测试 |
| 5 | 右键 .pdf 文件显示「PDF OCR 识别」并可用 | 手动测试 |
| 6 | 右键菜单显示「设置」并跳转到设置页 | 手动测试 |
| 7 | 托盘右键菜单显示「设置」并跳转 | 手动测试 |
| 8 | 浏览器扩展右键菜单同步新增「添加到剪藏收件箱」 | 手动测试 |
| 9 | 浏览器扩展右键菜单同步新增「AI 解析文件内容」 | 手动测试 |
| 10 | 所有埋点事件正确上报到后端 | 日志检查 |
| 11 | 卸载时清理注册表项 | 手动测试 |
| 12 | macOS 上 Finder 右键菜单正确显示 | 手动测试（如有 Mac） |