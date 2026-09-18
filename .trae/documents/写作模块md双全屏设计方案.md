# 写作模块 MD 视图双全屏：画布内全屏 + 全屏幕展示

## 一、Context（背景）

用户希望在写作模块的 Markdown 预览视图下拥有两种全屏能力：
1. **画布内全屏**：md 内容占满画布工作区（应用窗口内）；
2. **全屏幕展示**：类似浏览器 F11 的桌面真全屏，且**只保留干净的内容主体**（隐藏工具栏/标签栏/面包屑/状态栏/父窗口顶栏与左导航，仅显示 md 内容）。

**现状**：画布内全屏机制已存在（预览头部的 `mdFullscreenBtn` ⛶ 全屏 → `toggleMarkdownFullscreen()` 切 `.markdown-fullscreen`，md 独占工作区，Esc 退出）。但按钮文案不含"画布内全屏"语义，且 F11 全屏（`toggleFullscreen()`）只放大窗口、**不隐藏任何 UI chrome**，父窗口顶栏/左侧导航在全屏时依然可见，达不到"干净内容主体"。本次主要新增"全屏幕展示"，并把"画布内全屏"入口语义化。

## 二、Current State（关键位置）

- 预览头部按钮组：[editor.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/editor.html#L306-L316)：`mdFullscreenBtn`(⛶ 全屏) / `mdFollowBtn`(跟随) / `closeMarkdownBtn`(关闭)
- 画布内全屏：[editor.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L2000-L2012) `toggleMarkdownFullscreen` → `.markdown-fullscreen`（CSS [editor.css](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/styles/editor.css#L2147-L2218) 已完备）
- F11 全屏：[editor.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L6406-L6465) `toggleFullscreen`：Electron `setFullscreen` / 浏览器 `requestFullscreen`（catch 静默，因 [index.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1227) iframe 无 `allow="fullscreen"`）
- 关闭预览退全屏补丁：[editor.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/editor.js#L1916-L1919)（防止类残留画布空白）
- chrome 类名：`.editor-toolbar` / `.tab-bar` / `.breadcrumb-bar` / `.editor-statusbar` / `.compare-toolbar` / `.markdown-header`；父窗口 `.titlebar`（index.html L1130）、`.app-layout.sidebar-collapsed`（L104/L128 已可隐藏 `.titlebar-nav.sidebar` 与 `.sidebar-resizer`）
- 父子消息通道：editor 已有 `window.parent.postMessage({type:'editorReady'|'appNavigate'|'editorClipSaved'|...}, '*')`；父窗口 index.html 内联脚本 L1403 监听 message（L1517 editorReady、L1544 appNavigate、L1611 sidebar-collapsed 切换）

## 三、Proposed Changes（具体改动）

### 1. editor.html
- L310 `mdFullscreenBtn` 初始文案 `⛶ 全屏` → `⛶ 画布内全屏`。
- 其后新增按钮（放 `mdFullscreenBtn` 之后）：
  ```html
  <button class="inline-btn" id="mdStageFullscreenBtn" title="全屏幕展示（类似F11，仅保留干净内容主体）">🖥 全屏幕展示</button>
  ```

### 2. editor.js
- `elements` 数组（L106 所在行）追加 `mdStageFullscreenBtn`。
- `toggleMarkdownFullscreen`（L2008-2010）按钮文案改为 `⛶ 画布内全屏` / `退出画布内全屏`。
- 新增状态与函数（放在 `toggleMarkdownFullscreen` 之后）：
  ```js
  let stageFullscreen = false;
  let stageReturnMdFull = false; // 退出时恢复的 markdownFullscreen 原状态
  function toggleStageFullscreen(forceOpen) {
    const open = forceOpen !== undefined ? forceOpen : !stageFullscreen;
    if (open === stageFullscreen) return;
    stageFullscreen = open;
    if (open) {
      stageReturnMdFull = markdownFullscreen;
      if (elements.markdownPane.hidden) toggleMarkdownPreview(true);
      if (!markdownFullscreen) toggleMarkdownFullscreen(true);
      document.querySelector('.editor-app').classList.add('stage-fullscreen');
      enterDesktopFullscreen(true);
    } else {
      document.querySelector('.editor-app').classList.remove('stage-fullscreen');
      enterDesktopFullscreen(false);
      if (!stageReturnMdFull && markdownFullscreen) toggleMarkdownFullscreen(false);
    }
    syncStageBtn();
    window.parent.postMessage({ type: 'stageFullscreen', full: stageFullscreen }, '*');
    setTimeout(() => mainEditor.resize(), 60);
  }
  ```
  - `enterDesktopFullscreen(on)`：复用 `toggleFullscreen`（L6411-6435）同款分支 —— 有 `getElectronAPI().setFullscreen` 走 IPC，否则 `document.documentElement.requestFullscreen()/exitFullscreen().catch(()=>{})`。
  - `syncStageBtn()`：`mdStageFullscreenBtn` 文案 `🖥 全屏幕展示`→`🖥 退出全屏展示`，配 `active` 类。
- `toggleMarkdownPreview(false)` 处（L1916-1919）前插入：`if (stageFullscreen) toggleStageFullscreen(false);`（避免 stage 类残留画布空白）。
- Esc 分支（L6446-6456）：在现有 `markdownFullscreen` 分支前插入：
  ```js
  if (e.key === 'Escape' && stageFullscreen) { e.preventDefault(); toggleStageFullscreen(false); return; }
  ```
- `fullscreenchange`（L6460-6465）：追加 `if (!document.fullscreenElement && stageFullscreen) { stageFullscreen = false; ... 移除类/按钮态/恢复 md 全屏 }` —— 仅覆盖浏览器模式（Electron 的 OS 全屏不触发此事件，主退出路径是 Esc/按钮）。
- 绑定：`elements.mdStageFullscreenBtn.addEventListener('click', () => toggleStageFullscreen());`

### 3. editor.css（追加）
```css
/* 全屏幕展示：真全屏只留干净 md 内容主体 */
.editor-app.stage-fullscreen { grid-template-rows: minmax(0, 1fr); } /* 单轨铺满，避免 statusbar 27px 轨道残留 */
.editor-app.stage-fullscreen .editor-workspace { grid-row: 1 / -1; }
.editor-app.stage-fullscreen .editor-toolbar,
.editor-app.stage-fullscreen .tab-bar,
.editor-app.stage-fullscreen .breadcrumb-bar,
.editor-app.stage-fullscreen .editor-statusbar,
.editor-app.stage-fullscreen .compare-toolbar,
.editor-app.stage-fullscreen .markdown-header { display: none; }
```
> 说明：`.markdown-fullscreen` 已隐藏 main-pane 及抽屉，stage 仅需额外隐藏上述 chrome；`.markdown-header` 含全屏按钮，隐藏后退出靠 Esc。

### 4. index.html（父窗口协同）
- 内联脚本 `message` 监听（L1403 区域）新增分支：
  ```js
  if (event.data && event.data.type === 'stageFullscreen') {
    document.getElementById('titlebar').style.display = event.data.full ? 'none' : '';
    const appLayoutEl = document.querySelector('.app-layout');
    if (appLayoutEl) appLayoutEl.classList.toggle('sidebar-collapsed', event.data.full);
  }
  ```
  效果：OS 真全屏时顶栏与左侧导航一并隐藏，符合"干净内容主体"。
- （可选）给 `#editorFrame`（L1227）加 `allow="fullscreen"`，浏览器模式才能真全屏；低风险，非必需，建议顺手加。

## 四、Assumptions & Decisions

- **F11 原本语义不变**（全应用全屏、不隐藏 chrome）；新增的"全屏幕展示"是独立入口（按钮），不占用 F11。stage 全屏中以 Esc 退出为优先（Electron 的 OS 级全屏不触发 `fullscreenchange`）。
- **状态机**：stage ⇒ markdownFullscreen=true；退出时恢复进入前是否画布内全屏的原状态；关闭预览、切换标签不产生类残留。
- 浏览器（无 Electron）模式下 requestFullscreen 静默失败，但 stage 类仍生效 → "干净内容主体"依然成立（只是窗口未真正放大）；与现有 toggleFullscreen 策略一致。
- 画布内全屏仅文案语义化 + 入口保证，不改机制。

## 五、Verification

1. Electron 应用（`npm start`，前端 3001）：
   - 打开 md 预览 → 点「⛶ 画布内全屏」：md 占满画布、编辑区隐藏、Esc 退出。
   - 点「🖥 全屏幕展示」：OS/窗口全屏 + 工具栏/标签栏/面包屑/状态栏/父窗口顶栏/左侧导航全隐藏，仅纯 md 内容；Esc → 先退回"画布内全屏"态（若之前是）；再 Esc → 恢复分屏。
   - 关闭预览/切换标签：画布不空白（类残留 bug 不复现）。
   - F11 原行为不变；退出全屏不崩溃。
2. 浏览器直连 `http://127.0.0.1:3001/index.html`（无 Electron）：进 stage 静默（请求 fullscreen 失败但内容仍纯净），Esc 正常。
3. 无头验证（browser_use 对运行页）：`document.querySelector('.editor-app').classList.contains('stage-fullscreen')` 为 true、`.editor-toolbar` computed `display:none`、postMessage 触发后父窗口 `.titlebar` 隐藏。
4. 代码规范：`node --check` editor.js 语法通过。