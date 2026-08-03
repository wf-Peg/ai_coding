# 剪藏 Lite Spec

## Why

完整版 CutShelter 依赖 Spring Boot (Java) 后端进程，启动需数秒等待后端就绪，运行时占用较大（含 JRE 约 250MB+）。用户需要一个完全离线、秒开秒用的轻量文本编辑器，保留编辑器核心能力（多标签、编码处理、格式化、diff、Markdown 预览等），移除所有后端和 AI 功能，同时支持一键唤起完整版处理需要后端能力的场景。

Lite 版的目标不是替代完整版，而是提供低成本的日常文本编辑入口，完整版作为按需启动的补充能力。通过代码复制而非共享运行时依赖的方式，降低开发 token 消耗，同时保证 Lite 版构建独立性。

## What Changes

- 新建 `lite/` 子目录，包含完全独立的 `package.json`、Electron 主进程、preload 和前端文件。
- 复制现有编辑器模块核心文件（editor-core.js、editor-file-service.js、editor.css、design-tokens.css、主题文件、页面实际加载的 libs 文件、logger.js），保持原样零改动。
- 复制 `editor.html` 和 `editor.js` 后精简，移除 AI 对话面板、Pet 看板娘、剪藏弹窗（clipModal）、右键 AI 菜单、所有 `fetch(API_BASE_URL...)` 调用和启动遮罩。
- 新增极简主进程 `main.js`（约 250 行），仅包含窗口创建、托盘、全局快捷键和 IPC，不管理后端进程。
- 将 `{userData}/notes/` 作为默认本地工作区，复用文件树、新建、另存为和自动保存，不新增笔记服务或笔记列表 UI；通过一个只读 workspace IPC 将目录传给文件树。
- 在 `main.js` 内直接维护唯一配置项 `fullVersionPath`，不新增配置服务文件。
- 新增"启动完整版"功能，通过自动探测（开发模式 + 打包模式）和手动兜底选择实现跨实例启动。
- 新增全局快捷键 `Alt+X`（显示/隐藏窗口）和编辑器内快捷键 `Ctrl+Shift+O`（启动完整版）。
- 新增本地笔记入口：启动时准备 `notes/` 工作区，普通 `.txt/.md` 文件即为笔记。
- 不修改完整版 `electron/`、`frontend/`、`backend/` 中的任何现有代码。

## Impact

- **Affected directories**: `lite/`（全部新建），不修改 `electron/`、`frontend/`、`backend/` 现有文件。
- **Affected specs**: 编辑器模块（复制精简，非修改原文件）、Electron 主进程（重新编写精简版）。
- **Dependencies**: `lite/package.json` 独立管理依赖，运行时仅 `iconv-lite` + `chardet`；Electron 与 electron-builder 放在 `devDependencies`，与完整版 `package.json` 无关联。
- **Build**: `lite/` 自带 electron-builder 配置，可独立打包为可分发 exe。
- **Runtime**: 不启动 Java 后端进程，不占用 8080/3000 端口，不读写完整版业务 JSON 数据。

## ADDED Requirements

### Requirement: 独立构建与依赖隔离

系统 SHALL 在 `lite/` 目录下维护完全独立的 `package.json`，不依赖或引用完整版 `package.json` 的任何依赖项；`lite/` 的运行时依赖 SHALL 仅包含 `electron`、`iconv-lite` 和 `chardet`。

#### Scenario: 独立安装依赖
- **WHEN** 在 `lite/` 目录执行 `npm install`
- **THEN** 业务运行时仅使用 iconv-lite、chardet；Electron/electron-builder 只作为开发和打包依赖，不安装 sharp、node-notifier、js-yaml、serve-static 等完整版专属依赖

#### Scenario: 独立打包
- **WHEN** 在 `lite/` 目录执行 electron-builder 打包
- **THEN** 产出的可分发包不包含 Java 运行时、后端 JAR 或完整版前端资源

### Requirement: 离线运行

系统 SHALL 在无网络连接、无后端进程、无数据库的环境下完整运行；系统 SHALL NOT 发起任何 HTTP/HTTPS 网络请求，SHALL NOT 启动任何子进程管理 Java 后端。

#### Scenario: 完全离线启动
- **WHEN** 断开网络连接且完整版后端未运行时启动 Lite 版
- **THEN** 编辑器正常打开，文件读写、格式化、编码转换、diff、Markdown 预览等功能全部可用

#### Scenario: 无后端进程
- **WHEN** Lite 版启动
- **THEN** 不创建任何 Java 进程，不占用 8080 或 3000 端口，不读写完整版业务 JSON 数据

### Requirement: 编辑器核心能力保留

系统 SHALL 完整保留以下编辑器能力，通过复制现有代码实现而非共享依赖：ACE 编辑器、多标签页、文件树、编码检测与转换（UTF-8/GB18030/Shift_JIS/UTF-16 等）、格式化（JSON/XML/SQL）、文本转换（Base64/URL/Hex/MD5 等）、对比 diff、Markdown 预览、编辑历史、最近打开、收藏、自动保存、主题切换、拖拽打开、滚轮缩放、快捷键体系。

#### Scenario: 多标签编辑
- **WHEN** 用户打开多个文件
- **THEN** 每个文件在独立标签页中打开，可切换、关闭，各标签保持独立的编辑器和撤销历史

#### Scenario: 编码检测与转换
- **WHEN** 用户打开非 UTF-8 编码的文件
- **THEN** 系统自动检测编码并正确显示，用户可手动切换编码重新解码

#### Scenario: 格式化与文本转换
- **WHEN** 用户对 JSON/XML/SQL 内容执行格式化或对文本执行 Base64/URL/Hex/MD5 转换
- **THEN** 操作在本地完成，不依赖任何后端或网络服务

### Requirement: AI 与后端功能移除

系统 SHALL NOT 包含以下功能：AI 对话面板、Pet 看板娘、右键 AI 菜单（aiSearch/smartIngest/aiImportPassword）、剪藏弹窗（clipModal）、分类下拉、启动遮罩、update-manager、后端进程管理、端口清理、JRE 探测。

#### Scenario: 无 AI 相关 UI
- **WHEN** 用户打开 Lite 版编辑器
- **THEN** 界面上不存在 AI 对话入口、看板娘、右键 AI 菜单项或剪藏弹窗

#### Scenario: 无后端依赖调用
- **WHEN** 系统运行期间
- **THEN** 不发起任何 `fetch(API_BASE_URL...)` 调用，不引用 `editor-ai-chat-core.js`

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

## MODIFIED Requirements

无。Lite 版为全新独立子项目，不修改完整版现有任何功能或接口。

## REMOVED Requirements

无。Lite 版不继承完整版的后端、AI、剪藏存储、专题、待办、Git、邮件等功能需求。
