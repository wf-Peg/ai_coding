# 设置模块与写作模块修正计划

## 摘要（Summary）

本次修正覆盖两类共 6 项需求：**设置模块**（剪切板监听可配置、模型注册链接打开浏览器、中转站 apiKey 明文显示、设置窗口重组）与**写作模块**（画布区 Ctrl+K/P 跨平台唤起、双向链接 "/" 唤起与右键插入）。

**已与用户确认的取舍：**
- Java 语言格式化/语法高亮**本轮一律不做**（`libs/ace` 缺 `mode-java.js`、项目无 Java 格式化器）。
- 其余语言（js/python/yaml/css/html/markdown 等）**不做新增格式化能力**，仅将「语言」子项收敛为**自动识别 + 高亮**：扩展 `EditorCore.detectLanguage` 的启发式，让打开/切换时无需手动在下拉框选择，系统自动套用对应 ACE 高亮。
- 现有 `formatCurrentContentAuto`（仅 json/xml/sql 自动格式化）**不改**。

## 现状分析（Current State Analysis）

关键结论均来自本轮的只读探索，行号以当前 `git HEAD` 为准。

**A. 设置模块**
- **剪切板监听**：监听与历史逻辑集中在 `electron/main.js`：`clipboardAssistantEnabled`(4945)、常量 `CLIPBOARD_POLL_MS=1500/COOLDOWN_MS=10000/TOAST_LIFETIME_MS=3500`(4952-4954)、`startClipboardPolling()`(5094)/`pollClipboard()`(5076)/`stopClipboardPolling()`(5106)。运行期开关在 `save-config`(2855) 读 `nextConfig.clipboardAssistant.enabled`、启动读(6324)。**但 `DEFAULT_CONFIG`(317-355) 根本没有 `clipboardAssistant` 字段**，且常量写死、设置页无任何 UI —— 即"开关默认恒开、频率不可配"。
- **模型注册链接**：`frontend/settings.html` 1170/1192/1297 三处 `<a ... target="_blank">` 走默认新窗口，在 Electron 里被 `setWindowOpenHandler`/安全策略拦截点不开。主进程已有 `tools:open-external`(main.js 3635-3640, `shell.openExternal`) 且 `preload.js:824` 已暴露 `openExternal`，可直接复用。
- **中转站 apiKey 明文**：`settings.html` customSection(1203-1227) 的 `customApiKey`(1217) 是 `<input type=password>` 且**没有"显示"按钮**（对比 dashscope/deepseek 均有）；`settings.js` 已有通用 `toggleVisibility()`(901)。
- **设置窗口**：`settings.html` 侧边栏 6 个 tab(748-753)；长内容用 `.config-subsection` 折叠面板 + `toggleSection()`(1676) + 折叠 CSS(599-627)，**已有可复用折叠组件**；但 AI 与集成 tab 内"模型提供商/ApiKey/链接/自定义中转"散放，剪贴板监听无处安放，缺少分区与优先级排序。

**B. 写作模块**
- **画布快捷键**：命令面板存在一条主进程兜底链（与 AceJump 同款，见 memory）：
  `main.js` 2567 菜单加速键 `CmdOrCtrl+K→focusGlobalCmdPalette→send('focus-global-cmd-palette')`；`index.html` 2878-2888 `onFocusGlobalCmdPalette(open)` 打开的是**顶层 index.html 自己的面板**（而非编辑器的）；`editor.js` 8250-8259 `document keydown Ctrl/Cmd+P|K→openCommandPalette()` 是编辑器面板。
  **根因判断**：Windows 上 `CmdOrCtrl+K` 菜单加速键在底层吃掉按键，事件到达不了编辑器 iframe 的 `document keydown`(8250)，故编辑器面板不开；而 ACE 内置 `Ctrl-K` 绑定为 `removetolineend`/`findnext`（在 `libs/ace/ace.js` 中），于是在编辑区表现为对行内内容/花括号区做的编辑动作（即用户所见的"对{}区做选中/操作"）。Mac 上菜单加速键到顶层面板的链路可用，故"看起来能用"。`before-input-event`(main.js 2472-2487) 目前只兜底了 AceJump(⌘/Ctrl+;)，**未兜底 Ctrl+K/P** —— 这正是缺失的最低层兜底。
- **双向链接**：`registerWikilinkCompleter()`(editor.js 7250-7327) 已注册 completer，索引源 `wikilinkState.targets`(7109-7137)，模糊评分 `fuzzyScore()`(8292-8314) 已存在但 completer 用的是普通 `indexOf`；斜杠菜单(3074-3366)与右键菜单(editor.html 633-712 / `executeEditorContextAction` editor.js 2651)均**无插入 `[[]]` 项**。现状 `[[` 被输入时靠 completer 自动补全，但"/"唤起、右键插入、光标居中、模糊列表均未实现；completer 无防抖与结果上限（性能风险）。

## 拟议修改（Proposed Changes）

### 设置模块

**1. 剪切板监听改为可配置**
- `electron/main.js`
  - `DEFAULT_CONFIG`(~355 末尾)新增：`clipboardAssistant: { enabled: true, pollIntervalMs: 1500, cooldownMs: 10000 }`。
  - 将 `pollClipboard` 内对 `CLIPBOARD_COOLDOWN_MS` 的使用(5086)、`startClipboardPolling` 对 `CLIPBOARD_POLL_MS` 的使用(5103)改为运行时读取 `loadConfig().clipboardAssistant`，并对值做钳制：`pollIntervalMs ∈ [500, 60000]`、`cooldownMs ∈ [1000, 60000]`（本文件在两个函数内各自读取，避免状态错配）。
  - 保留旧常量作默认值回退。
  - `save-config`(2855-2856) 与启动(6324) 已在按 `enabled` 启停轮询，无需改动逻辑；仅确保读取新字段。
- `frontend/settings.js`
  - `loadConfig()`(~119-193) 增加读取 `clipboardAssistant` 填入开关与频率控件。
  - `saveConfig()`(~548-565) 增加写回 `clipboardAssistant: { enabled, pollIntervalMs }`。
- `frontend/settings.html`
  - 在「数据与隐私」tab 新增「剪切板监听」config-subsection：开关(checkbox) + 监听频率(下拉或输入，提供 0.5s/1s/1.5s/2s/3s 选项，单位 ms) + 一句说明文案。

**2. 模型注册链接打开系统浏览器**
- `frontend/settings.html`
  - 三处链接(1170/1192/1297)改为按钮/`<a>`，`onclick="openExternalLink('<url>')"`；样式保留链接观感。
  - 新增 `openExternalLink`（放本页内联 script 或 `settings.js`）：优先 `window.electronAPI.openExternal(url)`，失败回退 `window.open(url, '_blank')`。
- 校验 `preload.js` 已暴露 `openExternal`（824 已确认）。

**3. 中转站 apiKey 明文显示**
- `frontend/settings.html`：`customApiKey`(1217) 输入框旁加「显示/隐藏」按钮，`onclick="toggleVisibility('customApiKey')"`，复用 `settings.js` 已有 `toggleVisibility()`(901)。

**4. 设置窗口重组（折叠·分区·优先级）**
- `frontend/settings.html`（含少量 `settings.js` 联动）
  - 「AI 与集成」tab 内重组三级结构：外壳改为 `settings-group`→`section`→可折叠 `config-subsection`（复用现有折叠组件，599-627/1676）。分区顺序与内容：
    1) **模型与 API**：DashScope、DeepSeek、自定义中转（OpenAI 兼容）三个子区，各自含 apiKey(带显示按钮)+模型+（中转含 providerName/baseUrl），并放链接按钮。
    2) **AI 行为**：现有 AI 相关行为项上移前置。
    3) **其余**：AI 集成的低频项折叠靠后。
  - 「数据与隐私」tab 增加「剪切板监听」子区（承接需求 1），并保持现有数据项顺序。
  - 长配置（ApiKey 说明、URL 大段）默认折叠，首屏只展示开关/优先级高的项；`settings.js` 无结构性改动，仅当需要为新控件提供默认值时补 `loadConfig/saveConfig` 对应逻辑。

### 写作模块

**5. 画布区 Ctrl+K / Ctrl+P 跨平台唤起命令面板**
- `electron/main.js`
  - 在既有 `before-input-event`(2472-2487) 中新增对 `Ctrl/Cmd+K`、`Ctrl/Cmd+P`（排除 Shift/Alt）的判定与 `event.preventDefault(); focusGlobalCmdPalette();`，作为最低层兜底（与 AceJump 同款）。
- `frontend/index.html`：用户焦点在编辑器时，`onFocusGlobalCmdPalette` 不应打开顶层面板，而应转发到编辑器 iframe（复刻 AceJump 的 2047-2055 postMessage 路径）：`editorFrame.contentWindow.postMessage({ action: 'focusCommandPalette' }, '*')`；仅当编辑器不可用时回退顶层 `open()`。
- `frontend/editor.js`
  - 在既有 `message` 监听(5028-5038，含 `focusAceJump`)新增 `case 'focusCommandPalette'` → `openCommandPalette()`。
  - 注册 `EditorShortcuts`（`frontend/js/editor-shortcuts.js`）新 action `commandPalette`，默认 `Ctrl+K`，handler 调 `openCommandPalette()`；由于 `dispatchCapture`(241-258) 在捕获阶段 `preventDefault()+stopImmediatePropagation()`，可确保 ACE 内置 `Ctrl-K`(removetolineend/findnext) 不会再吃掉按键 —— 同时解决"Ctrl+K 变成对{}区做操作"。保留 8250-8259 的 `Ctrl+P` 别名与现有逻辑，避免重复触发（复用 AceJump 的 80ms 去重护栏思路）。
- 说明：主进程 `main.js` 变更需重启应用生效（与 Goodmemory 记载一致）。

**6. 双向链接 "/" 唤起 + 右键插入 `[[]]`**
- `frontend/editor.js`
  - **斜杠菜单**（3074-3366）：插入「双向链接」类目/条目，选中后调用统一插入函数。
  - **右键菜单**（`frontend/editor.html` 633-712 + `executeEditorContextAction` editor.js 2651）：新增「插入双向链接」项，选中插入 `[[]]` 并把光标定位到两括号中间。
  - 新增统一函数 `insertWikilinkAtCursor()`：在光标处插入 `[[]]` 文本、光标置于中间，立即唤起模糊匹配列表（复用现有 palette/completer 渲染能力）。
  - **模糊匹配 + 性能**：补全改用 `fuzzyScore()`(8292) 统一打分；检索用 `wikilinkState.targets`；对输入做防抖（rAF 或 ≤150ms setTimeout，仅在目标索引已 loaded 时执行）；结果上限（复用现有 `slice(0,30)` 或调低）；必要时对 `targets` 建一次含 basename 的轻量缓存，避免每次击键全量扫描。确保编辑器可感知渲染列表项聚焦（光标居中 + 列表可键盘导航，复用命令面板项交互）。
- `frontend/settings.js` 无需改动。

## 假设与决策（Assumptions & Decisions）
- **剪切板配置形态**：`config.clipboardAssistant = { enabled, pollIntervalMs, cooldownMs }`；UI 只暴露「开关 + 监听频率」，冷却沿用现有默认值（10s），不额外暴露，避免设置项过多。
- **命令面板目标**：写作中按 Ctrl+K/P 一律唤起**编辑器命令面板**（`openCommandPalette`），顶层 index.html 面板仅在编辑器不可用时兜底 —— 与用户"画布/编辑区快键"语境一致。
- **语言项**：仅扩展 `editor-core.js` `detectLanguage`(30-49) 增加 js/python/yaml/css/html/markdown 的轻量正则识别，让打开/加载即可自动高亮；**不**新增任何格式化器，`editor.html` 下拉框保留作手动兜底。`setLanguage`/`LANGUAGE_EXTENSIONS`(editor.js 8-9, 1292-1315) 已能映射这些语言，无需新增（若下拉框缺某项再补 option）。
- 不改后端、不加新依赖（避免引入 jar/二次开发），全部为前端/Electron 主进程改动。

## 验证（Verification）
1. **剪切板配置**：设置页可切换开关与频率 → 保存后 `config.json` 出现 `clipboardAssistant` → 改频率为 3s 后到主进程日志/行为确认轮询间隔变化 → 关闭开关后停止轮询（不再弹气泡/不新增历史）。
2. **链接打开**：点 DashScope/DeepSeek/exa 三个链接，系统默认浏览器成功打开对应注册页。
3. **中转明文**：在中转站模式点「显示」能看到明文 apiKey，再点隐藏。
4. **设置重组**：六个 tab 正常切换；«AI 与集成» 分区折叠/展开正常；«数据与隐私» 含剪切板监听子区；长配置默认折叠、保存后重开状态保留。
5. **画布快捷键（Windows 优先）**：在编辑区按 Ctrl+K、Ctrl+P 均唤起编辑器命令面板；确认不再出现"对{}区做选中"；Mac 上 ⌘K/⌘P 行为不回归。用 `SHORTCUT_DEBUG=1`/`?debug=shortcuts` 打开 `[ShortcutDebug]` 日志核对命中链路。
6. **双向链接**：输入 `/` 斜杠菜单出现「双向链接」并插入 `[[]]`、光标居中、出现模糊列表且键盘可导航；右键→插入双向链接同样生效；在目标设备量较大时输入仍流畅（防抖+结果上限生效）。
7. **回归**：编辑器现有快捷键（AceJump ⌘/Ctrl+;、全局搜索、快速打开）不回归；`formatCurrentContentAuto`（json/xml/sql）行为不变；语言自动识别高亮对 js/py/yaml/css/html 生效。

## 实施状态（Implementation Status · 2026-09-14）

全部 7 项已落地，`node --check` 通过（main.js / settings.js / editor.js / editor-core.js）。**主进程 `electron/main.js` 变更需重启应用生效。**

| # | 需求 | 状态 | 关键落点 |
|---|------|------|----------|
| 1 | 剪切板监听可配置 | ✅ | `main.js` DEFAULT_CONFIG 新增 `clipboardAssistant`，`getClipboardAssistantCfg()` 运行时钳制读取（poll 500–60s / cooldown 1–60s），`pollClipboard`/`startClipboardPolling` 改用运行时值；`settings.html` 新增「剪切板监听」子区 + `settings.js` 读写 `{enabled, pollIntervalMs}` |
| 2 | 模型注册链接打开系统浏览器 | ✅ | `settings.html` 链接改为 `onclick="openExternalLink('<url>')"`（暂存 preload 已暴露的 `openExternal`→`shell.openExternal`），失败回退 `window.open` |
| 3 | 中转站 apiKey 明文显示 | ✅ | `settings.html` customApiKey 旁加「显示/隐藏」，复用 `settings.js` 已泛化的 `toggleVisibility()` |
| 4 | 设置窗口重组 | ✅ | 「AI 与集成」tab 按模型/行为分区（config-subsection 折叠）；「数据与隐私」新增剪切板监听子区；长配置默认折叠 |
| 5 | Ctrl+K/P 跨平台唤起命令面板 | ✅ | 三层兜底：`main.js` `before-input-event`（排除 Shift/Alt）`focusGlobalCmdPalette()` → `index.html` 焦点在编辑器时 `postMessage({action:'focusCommandPalette'})` 转发 → `editor.js` message `case 'focusCommandPalette'`→`triggerCommandPalette()`；`EditorShortcuts.commandPalette`(Ctrl+K) 捕获期 `preventDefault+stopImmediatePropagation` 阻断 ACE 内置 Ctrl+K(删到行尾/找下)；统一 80ms 去重 |
| 6 | 双向链接 "/" 唤起 + 右键插入 | ✅ | 斜杠菜单「插入→双向链接」+ 右键「插入双向链接」；`insertWikilinkAtCursor()`（索引未载入先 `buildLinkIndex`）插入 `[[]]` 光标居中并 `execCommand('startAutocomplete')` 唤起补全；completer 改 `fuzzyScore` 模糊评分，新增 `wikilinkMatchCache` 预计算缓存避免逐键全量扫描，结果上限 30 |
| 7 | 语言自动识别高亮 | ✅ | `editor-core.js` `detectLanguage` 增加 HTML/CSS/JS/Python/YAML/Markdown 内容启发式（仅高亮、不格式化），落在 JSON/XML/SQL 强信号之后；`setLanguage` 已支持这些 mode |

**偏差说明：**
- 命令面板最低层兜底（#5）在 `before-input-event` 用 `focusGlobalCmdPalette()`，与既有菜单加速键链路汇聚到同一 IPC → postMessage，配合 80ms 去重避免三路径重复触发（面板刚出就关）。
- 语言项（#7）为纯高亮嗅探，`formatCurrentContentAuto`（仅 json/xml/sql）保持不变；误判时右上角语言下拉可手动覆盖。
- 附带完成：`main.js` 新增 `shortcut:audit` IPC（收集菜单 accelerator + 全局快捷键清单）与 `frontend/js/shortcut-audit.js`，供「工具模块→快捷键检测」面板扫描冲突，与 #5 的冲突诊断配套。