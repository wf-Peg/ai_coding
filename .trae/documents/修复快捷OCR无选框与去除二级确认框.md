# 修复快捷 OCR：截图无选框「图像解码失败」 + 去除二级确认框

## Summary

对标 K:\OCR 的核心体验：**快捷键唤起 → 框选 → 自动进剪贴板（无结果弹窗、无二级确认框）**，修复当前两个问题：

1. **阻断性 bug**：按 F5 唤起后覆盖层无选框，直接提示「截图失败：图像解码失败」。
2. **UX 不符**：框选完成后仍需点「🔤 提取文字（确认框）」才执行，与 K:\OCR「框选即自动复制」不一致。

改后目标：F5 唤起 → 拖出选区 → **松开鼠标立即自动 OCR 并复制到剪贴板**，右下角复用剪贴板气泡播报「🔤 OCR · 已复制 N 字 · 耗时 Xms」；未识别到文字弹警告气泡；全程无任何确认框/结果弹窗。

---

## Current State Analysis（现状分析）

### 问题 1 根因：覆盖层 PNG 解码路径脆弱

- 覆盖层显示由 [screenshot-service.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-service.js) 的 `encodeForDisplay()` 决定：
  - Windows 下 `image.toBitmap()` 成功且 `raw.length <= 24MB`（≈600 万像素，4K@100% 33MB 会超）→ `mode:'raw'`，渲染层走 `showRaw()`（`putImageData` 整块写入，**不涉及图片解码**）→ 稳定。
  - 反之回退 `mode:'png'`，`payload.bg = image.toPNG()`。
- 渲染层 [screenshot-window.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-window.html#L304-L329) 的 PNG 分支用 `<img src=blob>` 解码，`bg.onerror` 触发即发送 `screenshot:init-error('图像解码失败')`，主进程 `failScreenshot()` 关闭覆盖层 → **用户看不到选框，只见「截图失败」toast**。
- **结论**：用户在较大/高 DPI 屏幕（raw 超 24MB 走 PNG）或 `toBitmap` 偶发异常时命中此分支，`<img>` 解码大 PNG 失败 → 覆盖层立刻关闭。raw 路径从不解码，是本类故障的根因规避点。

### 问题 2 根因：OCR 模式二次确认框

- `applyMode()` 在 ocrMode 下只隐藏 btnCopy/btnSave/btnPaste/标注按钮，**保留 btnOcr + btnCancel**，因此框选后工具栏仍显示「🔤 提取文字」「✕ 取消」（即用户所称的二级确认框，附图所示）。
- OCR 只在点击「提取文字」/按 Enter/双击时通过 `confirm('ocr')` 触发，**不会在松开鼠标后自动执行**，与 K:\OCR「框选即自动复制」不符。
- 选区在 OCR 模式下已隐藏手柄（无可调整），故松开鼠标自动触发是自然的、无副作用。

---

## Proposed Changes（变更方案）

### 变更 1：规避/兜底覆盖层图片解码（修复「图像解码失败」）

**文件 A：`electron/screenshot/screenshot-service.js` → `encodeForDisplay()`**
- 将 `MAX_RAW = 24MB` 提升到高容值（如 `256MB`），使全高清→4K 及大部分高 DPI 屏幕都走 raw 路径（渲染层 `putImageData`，**零解码**），从根上规避大 PNG 的 `<img>` 解码失败。仅对极巨大帧缓冲（多显示器拼接等）才回退 PNG。

**文件 B：`electron/screenshot/screenshot-window.html` → `screenshot:init` 的 PNG 分支**
- 不再用 `<img>` 单一路径：改为 `createImageBitmap(blob)`（对大型位图更稳）成功后 `bgCanvas.getContext('2d').drawImage(bitmap, ...)` → 置背景为 bgCanvas（复用现有 `showRaw` 之后的展示形态）→ `onBackgroundReady()`；`createImageBitmap` 也失败才发送 `screenshot:init-error`。
- 保留现有 `<img>` blob + objectURL 路径不删（作为回退），但把 onerror 的「直接 init-error」改为先尝试 `createImageBitmap` 兜底。

### 变更 2：OCR 模式「松开即自动 OCR」，去掉二级确认框

**文件 C：`electron/screenshot/screenshot-window.html`**
1. **`applyMode()`**：ocrMode 分支新增隐藏整个工具栏（`set('toolbar', false)`），不再显示「提取文字/取消」确认框；仅保留 hint「拖拽框选 → 松开自动识别 → Esc 取消」。
2. **`mouseup` 处理器**（[L475-509](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-window.html#L475-L509)）：在验证 `selRect.w/h>=4` 后，若 `ocrMode` 且本次是选区拖拽（非标注），直接 `confirm('ocr')` 并 return，**不调用 `updateSel`（不再展示工具栏）**；完整模式维持原逻辑。
3. 保留 Enter/双击的显式 `confirm(ocrMode?'ocr':'copy')` 与 Esc 取消，作为冗余/兜底。

> 说明：`confirm('ocr')` 现有实现会 `screenshot:confirm` → 主进程 [handleConfirm 'ocr'](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-service.js#L474-L477) → `quickOcr(cropped)` → 自动写剪贴板 + `showClipboardEntryToast` 气泡；未识别走 `warn` 气泡。此链路已完整，无需改动主进程。覆盖层在确认后经 `closeScreenshotWindow` 关闭，无残留。

### 变更 3：计划文档同步（可选，轻量）

- 更新计划无硬性文件；本计划即执行依据。若实施时发现 `hint` 文案或 `tools-core.js`/`settings` 需对齐「自动识别」语义，可顺带微调，不新增功能。

---

## Assumptions & Decisions（假设与决策）

- **「去掉二级确认框」= OCR 模式框选完成（松开鼠标）即自动 OCR 复制**，不是去掉所有反馈；toast 气泡仍保留（那是「已复制」的播报，非确认框，且符合「未识别也要提醒」）。
- raw 提升校验位：`MAX_RAW 24MB→256MB` 属低风险，raw 的 `putImageData` 不涉及 renderer 图片解码，是消除「图像解码失败」最直接的根因规避；PNG 分支仍保留并加 `createImageBitmap` 兜底，双保险。
- OCR 模式隐藏整条工具栏：因为确认框本身就是要移除的对象，预留按钮均无必要；完整截图模式工具栏与标注逻辑完全不动。
- 不改动主进程 quickOcr/剪贴板气泡链路（已符合目标态），不动 `ocr-result-window`/`screenshot:ocr` IPC（完整模式「查看结果」复用仍保留）。

---

## Verification（验证）

实施后依次手动验证（无需回归完整截图，因完整模式工具栏/标注零改动，仅 raw/PNG 显示路径变更）：

1. **语法检查**：`node --check` 通过被改的 `screenshot-service.js`；抽取 `screenshot-window.html` 内联 `<script>` 用 `node --check -` 校验。
2. **F5 快捷 OCR**（Windows 常规屏 + 若可切一个高清屏）：按下 F5 → 出现清晰选框（无「图像解码失败」）→ 拖出选区并**松开** → 不出现任何确认框，立即自动复制 → 右下角弹「🔤 OCR · 已复制 N 字 · 耗时 Xms」气泡 → 到任意输入框 Ctrl+V 校验内容正确（中文/ASCII）。
3. **未识别**：框选纯空白区域 → 松开 → 弹**警告式**气泡「🔤 OCR 未识别到文字，请重新框选」，不复制、不弹结果窗。
4. **取消**：F5 → Esc → 覆盖层淡出，无残留；再按 F5 正常复用覆盖层。
5. **完整截图模式回归**（`设置 → 快捷OCR/截图 → 默认模式=完整`）：F5 框选仍显示原工具栏（复制/保存/贴图/标注），Enter 复制正常；F6 仍贴图；raw/PNG 两种显示均无「图像解码失败」。
6. **切换即时生效**：设置页 OCR↔完整 切换后按 F5 立即按新模式行为执行。