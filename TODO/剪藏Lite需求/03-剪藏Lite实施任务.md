# Tasks

- [ ] Task 1: 搭建 lite/ 骨架与依赖配置
  - [ ] SubTask 1.1: 创建 `lite/` 目录结构（`frontend/js/`、`frontend/libs/`、`frontend/styles/`）。
  - [ ] SubTask 1.2: 编写 `lite/package.json`，声明仅 `electron` + `iconv-lite` + `chardet` 三个运行时依赖，配置 electron-builder（productName=CutShelter Lite、appId、Windows/nsis 目标）。
  - [ ] SubTask 1.3: 编写 `lite/main.js`（约 250 行）：BrowserWindow 创建（900×640，原生标题栏，autoHideMenuBar）、托盘图标与右键菜单、全局快捷键 `Alt+X`、IPC 通道注册（文件操作、笔记、配置、launchFull）。
  - [ ] SubTask 1.4: 编写 `lite/preload.js`（约 120 行）：contextIsolation + nodeIntegration:false，暴露 `window.liteAPI` 包含文件读写、笔记操作、配置读写、launchFullVersion、窗口控制方法。
  - [ ] SubTask 1.5: 编写 `lite/config-service.js`（约 50 行）：读写 `{userData}/lite-config.json`，字段含 `fullVersionPath`、`globalShortcut`。
  - [ ] SubTask 1.6: 编写 `lite/note-service.js`（约 80 行）：`{userData}/notes/` 目录读写，新建笔记（时间戳文件名 `YYYY-MM-DD_HHmmss.txt`）、列表笔记、加载笔记内容、保存笔记。
  - [ ] SubTask 1.7: 在 `lite/` 执行 `npm install`，验证仅安装三个依赖及传递依赖，不出现 sharp/node-notifier/js-yaml/serve-static。

- [ ] Task 2: 复制前端核心文件（零改动）
  - [ ] SubTask 2.1: 复制 `electron/editor-file-service.js` → `lite/editor-file-service.js`（原样，0 行改动）。
  - [ ] SubTask 2.2: 复制 `frontend/js/editor-core.js` → `lite/frontend/js/editor-core.js`（原样，0 行改动）。
  - [ ] SubTask 2.3: 复制 `frontend/js/logger.js` → `lite/frontend/js/logger.js`（原样，0 行改动）。
  - [ ] SubTask 2.4: 复制 `frontend/styles/editor.css`、`design-tokens.css`、`theme-notion.css`、`theme-regular.css` → `lite/frontend/styles/`（原样，0 行改动）。
  - [ ] SubTask 2.5: 复制 `frontend/libs/` 目录（ace/、marked/、diff/、sql-formatter/）→ `lite/frontend/libs/`（原样，0 行改动，保持相对路径结构以兼容 ACE worker）。
  - [ ] SubTask 2.6: 验证复制的文件路径与原项目一致，ACE worker 路径可正确加载。

- [ ] Task 3: 精简 editor.html 与 editor.js
  - [ ] SubTask 3.1: 复制 `frontend/editor.html` → `lite/frontend/editor.html`，删除 AI 对话面板 DOM、Pet 看板娘 DOM、clipModal 弹窗 DOM、分类下拉 DOM、启动遮罩 DOM（约删 40 行），新增工具栏"笔记"按钮和"启动完整版"按钮，新增笔记列表面板 DOM。
  - [ ] SubTask 3.2: 复制 `frontend/js/editor.js` → `lite/frontend/js/editor.js`，删除 `editor-ai-chat-core.js` 引用、Pet 逻辑、aiSearch/smartIngest/aiImportPassword 右键菜单项、clipModal 交互、所有 `fetch(API_BASE_URL...)` 调用、启动遮罩逻辑（约删 200 行）。
  - [ ] SubTask 3.3: 在精简后的 `editor.js` 中新增本地笔记交互逻辑：笔记按钮点击 → 调用 `liteAPI.loadNotes()` 渲染列表 → 点击列表项调用 `liteAPI.loadNote(filename)` 载入编辑器 → 新笔记按钮调用 `liteAPI.createNote()` → 复用 autosave 逻辑保存到 notes/。
  - [ ] SubTask 3.4: 在精简后的 `editor.js` 中新增启动完整版逻辑：工具栏按钮 + `Ctrl+Shift+O` 快捷键 → 调用 `liteAPI.launchFullVersion()` → 根据返回结果显示 toast 成功/失败提示。
  - [ ] SubTask 3.5: 将 `editor.html` 中引用的 `editor-file-service.js` 路径适配为 `lite/` 目录结构，确认所有 `<script>` 和 `<link>` 标签路径正确。
  - [ ] SubTask 3.6: 执行前端脚本语法检查（`node -c` 或项目既有前端校验），确认无语法错误。

- [ ] Task 4: 实现启动完整版功能
  - [ ] SubTask 4.1: 在 `main.js` 中实现 `detectDevModePath()`：检查 `!app.isPackaged` 且上级目录存在 `electron/main.js` + `package.json`（name="clip-demo"），返回启动命令 `electron ..`。
  - [ ] SubTask 4.2: 在 `main.js` 中实现 `detectPackagedPath()`：按平台探测标准路径（Windows: `%LocalAppData%/CutShelter/CutShelter.exe` + `Program Files/CutShelter/CutShelter.exe`；macOS: `/Applications/CutShelter.app`；Linux: `/opt/CutShelter/CutShelter`）。
  - [ ] SubTask 4.3: 在 `main.js` 中实现 `launchFullVersion()` 优先级链：config.fullVersionPath → detectDevModePath → detectPackagedPath → 手动兜底 dialog → 持久化保存 → spawn 启动。
  - [ ] SubTask 4.4: 实现启动失败反馈：spawn 报错或路径不存在时，通过 IPC 向渲染进程发送 toast 提示，并引导手动选择。
  - [ ] SubTask 4.5: 在托盘右键菜单中添加"启动完整版"菜单项，绑定 `launchFullVersion()`。
  - [ ] SubTask 4.6: 验证不检测完整版已运行实例（直接 spawn，不查进程列表）。

- [ ] Task 5: 实现本地笔记功能
  - [ ] SubTask 5.1: 在 `note-service.js` 中实现 `createNote()`：生成时间戳文件名，在 `{userData}/notes/` 创建空文件，返回文件名。
  - [ ] SubTask 5.2: 实现 `listNotes()`：读取 notes/ 目录，返回文件名 + 修改时间列表，按时间倒序。
  - [ ] SubTask 5.3: 实现 `loadNote(filename)`：读取指定笔记文件内容，复用 editor-file-service 的编码检测能力。
  - [ ] SubTask 5.4: 实现 `saveNote(filename, content)`：复用现有 autosave 逻辑写入 notes/ 目录，不覆盖用户原始文件。
  - [ ] SubTask 5.5: 在 `editor.html` 中实现笔记列表面板 UI（复用 recent-pane 样式），在 `editor.js` 中实现面板打开/关闭、列表渲染、点击载入。
  - [ ] SubTask 5.6: 验证新建笔记 → 编辑 → 自动保存 → 重新加载笔记列表 内容完整不丢失。

- [ ] Task 6: 实现全局快捷键与托盘
  - [ ] SubTask 6.1: 在 `main.js` 中注册全局快捷键 `Alt+X`，实现窗口显示/隐藏切换（前台→隐藏，隐藏/后台→前台聚焦）。
  - [ ] SubTask 6.2: 在 `main.js` 中创建托盘图标，右键菜单包含"显示窗口"、"启动完整版"、"退出"三项。
  - [ ] SubTask 6.3: 验证 `Alt+X` 不与系统其他全局快捷键冲突，在 Lite 版窗口隐藏状态下仍可唤起。
  - [ ] SubTask 6.4: 验证托盘菜单三项功能均正常执行。

- [ ] Task 7: 测试与打包验证
  - [ ] SubTask 7.1: 前端脚本语法检查通过（`node -c` 对所有 .js 文件）。
  - [ ] SubTask 7.2: 桌面模式冒烟测试：启动 Lite 版 → 编辑文件 → 保存 → 新建笔记 → 编辑笔记 → 启动完整版（开发模式）→ 全局快捷键唤起/隐藏 → 托盘菜单操作。
  - [ ] SubTask 7.3: electron-builder 打包测试，确认产出的 exe 可正常启动。
  - [ ] SubTask 7.4: 验证打包后完整版探测路径（标准路径）和手动兜底选择均正常工作。
  - [ ] SubTask 7.5: 每项通过后勾选本文件与 `04-剪藏Lite验收清单.md` 的对应项目；发现需要产品取舍的问题时暂停并请求确认。

# Task Dependencies
- Task 2 无依赖，可与 Task 1 并行。
- Task 3 依赖 Task 1（骨架）和 Task 2（复制的核心文件）。
- Task 4 依赖 Task 1（main.js + config-service.js）。
- Task 5 依赖 Task 1（note-service.js）和 Task 3（editor.js 精简后的交互层）。
- Task 6 依赖 Task 1（main.js）和 Task 4（launchFullVersion）。
- Task 7 依赖 Task 1–6 全部完成。
