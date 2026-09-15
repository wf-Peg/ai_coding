# 写作区 4 个 Bug 修复方案

## 概述（Summary）

修复写作区（editor.html）的 4 个回归 bug：

1. **Markdown 预览全屏态**：反链/大纲/标签悬浮抽屉遮住预览区右侧滚动条。
2. **Ctrl+P 被主进程全局拦截**：历史功能「编辑器内命令面板（命令面板 / 快捷操作）」无法在画布区唤起，被改成打开顶层全局命令面板。经用户确认：Ctrl+P 应对齐历史行为，唤起**编辑器内命令面板**。
3. **Ctrl+C/V 粘贴过度转义**：粘贴带 `text/html` 的纯文本时，空格被包进反引号、下划线被转义为 `\_`（TurndownService 无条件转换导致）。
4. **斜杠菜单插入的内容不渲染**：① `![图](D:/xxx.png)` Windows 绝对路径图片 404 无法渲染；② `- [ ]` 待办复选框被消毒白名单删除。

## 当前状态分析（Current State Analysis）

### Bug 1 — 全屏悬浮抽屉遮住滚动条
- `frontend/styles/editor.css` L1989-2000：`.markdown-fullscreen > .markdown-pane` 为全宽 `right: 0`，滚动条在视口最右缘。
- L2013-2035：悬浮抽屉 `position:absolute; right:10px; width:clamp(280px,34vw,460px)` 直接叠在 markdown-pane 之上，压住右缘滚动条。
- 抽屉可横向拖动，偏移写入抽屉元素自身的 `--md-off` 变量（`frontend/js/editor.js` L1804/L1810），markdown-pane 为兄弟节点读不到该变量。

### Bug 2 — Ctrl+P 被主进程拦截
- `electron/main.js` L2567/L2581-2584：`before-input-event` 把 Ctrl+K **和 Ctrl+P** 统一 `preventDefault` 并调用 `focusGlobalCmdPalette()`（打开顶层全局面板）。该逻辑由 f3af4b1 引入，`event.preventDefault()` 使按键永远到不了渲染层。
- 编辑器内命令面板的唤起函数 `triggerCommandPalette()`（`frontend/js/editor.js` L8343-8349）与父窗口转发入口 `data.action === 'focusCommandPalette'`（L5138-5147）**均完整存在**，只是链路被主进程拦截切断。
- `electron/preload.js` 已有 `onFocusGlobalCmdPalette`（L279）、`onFocusAceJump`（L285），可照葫芦画瓢新增 `onFocusEditorCmdPalette`。
- `frontend/index.html` L2164-2172 已有 `onFocusAceJump` 转发 iframe 的成熟模式（`postMessage({action:'focusAceJump'})`），可直接镜像。
- 设计意图（index.html L1388、editor.js L8273 注释）：**Ctrl+K = 顶层全局命令面板；Ctrl+P = 编辑器内快捷操作面板**。

### Bug 3 — 粘贴过度转义
- `frontend/js/editor.js` L4760-4777：粘贴捕获处理器只要剪贴板含 `text/html` 就 `new TurndownService(...)` 转换。
- Turndown 对 `<code>`/`<span>` 包裹的纯文本：内容被包进反引号；文本节点中的 `_` 被转义为 `\_`（文件名、路径等常见内容被破坏）。`md !== plain` 判断挡不住这种"确有差异但属误伤"的情况。

### Bug 4 — 图片绝对路径 & 待办复选框
- `frontend/js/media-render.js`：
  - L20-27 `ALLOWED_TAGS` 无 `input` → marked GFM 渲染的 `<li><input disabled="" type="checkbox">` 中 `input` 被消毒删除（待办不渲染）。
  - L30-40 `ALLOWED_ATTRS` 无 `type/checked/disabled`。
  - L43 `ALLOWED_CLASS_PREFIXES` 无 `task-list` → `class="task-list-item"` 被删。
  - L60-77 `mediaUrl()/rewriteImageSrc()` 仅重写 `media/\d{4}/` 相对路径；`D:/...` 原样保留，浏览器按相对 URL 解析为 `http://127.0.0.1:3001/D:/...` → 404。
- `electron/main.js` 前端服务器（L1838-1943，`startFrontendServer`）绑定 `127.0.0.1`，已含 `/__lan_ip`、`/api/*` 代理、SPA 回退路由，无本地文件服务路由；无自定义 protocol 注册。

## 提议修改（Proposed Changes）

### 1. Bug 1 — 全屏抽屉打开时预览区让位，滚动条可见

**文件：`frontend/styles/editor.css`**
在悬浮抽屉规则块（L2035 之后）新增（特异性高于 L1989 的 `right:0` 规则）：

```css
/* 全屏悬浮抽屉打开时：预览区右缘让位（宽度 + 30px 间隙），滚动条不被抽屉压住；
   --md-off 由拖动逻辑写入 workspace，抽屉左移时预览区跟随收缩 */
.editor-workspace.markdown-preview.markdown-fullscreen.show-backlinks > .markdown-pane,
.editor-workspace.markdown-preview.markdown-fullscreen.show-outline > .markdown-pane,
.editor-workspace.markdown-preview.markdown-fullscreen.show-tags > .markdown-pane {
  right: calc(clamp(280px, 34vw, 460px) + 30px - var(--md-off, 0px));
  transition: right var(--app-duration-panel) var(--app-ease-smooth);
}
```

**文件：`frontend/js/editor.js`**
把 `--md-off` 从抽屉元素提升到工作区（`editorWorkspace`），使兄弟节点 markdown-pane 也能读到：
- L1804：`const startOff = parseFloat(ws.style.getPropertyValue('--md-off')) || 0;`（`ws` 已在 L1800 定义，改为读 `ws`）。
- L1810：`ws.style.setProperty('--md-off', off + 'px');`（不再写 pane，或两者都写以兼容）。
- `resetFloatingDrawers()`（L1776-1781）：改为清除 `elements.editorWorkspace` 上的 `--md-off`。

关闭抽屉（`.show-*` 移除）或退出全屏后 `right` 平滑回到 0，无残留。

### 2. Bug 2 — Ctrl+P 恢复唤起编辑器内命令面板

**文件：`electron/main.js`**
- 拆分组合键（L2567）：`isCmdPaletteCombo` 仅保留 `key === 'k'`；新增 `isEditorCmdPaletteCombo` 匹配 `key === 'p'`（排除 Shift/Alt，逻辑同前）。日志条件同时纳入两者。
- 处理块（L2581-2584）：
  - Ctrl+K → 保持 `focusGlobalCmdPalette()`。
  - Ctrl+P → 新增 `focusEditorCmdPalette()`：恢复/聚焦窗口 + `mainWindow.webContents.send('focus-editor-cmd-palette')`（镜像 L2755-2761 `focusGlobalCmdPalette`）。
- 主窗口 webPreferences 区域无需改动（IPC 走既有 preload 通道）。

**文件：`electron/preload.js`**
在 L279 后新增：

```js
/**
 * 监听主进程请求唤起编辑器内命令面板（⌘/Ctrl+P，before-input-event 兜底触发）
 * @param {Function} callback - 无参回调
 */
onFocusEditorCmdPalette: (callback) => ipcRenderer.on('focus-editor-cmd-palette', () => callback()),
```

**文件：`frontend/index.html`**
在 `onFocusAceJump` 注册块（L2164-2172）后新增镜像块：

```js
// 主进程 before-input-event（⌘/Ctrl+P）→ IPC → 焦点在写作视图时转发编辑器 iframe 唤起编辑器内命令面板；
// 非写作视图回退顶层全局命令面板（与 Ctrl+K 行为一致，保证始终有响应）。
if (window.electronAPI && window.electronAPI.onFocusEditorCmdPalette) {
  window.electronAPI.onFocusEditorCmdPalette(() => {
    if (window.__debugShortcutLog) window.__debugShortcutLog('收到主进程 focus-editor-cmd-palette IPC');
    if (currentView === 'editor' && editorFrame && editorFrame.contentWindow) {
      editorFrame.contentWindow.postMessage({ action: 'focusCommandPalette' }, '*');
    } else if (typeof window.openGlobalCmdPalette === 'function') {
      window.openGlobalCmdPalette();
    }
  });
}
```

- 编辑器内 `data.action === 'focusCommandPalette'` 处理器（editor.js L5138-5147）已存在，无需改动；`triggerCommandPalette()` 自带 80ms 去重，与 Ctrl+K/IPC 多路径不冲突。
- 编辑器 iframe 自身 L8464 的 Ctrl+P keydown 保留（浏览器直开/无主进程拦截时的兜底），不受影响。

### 3. Bug 3 — 粘贴仅对"真富文本"做 HTML→MD 转换

**文件：`frontend/js/editor.js`**
L4760-4777 在 `new TurndownService` 前增加结构判定（DOMParser 解析，无依赖）：

```js
// 判断剪贴板 HTML 是否"真富文本"：含块级结构（标题/列表/表格/引用/代码块）或
// 链接/图片，或"格式化标签 + 块容器"组合（Word/网页加粗等）。
// 仅内联包裹（span/code/font 等）的纯文本 → 视为普通文本，走 ACE 默认粘贴，
// 避免空格被包进反引号、下划线被转义为 \_（Bug 修复）。
function isRichClipboardHtml(html) {
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var body = doc.body;
    if (body.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,li,table,thead,tbody,tr,td,th,blockquote,pre')) return true;
    if (body.querySelector('a[href],img')) return true;
    var fmt = body.querySelector('strong,em,b,i,u,s,del');
    var block = body.querySelector('p,div');
    return !!(fmt && block);
  } catch (e) { return false; }
}
```

将 `if (html && /<[a-z][\s\S]*>/.test(html))` 改为 `if (html && isRichClipboardHtml(html))`。其余逻辑（turndown 参数、`md !== plain` 判断、插入/回退）保持不变。

### 4. Bug 4 — 本地绝对路径图片渲染 + 待办复选框

**文件：`frontend/js/media-render.js`**
- `ALLOWED_TAGS`（L20-27）追加 `'input'`。
- `ALLOWED_ATTRS`（L30-40）追加 `'type'`、`'checked'`、`'disabled'`。
- `ALLOWED_CLASS_PREFIXES`（L43）追加 `'task-list'`（保留 marked 的 `task-list-item` 类）。
- 扩展 `rewriteImageSrc()`（L69-77）：追加一条盘符/`file:///` 路径 → 本地文件路由的重写：

```js
/** Windows 绝对路径 / file:/// → 前端服务器本地文件路由（仅 src） */
function localFileUrl(p) {
  var clean = String(p).replace(/^file:\/\/\//, '').replace(/\\/g, '/');
  return '/__local_file?path=' + encodeURIComponent(clean);
}
```

`rewriteImageSrc` 的替换改为两级：原有 `media/\d{4}/` 规则不变，追加
`/(src)=["'](file:\/\/\/[^"']+|(?:[A-Za-z]:[\\/])[^"']+)["']/gi` → `localFileUrl(p)`。
（`https://` 不会误匹配：锚定 `^[A-Za-z]:` 只命中 `X:` 开头且 X 为单个字母的路径。）

**文件：`electron/main.js`**
在 `startFrontendServer` 的 http 处理器中、`/__lan_ip` 分支（L1861）之后新增本地文件路由（仅回环端口，仅图片扩展名白名单，防误用）：

```js
// 写作区 Markdown 图片本地绝对路径（D:/xxx.png、file:///…）渲染兜底：
// 前端把 src 重写为 /__local_file?path=…，此处仅回环监听、仅放行图片扩展名。
if (reqPath0 === '/__local_file') {
  const u = new URL(req.url, `http://127.0.0.1:${config.frontendPort}`);
  const target = u.searchParams.get('path') || '';
  const ext = path.extname(target).toLowerCase().replace('.', '');
  const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };
  if (!IMG_MIME[ext]) { res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' }); res.end('{"error":"unsupported type"}'); return; }
  try {
    const p = path.resolve(target);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': IMG_MIME[ext], 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
  }
  return;
}
```

- 复用编辑器预览 `renderMarkdownPreview` → `MediaKit.render.renderMarkdown` 管线（editor.js L1854），一处修改全端生效（含父窗口知识模块等）。
- 待办复选框：marked GFM 默认输出 `<li class="task-list-item"><input disabled="" type="checkbox">`，消毒放行后原生渲染。可选：在 `editor.css` 给 `.markdown-body input[type=checkbox]` 加 `margin-right: 6px; vertical-align: -2px; cursor: default;` 微调观感。

## 假设与决策（Assumptions & Decisions）

- **Bug 1 场景**：仅 Markdown 预览全屏态（`markdown-fullscreen`）的悬浮抽屉。非全屏分屏态无抽屉（上一会话已禁用），不涉及。方案采用"预览区让位"而非"改抽屉半透明"——抽屉可拖动，唯有让位能保证滚动条始终可点。
- **Bug 2 目标**（用户已确认）：Ctrl+P 恢复为编辑器内命令面板（历史功能对齐）；Ctrl+K 保持打开顶层全局命令面板（既有设计，index.html L1388 注释"编辑器内快捷面板由 Ctrl+P 承担"）。非写作视图下按 Ctrl+P 回退打开全局面板，保证任何焦点下都有响应。
- **Bug 3 收敛规则**：仅内联包裹（span/code/font 等）的 HTML 视为纯文本；含块级结构或链接/图片，或"格式化+块容器"组合的才转 Markdown。取舍：从网页复制无结构的普通段落会丢失加粗/斜体等内联格式（转为纯文本），换取粘贴不被转义破坏——以用户报告的场景（复制路径/代码/文本）为优先。
- **Bug 4 图片路径范围**：支持 `D:/xxx.png`（正斜杠）与 `file:///D:/xxx.png`；反斜杠路径 `D:\xxx.png` 会被 marked 当作转义符剥离，不在本方案范围内（斜杠菜单插入的 `![]()` 由用户填正斜杠即可）。路由仅服务图片扩展名、仅回环监听，不引入自定义 protocol。
- 不动 `triggerCommandPalette` 去重/编辑器内 keydown 兜底；不动既有 turndown 失败回退逻辑。

## 验证步骤（Verification）

1. **语法检查**（4 个改动文件）：
   ```
   node --check frontend/js/editor.js
   node --check frontend/js/media-render.js
   node --check electron/main.js
   node --check electron/preload.js
   ```
2. **Bug 2 手动验证**：重启应用进入「写作」，焦点在画布区按 `Ctrl+P` → 应弹出编辑器内命令面板（含 新建/保存/大纲/AceJump/到写作页 等条目，非顶层搜索面板）；在其它视图按 `Ctrl+P` → 回退顶层全局面板；`Ctrl+K` → 仍为顶层全局面板。
3. **Bug 1 手动验证**：打开长文档 → `Ctrl+Shift+M` 预览 → `⛶ 全屏` → 按 `Ctrl+Shift+B`（反链）唤醒抽屉 → 预览区右缘让位、滚动条完整可见可拖；横向拖动抽屉，滚动条随之保持可见；关闭抽屉/退出全屏后预览恢复全宽。
4. **Bug 3 手动验证**：从资源管理器/代码编辑器/网页复制含空格与下划线的文本（如 `D:\snipaste_20260915_115759.png`、`some file.txt`）粘贴到画布 → 原样纯文本，无反引号、无 `\_`；从含链接/列表的网页复制 → 仍转为 Markdown（链接/列表保留）。
5. **Bug 4 手动验证**：画布输入 `![x](D:/<存在的截图绝对路径>)` → 预览渲染出图片；输入 `- [ ] 待办` → 预览出现可勾选复选框（`- [x]` 已勾选态正常）；不存在的路径 → 图片占位/404 但不影响其它内容渲染。
