# Tasks

- [ ] Task 1: 搭建 lite/ 骨架与依赖配置
  - [ ] SubTask 1.1: 创建 `lite/` 目录结构（`frontend/js/`、`frontend/libs/`、`frontend/styles/`）。
  - [ ] SubTask 1.2: 编写 `lite/package.json`，声明仅 `electron` + `iconv-lite` + `chardet` 三个运行时依赖，配置 electron-builder（productName=CutShelter Lite、appId、Windows/nsis 目标）。
  - [ ] SubTask 1.3: 编写 `lite/main.js`（约 180 行）：BrowserWindow、托盘、全局快捷键、固定白名单 IPC、唯一配置项 `fullVersionPath`、默认 workspace 和 launchFull。
  - [ ] SubTask 1.4: 编写 `lite/preload.js`（约 70 行）：contextIsolation + nodeIntegration:false，仅暴露文件读写、只读 workspace、launchFullVersion 和窗口控制方法。
  - [ ] SubTask 1.5: 启动时创建 `{userData}/notes/` 默认工作区，配置和笔记均复用现有链路。
  - [ ] SubTask 1.6: 在 `lite/` 执行安装与依赖检查，运行时仅使用 iconv-lite/chardet，Electron/electron-builder 属于 devDependencies。

- [ ] Task 2: 复制前端核心文件（零改动）
  - [ ] SubTask 2.1: 复制 `electron/editor-file-service.js` → `lite/editor-file-service.js`（原样，0 行改动）。
  - [ ] SubTask 2.2: 复制 `frontend/js/editor-core.js` → `lite/frontend/js/editor-core.js`（原样，0 行改动）。
  - [ ] SubTask 2.3: 复制 `frontend/js/logger.js` → `lite/frontend/js/logger.js`（原样，0 行改动）。
  - [ ] SubTask 2.4: 复制 `frontend/styles/editor.css`、`design-tokens.css`、`theme-notion.css`、`theme-regular.css` → `lite/frontend/styles/`（原样，0 行改动）。
  - [ ] SubTask 2.5: 按 `editor.html` 实际引用清单复制 ACE/marked/diff/sql-formatter 文件，排除 axios/html2canvas/mermaid 等未使用资源。
  - [ ] SubTask 2.6: 验证复制的文件路径与原项目一致，ACE worker 路径可正确加载。

- [ ] Task 3: 精简 editor.html 与 editor.js
  - [ ] SubTask 3.1: 复制 `frontend/editor.html` → `lite/frontend/editor.html`，删除 AI 对话面板 DOM、Pet 看板娘 DOM、clipModal 弹窗 DOM、分类下拉 DOM、启动遮罩 DOM，保留文件树并增加启动完整版按钮。
  - [ ] SubTask 3.2: 复制 `frontend/js/editor.js` → `lite/frontend/js/editor.js`，删除 `editor-ai-chat-core.js` 引用、Pet 逻辑、aiSearch/smartIngest/aiImportPassword 右键菜单项、clipModal 交互、所有 `fetch(API_BASE_URL...)` 调用、启动遮罩逻辑（约删 200 行）。
  - [ ] SubTask 3.3: 调用只读 workspace IPC 将默认目录指向 `{userData}/notes/`，复用现有文件树、新建、另存为和 autosave，不新增笔记 UI/IPC。
  - [ ] SubTask 3.4: 在精简后的 `editor.js` 中新增启动完整版逻辑：工具栏按钮 + `Ctrl+Shift+O` 快捷键 → 调用 `liteAPI.launchFullVersion()` → 根据返回结果显示 toast 成功/失败提示。
  - [ ] SubTask 3.5: 将 `editor.html` 中引用的 `editor-file-service.js` 路径适配为 `lite/` 目录结构，确认所有 `<script>` 和 `<link>` 标签路径正确。
  - [ ] SubTask 3.6: 执行前端脚本语法检查（`node -c` 或项目既有前端校验），确认无语法错误。

- [ ] Task 4: 实现启动完整版功能
  - [ ] SubTask 4.1: 在 `main.js` 中实现 `detectDevModePath()`：检查 `!app.isPackaged` 且上级目录存在 `electron/main.js` + `package.json`（name="clip-demo"），返回 `process.execPath` 和项目根目录参数。
  - [ ] SubTask 4.2: 在 `main.js` 中实现 `detectPackagedPath()`：按平台探测标准路径（Windows: `%LocalAppData%/CutShelter/CutShelter.exe` + `Program Files/CutShelter/CutShelter.exe`；macOS: `/Applications/CutShelter.app`；Linux: `/opt/CutShelter/CutShelter`）。
  - [ ] SubTask 4.3: 在 `main.js` 中实现 `launchFullVersion()` 优先级链：config.fullVersionPath → detectDevModePath → detectPackagedPath → 手动兜底 dialog → 持久化保存 → spawn 启动。
  - [ ] SubTask 4.4: 实现启动失败反馈：spawn 报错或路径不存在时，通过 IPC 向渲染进程发送 toast 提示，并引导手动选择。
  - [ ] SubTask 4.5: 在托盘右键菜单中添加"启动完整版"菜单项，绑定 `launchFullVersion()`。
  - [ ] SubTask 4.6: 验证不检测完整版已运行实例（直接 spawn，不查进程列表）。

- [ ] Task 5: 实现本地笔记功能
  - [ ] SubTask 5.1: 启动时创建 `{userData}/notes/` 并将其设为默认工作区。
  - [ ] SubTask 5.2: 验证文件树新建/打开 `.txt`、`.md` 笔记。
  - [ ] SubTask 5.3: 验证笔记自动保存、另存为和重启恢复，不覆盖其他文件。

- [ ] Task 6: 实现全局快捷键与托盘
  - [ ] SubTask 6.1: 在 `main.js` 中注册全局快捷键 `Alt+X`，实现窗口显示/隐藏切换（前台→隐藏，隐藏/后台→前台聚焦）。
  - [ ] SubTask 6.2: 在 `main.js` 中创建托盘图标，右键菜单包含"显示窗口"、"启动完整版"、"退出"三项。
  - [ ] SubTask 6.3: 验证 `Alt+X` 不与系统其他全局快捷键冲突，在 Lite 版窗口隐藏状态下仍可唤起。
  - [ ] SubTask 6.4: 验证托盘菜单三项功能均正常执行。

- [ ] Task 7: 测试与打包验证
  - [ ] SubTask 7.1: 前端脚本语法检查通过（`node -c` 对所有 .js 文件）。
  - [ ] SubTask 7.2: 桌面模式冒烟测试：启动 Lite 版 → 编辑文件 → 保存 → 默认工作区新建/保存笔记 → 启动完整版（开发模式）→ 全局快捷键唤起/隐藏 → 托盘菜单操作。
  - [ ] SubTask 7.3: electron-builder 打包测试，确认产出的 exe 可正常启动。
  - [ ] SubTask 7.4: 验证打包后完整版探测路径（标准路径）和手动兜底选择均正常工作。
  - [ ] SubTask 7.5: 每项通过后勾选本文件与 `04-剪藏Lite验收清单.md` 的对应项目；发现需要产品取舍的问题时暂停并请求确认。

# Task Dependencies
- Task 2 无依赖，可与 Task 1 并行。
- Task 3 依赖 Task 1（骨架）和 Task 2（复制的核心文件）。
- Task 4 依赖 Task 1（main.js 内置配置读写）。
- Task 5 依赖 Task 1（默认工作区）和 Task 3（editor.js 精简后的交互层）。
- Task 6 依赖 Task 1（main.js）和 Task 4（launchFullVersion）。
- Task 7 依赖 Task 1–6 全部完成。
