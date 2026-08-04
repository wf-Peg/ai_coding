# 剪藏 Lite Spec

## Why
完整版 CutShelter 依赖 Spring Boot (Java) 后端进程，启动需数秒等待后端就绪，运行时占用较大（含 JRE 约 250MB+）。用户需要一个完全离线、秒开秒用的轻量文本编辑器，保留编辑器核心能力（多标签、编码处理、格式化、diff、Markdown 预览等），并保留 AI 对话能力（直接前端 fetch LLM API，无后端转发），同时在不依赖完整版的前提下提供"启动完整版"入口处理需要后端能力的场景（如智能入库、密码识别、剪藏存储）。

Lite 版的目标不是替代完整版，而是提供低成本的日常文本编辑 + AI 对话入口，完整版作为按需启动的补充能力。通过代码复制而非共享运行时依赖的方式，降低开发 token 消耗，同时保证 Lite 版构建独立性。

## What Changes
- 新建 `lite/` 子目录，包含完全独立的 `package.json`、Electron 主进程、preload 和前端文件。
- 复制现有编辑器模块核心文件（editor-core.js、editor-file-service.js、editor.css、design-tokens.css、主题文件、页面实际加载的 libs 文件、logger.js），保持原样零改动。
- 复制 `editor.html` 和 `editor.js` 后精简，移除剪藏弹窗（clipModal）、分类下拉、启动遮罩、`fetch(API_BASE_URL...)` 调用、`update-manager`、后端进程管理、端口清理、JRE 探测。
- **保留 AI 对话面板**：保留 Pet 看板娘按钮、AI 对话面板、右键 AI 菜单（aiSearch/smartIngest/aiImportPassword）；AI 调用改为 Lite 前端直接 fetch LLM API（DeepSeek / DashScope），不再走完整版后端 `/api/ai/chat`。
- **双 Provider 路由**：保留 DeepSeek + DashScope 切换能力，Lite 前端内置 Provider 路由表（与完整版 RoutingLlmProvider 前端等价物），运行时动态选择当前激活 Provider。
- **保留"剪藏"相关 AI 菜单项**：智能入库 / 密码识别（需要完整版后端）的菜单项保留但默认禁用；当 Lite 检测到完整版路径且点击时通过 spawn 启动完整版后引导，不要在后端未启动时静默失败。
- **保留 AI 对话面板与 Pet 看板娘**前端代码链路完整（复制 `editor-ai-chat-core.js` 核心 SSE 解析和消息状态机，但 provider fetch 改为调用 LLM 厂商直连 URL）。
- **Lite UI 内的轻量配置面板**：新增与 AI 相关的 minimal 设置面板（API Key、provider 选择、preset），通过 Lite `main.js` 持久化到 `{userData}/lite-config.json`（增加 `aiConfig` 字段：activeProvider、deepseekApiKey、dashscopeApiKey、deepseekModel、dashscopeModel）。
- 新增极简主进程 `main.js`（约 250 行），仅包含窗口创建、托盘、全局快捷键、文件 IPC、AI 配置 IPC 和完整版启动逻辑，不管理后端进程。
- 通过只读 workspace IPC 将启动时准备的 `{userData}/notes/` 目录传给文件树，复用文件树、新建、另存为和自动保存，不新增笔记服务或笔记列表 UI。
- 新增"启动完整版"功能，通过自动探测（开发模式 + 打包模式）和手动兜底选择实现跨实例启动。
- 新增全局快捷键 `Alt+X`（显示/隐藏窗口）和编辑器内快捷键 `Ctrl+Shift+O`（启动完整版）。
- 新增本地笔记入口：启动时准备 `notes/` 工作区，普通 `.txt/.md` 文件即为笔记。
- 不修改完整版 `electron/`、`frontend/`、`backend/` 中的任何现有代码。

## Impact
- **Affected directories**: `lite/`（全部新建），不修改 `electron/`、`frontend/`、`backend/` 现有文件。
- **Affected specs**: 编辑器模块（复制精简，非修改原文件）、AI 调用链路（不在依赖完整版后端）、Electron 主进程（重新编写精简版）。
- **Dependencies**: `lite/package.json` 独立管理依赖，运行时仅 `iconv-lite` + `chardet`；Electron 与 electron-builder 放在 `devDependencies`，与完整版 `package.json` 无关联。
- **Build**: `lite/` 自带 electron-builder 配置，可独立打包为可分发 exe。
- **Runtime**: 不启动 Java 后端进程，不占用 8080/3000 端口，不读写完整版业务 JSON 数据；AI 调用直接通过 HTTPS 访问 LLM 厂商 endpoint。

## ADDED Requirements

### Requirement: 独立构建与依赖隔离
系统 SHALL 在 `lite/` 目录下维护完全独立的 `package.json`，不依赖或引用完整版 `package.json` 的任何依赖项；`lite/` 的运行时依赖 SHALL 仅包含 `electron`、`iconv-lite` 和 `chardet`。

#### Scenario: 独立安装依赖
- **WHEN** 在 `lite/` 目录执行 `npm install`
- **THEN** 业务运行时仅使用 iconv-lite、chardet；Electron/electron-builder 只作为开发和打包依赖，不安装 sharp、node-notifier、js-yaml、serve-static 等完整版专属依赖

#### Scenario: 独立打包
- **WHEN** 在 `lite/` 目录执行 electron-builder 打包
- **THEN** 产出的可分发包不包含 Java 运行时、后端 JAR 或完整版前端资源

### Requirement: 离线运行（AI 除外）
系统 SHALL 在无网络连接、无后端进程、无数据库的环境下完整运行；系统 SHALL NOT 启动任何子进程管理 Java 后端、不读写完整版业务 JSON 数据。

#### Scenario: 完全离线启动
- **WHEN** 断开网络连接且完整版后端未运行时启动 Lite 版
- **THEN** 编辑器正常打开，文件读写、格式化、编码转换、diff、Markdown 预览等功能全部可用；AI 模块因网络依赖，禁用状态下不发起请求

#### Scenario: 无后端进程
- **WHEN** Lite 版启动
- **THEN** 不创建任何 Java 进程，不占用 8080 或 3000 端口

### Requirement: AI 对话（前端直连 Provider）
系统 SHALL 提供 AI 对话面板，点击 Pet 看板娘按钮唤起；AI 调用 SHALL 直接由 Lite 前端 fetch LLM 厂商 endpoint（DeepSeek: `https://api.deepseek.com/v1/chat/completions`、DashScope: `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`），不走完整版后端。

#### Scenario: DeepSeek 切换与调用
- **WHEN** 用户在 Lite UI 内选择 DeepSeek 并输入 API Key
- **THEN** 后续 AI 对话请求直接 fetch `https://api.deepseek.com/v1/chat/completions`，使用 Bearer Auth，并通过 SSE 流式打印增量到对话面板

#### Scenario: DashScope 切换与调用
- **WHEN** 用户在 Lite UI 内选择 DashScope 并输入 API Key
- **THEN** 后续 AI 对话请求直接 fetch DashScope OpenAI 兼容 endpoint，使用 Bearer Auth，并通过 SSE 流式打印增量

#### Scenario: 运行时切换 Provider
- **WHEN** 用户在 Lite UI 内切换 Provider 但未配置目标 API Key
- **THEN** 发送按钮禁用或弹出提示，且不会发起请求到任何 endpoint

#### Scenario: 流式响应与错误降级
- **WHEN** Provider 返回网络/HTTP 错误
- **THEN** 前端捕获后调用降级 provider（与完整版 RoutingLlmProvider 行为一致的简化前端版），全部失败时显示友好 toast（不再显示 raw `Failed to fetch`）

### Requirement: AI 相关 UI 保留
系统 SHALL 保留 Pet 看板娘按钮、AI 对话面板和右键 AI 菜单（aiSearch / smartIngest / aiImportPassword），SHALL NOT 移除 Pet 资源。

#### Scenario: 右键 AI 菜单渲染
- **WHEN** 用户在编辑器中右键选区
- **THEN** 右键菜单显示 AI 搜索 / 智能入库 / AI 识别导入密码三项

#### Scenario: AI 搜索选中词
- **WHEN** 用户选中一段文本并点击"AI 搜索选中内容"
- **THEN** 触发 AI 对话流，并把"搜索这个词"提示词作为用户消息发送；完成后写入对话面板

#### Scenario: 需要完整版的 AI 菜单项暂停
- **WHEN** Lite 检测到完整版路径但完整版未运行
- **THEN** "智能入库"与"AI 识别导入密码"项点击时通过 spawn 启动完整版并 toast 提示"正在启动完整版后再继续"

### Requirement: Lite UI 配置面板
系统 SHALL 在 Lite 前端提供最小化 AI 设置面板（菜单按钮或工具栏入口），允许配置：activeProvider、DeepSeek API Key、DeepSeek Model、DashScope API Key、DashScope Model。配置 SHALL 持久化到 `{userData}/lite-config.json` 的 `aiConfig` 字段。

#### Scenario: 通过 preload 暴露 AI 配置 IPC
- **WHEN** Lite 启动
- **THEN** `window.liteAPI.ai.getConfig()` / `window.liteAPI.ai.saveConfig(next)` 可用，渲染进程不直接接触 fs

#### Scenario: 配置变更即时生效
- **WHEN** 用户在 Lite UI 内保存 AI 配置
- **THEN** 后续 AI 对话请求立即使用新 Provider/Key，不需重启

### Requirement: 启动完整版
系统 SHALL 提供从 Lite 版启动完整版 CutShelter 的能力，通过工具栏按钮、快捷键 `Ctrl+Shift+O` 和托盘菜单项触发；系统 SHALL 按优先级自动探测完整版路径（开发模式 → 打包模式标准路径 → 手动兜底选择），手动选择的路径 SHALL 持久化保存到配置文件。

#### Scenario: 开发模式自动探测
- **WHEN** Lite 版以非打包模式运行（`!app.isPackaged`）且上级目录存在 `electron/main.js` + `package.json`（name="clip-demo"）
- **THEN** 系统通过 `process.execPath` 加项目根目录参数启动完整版，不依赖 shell PATH 且不弹窗询问

#### Scenario: 打包模式自动探测
- **WHEN** Lite 版以打包模式运行且未手动指定过完整版路径
- **THEN** 系统按平台标准路径（Windows: `%LocalAppData%/CutShelter/CutShelter.exe` 等）探测完整版可执行文件

#### Scenario: 手动兜底选择
- **WHEN** 自动探测均失败
- **THEN** 系统弹出原生文件对话框让用户选择完整版可执行文件，选择后路径保存到配置文件，之后一键启动不再询问

#### Scenario: 启动失败反馈
- **WHEN** 完整版路径不存在或启动失败
- **THEN** 系统显示 toast 提示并引导用户重新选择路径

#### Scenario: 不检测已运行实例
- **WHEN** 完整版可能已在运行
- **THEN** Lite 版不检测完整版进程状态，直接尝试启动，由完整版自身处理多实例

### Requirement: 默认笔记工作区
系统 SHALL 在启动时准备 `{userData}/notes/` 目录并将其作为默认工作区；通过只读 workspace IPC 将目录传给文件树。笔记使用普通 `.txt/.md` 文件，复用现有文件树、新建、另存为、编码和自动保存能力；系统 SHALL NOT 新增笔记服务、笔记列表面板或笔记专用元数据。

#### Scenario: 新建笔记
- **WHEN** 用户在默认工作区执行现有新建/另存为操作
- **THEN** 文件保存到 `{userData}/notes/`，并使用现有编辑器流程进入编辑状态

#### Scenario: 笔记自动保存
- **WHEN** 用户编辑笔记内容
- **THEN** 系统复用现有 autosave 逻辑保存到当前笔记文件，不覆盖其他文件

### Requirement: 全局快捷键
系统 SHALL 注册全局快捷键 `Alt+X` 用于显示/隐藏 Lite 版窗口；系统 SHALL 支持编辑器内快捷键 `Ctrl+Shift+O` 用于启动完整版。

#### Scenario: 全局显示/隐藏
- **WHEN** Lite 版窗口处于任意状态（前台/后台/隐藏）且用户按下 `Alt+X`
- **THEN** 窗口在前台显示与隐藏之间切换

#### Scenario: 快捷键启动完整版
- **WHEN** 用户在编辑器中按下 `Ctrl+Shift+O`
- **THEN** 系统触发完整版启动流程

### Requirement: 托盘图标
系统 SHALL 在系统托盘显示图标，右键菜单包含"显示窗口"、"启动完整版"和"退出"三个选项。

#### Scenario: 托盘菜单操作
- **WHEN** 用户右键托盘图标
- **THEN** 显示"显示窗口"、"启动完整版"、"退出"三个菜单项，点击各执行对应操作

### Requirement: 窗口设计
系统 SHALL 使用标准原生标题栏窗口（不自绘标题栏），默认尺寸 900×640，最小尺寸 600×400，菜单栏默认隐藏（Alt 唤出）。

#### Scenario: 窗口初始化
- **WHEN** Lite 版启动
- **THEN** 创建 900×640 的标准窗口，菜单栏隐藏，多标签编辑区占满窗口

### Requirement: 秒开启动
系统 SHALL 在不等待任何外部服务就绪的情况下直接加载编辑器页面；系统 SHALL NOT 显示启动遮罩或等待后端就绪。

#### Scenario: 快速启动
- **WHEN** 用户启动 Lite 版
- **THEN** 编辑器界面在无遮罩等待的情况下直接展示，用户可立即开始操作

### Requirement: AI 与完整版后端功能移除（与上述 AI 保留项并行）
系统 SHALL 移除剪藏存储、分类、AI 总结、周报、待办、专题、Git、邮件等所有依赖完整版后端的功能；LLM 调用 SHALL NOT 走完整版 `/api/ai/chat`，全部改为前端直连厂商。

#### Scenario: 无剪藏弹窗
- **WHEN** 用户打开 Lite 版编辑器
- **THEN** 工具栏不存在"存入剪藏"按钮，无 clipModal、分类下拉和 submitClipBtn 调用

#### Scenario: 无后端依赖调用
- **WHEN** 系统运行期间
- **THEN** 不发起任何 `fetch(API_BASE_URL...)` 调用；不引用完整版后端 controller / Spring 组件

#### Scenario: 后端进程与配置管理
- **WHEN** Lite 版启动
- **THEN** 不启动 Java 进程、不清理 8081/3000 端口、不探测 JRE、不存在 update-manager

## MODIFIED Requirements
无。Lite 版为全新独立子项目，不修改完整版现有任何功能或接口。

## REMOVED Requirements
- 完整版 `client/modules/clip/` 等所有剪藏存储业务接口（仅就 Lite 版范围而言，完整版代码本身未变动）。
- 完整版后端依赖（Spring Boot、JRE、数据库配置）。
- 完整版 setup / scheduler / update-manager。
