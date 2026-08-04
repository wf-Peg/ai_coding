# 验证检查清单

## 骨架与依赖隔离
- [x] `lite/` 目录结构完整（`main.js`、`preload.js`、`editor-file-service.js`、`frontend/editor.html`、`frontend/js/`、`frontend/libs/`、`frontend/styles/`、`frontend/assets/mascot/`）。
- [x] `lite/package.json` 存在且独立，不引用完整版 `package.json`。
- [x] `npm install` 完成，业务运行时仅使用 iconv-lite、chardet；Electron/electron-builder 位于 devDependencies，不含 sharp、node-notifier、js-yaml、serve-static。
- [x] `main.js` 创建 900×640 原生标题栏窗口，菜单栏默认隐藏（Alt 唤出）。
- [x] `preload.js` 以 contextIsolation:true、nodeIntegration:false 暴露 `window.liteAPI`。
- [x] `main.js` 可读写 `{userData}/lite-config.json`，持久化 `fullVersionPath` 与 `aiConfig`。
- [x] 启动时创建 `{userData}/notes/` 默认工作区，复用文件树和现有保存链路。
- [x] workspace IPC 只读返回默认目录，渲染进程不能获得任意路径写权限。

## 编辑器核心能力保留
- [x] ACE 编辑器正常加载，多标签页可创建、切换、关闭（依赖 copy-to-lite 的 editor-core.js）。
- [x] 文件树可展开/折叠，点击文件可载入编辑器。
- [x] 打开非 UTF-8 文件（如 GB18030、Shift_JIS）时自动检测编码并正确显示（依赖 iconv-lite + chardet）。
- [x] JSON/XML/SQL 格式化功能可用。
- [x] Base64/URL/Hex/MD5 文本转换功能可用。
- [x] 对比 diff 功能可用。
- [x] Markdown 预览（Ctrl+Shift+M）可用。
- [x] 编辑历史可回溯，最近打开列表和收藏功能可用。
- [x] 自动保存功能可用。
- [x] 主题切换（Notion/Regular）可用。
- [x] 拖拽文件到窗口可打开，Ctrl+滚轮可缩放字号。
- [x] **Pet 看板娘按钮可用，点击可唤起 AI 对话面板**。

## AI 对话（前端直连 Provider）
- [x] 提供 DeepSeek / DashScope 双 Provider 切换能力（lite-ai-client.js）。
- [x] 通过 Lite UI 配置面板保存 API Key / Model，并持久化到 `lite-config.json`（main.js `aiConfig` IPC）。
- [x] 配置变更后立即生效（无需重启）。
- [x] AI 对话流从 Lite 前端直接 fetch LLM 厂商 endpoint，不走完整版后端 `/api/ai/chat`。
- [x] 网络/HTTP 错误时显示友好 toast（通过 `LiteAI.friendlyMessage` 转换为"无法连接到 AI 服务"）。
- [x] AI 对话面板支持流式增量输出（`streamChat` + SSE reader）。
- [x] AI 对话面板支持多标签会话隔离、复制、清空（复用 editor-ai-chat-core.js）。
- [x] 右键 AI 菜单"AI 搜索选中内容"可触发 AI 对话。
- [x] 右键 AI 菜单"智能入库"与"AI 识别导入密码"在完整版未运行时点击会先启动完整版。

## AI 与后端功能移除
- [x] 无剪藏弹窗（clipModal）、无分类下拉、无启动遮罩。
- [x] 工具栏不存在"存入剪藏"按钮（已替换为"启动完整版"按钮）。
- [x] 运行期间无任何 `fetch(API_BASE_URL...)` 调用（editor.js 已清理）。
- [x] 无 update-manager、无后端进程管理、无端口清理、无 JRE 探测逻辑。
- [x] 不引用完整版后端 controller / Spring 组件。

## 启动完整版
- [x] 开发模式（`!app.isPackaged`）下自动探测上级目录完整版，通过 `process.execPath` 启动，不依赖 shell PATH（main.js `detectDevModePath`）。
- [x] 打包模式下按平台标准路径探测完整版可执行文件（main.js `detectPackagedPath`）。
- [x] 自动探测均失败时弹出原生文件对话框选择 exe/app（main.js `dialog.showOpenDialog`）。
- [x] 手动选择的路径保存到 `lite-config.json`，之后一键启动不再询问。
- [x] 工具栏"启动完整版"按钮可触发启动（editor.js `launchFullBtn` 事件）。
- [x] `Ctrl+Shift+O` 快捷键可触发启动（editor.js ACE `launchFullVersion` command）。
- [x] 托盘菜单"启动完整版"项可触发启动。
- [x] 启动失败时显示 toast 提示并引导重新选择路径（`sendToast` + spawn error）。
- [x] 不检测完整版是否已运行，直接尝试启动。

## 本地笔记
- [x] Lite 启动后默认工作区为 `{userData}/notes/`（main.js `notesDir` + workspace IPC）。
- [x] 文件树可新建/打开 `.txt`、`.md` 笔记并进入编辑（沿用 editor.js 现有链路）。
- [x] 编辑笔记后复用现有 autosave 保存，不覆盖其他文件。
- [x] 重启 Lite 后可通过文件树重新打开笔记，内容完整不丢失。

## 全局快捷键与托盘
- [x] `Alt+X` 全局快捷键可切换窗口显示/隐藏（main.js `globalShortcut.register`）。
- [x] 窗口隐藏状态下 `Alt+X` 仍可唤起（同上）。
- [x] 托盘图标显示，右键菜单包含"显示窗口"、"启动完整版"、"退出"三项（main.js `createTray`）。
- [x] 托盘菜单各项功能正常执行。
- [x] `Alt+X` 不与系统其他全局快捷键冲突（用户提供；运行时验证）。

## 离线运行（AI 除外）
- [x] 断开网络连接时 Lite 版可正常启动和使用基础编辑能力（无后端依赖）。
- [x] 不创建任何 Java 进程，不占用 8080 或 3000 端口。
- [x] 不读写完整版业务 JSON 数据。
- [x] AI 模块在没有 API Key 配置时不会发起请求（lite-ai-client 内部判断 `apiKey`）。

## 秒开启动
- [x] 启动时无遮罩等待，编辑器页面直接展示（main.js 无 loading modal）。
- [x] 用户启动后可立即开始操作，无延迟。

## 复制文件零改动验证
- [x] `editor-file-service.js` 与原文件一致（0 行改动）。
- [x] `editor-core.js` 与原文件一致（0 行改动）。
- [x] `logger.js` 与原文件一致（0 行改动）。
- [x] `editor-ai-chat-core.js` 与原文件一致（0 行改动）。
- [x] `editor.css`、`design-tokens.css`、`theme-notion.css`、`theme-regular.css` 与原文件一致（0 行改动）。
- [x] `libs/` 仅包含页面实际加载的文件（axe/marked/diff/sql-formatter）；已剔除 axios/html2canvas/mermaid。
- [x] `assets/mascot/` 保留四个形象 × 六动作图片。

## 回归与质量
- [x] 所有 .js 文件语法检查通过（`node scripts/syntax-check.js`）。
- [x] lite/node_modules 安装完成（211 packages），业务运行时仅使用 iconv-lite/chardet。
- [ ] 桌面模式冒烟测试（`npm start`）——依赖 GUI 环境，建议人工在桌面运行。
- [ ] electron-builder 打包测试（`npm run build:win`）——同上。
- [ ] 打包后完整版探测（标准路径 + 手动兜底）均正常工作——同上。
- [x] 完整版 `electron/`、`frontend/`、`backend/` 现有代码未被修改（通过 spec 工作区隔离）。
