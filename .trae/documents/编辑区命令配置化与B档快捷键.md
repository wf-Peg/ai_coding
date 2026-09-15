# 编辑区命令配置化 + B 档快捷键开发方案

## 一、背景与目标

承接 Alt+J 多光标功能（已上线，硬编码键位），本次：

1. **B 档 3 个新命令**：`Ctrl+Shift+U` 大小写切换、`Alt+Shift+W` 收缩选区（逆扩展）、`Ctrl+Shift+K` 删除整行（VS Code 同款）。
2. **编辑区命令配置化**：让「编辑区画布的内置快捷键」可在**写作区快捷键速查弹窗**内直接改键（用户决策：覆盖常用核心命令）。
3. **生效范围区分**（用户强调）：文本编辑类命令=仅编辑区聚焦生效；核心操作类命令=编辑器窗口内任意焦点生效；系统级（Ctrl+P/K、全局搜索）保持固定/归设置模块。
4. 设置模块现有 13 项「编辑器功能快捷键」**保持原位不动**（用户决策）。

## 二、现状分析（已核实）

| 链路 | 载体 | 存储 | 配置入口 |
|---|---|---|---|
| 功能级（13 项） | `EditorShortcuts`（editor-shortcuts.js），window 捕获分发 `dispatchCapture` | `localStorage['editor_shortcuts_v1']` | 设置模块 |
| ACE 级命令（Alt+J 生态等） | `mainEditor.commands.addCommand({name,bindKey,exec})` 硬编码 | 无 | 不可配置 |
| 核心操作（Ctrl+T/N/O/S/M/L/I/Alt+T） | editor.js 分散硬编码：document 冒泡 keydown（L5424）+ window 捕获监听（L5068/L5082/L5094）+ document keydown（L5665） | 无 | 不可配置 |
| 速查弹窗（#shortcutModal） | 可配置（EditorShortcuts 只读展示）/ 固定（shortcutFixedRows）/ 键盘模式（MODE_SHORTCUTS + `resolveAceModeRows` 实时读 `cmds.byName[].bindKey.win`） | — | — |

关键结论：
- `resolveAceModeRows` **已实时读运行时 bindKey** → ACE 命令改键后 Ace 模式查看表自动显示新键位（天然适配）。
- ACE 命令重绑现成模式：`rebindAceReplaceShortcut`（editor.js L264-275）：`removeCommand → 改 bindKey → addCommand(cmd, true)`。
- 转换面板 `Ctrl+Shift+X` 在代码中无实际 handler（仅速查表文案），**不进配置**。
- 命令面板 `Ctrl+P`、全局 `Ctrl+K` 由 **main.js `before-input-event` 主进程级拦截**（系统级兜底）→ 保持固定，不进本次配置（改动 main.js 风险高）。

## 三、方案总览

新增 **`EditorAceShortcuts`** 注册表（扩展 editor-shortcuts.js，复用其 parse/match/normalizeCombo，设置模块 UI 不受影响——settings.js 只遍历 `DEFAULTS`）。分两类：

- **aceOnly=true（文本编辑类，7 项）**：纯 ACE 命令管理器绑定/重绑（bindKey 读配置）→ 仅编辑区聚焦生效；**不设窗口捕获兜底**（以 ACE 默认键位为准）。
- **aceOnly=false（核心操作类，8 项）**：editor.js window 捕获统一分发 → 编辑器窗口内任意焦点生效；旧硬编码分支移除（默认键位=原值，行为不变）。

## 四、改动清单

### 1. frontend/js/editor-shortcuts.js — 新增 `EditorAceShortcuts` 注册表

```js
var ACE_STORAGE_KEY = 'editor_ace_shortcuts_v1';
// id: { label, shortcut, aceOnly, guard? }
var ACE_DEFAULTS = {
  // ── 文本编辑类（仅编辑区聚焦生效）──
  selectNextOccurrence:      { label: '选中下一个相同项',   shortcut: 'Alt+J',        aceOnly: true },
  unselectPreviousOccurrence:{ label: '撤销上一个选中',     shortcut: 'Alt+Shift+J',  aceOnly: true },
  selectAllOccurrences:      { label: '选中所有相同项',     shortcut: 'Ctrl+Alt+J',   aceOnly: true },
  expandSmartSelection:      { label: '智能选中（词/句/行/段）', shortcut: 'Alt+W',   aceOnly: true },
  toggleCase:                { label: '大小写切换',         shortcut: 'Ctrl+Shift+U', aceOnly: true },
  shrinkSmartSelection:      { label: '收缩选区（逆扩展）', shortcut: 'Alt+Shift+W',  aceOnly: true },
  deleteLine:                { label: '删除整行',           shortcut: 'Ctrl+Shift+K', aceOnly: true },
  // ── 核心操作类（编辑器窗口内任意焦点生效）──
  newTab:        { label: '新建标签',   shortcut: 'Ctrl+T' },
  newFile:       { label: '新建文件',   shortcut: 'Ctrl+N' },
  openFile:      { label: '打开文件',   shortcut: 'Ctrl+O' },
  save:          { label: '保存',       shortcut: 'Ctrl+S' },
  formatDoc:     { label: '格式化（自动识别）', shortcut: 'Ctrl+Shift+L',
                  guard: 'skipEditableAceExcept' },          // 沿用原 Ctrl+G/L 监听器的 INPUT/TEXTAREA 跳过逻辑
  markdownPreview:{ label: 'Markdown 预览', shortcut: 'Ctrl+Shift+M',
                  guard: 'skipTextareaNonAce' },              // 沿用原 TEXTAREA 跳过逻辑
  terminal:      { label: '终端跟随目录', shortcut: 'Alt+T' },
  insertImage:   { label: '插入图片',   shortcut: 'Ctrl+Shift+I',
                  guard: 'skipEditableAceExcept' }
};
// 导出：get/getAll/save/reset/findConflicts（复用现有 parse/match/normalizeCombo；
// findConflictsAce 合并本注册表 + EditorShortcuts 全部组合做交叉冲突检测）
```

存储独立于设置模块（`editor_ace_shortcuts_v1`），`settings.js` 零改动。

### 2. frontend/js/editor.js — B 档 3 个命令辅助函数（插在 `altwExpandRange` 附近）

- **`toggleCaseText(text)`**：VS Code 语义——含大写且不含小写→转小写，否则转大写。
- **`aceToggleCase(editor)`**：`multiSelectAction:'forEach'`，`exec` 内 `getTextRange(range)` → `session.replace(range, toggleCaseText)`（无选区/空选区跳过）。
- **`altwShrinkRange(session, range)`**（逆扩展一级，确定性）：词→光标（空选区）；句子/部分行→起点处词；整行→起点所在句子（若结果=整行则回退起点处词，防卡死）；多行/段落→起点行整行。
- **`altwShrinkSelection(editor)`**：与 `altwSmartSelect` 同构——`getAllRanges()` 逐个 shrink，`clearSelection + addRange` 批量应用。
- **`aceDeleteLine(editor)`**：`multiSelectAction:'forEachLine'`，`exec` 调 `editor.removeLines()`（对齐 ACE `removeline`）。

### 3. editor.js — `initAltJCommands` 改造：ACE 命令键位改读配置（单机制，不做双保险）

- `initAltJCommands` 的 `defs` 扩展为 8 项（原 5 + `toggleCase`/`shrinkSmartSelection`/`deleteLine`），**bindKey 注册时直接取 `EditorAceShortcuts.get(id)`**（默认=旧值），mac 经 `macBind` 转换——**启动即最终键位、不做二次重绑**（Review 建议④：消除启动双重重绑冗余）。
- 新增 `applyAceShortcutOverrides()`：**仅弹窗改键成功后调用**（复用 removeCommand→改 bindKey→addCommand 模式），并 `renderShortcutHelp()` 刷新两表。
- **`deleteLine` 注册前显式解除 ACE 内置 `findprevious` 的 Ctrl+Shift+K 绑定**（Review Bug②：决策与实现脱节）：复用 `rebindAceReplaceShortcut` 既有模式——`removeCommand(findprevious)` → 以无 bindKey 重新 `addCommand`（搜索框按钮仍可反向查找），避免依赖 ACE「后注册覆盖 + Repeated keybinding 警告」的隐式行为。
- **`toggleCase` 注册前同样显式解除 ACE 内置 `tolowercase` 的 Ctrl+Shift+U 绑定**（实施阶段经 ace.js 内置键位核查发现，与 findprevious 同型处理，命令本体保留）。
- **单一绑定机制**（用户决策：以 ACE 默认键位为准）：aceOnly 命令只走 ACE 命令管理器 bindKey，**不设窗口捕获兜底**——应用未打包任何键盘处理器模块，Ace 模式为唯一实际模式，bindKey 在编辑区聚焦时必然命中；将来若打包 Vim/Emacs 处理器导致键位被抢占，再按 acejump「命令管理器 + 窗口捕获」模式补兜底（不提前实现）。
- `collapseMultiCursor`（Esc）**固定不可配置**（Esc 为通用取消键，重绑风险高），不进注册表，仅速查表固定行展示。

### 4. editor.js — 统一捕获分发（仅 core 类）

- 新增 `aceShortcutDispatch(e)`（window 捕获 keydown，绑定一次，注册于 `EditorShortcuts.startCapture()` 附近）：遍历 **core 类 8 个动作**——
  - 命中 → 按 `guard` 校验（无 guard 不跳过）→ `preventDefault + stopImmediatePropagation` → 执行动作映射：
    `newTab→createNewTab()、newFile→createNewTab()、openFile→openMainFile()、save→saveFile(false)、formatDoc→formatCurrentContentAuto()、markdownPreview→toggleMarkdownPreview()、terminal→openTerminalInDir()、insertImage→editorImageInput.click()`。
  - **录制态守卫（共享标记）**（Review Bug①：原守卫只防 aceShortcutDispatch，漏防系统级 dispatchCapture——录 Ctrl+Shift+F 会被 13 项系统键先拦截、stopImmediatePropagation 后按键到不了录制 input）：录制开始时设 `window.__aceShortcutRecording = true`；`aceShortcutDispatch` 开头与 `EditorShortcuts.dispatchCapture`（editor-shortcuts.js）开头各加一行 `if (window.__aceShortcutRecording) return;`。editor-shortcuts.js 因此纳入本次改动（settings 模块 UI 不受影响）。
  - **系统级优先规则**（Review 建议⑤：交叉冲突生效优先级）：`aceShortcutDispatch` 遍历前先检查按键是否命中 EditorShortcuts 的 13 项系统级组合（`EditorShortcuts.match(keydown, get(action))` 任一命中）→ 是则直接 return（让 dispatchCapture 处理），保证「系统级 13 项 > 编辑区命令」；冲突仅标红提示、允许提交，同键时系统级生效。
- **移除旧硬编码分支**（由分发器接管，默认键位一致故行为不变）：
  - document 冒泡 keydown（L5424-5472）：删 `n/t/o/s(仅非 Shift)`/`,` 分支；**保留** `w`（关闭标签）、`Ctrl+Tab`、`Ctrl+Shift+S`（另存为）、`Ctrl+=`/`Ctrl+-`（字体，固定）。
  - window 捕获监听 L5068（Shift+I）与 L5082（Shift+M）整段删除（分发器接管）。
  - L5094 监听：删除 `isFormat` 分支，仅保留 `Ctrl+G` 跳转行（固定）。
  - L5665（Alt+T）整段删除。
- guard 语义忠实复刻原逻辑：`skipEditableAceExcept`=目标为 INPUT/TEXTAREA/SELECT 且不在 `.ace_editor` 内则跳过；`skipTextareaNonAce`=目标为 TEXTAREA 且非 ACE 文本域则跳过；其余动作无跳过（与原冒泡行为一致）。

### 5. frontend/editor.html — 速查弹窗新增「编辑区命令」分组

在 `#shortcutConfigurableList` 分组之后插入：

```html
<div class="shortcut-group">
  <div class="shortcut-group-title">编辑区命令（可配置）<span class="ace-sc-hint">点击键位直接改键</span></div>
  <div class="shortcut-group-sub">文本编辑类（编辑区聚焦生效）</div>
  <div class="shortcut-table" id="aceShortcutTextList"></div>
  <div class="shortcut-group-sub">核心操作类（编辑器内任意焦点生效，仅写作区）</div>
  <div class="shortcut-table" id="aceShortcutCoreList"></div>
  <div class="panel-actions" style="justify-content:flex-end">
    <button class="tool-btn" id="aceShortcutResetBtn">恢复默认</button>
  </div>
</div>
```

弹窗副标题文案更新为「可配置快捷键可在系统设置中修改；编辑区命令可在本弹窗直接改键」。

### 6. editor.js — 弹窗内录制改键交互（新增）

- 渲染 `renderAceShortcutGroups()`：按 `aceOnly` 分两表渲染 `shortcut-row` + 可点击 `<input class="ace-sc-input" readonly value="组合键">`（复用 EditorShortcuts 的 `normalizeCombo/parse`）。
- 交互（复刻 settings.js `startEsRecording` 模式，editor 内自实现）：点击进入录制 → keydown 归一化组合 → 提交 `EditorAceShortcuts.save` → `applyAceShortcutOverrides()`（重绑 ACE 命令）+ `renderShortcutHelp()` 重渲染；Esc 取消；Backspace/Delete 恢复默认；`aceShortcutResetBtn` 一键恢复。
- **录制键处理细节**（Review 建议⑦）：录制态处理 Esc/Backspace/Delete 时须 `preventDefault + stopImmediatePropagation`，防止弹窗自身 Esc 关闭监听联动误关弹窗。
- **主进程拦截键不可作改键目标**（Review Bug③）：main.js `before-input-event` 拦截 Ctrl+;/K/P，渲染进程收不到完整按键 → 录制命中这 3 个组合时不提交，输入框标红 `.conflict` 并 Toast 提示「Ctrl+;/K/P 为系统级固定键，不可用于编辑区改键」（与设置模块 13 项同既有约束，但新入口主动声明）。
- 冲突检测：`EditorAceShortcuts.findConflictsAce()`（本注册表内 + 与 EditorShortcuts 交叉）→ 冲突输入标红 `.conflict`；**仅提示不阻止提交**（与 settings.js 行为一致），同键时优先级见 §4 系统级优先规则。

### 7. 快捷键表联动

- **固定表（shortcutFixedRows）**：对应可配置命令的行改为渲染时读 `EditorAceShortcuts.get(id)`（如「新建标签」「保存」「Markdown 预览」「终端跟随目录」「选中下一个相同项」等），不再硬编码，且键位列追加「可配置」小标记（Review 建议⑥：避免与「编辑区命令」分组重复展示造成困惑，`.ace-sc-tag` 样式）；新增固定信息行：`复制行 Shift+Alt+↑/↓`、`移动行 Alt+↑/↓`、`添加光标 Ctrl+Alt+↑/↓`（ACE 内置，仅展示）。
- **Ace 模式表（ACE_CMD_KEYS）**：追加 `toggleCase/shrinkSmartSelection/deleteLine` 三条（命令名与注册名一致），`resolveAceModeRows` 自动读改键后的真实键位。
- **命令面板（registerCommand）**：B 档 3 条注册 shortcut 取配置值；core 类命令面板条目 shortcut 同步读配置（如 `save`、`markdown` 等）。

### 8. frontend/styles/editor.css — 新增样式

`~30 行`：`.ace-sc-input`（键位胶囊样式，复用 `.shortcut-keys` 视觉）、`.ace-sc-input.recording`（录制态描边）、`.ace-sc-input.conflict`（红色）、`.ace-sc-hint`、`.shortcut-group-sub`、`.ace-sc-tag`（固定表「可配置」小标记）。

## 五、键盘模式（Ace/Vim/VSCode）冲突分析（用户质询，已按反馈简化）

**现状核实**：应用仅打包 `libs/ace/ext-settings_menu.js`，**未打包** `ace-keybinding-vim/emacs/sublime/vscode` 处理器模块；高级设置内「键盘模式」select 与弹窗仅为静态说明（L579「仅查看，不可修改」），编辑器 L5369 注释明确「处理器未打包时恒为 Ace」→ **当前实际无法切换键盘模式，Ace 为唯一实际模式**。

**结论（按用户反馈对齐删除）**：既然冲突不可达，**不做预防性双保险**——aceOnly 命令统一以 **ACE 命令管理器 bindKey（即 ACE 默认键位机制）** 为唯一绑定途径：默认键位=现值，用户可在速查弹窗内改键（removeCommand→改 bindKey→addCommand）。理由：
1. 无键盘处理器 → bindKey 在编辑区聚焦时必然命中，无兜底需求；
2. 少一层捕获 = 少一份 dispatch 遍历与双触发/守卫复杂度，符合「轻量、低占用」原则；
3. Ace 模式查看表依赖 `byName[].bindKey` 展示真实键位，单机制天然自洽。

**未来扩展点（不提前实现）**：若将来打包 Vim/Emacs 处理器，其状态机可能抢占自定义组合键；届时按 acejump 既有「命令管理器 + 窗口捕获」模式为 aceOnly 命令补窗口捕获兜底（守卫 `isFocused()`）即可——注册表 `aceOnly` 字段、`applyAceShortcutOverrides` 重绑入口、`aceShortcutDispatch` 结构均已为此预留。core 类走窗口捕获不经 ACE 键盘处理器，天然不受影响。

## 六、生效范围区分（用户核心诉求）

| 类别 | 生效范围 | 配置入口 |
|---|---|---|
| 文本编辑类（7 项） | 仅 ACE 编辑区聚焦时 | 写作区速查弹窗「编辑区命令」 |
| 核心操作类（8 项） | 编辑器（写作区 iframe）内任意焦点，不扩散到知识库/设置等页面 | 同上 |
| 功能级 13 项 | 系统级 + 跨页面 | 设置模块（原位不动） |
| 固定项（Ctrl+W/Tab/Shift+S/=/-/G、Ctrl+P/K、Esc、Alt+↑/↓ 等） | 不可配置，弹窗仅展示 | — |

## 七、决策与假设

1. **Ctrl+P（命令面板）/ Ctrl+K** 保持固定：main.js `before-input-event` 主进程拦截属系统级兜底，本次不动 main.js（谨慎）；如需可配属后续独立任务（复用 `syncGlobalSearchMenu` IPC 模式）。
2. **Ctrl+Shift+K 覆盖 ACE 内置 findprevious（反向查找）**：VS Code 语义优先；实现上**显式解绑**（removeCommand 后无 bindKey 重新注册），搜索框反向查找按钮仍直接调用该命令可用，不留隐式键位冲突（Review Bug②）。同理 `Ctrl+Shift+U` 显式解绑 ACE 内置 `tolowercase`。
3. **Esc（收起多光标）固定**：通用取消键，防误改。
4. 默认键位=现值 → 未改键时行为与现状逐键一致；改键后旧键释放（旧分支已移除/分发器接管）。
5. 转换面板（Ctrl+Shift+X）代码中无 handler，不进配置，固定行保留展示。
6. 不改 main.js、不新增独立 JS 文件、不改 settings 模块 UI（谨慎原则）；editor-shortcuts.js 因「dispatchCapture 录制守卫」纳入本次改动（仅加一行守卫，导出面不变）。
7. **aceOnly 命令单一绑定机制**（按用户反馈对齐删除）：未打包键盘处理器模块、Ace 为唯一实际模式 → 不做窗口捕获双保险，以 ACE bindKey 为唯一途径，用户可改键；未来打包模式处理器时再按 acejump 模式补兜底，不提前实现。
8. **同键冲突优先级**（Review 建议⑤）：系统级 13 项 > 编辑区命令；`aceShortcutDispatch` 入口先让行给系统级组合；冲突仅标红提示、允许提交。
9. **Ctrl+;/K/P 为系统级固定键**（main.js 拦截），编辑区改键录制命中时拒绝提交并提示（Review Bug③）。

## 八、验证步骤

1. `node --check frontend/js/editor.js`、`node --check frontend/js/editor-shortcuts.js`。
2. 重启应用，编辑器内验证 B 档：选区 → `Ctrl+Shift+U` 大小写翻转（多光标独立）；`Alt+W` 连按扩展 → `Alt+Shift+W` 逐级收缩到词/光标；光标所在行 `Ctrl+Shift+K` 删行（多光标逐行删）。
3. 打开 ⌨️ 快捷键弹窗：新分组显示 15 项；点击某键位录制改键（如 `save` 改 `Ctrl+Shift+S` 之外的组合）→ 旧键失效、新键生效；Ace 模式查看表与固定表同步显示新键位。
4. 冲突验证：把两项改成相同组合 → 红色标注。
5. 回归：Ctrl+T/N/O/S/Shift+M/L/Shift+I/Alt+T 默认行为不变；Ctrl+W/Ctrl+Tab/Ctrl+Shift+S/Ctrl+G/Ctrl+=/- 不受影响；设置模块 13 项列表不变。
6. 恢复默认按钮 → 全部回到默认键位，ACE 命令可正常执行。
7. 录制守卫验证（Review Bug①）：弹窗内录 Ctrl+Shift+F → 全局搜索不弹出、录制 input 正常接收。
8. 主进程拦截键验证（Review Bug③）：录 Ctrl+K → 标红 + Toast 提示，不提交。
9. findprevious 解绑验证（Review Bug②）：Ctrl+Shift+K 删除行生效；搜索框反向查找按钮仍可用；控制台无 "Repeated keybinding" 警告。`tolowercase` 同法：Ctrl+Shift+U 大小写切换生效且无 Repeated keybinding 警告。
10. 系统中优先级验证（Review 建议⑤）：把 `save` 改键为 `Ctrl+Shift+F` → 标红但可提交；实际按键触发全局搜索（系统级优先），不触发保存。
