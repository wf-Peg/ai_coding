# 验证检查清单

## 骨架与依赖隔离
- [ ] `lite/` 目录结构完整（`main.js`、`preload.js`、`editor-file-service.js`、`note-service.js`、`config-service.js`、`frontend/editor.html`、`frontend/js/`、`frontend/libs/`、`frontend/styles/`）。
- [ ] `lite/package.json` 存在且独立，不引用完整版 `package.json`。
- [ ] `npm install` 后 `node_modules` 仅包含 electron、iconv-lite、chardet 及传递依赖，不含 sharp、node-notifier、js-yaml、serve-static。
- [ ] `main.js` 创建 900×640 原生标题栏窗口，菜单栏默认隐藏（Alt 唤出）。
- [ ] `preload.js` 以 contextIsolation:true、nodeIntegration:false 暴露 `window.liteAPI`。
- [ ] `config-service.js` 可读写 `{userData}/lite-config.json`，含 `fullVersionPath` 字段。
- [ ] `note-service.js` 可在 `{userData}/notes/` 创建、列表、加载、保存笔记文件。

## 编辑器核心能力保留
- [ ] ACE 编辑器正常加载，多标签页可创建、切换、关闭。
- [ ] 文件树可展开/折叠，点击文件可载入编辑器。
- [ ] 打开非 UTF-8 文件（如 GB18030、Shift_JIS）时自动检测编码并正确显示。
- [ ] JSON/XML/SQL 格式化功能可用。
- [ ] Base64/URL/Hex/MD5 文本转换功能可用。
- [ ] 对比 diff 功能可用。
- [ ] Markdown 预览（Ctrl+Shift+M）可用。
- [ ] 编辑历史可回溯，最近打开列表和收藏功能可用。
- [ ] 自动保存功能可用。
- [ ] 主题切换（Notion/Regular）可用。
- [ ] 拖拽文件到窗口可打开，Ctrl+滚轮可缩放字号。

## AI 与后端功能移除
- [ ] 界面无 AI 对话面板、无 Pet 看板娘、无右键 AI 菜单项。
- [ ] 无剪藏弹窗（clipModal）、无分类下拉、无启动遮罩。
- [ ] 运行期间无任何 `fetch(API_BASE_URL...)` 调用。
- [ ] 不引用 `editor-ai-chat-core.js`。
- [ ] 无 update-manager、无后端进程管理、无端口清理、无 JRE 探测逻辑。

## 启动完整版
- [ ] 开发模式（`!app.isPackaged`）下自动探测上级目录完整版，通过 `electron ..` 启动，不弹窗。
- [ ] 打包模式下按平台标准路径探测完整版可执行文件。
- [ ] 自动探测均失败时弹出原生文件对话框选择 exe/app。
- [ ] 手动选择的路径保存到 `lite-config.json`，之后一键启动不再询问。
- [ ] 工具栏"启动完整版"按钮可触发启动。
- [ ] `Ctrl+Shift+O` 快捷键可触发启动。
- [ ] 托盘菜单"启动完整版"项可触发启动。
- [ ] 启动失败时显示 toast 提示并引导重新选择路径。
- [ ] 不检测完整版是否已运行，直接尝试启动。

## 本地笔记
- [ ] 工具栏"笔记"按钮可打开笔记列表面板。
- [ ] "新笔记"按钮在 `{userData}/notes/` 下创建时间戳文件名文件并进入编辑。
- [ ] 笔记列表展示文件名和修改时间，按时间倒序。
- [ ] 点击列表项将笔记内容载入编辑器。
- [ ] 编辑笔记后自动保存到 notes/ 目录，不覆盖用户原始文件。
- [ ] 重新打开笔记列表后内容完整不丢失。

## 全局快捷键与托盘
- [ ] `Alt+X` 全局快捷键可切换窗口显示/隐藏（前台→隐藏，隐藏/后台→前台聚焦）。
- [ ] 窗口隐藏状态下 `Alt+X` 仍可唤起。
- [ ] 托盘图标显示，右键菜单包含"显示窗口"、"启动完整版"、"退出"三项。
- [ ] 托盘菜单各项功能正常执行。
- [ ] `Alt+X` 不与系统其他全局快捷键冲突。

## 离线运行
- [ ] 断开网络连接时 Lite 版可正常启动和使用。
- [ ] 不创建任何 Java 进程，不占用 8080 或 3000 端口。
- [ ] 不读写完整版业务 JSON 数据。
- [ ] 不发起任何 HTTP/HTTPS 网络请求。

## 秒开启动
- [ ] 启动时无遮罩等待，编辑器页面直接展示。
- [ ] 用户启动后可立即开始操作，无延迟。

## 复制文件零改动验证
- [ ] `editor-file-service.js` 与原文件一致（0 行改动）。
- [ ] `editor-core.js` 与原文件一致（0 行改动）。
- [ ] `logger.js` 与原文件一致（0 行改动）。
- [ ] `editor.css`、`design-tokens.css`、`theme-notion.css`、`theme-regular.css` 与原文件一致（0 行改动）。
- [ ] `libs/` 目录文件与原项目一致，ACE worker 路径可正确加载。

## 回归与质量
- [ ] 所有 .js 文件语法检查通过（`node -c`）。
- [ ] 桌面模式冒烟测试通过（启动→编辑→保存→笔记→启动完整版→全局快捷键→托盘菜单）。
- [ ] electron-builder 打包成功，产出的 exe 可正常启动。
- [ ] 打包后完整版探测（标准路径 + 手动兜底）均正常工作。
- [ ] 完整版 `electron/`、`frontend/`、`backend/` 现有代码未被修改。
