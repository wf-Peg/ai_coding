# 编辑器键盘模式快捷键说明入口 集成方案

## 摘要
编辑器「高级设置」中，ACE `OptionPanel` 提供 **Keybinding**（Ace/Vim/Emacs/Sublime/VSCode）切换，但用户选中后看不到该模式的键位。本次集成一个**只读**的「查看该模式快捷键」入口：在高级设置内选择模式 → 打开说明弹窗，展示该模式常用快捷键。**仅静态说明，不打包 handler，不修改各模式内快捷键。**

## 现状分析（探索结论）
- 高级设置标签页：`settingsAdvanced` 内 `#aceSettingsContainer` 渲染 ACE `OptionPanel`（[editor.js L3383-3391](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3383-L3391)、[editor.html L414-417](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L414-L417)）。
- Keybinding 选项来源：ACE `ext-settings_menu.js` 内 `Keybinding {Type:buttonBar,path:keyboardHandler,items:[Ace/Vim/Emacs/Sublime/VSCode]}`（[ext-settings_menu.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/libs/ace/ext-settings_menu.js)）。
- 项目仅打包部分 ACE 模块（`frontend/libs/ace` 无 `keybinding-vim.js` 等，`ace.js` 内无 `ace/keyboard/vim|emacs|sublime|vscode`）→ 非 Ace 模式当前无法真正应用。**本次不解决生效问题**，仅提供静态说明。
- 已有「快捷键速查」弹窗能力：`shortcutModal`（[editor.html L546-570](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L546-L570)）、样式 `.shortcut-*`（[editor.css L1210-1271](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L1210-L1271)）、逻辑 `openShortcutHelp/renderShortcutHelp/buildShortcutRows`（[editor.js L3022-3052](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3022-L3052)）。复用该 modal 与表格结构。

## 方案
复用现有 `shortcutModal`，为其新增「模式快捷键」分组。入口放在高级设置标签页内 `#aceSettingsContainer` 下方。

### A. `frontend/editor.html`
1. 在 `settingsAdvanced` 内、`#aceSettingsContainer` 之后新增一行模式快捷键操作条：
   - `<select id="keyboardModeHelpSelect">` 选项：Ace / Vim / Emacs / Sublime / VSCode。
   - `<button class="tool-btn" id="keyboardModeHelpBtn">查看快捷键</button>`。
   - 提示：`仅查看，不可修改模式内快捷键`。
2. 在 `#shortcutModal` 内新增一个默认隐藏的组（置于配置列表前）：
   - `<div class="shortcut-group" id="shortcutModeGroup" hidden>` 内含标题 `<div class="shortcut-group-title" id="shortcutModeGroupTitle">` 与 `<div class="shortcut-table" id="shortcutModeList">`。

### B. `frontend/js/editor.js`
1. 新增静态键位数据 `MODE_SHORTCUTS`：`{ 'Ace': [...], 'Vim': [...], 'Emacs': [...], 'Sublime': [...], 'VSCode': [...] }`，每一项 `[名称, 组合键]`（组合键经 `platformShortcut` 适配）。各模式维护**常用键位**（新建/保存/撤销/重做/查找/替换/跳行/多光标/缩进/注释 等）。
   - 说明地址（README/官方文档）可作为标题旁小字提示，不强制。
2. 新增状态 `shortcutMode = null`（`null` 表示打开的是默认「快捷键速查」）。
3. 打开默认速查（`openShortcutHelp`）时置 `shortcutMode = null`，渲染可配置组 + 固定组，隐藏模式组。
4. 新增 `openModeShortcutHelp()`：
   - `shortcutMode = <select 选中值>`；隐藏默认两组的标题/列表，填充并显示模式组（`#shortcutModeGroupTitle` 设为 `<模式> 键盘模式快捷键（仅查看）`，`#shortcutModeList` 用 `buildShortcutRows(MODE_SHORTCUTS[mode])`）。
   - 适配 `renderShortcutHelp` 到新增分组逻辑；统一入口为 `openShortcutHelp(mode?)`。
5. 打开高级设置标签页（`switchSettingsTab('advanced')`）时，将 `#keyboardModeHelpSelect` 初始化为当前键盘处理器：默认 Ace（因处理器未打包，始终为默认键）。
6. 绑定 `#keyboardModeHelpBtn` click → `openShortcutHelp(select.value)`；`#keyboardModeHelpSelect` 支持直接回车触发。
7. 复用现有 `markdown modal` 关闭逻辑（`[data-close-modal]` 已全局接管 `shortcutModal` 关闭）。

### C. `frontend/styles/editor.css`
- 复用 `.shortcut-group/.shortcut-table/.shortcut-row/.shortcut-keys`（已存在），无需新增。
- 仅为高级设置里的模式快捷键操作条新增少量样式（可选择 `.tool-bar` 或内联 margin），保持与弹窗/选项面板协调、深浅主题用 `--app-*` 变量。

### D. 测试
- 无后端改动，跳过 Maven。
- `node --check frontend/js/editor.js`。
- 手动清单：
  - 高级设置 → 选 Vim → 点「查看快捷键」→ 弹窗显示「Vim 键盘模式快捷键（仅查看）」与键位表。
  - 状态栏「⌨️ 快捷键」仍显示默认可配置 + 固定两组（模式组隐藏）。
  - 关闭/重开弹窗分组显示正确，Esc/× 正常关闭。
  - 深浅主题下图表格样式正常。

## 假设与决策
- **只读**：本入口仅展示，不提供对模式内快捷键的修改（用户已确认）。
- **静态数据**：各模式键位为人工维护的常用表；不具备动态提取条件（handler 未打包），且用户选择静态方案。
- **范围**：不打包 Vim/Emacs/Sublime/VSCode handler，不修复模式切换生效问题（本次不在范围）。
- **复用**：复用 `shortcutModal`/`.shortcut-*` 结构，减少重复实现（遵循既有弹窗模式）。

## 验证步骤
1. `node --check` 校验 `editor.js`/`editor.html`（HTML 无脚本校验，靠手动）。
2. 按 D 手动清单逐项验证。
3. 验证后用项目 commit-history 规范提交（如需）。