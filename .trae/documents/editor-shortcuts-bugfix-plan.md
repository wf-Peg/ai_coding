# 编辑器快捷键失效梳理与修正方案

## 摘要
编辑器模块存在快捷键"选中都没法唤起"、大小写不一致、设置改动即时同步不完整等问题。本次聚焦**右下角抽屉核心功能**（文件/历史/最近/收藏/反链/大纲/标签/搜索/概览），采用**捕获阶段全局拦截**策略修正，并补齐设置模块实时同步与"快捷键速查说明"。

## 现状分析（Phase 1 结论）

### 1. 快捷键绑定分散、冒泡阶段易被吞
- `editor.html` 作为 `index.html` 的 `#editorFrame` iframe 加载。右下角抽屉功能的 9 处 `document.addEventListener('keydown', ...)` 全部在 editor iframe 内、**冒泡阶段**绑定（[editor.js L4069](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4069)、[L4392](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4392)、[L4582](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4582)、[L4778](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L4778)、[L5018](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5018)、[L5940](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5940)、[L6078](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6078)、[L6190](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6190)、[L6485](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6485)）。
- 焦点进入 ACE 编辑区时，ACE 会先处理并拦截部分组合键，导致 document 冒泡阶段监听收不到 → **"选中没法唤起"**。
- 主进程仅将 `globalSearch` 注册进菜单加速键（[main.js L2412](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L2412)），其余抽屉功能在 iframe 焦点/ACE 焦点下均无兜底。

### 2. 大小写处理不一致
- `EditorShortcuts.match` 已对 `e.key` 与 `parse(combo)` 做 `toUpperCase()`，**大小写无关** ✅。
- 但工具栏/命令面板等**不经 match 的硬编码**仍区分大小写：
  - [editor.js L6306](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6306)：`e.key === 'p'` 只匹配小写。
  - [editor.js L3599](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3599)：`e.key === 't' || e.key === 'T'` 手动补大写，未统一。
  - 其余 `e.key === 'Enter'/'Escape'/'ArrowDown'` 等为控件内导航，与大小写无关，保持。
- 用户要求"组合键唤起不需要区分大小写"，需统一收敛到大小写无关的判定。

### 3. 设置即时同步不完整
- 快捷键配置数据在 `localStorage['editor_shortcuts_v1']`（`editor-shortcuts.js`）。
- 设置页保存后：`EditorShortcuts.save()` + 重渲染列表 + `syncGlobalSearchMenu()`（[settings.js L2184-2189](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L2184-2189)）。
- editor.js 通过 `window.addEventListener('storage', ...)` 刷新 tooltip（[editor.js L151](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L151)）。但 settings(iframe) 与 editor(iframe) 同窗口不同 iframe，`storage` 事件同窗口内不会跨 iframe 触发，**实时同步需借助 index 主界面广播**（现有 `postMessage` 通道，如 [index.html L954](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/index.html#L954) 主题广播，可复用同机制）。

### 4. 缺少快捷键速查说明
- 无一处集中说明画布区支持的全部快捷键。

## 决策（Phase 2 已确认）
- **范围**：先修右下角抽屉核心功能；工具栏保持现有逻辑（仅统一大小写兜底与展示）。
- **策略**：捕获阶段全局拦截（capture=true）统一处理，保证焦点在 ACE/输入框/弹窗内也能唤起。
- **补充需求**：设置改动后文案+组合键实时生效；新增"快捷键速查"说明入口。

## 改动方案

### A. `frontend/js/editor-shortcuts.js` — 新增统一分发能力
1. 新增 `registerHandler(action, handler)`：把 action → 回调存到内部 `_handlers`。
2. 新增 `getHandler(action)` / `hasHandler(action)`。
3. 新增 `startCapture()`：在 `window` 上 `addEventListener('keydown', 分发函数, true)`（捕获阶段）。遍历 `_handlers`，命中 `match(e, action)` 且 `preventDefault` 未发生则执行 handler。保证焦点在 iframe/ACE/输入框内均触发。
4. 保持现有 `match` 大小写无关逻辑不变（已满足"组合键唤起不分大小写"）。
5. 导出以上新 API。

### B. `frontend/js/editor.js` — 收敛右下角快捷键
1. 删除右下角抽屉功能分散的 9 处 `document.addEventListener('keydown')` 冒泡绑定。
2. 改为在对应按钮创建处调用 `EditorShortcuts.registerHandler(action, handler)`：
   - `fileTree` → `toggleFileTree`
   - `history` → `toggleHistoryPanel`
   - `recent` → `toggleRecentPanel`
   - `favorite` → `toggleFavPanel`
   - `overview` → `toggleOverviewRuler`
   - `backlinks` → `toggleBacklinks`
   - `outline` → `toggleOutline`
   - `tags` → `toggleTags`
   - `quickOpen` → open/close `openQuickSwitcher` 切换
3. 脚本末尾统一调用 `EditorShortcuts.startCapture()`（仅一次，加幂等标志）。
4. 工具栏/命令面板硬编码键统一大小写无关兜底：
   - [L6306](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6306)：`e.key === 'p'` → `e.key.toLowerCase() === 'p'`。
   - [L3599](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3599)：简化为 `e.key.toLowerCase() === 't'`。
5. 新增监听 `'editor-shortcuts-changed'` 消息（来自 index 广播），触发 `refreshAllShortcutTitles()` 更新 tooltip 文案与组合键。

### C. `frontend/settings.js` + `index.html` — 实时同步广播
1. settings.js 保存成功后，通过 `window.parent.postMessage({ type: 'editor-shortcuts-changed' }, '*')` 通知 index 主界面（如无 parent 则直接 `dispatchEvent` 兜底）。
2. index.html 主界面监听该消息，向所有子 iframe 广播（复用现有 `postMessage` 广播机制，同主题广播 [index.html L954](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/index.html#L954) 模式）。
3. editor.js 收到后刷新 tooltip（见 B5）。同时因 keydown 走 `match` 实时读 localStorage，组合键立即生效，无需重载。

### D. 快捷键速查说明入口
1. `editor.html` 底部状态栏新增"⌨️ 快捷键"按钮（`status-btn`），点击打开速查弹窗。
2. 速查弹窗列出：全部 `EditorShortcuts.DEFAULTS`（功能名 + 生效组合键，读 `get()` 显示实际生效值）+ 工具栏/系统级固定键（新建 Ctrl+T、保存 Ctrl+S、格式化 Ctrl+L、Markdown Ctrl+Shift+M、设置 Ctrl+,、全屏 F11、命令面板 Ctrl+P、终端 Alt+T、Ctrl+滚轮缩放、F3 贴图等）。
3. 弹窗样式对齐现有 modal / 主题变量，支持深浅主题。

### E. 测试
1. `electron/editor-shortcuts.test.js` 补充：
   - 捕获分发：注册 handler + `startCapture` 后，模拟事件触发（用捕获监听注入方式）。
   - 大小写：`match` 对 `Ctrl+Shift+F` 与 `Ctrl+Shift+f` 均命中的用例。
   - 覆盖返回值：`get('xxx')` 未配置回落默认。
2. `editor.html`/`editor.js` 无自动化测试框架，靠手动清单验证。

## 假设与决策记录
- 右下角抽屉功能的快捷键 handler 由各按钮创建处就近注册，避免大段集中注册表过长。
- `startCapture` 在捕获阶段分发，ACE/输入框/弹窗焦点均可唤起，且不会破坏 ACE 自身的输入类组合键（仅命中配置过的 action）。
- 工具栏与命令面板保留原绑定，仅统一大小写判定（不纳入可配置，遵循"先修右下角"范围）。
- 快捷键速查为静态展示 + 实时读取 `get()`，改动后立即反映。

## 验证步骤
1. 后端不受影响，跳过 Maven 编译（无后端改动）；对 `editor-shortcuts.js` 用 `node --check` 校验，运行 `npm run test:editor-shortcuts`。
2. `node --check frontend/js/editor.js` 语法校验。
3. 手动回归清单：
   - 焦点在 ACE 编辑区内，按各抽屉组合键（Ctrl+Shift+E/D/T/B/O/H/N/A/Y）均能唤起对应面板。
   - 焦点在编辑器输入框/弹窗内同样触发。
   - 命令面板 Ctrl+P（大小写键）、终端 Alt+T 冒泡阶段仍正常；按 Shift+CapsLock 或无差别键名大小写验证 match 均命中。
   - 设置页改某抽屉快捷键 → 保存 → 编辑器内 tooltip 文案与组合键实时更新，新组合键立即生效。
   - 速查弹窗展示全部功能与当前生效组合键，改动后刷新正确。
4. service 前后端状态不受影响；按项目规则提交前编译校验。