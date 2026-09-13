# 修复写作模块 AceJump 唤起无反应 & 补齐命令面板说明

## 概述（Summary）
用户报告写作模块（`editor.html`，Ace 编辑器）两个互相纠缠的问题：
1. `Ctrl/⌘+;` 唤出 AceJump 无反应；
2. 通过 `⌘+P` 命令面板里的 AceJump 条目：功能说明不清晰，且点击后在写作区画布上也“没反应”。

经排查，AceJump 的**纯逻辑与所有单元测试均正确**（18/18 通过），模块加载、快捷键分发链路、叠加层 CSS 全部正常。真正的问题是运行时的**静默空操作**：`toggle()` 在 `collectCandidates()` 收集不到候选时（编辑器为空 / 容器未测量出高度 / 中文输入法导致按键 key 变成全角 `；`）会直接 return，**不给任何用户反馈**，表现为“没反应”。同时命令面板里的条目没有说明文字、快捷键速查表缺少 AceJump 行。

本方案在不大改架构的前提下：修复唤起链路、补齐说明、新增回归测试与可观测反馈，实现“修好 + 补说明 + 补测试”三合一。

## 当前状态分析（Current State Analysis）
- 写作页 = `frontend/editor.html`，在 `index.html` 中以 iframe（`#editorFrame`）加载。
- 触发链路已就绪且正确：
  - `frontend/js/ace-jump.js` 暴露 `window.EditorAceJump.toggle()`，叠加层 CSS 挂在 `.ace-host` 下（`styles/editor.css:4477`），样式正常。
  - `frontend/js/editor.js:7956` `EditorShortcuts.registerHandler('aceJump', ...)`；`editor.js:8286` `startCapture()` 启用 `editor-shortcuts.js:dispatchCapture` 捕获分发。
  - `editor.js:8084-8092` 处理 `⌘/Ctrl+P`、`⌘/Ctrl+K` 打开命令面板。
- 根因定位：
  - **静默空操作**：`ace-jump.js:start()` 中 `collectCandidates()` 返回空数组时 `return`，无任何提示（`ace-jump.js:254-258`）。`collectCandidates()` 用 `renderer.$size.height` 判定可视高度（`ace-jump.js:85-86,102`），编辑器未测量或高度为 0 时全部候选被过滤 → 空 → 无反应。
  - **无触发反馈**：`editor.js:7946-7950` 的 `acejump()` 只在模块缺失时提示，成功却零反馈。
  - **输入法兼容**：`editor-shortcuts.js:match()`（L100-115）严格用 `e.key.toUpperCase() === p.key` 比对；中文输入法在部分布局/状态下会把 `;` 报为全角 `；`（U+FF1B），导致 `⌘+;` 匹配失败。
  - **说明缺失**：
    - 快捷键速查表 `editor.js:4163-4169` 没有 `AceJump / Ctrl+;` 行。
    - 命令面板条目 `editor.js:7951-7954` 名称为简短标签，无功能说明。
    - 命令面板渲染 `editor.js:7994-8042`（条目模板 L8034-8036）不支持二级说明文字。
- 测试现状：`electron/editor-shortcuts.test.js` 已覆盖 `dispatchCapture` 命中（但只用 `quickOpen`/`Ctrl+Shift+O`）；`electron/ace-jump.test.js` 只测候选收集纯逻辑，明确注释“键盘捕获/唤起不在单测范围”。两者均未覆盖 `⌘+;` 与全角 `；`。

## 提议修改（Proposed Changes）

### 1. 修复 `⌘/Ctrl+;` 唤起无反应
**文件：`frontend/js/ace-jump.js`**
- 修改 `collectCandidates()`（约 L85-L86）：为可视高度增加兜底。当 `renderer.$size` 缺失或其 `.height` 为 0/NaN 时，回退用 `editor.container` 的 `clientHeight` / `getBoundingClientRect().height`；仍为 0 时返回空数组（保持安全）。
- 修改 `start()`（约 L246-L296）：新增可选回调 `opts /* onEmpty 与 */` ——当 `base.length === 0` 时，若提供了 `opts.onEmpty` 则调用它，再 return，而不是完全静默。

**文件：`frontend/js/editor.js`**
- 修改 `acejump()`（L7946-7950）：在调用 `toggle` 时传入 `onEmpty` 回调，向用户 `showToast('当前编辑区无可跳转目标（区域为空或尚未完成布局）')`。保留原有 `'AceJump 未加载'` 提示；成功进入跳跃模式时叠加标签本身上屏即作为反馈，无需额外提示。

**文件：`frontend/js/editor-shortcuts.js`**
- 修改 `match()`（L100-115）：在比对单字符 `key` 时，增加全角→半角标点映射（至少覆盖 `；→;`，并加一组常用全角标点如 `：→:、，→,、。→.、＄→$、＝→=` 等，集中在一个 `FULLWIDTH_TO_ASCII` 映射常量）。比对前先对 `e.key` 做归一化。`parse()` 不需改动（用户配置仍为半角）。

### 2. 补齐快捷键速查表说明
**文件：`frontend/js/editor.js`**
- 在 `shortcutFixedRows`（L4163-4170）末尾追加一行：`['AceJump 跳跃导航', 'Ctrl+;']`。

### 3. 命令面板 AceJump 条目功能说明更清晰
**文件：`frontend/js/editor.js`**
- 扩展 `registerCommand()`（L7875-7876）：新增可选第 6 参 `desc`，push 进 `commandRegistry` 项（`desc: desc || ''`）。历史调用不受影响（新增可选参数向后兼容）。
- 给 4 个 AceJump 命令（L7951-7954）补 `desc`，例如：
  - `acejump-word`：`跳转到可见区域中任意单词/中文单字的开头`（快捷键 `Ctrl+;`）
  - `acejump-char`：`跳转到可见区域任意字符`
  - `acejump-line`：`跳转到每个可见行首的非空白字符`
  - `acejump-select`：`从当前光标延伸选区到目标位置（单词模式）`
- 修改命令面板条目渲染 `renderCommandList()`（L8034-8036）：当 `c.desc` 存在时，把图标 + 名称包进内层列容器，并在名称下追加一行 `.command-palette-item-desc`（弱化灰色小字）。无 `desc` 的条目保持原样，保证零回归。

**文件：`frontend/styles/editor.css`**
- 为 `.command-palette-item` 支持内层两行布局并新增 `.command-palette-item-desc` 样式（小号、弱化用 `--app-text-muted`、`line-height:1.3`），权重/换行不破坏现有单项 flex 布局。

### 4. 新增回归测试
**文件：`electron/editor-shortcuts.test.js`**
- 新增用例：`捕获分发：Cmd+;（metaKey）命中并执行 aceJump handler`。注册 `aceJump` handler，`dispatchCapture({metaKey:true, shiftKey:false, altKey:false, key:';', ...})`，断言 handler 被调用；再用不匹配键（如 `key:'p'`）断言不触发。
- 新增用例：`match 全角分号也能命中 Ctrl+;`：`ES.match({metaKey:true,key:'；'}, 'Ctrl+;') === true`。

**文件：`electron/ace-jump.test.js`**
- 新增用例：`start 在候选为空时回调 onEmpty 而非静默`。用最小 mock 编辑器（`session.getLine`/`getLength` 返回 0 行，`renderer` 返回 `$size` 为 0 或抛错）驱动 `EditorAceJump.start(fakeEditor, { onEmpty })`，断言 `onEmpty` 被调用且未抛异常。

### 不做（Out of scope，按用户澄清）
- 不改 `⌘+P` 的唤起范围（其已在写作页生效，`index/server` 端保持现状），本次仅处理命令面板里 **AceJump 条目**的说明与唤起。
- 不改 `collectCandidates` 之外的编辑器实例选择（正常写作态 `mainEditor` 即可视编辑区）。

## 假设与决策（Assumptions & Decisions）
- “写作区画布”= `editor.html` 的 Ace 编辑区（`#mainEditor` 所在 `.ace-host`），且用户此时已有焦点/内容；与知识图谱画布 `canvas.html` 无关。
- `⌘+;` 在真实 macOS + 中文输入法下的无反应，最可能是全角 key 或容器未测量导致静默空操作；两项均被本方案覆盖，并同时补上“空操作提示”作为可观测兜底。
- `registerCommand` 增加可选 `desc` 参，向后兼容，不触碰其它命令。

## 验证步骤（Verification）
1. 运行回归测试：
   `node --test electron/editor-shortcuts.test.js electron/ace-jump.test.js`，预期全部通过（含新增用例）。
2. 语法检查改动文件：
   `node --check frontend/js/ace-jump.js && node --check frontend/js/editor.js && node --check frontend/js/editor-shortcuts.js`。
3. 浏览器手动验证（`python3 -m http.server 8123` 托管后访问 `http://127.0.0.1:8123/frontend/editor.html`）：
   - 在空编辑区按 `⌘+;` → 应弹出“无可跳转目标”的 toast（而非无反应）。
   - 输入英文/中文后按 `⌘+;` → 应出现字母叠加标签，输入标签字母可跳转。
   - `⌘+P` 打开命令面板 → 4 个 AceJump 条目显示新增说明文字；点击“AceJump 跳跃（单词）”能进入跳跃模式。
   - 点快捷键速查（帮助）→ 速查表出现 `AceJump 跳跃导航 / Ctrl+;`。
4. Electron 桌面端回归（可选）：进入「写作」打开任一记录，分别用 `⌘+;` 与 `⌘+P→AceJump 跳跃（单词）`验证。
```
```