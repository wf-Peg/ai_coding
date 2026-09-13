# 编辑器模块对标 IDEA 深度分析与 Acejump 评估分期方案

> 生成时间：2026-09-13
> 用户决策（经 AskUserQuestion 确认）：
> - 交付物：**深度分析 + 分期实施计划**（分析先行，按优先级分期执行）
> - Acejump：**本期仅评估，不实现**（评估结论 + 推荐方案纳入计划，排入后续可选阶段）
> - 对标优先级：**导航效率 > 代码智能 > 性能**
> - **追加约束（用户反馈）：小心改动，不允许影响现有功能。所有改造默认不改动现有行为，新功能 opt-in 启用，改动面最小化，并逐项提供回退方案。**

---

## 〇、总体风险控制与兼容性保障（先行原则，所有阶段强制执行）

**核心原则：新增不改旧，默认不变化，坏了能回退。**

1. **默认行为零变更**：任何新功能（命令面板增强、多光标、面包屑、大纲跳转、语言模式、补全、降级策略等）在未启用前，必须与现状 100% 一致。
   - 新功能一律 `opt-in`（默认关闭或默认沿用旧逻辑）；
   - 旧逻辑路径保持原样，只在「开启新功能」时走新分支；
   - 禁止重构 `createEditor` 的既有选项值（字体、缩进、滚动、worker 等默认值一个都不改）。
2. **最小改动面**：优先「新增独立文件 / 新增独立函数 / 新增 DOM 元素」，而不是修改现有代码段；必须修改现有函数时，用「前置守卫 + 新分支」而非改写原逻辑主体。
3. **每期独立回退**：每一期及其子项都是独立 commit；新功能用配置开关（`localStorage` 或 `EditorShortcuts` 元数据）包裹，可在不改代码的情况下关掉复位。回退 = 关开关或 revert 单个 commit。
4. **两阶段验证**：浏览器直启（`frontend/server.js`）与 Electron 桌面各跑一遍回归清单（见第八节），重点回归 iframe/postMessage 契约、多标签快照、对比视图、AI 对话、自动保存、编码转换、剪藏/存知识库链路。
5. **加载顺序禁忌**：新增 `<script>` 只能追加在现有脚本清单末尾（editor.html#L835-865 之后的位置），不得插入中间改变现有初始化顺序；`bridgeAceGlobals` 桥接逻辑（editor.html#L846-854）不可触碰。
6. **不整包替换 ACE**：所有语言模式/补全能力均「按需补齐单文件」，禁止整体替换 `frontend/libs/ace/` 目录，防止破坏现有 `ace.require` 与全局桥接。

以下每期清单中的每一项都标注「影响面」与「回退方式」。

---

## 一、摘要

编辑器模块（`frontend/editor.html` + `frontend/js/editor.js`等）已具备多标签、文件树、双链、大纲、标签、反链、对比、Markdown 预览、AI Pet/对话、词典翻译等丰富能力，但存在三类核心问题：

1. **导航效率**：命令面板为简单名称过滤、算法式大纲零散不统一、无面包屑、无多光标显式体验、无近期位置跳转。
2. **代码智能**：ACE 为定制精简构建，仅内置 5 种语法模式（text/markdown/json/xml/sql），无 JS/Python/YAML/CSS/HTML 等；自动补全仅依赖基础 completer；括号配对行为未覆盖所有模式。
3. **性能**：`editor.js` 为 7632 行单文件 IIFE；自动保存每 10s 全量往返、编辑器缓存 30s 全量、工作区 60s 全量；标签栏/大纲/命令面板每次全量重建 DOM；大文件（上限 20MB）全量解码渲染。

本方案按「导航效率 → 代码智能 → 性能 → 远期架构」四期给出具体改造清单（每项含文件、做法、衡量的验证方式），并对 Acejump 输入项给出可行性评估与推荐实现设计。

---

## 二、现状分析

### 2.1 架构总览

- 入口：[frontend/editor.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/editor.html)（工具栏/标签栏/状态栏/各面板/右键菜单/命令面板/快捷打开）。
- 主逻辑：[frontend/js/editor.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/editor.js)（7632 行，单 IIFE，模块级变量 + `elements` DOM 映射 + `tabs`/`state`/`sharedState`）。
- 辅助模块：`editor-core.js`（格式化/编解码/MD5）、`editor-shortcuts.js`（可配置快捷键 + 捕获阶段分发）、`editor-ai-chat-core.js`（AI 会话状态）、`dict-offline.js`（离线词典）、`media-render/uploader.js`。
- 样式：[frontend/styles/editor.css](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/editor.css)（101KB）+ [design-tokens.css](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/design-tokens.css) 的 `--app-editor-*` token。
- 宿主：`editor.html` 以 iframe 嵌入 [frontend/index.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/index.html#L1000-L1001)，通过 `postMessage` 与父页通信（`editorReady`/`editor-shortcuts-changed` 等）。
- 桌面文件能力：`electron/main.js` IPC + [electron/editor-file-service.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/editor-file-service.js)（20MB 上限、token 能力模型、编码检测/转换、mtime 冲突检测）。

### 2.2 已具备能力清单（按对标维度归类）

| 维度 | 已有能力 |
|---|---|
| 编辑 | 多标签（快照含光标/滚动/语言/换行）、自动换行、缩进配置、字号缩放、编码读写/转换、行尾符、自动保存、智能格式化（JSON/XML/SQL 自动识别） |
| 导航 | 文件树、大纲、标签、双链反链/出链、对比视图、跳转行(Ctrl+G)、快速打开(Ctrl+Shift+O)、命令面板(Ctrl+P/K)、最近/收藏/历史 |
| 搜索替换 | Ctrl+F/Ctrl+R(Ctrl+H 已改)、选中词跨编辑器同步高亮、diff 上一处/下一处导航 |
| 文件 | 另存为、导出 MD/Word/PDF、保存到剪藏、保存到知识库、模板系统、常见文件收藏 |
| AI | Pet 快捷操作、AI 对话+上下文注入、AI 差异审批、智能入库、AI 识别导入密码 |
| 词典 | 离线翻译、自定义映射、词典库、词典自动补全 completer |
| 快捷键体系 | `EditorShortcuts`（10 个功能 action 可配置 + 捕获分发）、命令面板注册、快捷键速查表 |

### 2.3 关键技术债 / 风险点（含位置）

1. **单文件巨石**：[frontend/js/editor.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/editor.js) 7632 行，功能全部依赖模块级变量与隐式顺序，难单测、改一处可能影响他处。
2. **ACE 定制精简构建**：[frontend/libs/ace/](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/libs/ace) 为压缩定制包（473KB），内置模块经核实含：`multi_select`、`edit_session/folding`、`ext/error_marker`、`search`、`tokenizer`、`editor`、`virtual_renderer`、`layer/marker`（`addDynamicMarker` 存在）、坐标换算 `documentToScreenRow`/`screenToDocumentPosition` 齐全；但**缺少**：
   - 语言模式：无 javascript/python/yaml/java/css/html 等（`mode-*.js` 仅 5 个）；
   - 扩展：无 `ext-vim`、`ext-whitespace`、`ext-statusbar`、`ext-minimap`；
   - 自动补全核心 `ace/autocomplete`/`ace/snippets` 未在 `ace.js` 内定义（`ext-language_tools.js` 内部对 autocomplete 有引用，需验证是否自包含，见 4.2 风险）；
   - 主题仅 textmate / tomorrow_night 两种。
3. **全量性能热点**：
   - `renderTabBar`（editor.js#L537）：每次标签变更重建全部 tab DOM；
   - `renderMarkdownPreview`（#L1312）：整篇 `innerHTML` 重渲染；
   - 自动保存（#L4607-4712，10s 全量 `getValue`→IPC→全量写盘）；
   - `saveEditorCache`（#L4749，30s 全量）、`saveWorkspace`（#L5062，60s 全量）；
   - `renderCommandList`（#L7182）/快捷打开：每次开启重建列表 DOM，无模糊匹配、无最近优先。
4. **文件加载链路**：[editor-file-service.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/editor-file-service.js#L14) 上限 20MB，`openPath` 同步读全量 Buffer → 解码 → `setValue` 全量渲染；大文件无降级策略（超 5MB 时建议自动关 highlight/worker/自动换行）。
5. **快捷键抢占已注意**：`Ctrl+R` 已被全局 keydown preventDefault（editor.js#L4500-4505），替换已改为 Ctrl+R；新增导航类快捷键需避开已在 `EditorShortcuts.DEFAULTS` 与 `registerCommand` 中占用的组合。

---

## 三、对标 IDEA 差距分析（gap 概览）

| IDEA 能力 | 现状 | 差距等级 |
|---|---|---|
| 字母跳跃 AceJump | 无 | 高（用户点名） |
| 面包屑（路径分级导航） | 无，仅文档标题 | 中 |
| 命令面板模糊匹配 + 最近优先 | 简单 indexOf 过滤 | 中 |
| 多光标（Alt+Click/多选） | `multi_select` 模块在内但未显式启用/引导 | 中 |
| 近期编辑位置记忆（跳回上次光标） | 仅标签内快照 | 中 |
| 语法高亮语言覆盖 | 仅 5 种 | 高 |
| 自动补全（关键字/符号/词典） | 基础 completer + 词典，需验证完整性 | 中 |
| 括号配对/自动闭合 | behaviour 模块可用，未对非 cstyle 模式启用 | 中 |
| 错误标注（worker） | json/xml worker 在，未统一接入界面标注 | 低-中 |
| 代码折叠 | 折叠模块在内，未显式启用 UI/快捷键 | 低 |
| 大纲结构化 + 点击跳转 | 有 outline pane | 低 |
| 大文件性能 | 20MB 上限、全量链路、无降级 | 高 |
| 自动保存/缓存节流 | 固定间隔全量 | 中 |
| 模块化/可测试性 | 单文件巨石 | 中（远期） |

---

## 四、Acejump 接入评估（本期不实现）

### 4.1 功能定义（对标 JetBrains 插件 acejump）

按快捷键进入「跳跃模式」，编辑器可视区内每个字符/单词上方叠加字母标签；连续键入标签字母即把光标（或选区光标）移动到对应位置；支持 Word 模式、Line 模式、Char 模式；`Esc` 取消。核心是「可视字符 → 屏幕坐标 → 标签覆盖 → 按键过滤」。

### 4.2 本环境可行性结论：**可行，推荐自研轻量实现**

依据（已在 `frontend/libs/ace/ace.js` 中核实）：
- 坐标换算 API 齐全：`documentToScreenRow`、`screenToDocumentPosition` 存在；
- 叠加渲染：`layer/marker` 与 `addDynamicMarker` 存在，可在 `renderer.$textLayer` 之上叠加文本标签（或直接在编辑器容器上盖一层绝对定位的覆盖 DOM）；
- 命令体系：可通过 `mainEditor.commands.addCommand` + `setKeyboardHandler` 或捕获阶段 keydown 进入/退出跳跃模式；
- 主题统一：标签色/背景可直接引用 `design-tokens.css` 的 `--app-*` 变量，深浅色自动适配（项目已有 `data-theme` 机制）。

实现路径（推荐新增独立文件 `frontend/js/ace-jump.js`，约 300-500 行，不依赖额外构建）：
1. 注册命令（如 `Ctrl+;`，可选 via `EditorShortcuts` 可配置），进入跳跃模式；
2. 遍历 `session.firstRow..lastRow` 可视行，对每行：取可见列区间（扣除 gutter 宽），用 `documentToScreenRow` + `$characterSize`（或 renderer 字符宽度度量）计算每个可视字符的屏幕坐标；过滤空白/控制字符；生成「候选字符 → 屏幕位置」map；
3. 渲染：在编辑器容器上创建覆盖层 `<div>`，为每个候选字符绝对定位一个标签（Word/Char 两种模式；首层标签用 26 字母 a-z，候选超 26 时两层：先字母分组、再字母定位）；
4. 键盘捕获：跳跃模式下接管 keydown（做 `e.isComposing` 过滤避免与 IME 冲突），逐键缩小候选集；唯一命中或标签输入完即 `navigateTo` 移动光标/选区并退出；`Esc`/点击空白取消；
5. 滚动/窗口 resize 时重建或取消跳跃模式（监听 `scroll`/`resize`）。

**风险与规避**：
- 全角/CJK 字符宽度：用 renderer 的字符度量而非固定值；
- 软换行（wrap）下屏幕行 ≠ 文档行：改用 `screenToDocumentPosition` 反向换算回文档坐标；
- 与既有快捷键冲突：触发键默认 `Ctrl+;`（当前未被占用，见 editor-shortcuts.js#L26-37 与 registerCommand 清单），且纳入 `EditorShortcuts` 可配置；
- ACE 定制构建无现成 ext：因此**不自研扩展文件外接**，直接作为页面脚本按 `editor.html` 现有 `<script>` 顺序引入即可，零构建成本。

### 4.3 推荐结论

Acejump 可低成本落地（独立新文件 + 少量 HTML 引入 + 命令注册），且与项目「无前端构建链、直接 `<script>`」的约定一致。**建议作为第二阶段（导航效率）末的独立增量实现**，本计划将其列为「待用户拍板的后置任务」，不纳入本期执行范围。

---

## 五、分期实施计划

### Phase 1 — 导航效率（优先，本期执行）

目标：在不改动架构的前提下，把「找得到、跳得快」做齐，每项独立可交付。**本节所有新增交互默认 off，全部可开关回退。**

1. **命令面板增强**（[editor.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/editor.js#L7182)）
   - 模糊匹配：新增独立 `fuzzyMatch(query, name)` + 排序函数，**只影响新增的过滤路径**；原有 `renderCommandList` 的 indexOf 逻辑保留为开关关闭时默认路径；
   - 记录并持久化命令使用次数（新增 `recordCommandUsage(id)` + localStorage 键，不涉及现有存储键）；
   - 扩充注册命令（见后续各项），统一走现有 `registerCommand`。
   - 影响面：仅 `renderCommandList`/`executeCommand` 内新增一个开关分支；不开关时输出与现状逐字节一致。
   - 回退：`localStorage['editor_cmd_palette_v1']=0` 或 revert 该 commit。
2. **多光标显式启用 + 状态栏提示**（editor.js#L353 `createEditor`，**不改 createEditor 参数**）
   - 不修改现有 `createEditor`：新增一个初始化后处理 `enableMultiCursor()` 独立函数，被 `init()` 末尾按开关调用；操作通过 `mainEditor.commands.addCommand` 补充（ACE multi_select 模块已内置）；
   - 状态栏新增「多光标」指示：只在 `selection.ranges.length>1` 时显示，其余情况不渲染，避免 statusbar 布局变化。
   - 影响面：新函数 + 新增命令 + 状态栏条件文本；不开开关 = 现状。
   - 回退：关闭开关；`Alt+Click` 在开关 off 时不绑定（ACE 默认未显式启用的路径原样）。
3. **面包屑导航栏**（editor.html 工具栏下方**新增**一个 `breadcrumbBar` 容器，默认 `hidden`）
   - 新增 `renderBreadcrumb()` 独立函数挂在 `updateDocumentIdentity` 之后由开关触发；
   - `hidden` 时零布局影响（不占位、不参与 grid）；打开开关才显示。
   - 影响面：纯新增 DOM + 函数，不触碰现有工具栏 HTML。
   - 回退：关闭开关（`display:none`）或 revert。
4. **近期编辑位置记忆**（新增独立模块函数）
   - 新增 `editor-history` 状态（localStorage 新键 `editor_pos_history_v1`），复用 `saveActiveTabSnapshot` 已有的 cursor/scroll 快照字段，**不修改 saveActiveTabSnapshot 现有写入**，采用「在新函数里读取快照并记录」；
   - 命令面板新增命令「返回上次编辑位置」，绑定 `Ctrl+-`/`Shift+Ctrl+-`（已确认未占用）。
   - 影响面：纯新增；现有快照逻辑不动。
   - 回退：删除该 localStorage 键即可，不影响现有标签快照。
5. **大纲统一增强**（沿用 outline pane）
   - 在现有 `renderOutline` 的回调上加「点击跳转」监听（现有点击逻辑不删，只增补滚动定位）；大纲项 hover 行号展示为新增元素。
   - 影响面：仅大纲 pane 内部；不开开关与现状一致。
   - 回退：关闭开关。

> 阶段验证：各增量功能手测清单；命令面板 30+ 命令模糊匹配可用；多光标 Alt+Click 可用；面包屑在多标签/对比视图下不遮挡编辑区。**验证时先跑一遍「开关全关=现状」基线，确认与当前版本无差异，再逐个开开关验证。**

### Phase 2 — 代码智能（本期执行）

目标：把「写法上给提示、格式上有支撑」补齐，重点是语言模式覆盖与补全可信度。**所有新增模式均为「语言下拉可选项」的增量，不改变已存在 5 种模式的行为；补全/括号行为默认沿用现状，新能力 opt-in。**

1. **扩充语言模式**（前置：核实/复制 ACE 官方案派文件）
   - 从官方 ace-builds（1.x 对应版本）拷贝缺失 `mode-javascript.js / mode-python.js / mode-yaml.js / mode-css.js / mode-html.js` 及其依赖（`mode-{c_cpp,clojure...}` 按需），放入 `frontend/libs/ace/`，与现有 `ace.config.set('modePath', 'libs/ace')` 自动兼容；
   - **关键约束：只新增文件，绝不覆盖已存在的 `mode-json/xml/sql/markdown/text.js` 与 `theme-*.js`**；新增文件命名不冲突；
   - `editor.html` 的 `languageSelect` 扩为从 `EditorCore` 的静态清单生成：**把新选项追加到现有 `<option>` 之后**，保持现有 5 项顺序不变，已打开文档的语言/模式选择不受影响；
   - 同步补齐深色主题高亮：新增模式仅新增一个中性深色语法主题作为「新增」项，不替换现有 `tomorrow_night`/`textmate` 两主题。
   - 影响面：新增文件 + languageSelect 追加 option；现有 5 模式用户无感知。
   - 回退：从 `languageSelect` 移除新 option（或 revert commit），已存在模式不变。
2. **自动补全完整性验证与增强**
   - 第一步**只验证不改造**：输入 `con` 观察是否出现关键字/代码段补全，判断定制构建的 `ace/ext/language_tools` 是否自包含；若缺失 `ace/snippets`/`ace/autocomplete` 核心，按需补对应构建文件（**新增文件，不覆盖现有**）；
   - 为 JSON/XML/SQL 增加关键字 completer：在 `registerDictCompleter`（editor.js#L6250）**之后**追加一个独立 `registerKeywordCompleter()`，通过 `mainEditor.completers.push` 注入，不修改现有 completer 逻辑；
   - 影响面：仅补全候选集扩展；不开开关 = 现状补全行为。
   - 回退：移除新 completer 注册即可。
3. **括号配对 / 自动闭合 / 环绕**
   - 对新增模式启用 `setBehavioursEnabled(true)` + 括号匹配高亮；**现有 json/xml/sql 模式行为不变**；
   - 新增命令「包裹选区」（`wrapSelectionWith(char)`）注册到命令面板，为 opt-in 命令。
   - 影响面：新模式 + 新命令；原模式原样。
   - 回退：关闭命令注册。
4. **worker 错误标注小入口**（低优先级，放本期末尾）
   - JSON/XML worker 报错 → 行号 gutter 红点 + 状态栏错误计数 + 点击跳转（复用 `ext/error_marker`）。实现为**新增函数**，挂在现有 worker 事件回调之后，不重写现有回调。
   - 影响面：仅 JSON/XML 模式在报错时新增 UI；正常编辑无感知。
   - 回退：关闭开关。

> 阶段验证：语言下拉 ≥10 种（原有 5 种顺序与行为不变）；JS/JSON 输入关键字能出补全；括号自动闭合可用；JSON 坏文件 gutter 出现行级错误标注。**基线先验证「未新增模式下原 5 模式高亮与补全无回归」。**

### Phase 3 — 性能（本期执行）

目标：大文件不卡死、高写入不发热、不因重绘掉帧。全部为行为改造，不动 API。**性能项全部做成「阈值触发 + 可开关」，小文件（≤2MB）场景行为与现状完全一致。**

1. **大文件降级策略**（editor.js `createEditor`/`setEditorContent` + editor-file-service.js#L14）
   - 阈值：文件 >2MB 关闭实时高亮与 worker（`useWorker:false`，降级为纯文本/按需异步）；>5MB 额外关闭自动换行与选中词同步。**阈值与开关双条件：文件 ≤2MB 时即使开了开关也走原逻辑**；
   - 打开超大文件时 toast 提示「已进入轻量模式」；
   - **禁止修改 `createEditor` 默认值**：降级逻辑为打开文件后（`setEditorContent` 内按 size 分支）临时切换 session 选项，保存/重开小文件时逐项恢复默认值。
   - 影响面：仅超大文件走新分支；≤2MB 文件零变化。
   - 回退：关闭开关即恢复全量高亮/worker（大文件可能慢但行为与旧版一致）。
2. **自动保存/缓存节流**
   - 自动保存：从固定 10s 改为「内容脏标记 + 停止输入 2s 防抖」（保留 `document blur` 立即保存）。**保留 `triggerAutosave` 函数名与写入语义不变量**，仅改调度器（`startAutosave`/`triggerAutosave` 的触发方式），保存动作本身不动；
   - `saveEditorCache`/`saveWorkspace`：仅在有变更时执行；**保留原函数逻辑**，外层包一层变更判断。
   - 影响面：防抖后保存时机变化，但保存动作、写入格式、IPC 参数完全一致；未提供开关时通过「保存间隔改大但语义不变量」控制风险。
   - 回退：`AUTOSAVE_DEBOUNCE_V1=0` 回落到原 10s 固定间隔。
3. **标签栏 / Markdown 预览增量渲染**
   - `renderTabBar`：改为局部更新——**新增 `renderTabBarIncremental()` 与原 `renderTabBar()` 共存**，开关开启时调用新函数，关闭时仍调用原函数；新函数对 `data-tab-index` 打标记复用 DOM；
   - `renderMarkdownPreview`：保留现有防抖（editor.js#L1307），追加「内容 hash 变化才重写 innerHTML」判断（`prevHash!==newHash`）。
   - 影响面：开关 off = 原 `renderTabBar` 原样；预览仅在内容实际变化时重绘。
   - 回退：关闭增量开关。
4. **列表渲染优化**：命令面板/快捷打开/大纲列表改为 `DocumentFragment` 批量构造 + 限制展示条数（如 50），高频过滤用 requestAnimationFrame 节流。**改造只优化渲染路径，过滤结果/排序/高亮逻辑保持开关 off 时原样。**
5. **验证基线**：打开 20MB 大文件不再白屏卡死；连续输入自动保存不阻塞主线程；切换 10 个标签无持续掉帧。**验证顺序：先跑「≤2MB 文件全功能无回归」基线，再跑大文件场景。**

### Phase 4 — 远期架构（后置，需另行立项）

1. `editor.js` 拆分：按域拆为 `editor-tabs.js / editor-nav.js / editor-ai.js / editor-file.js / editor-diff.js`，保持同一 IIFE 命名空间逐步迁移（**每个函数迁移必须单 commit + 该函数行为无差异验证后才移下一个**，避免一次性大改动回归）；
2. 新增功能统一走 `registerCommand` + `EditorShortcuts` 元数据表，快捷键冲突在保存时静态校验（`editor-shortcuts.js` 已有 `findConflicts`，接入设置面板 UI）；
3. 可测试性：为纯逻辑（面包屑、命令模糊匹配、AceJump 命中算法）补 `node` 单元测试（参考现有 [electron/editor-shortcuts.test.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/editor-shortcuts.test.js)）。

---

## 六、实施顺序与依赖

1. **Phase 1（导航效率）** 优先，事项间无强依赖，可并行小步提交。
2. **Phase 2（代码智能）** 依赖 Phase 1 的命令面板框架（补全新命令入口）；新 mode 文件为纯资源复制，可先行落地验证。
3. **Phase 3（性能）** 与大文件相关项依赖 Phase 2 的 worker 控制代码；其余独立。
4. **Phase 4** 需在 1-3 稳定后立项，不与前三期混提。

**执行纪律（保证"不影响现有功能"）：**
- **功能开关先行**：每期第一个 commit 先落一个全局开关注册 + 默认值（全部 off / 全走旧路径），此后每个子功能 commit 都只动「开关 on 的分支」；
- **提交粒度**：单项一 commit，禁止跨项混提；commit 内新增文件与修改现有文件的 diff 分开陈述（见现有 `commit_history.log` 习惯）；
- **每次提交后立即双端冒烟**（浏览器 + Electron）：跑第八节的「现状基线」子集（标签切换/保存/对比/剪藏/编码），确认开关全关时与提交前零差异，再合入下一项；
- **禁止触碰项清单（无论何时都不可改）**：`createEditor` 默认选项值、`bridgeAceGlobals` 桥接、`editor.html` 现有 `<script>` 顺序（新增只能追加末尾）、`editor-file-service.js` 的 token 能力模型与 20MB 上限校验、`EditorShortcuts.DEFAULTS` 已占用的 10 个 action 键位、`tabs`/`state`/`saveActiveTabSnapshot` 既有状态字段语义。

---

## 七、假设与决策记录

- 不引入前端构建链（保持现有 `<script>` + 静态资源方式），新增 `.js` 直接引用，且**只能追加在现有脚本清单末尾**；
- ACE 保持定制精简构建，不整体替换为官方完整包（避免破坏现有 `bridgeAceGlobals` 与 `editor.html` 加载顺序），需要的能力按需补文件；
- Acejump：本期仅评估，实现排入后置（建议 `Ctrl+;` 触发，进入 `EditorShortcuts` 可配置体系）；
- 快捷键新增统一避免占用：现有占用见 `EditorShortcuts.DEFAULTS`（editor-shortcuts.js#L26-37）与 `registerCommand` 清单（editor.js#L7144-7157）；
- 界面文案/注释/提交信息保持中文项目惯例；
- **所有新功能默认关（opt-in），经双端冒烟确认"开关全关=现状"后才允许合入；不允许"顺手改"现有行为。**

---

## 八、验证清单（总）

**0 号基线（每期必跑，证明未影响现有功能）**
- 开关全关状态下：多标签新建/切换/关闭、自动保存、对比视图、Markdown 预览、格式化、编码转换（GB18030/UTF-16）、存剪藏、存知识库、AI 对话上下文——与改造前逐一手测一致，无控制台报错。

**1 号验证（功能有效性）**
- 每期新增功能按各 Phase 内的「阶段验证」清单手测通过。

**2 号验证（回归重点）**
- 多标签快照恢复、对比视图、AI 对话上下文、自动保存、编码转换（GB18030/UTF-16）、剪藏/存知识库链路；
- 快捷键回归：`Ctrl+F`、`Ctrl+R`（已改替换）、`Ctrl+G`、`Ctrl+Shift+O`、命令面板/快捷打开、深浅色主题下新 UI 可读性；
- iframe/postMessage 契约：`editorReady`、`editor-shortcuts-changed`、父页切视图/开文件链路不受影响。

**3 号验证（性能抽测）**
- 20MB 大文件打开时长、连续键入帧率、标签频繁切换稳定性；≤2MB 文件全功能无回归。

**4 号验证（双端）**
- 浏览器直启（`frontend/server.js`）与 Electron 桌面各过一遍，参考项目既有双端验收习惯。