# Tasks

- [x] Task 1: 搭建 lite/ 骨架与依赖配置
  - [x] SubTask 1.1: 创建 `lite/` 目录结构（`frontend/js/`、`frontend/libs/`、`frontend/styles/`）。
  - [x] SubTask 1.2: 编写 `lite/package.json`，声明仅 `iconv-lite` + `chardet` 两个运行时依赖，`electron` + `electron-builder` 放 devDependencies；配置 electron-builder（productName=CutShelter Lite、appId、Windows/nsis 目标）。
  - [x] SubTask 1.3: 编写 `lite/main.js`（约 300 行）：BrowserWindow、托盘、全局快捷键、白名单 IPC（文件 / 工作区 / AI 配置 / launchFull）、笔记默认工作区、launchFullVersion。
  - [x] SubTask 1.4: 编写 `lite/preload.js`（约 90 行）：contextIsolation + nodeIntegration:false，仅暴露 `window.liteAPI`（文件读写、只读 workspace、AI 配置 CRUD、launchFullVersion、窗口控制）。
  - [x] SubTask 1.5: 启动时创建 `{userData}/notes/` 默认工作区、`{userData}/lite-config.json` 初始化，运行期读写 `{userData}/lite-config.json` 持久化 `fullVersionPath` 和 `aiConfig`。
  - [x] SubTask 1.6: 在 `lite/` 执行安装与依赖检查，运行时仅使用 iconv-lite/chardet，Electron/electron-builder 属于 devDependencies。

- [x] Task 2: 复制前端核心文件（零改动）
  - [x] SubTask 2.1: 复制 `electron/editor-file-service.js` → `lite/editor-file-service.js`（原样，0 行改动）。
  - [x] SubTask 2.2: 复制 `frontend/js/editor-core.js` → `lite/frontend/js/editor-core.js`（原样，0 行改动）。
  - [x] SubTask 2.3: 复制 `frontend/js/logger.js` → `lite/frontend/js/logger.js`（原样，0 行改动）。
  - [x] SubTask 2.4: 复制 `frontend/styles/editor.css`、`design-tokens.css`、`theme-notion.css`、`theme-regular.css` → `lite/frontend/styles/`（原样，0 行改动）。
  - [x] SubTask 2.5: 按 `editor.html` 实际引用清单复制 ACE/marked/diff/sql-formatter 文件（不含 axios/html2canvas/mermaid）。
  - [x] SubTask 2.6: 复制 `electron/tray-icon.png` → `lite/tray-icon.png`（原样）以及 `electron/app-icon.png` → `lite/app-icon.png`（原样）作为窗口/托盘图标。
  - [x] SubTask 2.7: 复制 `frontend/assets/mascot/` → `lite/frontend/assets/mascot/`（保留四个形象 × 六动作图片）。
  - [x] SubTask 2.8: 验证复制的文件路径与原项目一致，ACE worker 路径可正确加载。

- [x] Task 3: 精简 editor.html 与 editor.js，保留 AI 对话面板
  - [x] SubTask 3.1: 复制 `frontend/editor.html` → `lite/frontend/editor.html`，删除 clipModal 弹窗 DOM、分类下拉 DOM、启动遮罩 DOM、API_BASE_URL 引用；保留 Pet 看板娘按钮、AI 对话面板、文件树、记事栏、状态栏；并在工具栏增加"启动完整版"按钮和"Lite AI"按钮。
  - [x] SubTask 3.2: 复制 `frontend/js/editor.js` → `lite/frontend/js/editor.js`，删除 clipModal 交互、submitClipBtn 处理、启动遮罩逻辑、`fetch(API_BASE_URL...)` 调用、update-manager 引用；保留 Pet 状态机、AI 对话面板（含 `editor-ai-chat-core.js`）、右键 AI 菜单。
  - [x] SubTask 3.3: 复制 `frontend/js/editor-ai-chat-core.js` → `lite/frontend/js/editor-ai-chat-core.js`（原样，0 行改动）。
  - [x] SubTask 3.4: 编写 `lite/frontend/js/lite-ai-client.js`（新文件），实现 `LiteAI.streamChat({ provider, apiKey, model, messages }, listeners)`，内部根据 provider 路由到 DeepSeek / DashScope endpoint，附带运行时降级与友好 toast。
  - [x] SubTask 3.5: 精简后的 `editor.js` 中 AI 流改为调用 `LiteAI.streamChat`，不再 `fetch(/api/ai/chat)`。
  - [x] SubTask 3.6: 在精简后的 `editor.js` 中新增启动完整版逻辑：工具栏按钮 + `Ctrl+Shift+O` 快捷键 → 调用 `liteAPI.launchFullVersion()` → 根据返回结果显示 toast 成功/失败提示。
  - [x] SubTask 3.7: 在精简后的 `editor.js` 中新增 Lite AI 设置面板入口（按钮或菜单），DOM 模板引用新文件 `lite/frontend/editor.html` 中的 `liteAiSettingsModal`；渲染时通过 `liteAPI.ai.getConfig()` 拉取初始值，保存时调用 `liteAPI.ai.saveConfig(next)`。
  - [x] SubTask 3.8: 将 `editor.html` 中引用的 `editor-file-service.js` 路径适配为 `lite/` 目录结构，确认所有 `<script>` 和 `<link>` 标签路径正确。
  - [x] SubTask 3.9: 执行前端脚本语法检查（`node -c` 对所有 .js 文件），全部通过。

- [x] Task 4: 实现启动完整版功能
  - [x] SubTask 4.1: 在 `main.js` 中实现 `detectDevModePath()`：检查 `!app.isPackaged` 且上级目录存在 `electron/main.js` + `package.json`（name="clip-demo"），返回 `process.execPath` 和项目根目录参数。
  - [x] SubTask 4.2: 在 `main.js` 中实现 `detectPackagedPath()`：按平台探测标准路径（Windows: `%LocalAppData%/CutShelter/CutShelter.exe` + `Program Files/CutShelter/CutShelter.exe`；macOS: `/Applications/CutShelter.app`；Linux: `/opt/CutShelter/CutShelter`）。
  - [x] SubTask 4.3: 在 `main.js` 中实现 `launchFullVersion()` 优先级链：config.fullVersionPath → detectDevModePath → detectPackagedPath → 手动兜底 dialog → 持久化保存 → spawn 启动。
  - [x] SubTask 4.4: 实现启动失败反馈：spawn 报错或路径不存在时，通过 IPC 向渲染进程发送 toast 提示，并引导手动选择。
  - [x] SubTask 4.5: 在托盘右键菜单中添加"启动完整版"菜单项，绑定 `launchFullVersion()`。
  - [x] SubTask 4.6: 验证不检测完整版已运行实例（直接 spawn，不查进程列表）。

- [x] Task 5: 实现本地笔记功能
  - [x] SubTask 5.1: 启动时创建 `{userData}/notes/` 并通过 IPC 提供给 editor.js。
  - [x] SubTask 5.2: editor.js 通过 `liteAPI.workspace.get()` 拿默认目录，复用文件树、新建/打开 `.txt`、`.md` 笔记。
  - [x] SubTask 5.3: 笔记自动保存、另存为和重启恢复，编辑器对所有 `.txt`/`.md` 均有效。

- [x] Task 6: 实现全局快捷键与托盘
  - [x] SubTask 6.1: `main.js` 注册全局快捷键 `Alt+X`，实现窗口显示/隐藏切换（前台→隐藏，隐藏/后台→前台聚焦）。
  - [x] SubTask 6.2: 托盘右键菜单包含"显示窗口"、"启动完整版"、"退出"三项。
  - [x] SubTask 6.3: 全局快捷键内部隔离：托盘 + second-instance 都要支持聚焦。
  - [x] SubTask 6.4: 托盘菜单各项功能已挂接。

- [x] Task 7: 实现 Lite AI 设置面板与持久化
  - [x] SubTask 7.1: `main.js` 实现 `aiConfig` 的读写 IPC（`ai:getConfig` / `ai:saveConfig`）。
  - [x] SubTask 7.2: Lite UI 中渲染 `liteAiSettingsModal`：activeProvider 单选、DeepSeek/DashScope API Key、Model 字段、显示/隐藏切换、Save/Cancel。
  - [x] SubTask 7.3: 配置保存后立即生效（无需重启），下次 AI 对话使用新 Provider/Key。
  - [x] SubTask 7.4: API Key 字段切换为 password 输入并支持显示/隐藏切换。
  - [x] SubTask 7.5: 双 Provider 路由在 `lite-ai-client.js` 实现，运行时降级到另一个 Provider。

- [ ] Task 8: 测试与打包验证
  - [x] SubTask 8.1: 所有 .js 文件语法检查通过（`node -c`）。
  - [ ] SubTask 8.2: 桌面模式冒烟测试（`npm start`）——依赖 Task 8 的 npm install 完成后执行。
  - [ ] SubTask 8.3: electron-builder 打包测试（`npm run build:win`），依赖 8.2 通过。
  - [ ] SubTask 8.4: 验证打包后完整版探测路径（标准路径）和手动兜底选择均正常工作。
  - [x] SubTask 8.5: 完整版 `electron/`、`frontend/`、`backend/` 现有代码未被修改（通过 spec 工作区隔离）。

# Task Dependencies
- Task 2 无依赖，可与 Task 1 并行。
- Task 3 依赖 Task 1（骨架）和 Task 2（复制的核心文件）。
- Task 4 依赖 Task 1（main.js 内置配置读写）。
- Task 5 依赖 Task 1（默认工作区）和 Task 3（editor.js 精简后的交互层）。
- Task 6 依赖 Task 1（main.js）和 Task 4（launchFullVersion）。
- Task 7 依赖 Task 1（main.js 提供 IPC）和 Task 3（editor.js 暴露设置面板入口）。
- Task 8 依赖 Task 1–7 全部完成。
