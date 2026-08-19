# 截图工具 Snipaste 对标 UX 增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏「选区↔标注坐标对齐」的前提下，对标 Snipaste 补齐选区十字准星/吸附/辅助线、短键动态提示、贴图增强与视觉细节，并提供自测清单。

**Architecture:** 全部工作在既有截图模块三类文件内增量完成：覆盖层 `electron/screenshot/screenshot-window.html`（选区绘制/DIP 空间）、贴图 `electron/screenshot/paste-window.html`（右键菜单/缩放重置）、主进程 `electron/screenshot/screenshot-service.js`（贴图重排 IPC）。新建增强全部跑在 DIP 空间，**不触碰 crop 换算与 `sfPhys` 物理映射**，从机制上避免坐标错乱。

**Tech Stack:** Electron（主进程 + 渲染层 `require('electron')`）、原生 HTML5 Canvas。无新依赖。

---

### Task 1: 覆盖层 — 新增 `#gui` 画布（十字准星 + 读数 + 辅助线）

**Files:**
- Modify: `electron/screenshot/screenshot-window.html`

**坐标规则：** `#gui` 画布与 `#mask`/`#sel` 同为 DIP 尺寸；辅助线/准星/读数全用 CSS 坐标，与 `selRect` 一致。不经过 `sfPhys`，不走背景物理像素，因此与标注/裁剪的物理映射完全隔离。

- [ ] **Step 1: 在 HTML 中挂 `#gui` 画布**

将 `<canvas id="mask" width="0" height="0"></canvas>` 所在行之后插入一行新 canvas：

```html
<canvas id="mask" width="0" height="0"></canvas>
<canvas id="gui"></canvas>
```

- [ ] **Step 2: 添加 `#gui` 样式**

在 `<style>` 内、`#hint { ... }` 规则之前插入：

```css
#gui { position: fixed; left: 0; top: 0; z-index: 4; pointer-events: none; }
```

（`z-index`：遮罩 `#mask` < 4 < 提示 `#hint`(5) < 工具栏(10)，保证准星浮于暗色遮罩之上，又不挡交互。）

- [ ] **Step 3: 引入 `gui`/`guiCtx` 与光标/吸附常量**

在变量声明区，紧跟 `const MAG_SIZE = 120, MAG_SCALE = 6;`（约 L139）之后插入：

```javascript
const gui = document.getElementById('gui');
const guiCtx = gui.getContext('2d');
let lastCursor = null;   // 最近一次鼠标位置（供选区改变时重绘辅助线/读数）
const SNAP_PX = 8;       // 选区吸附阈值（像素）
const RGB_CROSS = ['#ff4d4d', '#4caf50', '#4d8bff']; // 红/绿/蓝十字准星
```

- [ ] **Step 4: `onBackgroundReady` 中校准 `#gui` 尺寸**

在 `onBackgroundReady` 内、`mask.height = display.height;`（约 L194）之后插入：

```javascript
gui.width = display.width;
gui.height = display.height;
gui.style.width = '100%';
gui.style.height = '100%';
```

- [ ] **Step 5: `resetOverlay` 中清理 `#gui` 与十字状态**

在 `resetOverlay` 内、`ctx.clearRect(0, 0, mask.width || 0, mask.height || 0);`（约 L185）之后插入：

```javascript
guiCtx.clearRect(0, 0, gui.width || 0, gui.height || 0);
lastCursor = null;
document.body.style.cursor = 'crosshair';
```

- [ ] **Step 6: 新增 `renderGui(cx, cy)` 绘制函数**

在 `updateMagnifier` 函数定义之前插入：

```javascript
// ── 十字准星 + 辅助线 + 读数（DIP 空间，单 canvas 合绘） ──
function renderGui(cx, cy) {
  const W = gui.width, H = gui.height;
  guiCtx.clearRect(0, 0, W, H);
  // 辅助线：选中后从选区四边延伸到屏幕边缘（浅蓝虚线）
  if (selRect && selRect.w >= 4 && selRect.h >= 4) {
    guiCtx.save();
    guiCtx.strokeStyle = 'rgba(63,140,255,0.3)';
    guiCtx.setLineDash([4, 4]);
    guiCtx.lineWidth = 1;
    guiCtx.beginPath();
    guiCtx.moveTo(selRect.x, 0); guiCtx.lineTo(selRect.x, H);
    guiCtx.moveTo(selRect.x + selRect.w, 0); guiCtx.lineTo(selRect.x + selRect.w, H);
    guiCtx.moveTo(0, selRect.y); guiCtx.lineTo(W, selRect.y);
    guiCtx.moveTo(0, selRect.y + selRect.h); guiCtx.lineTo(W, selRect.y + selRect.h);
    guiCtx.stroke();
    guiCtx.restore();
  }
  // 无光标则不画准星（仅辅助线场景）
  if (cx == null || cy == null) return;
  // 经典红绿蓝三色细十字
  for (let k = 0; k < 3; k++) {
    const off = k - 1;
    guiCtx.strokeStyle = RGB_CROSS[k];
    guiCtx.lineWidth = 1;
    guiCtx.beginPath();
    guiCtx.moveTo(cx + off, 0); guiCtx.lineTo(cx + off, H);
    guiCtx.moveTo(0, cy + off); guiCtx.lineTo(W, cy + off);
    guiCtx.stroke();
  }
  guiCtx.closePath();
  // 读数：未选区显坐标，选坑中/后显 w×h
  const label = (selRect && selRect.w >= 4 && selRect.h >= 4)
    ? Math.round(selRect.w) + ' × ' + Math.round(selRect.h)
    : Math.round(cx) + ', ' + Math.round(cy);
  guiCtx.font = '11px "IBM Plex Sans","Noto Sans SC",sans-serif';
  const tw = guiCtx.measureText(label).width + 12;
  const bx = Math.min(cx + 14, W - tw - 4);
  const by = cy < H - 22 ? cy + 14 : cy - 22;
  guiCtx.fillStyle = 'rgba(0,0,0,0.6)';
  guiCtx.fillRect(bx, by, tw, 18);
  guiCtx.fillStyle = '#fff';
  guiCtx.fillText(label, bx + 6, by + 13);
}
```

- [ ] **Step 7: `processMouseMove` 中刷新准星/光标**

在 `processMouseMove` 内、`updateMagnifier(e.x, e.y);`（约 L368）之后插入：

```javascript
lastCursor = { x: e.x, y: e.y };
renderGui(e.x, e.y);
// 光标反馈：悬停选区内移动、其余十字
document.body.style.cursor = (selRect && dragMode && dragMode !== 'move' && !dragMode.dir) ? 'default'
  : (selRect && e.x >= selRect.x + 2 && e.x <= selRect.x + selRect.w - 2 &&
     e.y >= selRect.y + 2 && e.y <= selRect.y + selRect.h - 2) ? 'move' : 'crosshair';
```

- [ ] **Step 8: `updateSel` 末尾跟随重绘辅助线/读数**

在 `updateSel` 末尾（`hint.style.display = 'none';` 之前）插入：

```javascript
if (lastCursor) renderGui(lastCursor.x, lastCursor.y); else renderGui(null, null);
```

- [ ] **Step 9: 校验**

运行：`node --check electron/main.js`（仅确认整体脚本无 `require` 层语法回归）+ 在覆盖层输入字号处 `grep -n "renderGui" electron/screenshot/screenshot-window.html`
预期：出现 6 处 `renderGui`（定义 1 + 调用 5：mousemove、updateSel、resetOverlay 清理用 `guiCtx.clearRect` 不计）。

- [ ] **Step 10: Commit**

```bash
git add electron/screenshot/screenshot-window.html
git commit -m "feat(screenshot): 覆盖层十字准星/辅助线/读数 (DIP, 不触碰裁剪映射)"
```

---

### Task 2: 覆盖层 — 选区吸附（屏幕边缘 + 中心线）

**Files:**
- Modify: `electron/screenshot/screenshot-window.html`

**设计决策：** 吸附仅在 `move`（拖动已选选区）时生效，`draw`/手柄缩放不吸附，避免新选区被拉力干扰、也避免与手柄定位冲突。只改 `selRect`（DIP），不碰任何物理裁剪。

- [ ] **Step 1: 新增 `snapRect()` 辅助函数**

在 `clampRect()` 定义（约 L448）之后插入：

```javascript
// 选区吸附：移动时贴齐屏幕四边与垂直/水平中心线（阈值 SNAP_PX DIP 像素）
function snapRect() {
  if (!selRect || dragMode !== 'move') return;
  const r = selRect;
  // 屏幕边缘
  if (Math.abs(r.x) < SNAP_PX) r.x = 0;
  else if (Math.abs((display.width - (r.x + r.w))) < SNAP_PX) r.x = display.width - r.w;
  if (Math.abs(r.y) < SNAP_PX) r.y = 0;
  else if (Math.abs((display.height - (r.y + r.h))) < SNAP_PX) r.y = display.height - r.h;
  // 屏幕中心线
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (Math.abs(cx - display.width / 2) < SNAP_PX) r.x = Math.round(display.width / 2 - r.w / 2);
  if (Math.abs(cy - display.height / 2) < SNAP_PX) r.y = Math.round(display.height / 2 - r.h / 2);
  // 边界收敛（与 clampRect 一致）
  r.x = Math.max(0, Math.min(r.x, display.width - 4));
  r.y = Math.max(0, Math.min(r.y, display.height - 4));
}
```

- [ ] **Step 2: 在 `processMouseMove` 计算选区后调用**

在 `processMouseMove` 内 `clampRect();` 与 `drawMask(selRect);` 之间（draw/move 分支之后的主要更新路径）插入 `snapRect();`：

```javascript
    snapRect();
    drawMask(selRect);
    updateSel(selRect);
```

- [ ] **Step 3: 校验**

运行：`node --check electron/main.js`；随后 `grep -n "snapRect" electron/screenshot/screenshot-window.html`
预期：2 处（定义 + 调用）；无其它语法问题。

- [ ] **Step 4: Commit**

```bash
git add electron/screenshot/screenshot-window.html
git commit -m "feat(screenshot): 选区移动吸附屏幕边缘与中心线"
```

---

### Task 3: 覆盖层 — 选中后动态引导 Toast + 光标反馈收尾

**Files:**
- Modify: `electron/screenshot/screenshot-window.html`

- [ ] **Step 1: 新增一次性引导标志**

在变量声明区（`let lastCursor = null;` 之后）插入：

```javascript
let hintedSel = false; // 选区首次出现时是否已提示后续操作
```

在 `resetOverlay` 内（`wheelAccum = 0; canceling = false;` 附近）重置：

```javascript
hintedSel = false;
```

- [ ] **Step 2: 选区首次有效时给出下一步引导 Toast**

在 `updateSel` 内、`toolbar.style.display = 'flex';` 之前插入：

```javascript
if (!hintedSel) {
  hintedSel = true;
  showHint('拖动内部移动 · 拖手柄调整 · 滚轮缩放 · 方向键微调 · R/O/A/P/T/M/E 标注 · Enter 复制', 2600);
}
```

- [ ] **Step 3: 校验**

运行：`node --check electron/main.js`；确认 `hintedSel` 有声明/重置/使用三处：`grep -n "hintedSel" electron/screenshot/screenshot-window.html`

- [ ] **Step 4: Commit**

```bash
git add electron/screenshot/screenshot-window.html
git commit -m "feat(screenshot): 选中后动态引导提示"
```

---

### Task 4: 贴图窗口 — 右键菜单增强（还原尺寸/透明度±/重排/关闭全部 + 缩放显示）

**Files:**
- Modify: `electron/screenshot/paste-window.html`

**注意：** `scale`、`opacity` 已在贴图渲染层声明（`let scale = 1; let opacity = 1;`）。还原尺寸复用现有 `paste:zoom-at`（scale=1 回初始尺寸），无需新主进程 IPC。

- [ ] **Step 1: 新增菜单的 `.menu-label` 样式**

在样式块 `#menu button:hover { ... }`（约 L58，`#menu .sep` 规则之前）插入：

```css
#menu .menu-label { color: #9aa0a6; pointer-events: none; }
```

- [ ] **Step 2: 扩展 `showMenu` 菜单项并显示缩放百分比**

将 `showMenu` 中的 HTML（约 L268-274）替换为：

```javascript
    menu.innerHTML =
      '<button data-a="pin">' + (isPinned ? '📌 取消置顶' : '📌 置顶') + '</button>' +
      '<button data-a="copy">📋 复制图片</button>' +
      '<button data-a="ocr">🔤 OCR 识别</button>' +
      '<button data-a="save">💾 保存为文件</button>' +
      '<div class="sep"></div>' +
      '<button class="menu-label">缩放 ' + Math.round(scale * 100) + '%</button>' +
      '<button data-a="reset">↺ 还原到初始尺寸</button>' +
      '<button data-a="op-">◐ 透明度 −</button>' +
      '<button data-a="op+">◑ 透明度 +</button>' +
      '<button data-a="rearrange">▦ 重新排列</button>' +
      '<button data-a="closeAll">✕ 关闭全部贴图</button>' +
      '<div class="sep"></div>' +
      '<button data-a="close">✕ 关闭贴图</button>';
```

- [ ] **Step 3: 处理新菜单动作**

在 `menu.addEventListener('click', ...)` 内、`else if (a === 'save') ...` 分支之后、`else if (a === 'close')` 分支之前插入：

```javascript
    else if (a === 'reset') { const prev = scale; scale = 1; zoomTo(prev, 1, window.innerWidth / 2, window.innerHeight / 2); }
    else if (a === 'op-') { opacity = Math.max(0.2, opacity - 0.1); ipcRenderer.invoke('paste:set-opacity', opacity); }
    else if (a === 'op+') { opacity = Math.min(1, opacity + 0.1); ipcRenderer.invoke('paste:set-opacity', opacity); }
    else if (a === 'rearrange') ipcRenderer.invoke('paste:rearrange');
    else if (a === 'closeAll') ipcRenderer.send('screenshot:close-paste-windows');
```

- [ ] **Step 4: 校验**

运行：`node --check electron/main.js`；`grep -n "menu-label\|data-a=\"reset\"\|data-a=\"closeAll\"" electron/screenshot/paste-window.html` 均存在。

- [ ] **Step 5: Commit**

```bash
git add electron/screenshot/paste-window.html
git commit -m "feat(screenshot): 贴图右键菜单增强（还原尺寸/透明度/重排/关闭全部）"
```

---

### Task 5: 主进程 — `paste:rearrange`（层叠重排贴图）

**Files:**
- Modify: `electron/screenshot/screenshot-service.js`

**注意：**「关闭全部贴图」已由既有 `screenshot:close-paste-windows` → `closeAllPasteWindows()` 承担（约 L710/L603），无需新增。「还原尺寸」「透明度±」走既有 `paste:zoom-at`/`paste:set-opacity`。唯缺 `paste:rearrange`。

- [ ] **Step 1: 新增 `paste:rearrange` handle**

在 `registerIpc()` 中、`ipcMain.handle('paste:zoom-at', ...)` 定义之后插入：

```javascript
  // 层叠重排：把当前所有打开贴图按 30px 偏移级联铺开（保持各自当前尺寸）
  ipcMain.handle('paste:rearrange', () => {
    let n = 0;
    for (const w of pasteWindows) {
      if (w.isDestroyed()) continue;
      const [cw, ch] = w.getSize();
      try {
        w.setBounds({ x: 100 + n * 30, y: 100 + n * 30, width: cw, height: ch });
      } catch (e) {}
      n++;
    }
    return true;
  });
```

- [ ] **Step 2: 校验**

运行：`node --check electron/screenshot/screenshot-service.js`
预期：无输出（语法通过）。

- [ ] **Step 3: Commit**

```bash
git add electron/screenshot/screenshot-service.js
git commit -m "feat(screenshot): 贴图层叠重排 IPC paste:rearrange"
```

---

### Task 6: 校验 + 自测清单

**Files:**
- Create: `docs/superpowers/self-test/screenshot-ux-self-test.md`

- [ ] **Step 1: 全量语法校验**

```bash
node --check electron/main.js && node --check electron/screenshot/screenshot-service.js && echo OK
```
预期：输出 `OK`，无报错。

- [ ] **Step 2: 写自测清单**

创建 `docs/superpowers/self-test/screenshot-ux-self-test.md`，内容：

```markdown
# 截图 UX 增强——自测清单（macOS + Windows 各跑一遍）

## A. 选区与坐标对位（回归硬性）
- [ ] F1 截图，拖选区域，框选一个矩形标注 → 确认，输出图与选区完全一致（不错位/不糊）。
- [ ] 选区拖拽移动、8 向手柄调整、滚轮缩放、方向键微调均正常。
- [ ] 放大镜取到像素与十字准星所在位置一致。

## B. 十字准星 / 辅助线 / 吸附（新增）
- [ ] 准星为红/绿/蓝三条细线，随光标移动，读数为坐标；选坑中后读数为 w×h。
- [ ] 选中后显示淡蓝虚线辅助线，从选区四边延伸到屏幕边缘。
- [ ] 拖动已选区靠近屏幕四条边/垂直/水平中心线时吸附（阈值 ~8px）。

## C. 动态提示 / 光标反馈
- [ ] 初始提示"拖拽选择区域…"，选中后弹出 2.6s 引导 Toast。
- [ ] 光标：选区内=移动、选区外=十字。

## D. 贴图
- [ ] 拖放贴图、滚轮缩放、Cmd+滚轮透明度、双击关闭、置顶切换正常。
- [ ] 右键菜单显示缩放 %；还原到初始尺寸=回到贴图时大小。
- [ ] 「透明度 − / +」有效；「重新排列」把多个贴图级联铺开；「关闭全部贴图」全部退出。
- [ ] 文本贴图后右键菜单、缩放、透明度仍正常。

## E. 性能
- [ ] 准星/辅助线绘制无卡顿（连续画圈光标流畅）。
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/self-test/screenshot-ux-self-test.md
git commit -m "test(screenshot): Snipaste 对标 UX 自测清单"
```

---

## Self-Review（实施前自查记录）

- **Spec 覆盖**：十字准星+读数（Task1）✓；吸附+延伸参考线（Task1 辅助线 + Task2 吸附）✓；动态提示 + 光标反馈（Task3）✓；贴图还原/透明度±/重排/关闭全部 + 缩放显示（Task4/5）✓；启动轻量不改 ✓；自测清单（Task6）✓；坐标不错乱由「全 DIP、不碰 crop」在 Task1/2 承载并在 Task6 A 回归 ✓。
- **占位扫描**：无 TBD/TODO，所有编辑均给完整代码与锚点。
- **类型/命名一致性**：覆盖层 `selRect` 用 `{x,y,w,h}`、渲染层贴图 `scale/opacity` 为既有 `let` 变量、`zoomTo(prev,next,cx,cy)`/`showHint(msg)`/`closeAllPasteWindows()`/`screenshot:close-paste-windows` 均为既有符号，跨 Task 引用一致。
- **已知取舍**：吸附仅在 `move` 模式生效（避免干扰新建选区/新手柄），已在 Task2 说明。