# 截图工具转"快捷 OCR"——K:\OCR 调研与改造实施计划

## 1. 摘要 (Summary)

调研 K:\OCR（RapidOcrOnnx 截图 OCR 工具）后，参考其核心体验（快捷键唤起 → 框选 → OCR → 文本自动进剪贴板 → 关闭，无结果弹窗、追求速度），将本应用现有「截图工具」改造为 **默认快捷 OCR**：

- 新增配置 `screenshotMode`（默认 `ocr`）：**OCR 模式** 下 F5 唤起后只做"框选文字区域 → 离线 OCR → 自动复制文本到剪贴板 → **复用剪贴板监听气泡**播报已复制（未识别到时以警告气泡提醒）"；**完整截图模式** 一键恢复现有全部功能（截图复制/保存/贴图/标注），**代码全部保留不删**，仅按模式切换 UI 与默认动作。
- OCR 模型从 PP-OCRv4 升级到 **PP-OCRv5**（与 K:\OCR 对齐，更快更准），同步更新模型常量、下载脚本与打包清单。
- 快捷键默认调整（均可设置页修改）：OCR/截图快捷键 F1 → **F5**；贴图快捷键 F2 → **F6**，且**贴图仅在完整截图模式下注册生效**。

## 2. K:\OCR 调研报告

### 2.1 目录构成（已勘察）
| 文件 | 说明 |
| --- | --- |
| `OCR.exe` | 主程序（截图 + OCR 一体） |
| `RapidOcrOnnx.exe` | RapidOcrOnnx 推理框架执行体 |
| `models/ch_PP-OCRv5_det_infer.onnx` | PP-OCRv5 文本检测模型 |
| `models/ch_PP-OCRv5_rec_infer.onnx` | PP-OCRv5 文本识别模型 |
| `models/ch_ppocr_mobile_v2.0_cls_train.onnx` | 方向分类模型（小模型，可选） |
| `models/ppocr_keys_v1.txt` | PP-OCR 字典 |

> K:\OCR 仅为发布版二进制（无源码），调研基于用户提供的使用说明 + 文件清单 + RapidOCR/PP-OCR 公开技术事实。

### 2.2 技术栈
- **推理框架**：RapidOcrOnnx（RapidOCR 的 ONNX 运行时封装，官方 PaddleOCR 模型导出 onnx，onxruntime 推理，纯本地离线）。
- **模型**：PP-OCRv5 det/rec + mobile cls（与当前应用用的 ch_PP-OCRv4 相比为新一代，速度和准确率均有提升）。
- **形态**：单进程无后台驻留——被快捷键（用户自用 HotkeyP 绑定）唤起时启动进程 → 显示全屏选框 → 框选 → 识别 → 文本写剪贴板 → 进程退出。工具本身不自带快捷键注册。

### 2.3 关键体验（本计划的改造目标）
1. **快**：唤起 → 截图 → 粘贴"一瞬间"；文字多时约 1s（取决于机器性能）。
2. **零摩擦**：OCR 结果直接进剪贴板，无需任何二次点击/弹窗确认。
3. **工具干净**：无后台驻留、无内置快捷键，由外部触发。

### 2.4 与现状的能力对照
| 维度 | K:\OCR | 本应用现状 | 改造后 |
| --- | --- | --- | --- |
| OCR 引擎 | RapidOcrOnnx / PP-OCRv5 | onnxruntime-node / PP-OCRv4 | **PP-OCRv5** |
| 结果呈现 | 自动进剪贴板，无弹窗 | 结果窗口，需手动复制 | **自动复制 + toast，无弹窗** |
| 触发 | 外部快捷键 | F1（截图）/ F2（贴图） | **F5（OCR 默认）/ F6（贴图·仅完整模式）** |
| 常驻 | 无 | 常驻全局快捷键 | 保持一致（快捷键常驻，工具本身不常驻） |
| 后台逻辑 | 冷启动每次加载 | 覆盖层窗口复用 + ONNX 会话缓存 | 保持（更快于 K:\OCR 冷启动） |

## 3. 现状分析 (Current State Analysis)

截图/OCR 链路已完整存在于 `electron/screenshot/`，改造为最小增量：

- [screenshot-service.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-service.js)
  - `loadScreenshotConfig()`（L64-76）读取 `screenshotEnabled/screenshotShortcut/pasteShortcut/screenshotHideMain/saveDir`；快捷键默认 F1。
  - `registerShortcuts()`（L79-89）：截图键回调 `startScreenshot('copy')`（L86）、贴图键回调 `pasteFromClipboard()`（L87）。
  - `startScreenshot(defaultAction)`（L284-347）→ 覆盖层创建/复用 → `screenshot:init` 下发（L331，含 `display.t0` 等）。
  - `handleConfirm(payload)`（L410-477）：已有 `action='ocr'` 分支（L462-464）→ `runOcr(cropped)`。
  - `runOcr(image)`（L662-681）：识别后 `showOcrResult(result)` 弹结果窗；失败走 `notifyMainWindow` toast + `screenshot:ocr-needs-setup` 引导。
  - `showOcrResult`（L694-720）：新建无边框结果窗加载 `ocr-result-window.html`。
  - 下载相关：`downloadModelsInline`（L772-797，内联 PowerShell，写死 v4 文件名与 v4 下载源）、`getModelJobs()`（L800-808）、`downloadFile/downloadModelsNode`（L811-866）、`install-ocr`（L1061-1096，`required` 写死 v4 文件名）。
- [ocr-service.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/ocr-service.js)：`DET_MODEL/REC_MODEL/CLS_MODEL/DICT_FILE`（L19-22）写死 v4；`status()`（L59-72）与 `init()`（L33-56）校验 `DET/REC/字典` 必需。推理用 `firstFloatTensor` 取输出（对 v5 输出名不敏感），rec 高 48、det 长边 960 与 PP-OCRv5 预处理一致，**无需改算法**。
- [screenshot-window.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-window.html)：工具栏（复制/保存/OCR/贴图 + 标注）、`Enter/双击/Ctrl+C → confirm('copy')`（L531-533、L954-957）、hint 文案（L100、L224、L339）。
- [ocr-result-window.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/ocr-result-window.html)：OCR 结果窗（保留，供其他入口复用，如 `screenshot:ocr` IPC 对剪贴板图再识别）。
- [screenshot-preload.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/screenshot-preload.js)：IPC 白名单，通道已齐，无需改动。
- **main.js**：默认配置 L350-352（`screenshotShortcut: 'F1'`）；快捷键审计 L5520（'F1'）；`initScreenshotService` L7183-7188。
- **前端**：`tools-core.js` SYSTEM_SCREENSHOT（L93-102，「截图工具」，📸）；`openSystemTool` 配置面板（L663-737，快捷键默认 'F1'）；`settings.html` 📸 截图工具区块（L1000-1035，placeholder F1）；`settings.js` load/save（L1138-1171，fallback 'F1'）；`index.html` OCR 通知/toast 处理（L2326-2373，复用无需改）。
- **打包**：`package.json` extraResources `electron/screenshot/ocr-models` → `resources/ocr-models`（L103-108）；仓库内 v4 模型将替换为 v5。

## 4. 变更方案 (Proposed Changes)

### A. 主进程服务：模式 + 快捷 OCR 行为（screenshot-service.js）

1. **配置读取扩展** `loadScreenshotConfig()`：
   - 新增 `mode: cfg.screenshotMode !== 'full' ? 'ocr' : 'full'`（默认 `ocr`）。
   - 截图快捷键默认 `cfg.screenshotShortcut || 'F5'`（原 F1）。
   - 贴图快捷键默认 `cfg.pasteShortcut || 'F6'`（原 F2）。
2. **快捷键注册** `registerShortcuts()`：按模式注册：
   - 截图键回调改为 `startScreenshot(cfg.mode === 'full' ? 'copy' : 'ocr')`（两种模式都注册，区别在默认动作与覆盖层 UI）。
   - **贴图键（粘贴）仅 `mode==='full'` 时注册**：OCR 模式下不注册 F6，贴图属被隐藏的截图功能；切回完整模式（`refreshShortcuts()`）即恢复。`pasteFromClipboard()` 入口也加守卫：非完整模式直接返回（防残留调用路径）。
3. **通知覆盖层当前模式**：`startScreenshot` 中 `screenshot:init`（L331）payload 增加 `mode` 字段（`'ocr' | 'full'`）。
4. **新增 `quickOcr(image)`**（对标 K:\OCR 自动复制，不弹结果窗，复用剪贴板助手气泡反馈）：
   ```js
   async function quickOcr(image) {
     // 复用 runOcr 的识别逻辑，但识别成功后：
     const t0 = Date.now();
     // 1) ocrService.recognize(image.toPNG())，失败降级提示（复用现有 unavailable 文案 + 一键安装引导）
     // 2) 空文本：走「未识别提醒」（见下方 5），不复制
     // 3) 成功：先把去重键写给主进程剪贴板助手（抑制轮询器对同一内容重复弹窗），再写剪贴板
     //    deps.markClipboardSuppress(text)   // main.js 注入：lastClipboardKey=签名, lastClipboardPromptAt=now
     //    deps.clipboard.writeText(text)
     // 4) 复用剪贴板监听气泡播报（式样/位置/动效完全一致，仅标题改为 OCR 语义）：
     //    deps.showClipboardEntryToast({ type:'text', text, title:'🔤 OCR · 已复制 N 字 · 耗时 Xms' })
     //    副产物：轮询器会把 OCR 文本自动记入「剪贴板历史」（addClipboardHistory），无需额外代码
   }
   ```
   - 复用现有 `ocrService` 实例与缓存会话（覆盖层复用 + 会话缓存，实际比 K:\OCR 冷启动更快）。
   - `handleConfirm` 的 `case 'ocr'`（L462-464）改调 `quickOcr(cropped)`；**删除 `showOcrResult` 调用只发生在 OCR 模式**——`runOcr()` 与 `showOcrResult()` 完整保留，供 `screenshot:ocr` IPC（贴图窗/剪贴板图再识别）继续弹结果窗，避免回归。
5. **未识别到文字提醒**（复用时保证可见，即使主窗口被 hideMain 收起）：
   - 复用同一个非聚焦气泡，走"警告式"文案：`deps.showClipboardEntryToast({ type:'text', text:'未识别到文字，请重新框选', title:'🔤 OCR 未识别到文字', warn:true })`（warn 变体：红色/琥珀主色，无动作按钮，3.5s 自动关闭）。
   - 同时保留 `notifyMainWindow('🔤 未识别到文字，请重新框选', 'warn', 3000)`（主窗口可见时的应用内提示，与气泡双保险，不重复冲突）。
6. **IPC 扩展**：
   - `screenshot:get-shortcuts`（L907）返回值增加 `mode`。
   - `screenshot:set-shortcuts`（L908-917）支持 `payload.mode`（'ocr'|'full'）写入 `cfg.screenshotMode`，保存后 `refreshShortcuts()`。
7. **下载/安装清单升级 v5**（与 ocr-service 同步，见 B 节）：
   - `downloadModelsInline`（L778-780）jobs 文件名 + 下载源改为 v5。
   - `getModelJobs()`（L800-808）同名处理。
   - `install-ocr` 的 `required`（L1069）与模型存在性校验同步 v5 文件名。
   - `required` = v5 det + v5 rec + 字典；cls（`ch_ppocr_mobile_v2.0_cls_train.onnx`）仍为可选。

### B. OCR 服务：模型升级 PP-OCRv5（ocr-service.js）

- 模型常量 L19-22 改为：
  ```js
  const DET_MODEL = 'ch_PP-OCRv5_det_infer.onnx';
  const REC_MODEL = 'ch_PP-OCRv5_rec_infer.onnx';
  const CLS_MODEL = 'ch_ppocr_mobile_v2.0_cls_train.onnx'; // 可选，文件名与 K:\OCR 一致
  const DICT_FILE = 'ppocr_keys_v1.txt';
  ```
- `init()`（L39-41）与 `status()`（L65-66）的必需文件名/缺失检测同步 v5。
- 推理管线（det 长边 960 / 32 对齐、rec 高 48 / 32 对齐、输出经 `firstFloatTensor` 取第一个 Float32Array）与 PP-OCRv5 兼容，**算法层不改**。
- 精修项（可选，实施时若验证必要才做）：v5 rec 输出类别数与字典长度差异已由 `numClasses = rDims[2]` 动态取，无需改。

### C. 覆盖层 UI：OCR 模式（screenshot-window.html）

1. **接收模式**：`screenshot:init` handler（L276-300）读取 `payload.mode` → 存 `let ocrMode = (payload.mode !== 'full')`；默认 false（完整模式兜底）。
2. **新增 `applyMode()`**（在 `onBackgroundReady` 与 reset 时调用）：
   - OCR 模式：隐藏 `btnCopy/btnSave/btnPaste` 及标注工具按钮区（`#toolbar` 内标注按钮与 `#annoColor`，`style.display='none'`）；`btnOcr` 提升为 primary「🔤 提取文字」；隐藏 `#annoText`、`#sel .handle`（选区不可微调手柄则保留，仅标注类隐藏；手柄保留不影响 OCR 框选）；hint 文案改「拖拽框选要识别的文字区域 · Enter 提取文字 · Esc 取消」；`selRect` 更新时的次级提示改「Enter 提取文字 · Esc 取消」。
   - 完整模式：恢复全部按钮/hint（与现状一致）。
   - **代码不删除**：`confirm('copy'|'save'|'paste')`、标注工具函数、`composeAnno`、`showRaw` 等全部保留，仅按 `ocrMode` 切换显示与默认动作。
3. **默认动作切到 OCR**：以下三处由 `'copy'` 改为 `ocrMode ? 'ocr' : 'copy'`：
   - Enter（L531）、Ctrl+C（L532）、双击选区（L956）。
4. **标注快捷键屏蔽**（L536-550）：OCR 模式时 `annoTool` 相关按键（R/O/A/P/T/M/E、数字粗细、C 取色）直接早退，避免误触发（代码保留，仅 `if (ocrMode) return`）。
5. `paste-selection`（贴图键在覆盖层打开时）：**仅完整模式可用**——OCR 模式下贴图键不注册（见 A.2），覆盖层收不到 `screenshot:paste-selection`，无需额外处理。

### D. 主进程默认配置与审计（main.js）

- L351-352：`screenshotShortcut: 'F5'`；`pasteShortcut: 'F6'`（原 'F2'）；新增 `screenshotMode: 'ocr'`（默认配置一并写入，供迁移/新用户）。
- L5520-5521 快捷键审计候选 accelerator 默认：截图 `'F1'` → `'F5'`、贴图 `'F2'` → `'F6'`。

### D+. 复用剪贴板监听气泡（main.js — 用户指定：toast 对齐剪贴板助手弹窗）

现状（已勘察）：`showClipboardToast(content)`（L5789-5947）创建右下角透明气泡窗——`frame:false / alwaysOnTop / type:'panel'(mac) / skipTaskbar / transparent / focusable:false / show:false`，`loadURL(data:text/html)` 内联卡片（主题令牌对齐，slideIn 动效，3.5s 自动关闭，含 [忽略/历史/写作区/记录到剪藏] 动作）；轮询器 `pollClipboard()`（L5707-5724）每 1.5s 读剪贴板，按签名去重 + 10s 冷却弹气泡，并把新内容记入「剪贴板历史」。OCR 写剪贴板后轮询器必然检测到新文本，因此**必须复用同一气泡并抑制重复弹窗**，实现方案：

1. **`showClipboardToast(content, opts)` 增加可选标题覆盖**：
   - `opts.title`（如 `'🔤 OCR · 已复制 N 字 · 耗时 Xms'`）替换原标题 `剪贴板 · 已复制内容`，其余式样/动效/动作按钮不变；
   - `opts.warn`（true）→ 主色切为琥珀/红（`--primary` 覆盖），隐藏动作按钮组（` actions` 区 `display:none`），用于「未识别到文字」提醒。默认参数不影响现有轮询调用（向后兼容）。
2. **新增 `showClipboardEntryToast(entry)`**（OCR 快捷入口专用，main.js 模块函数）：
   ```js
   function showClipboardEntryToast(entry) {
     // 1) 抑制轮询重复：先按 entry.text 的签名更新状态，再展示
     //    lastClipboardKey = clipboardSignature({ type:'text', text: entry.text })
     //    lastClipboardPromptAt = Date.now()
     //    （轮询器下次 tick 命中同签名 → return，不弹第二个"剪贴板·已复制"气泡）
     // 2) showClipboardToast({ type:'text', text: entry.text }, { title: entry.title, warn: entry.warn })
     // 3) 剪贴板历史：轮询器的去重（lastClipboardKey）发生在历史落库之前，被抑制的内容不会自动进历史，
     //    因此 showClipboardEntryToast 对非空文本显式补记一条 addClipboardHistory（同一落库），OCR 文本仍进历史面板
   }
   ```
   - 顺序注意：先设去重键、再 `writeText`、再弹气泡（抑制窗口在写剪贴板前生效，消除与轮询 tick 的竞态）。
3. **注入截图服务**：`initScreenshotService` 调用处（L7183-7188）deps 增加：
   ```js
   showClipboardEntryToast,   // OCR 成功/未识别提醒，复用剪贴板气泡
   ```
4. 现有 `pollClipboard`/`showClipboardToast`/冷却逻辑**不做结构性改动**，仅新增可选参数与 OCR 专用包装函数。

### E. 前端：设置页 + 工具卡片

- [settings.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/settings.html)（L1000-1035）：
  - 区块标题「📸 截图工具」→「🔤 快捷 OCR / 截图工具」。
  - 「截图快捷键」行标题改「OCR/截图快捷键」，description 改「框选文字区域 → 自动 OCR 并复制到剪贴板（完整模式为全屏选区截图）」；placeholder `F1` → `F5`。
  - 「贴图快捷键」行：placeholder `F2` → `F6`；description 改「置顶贴图（仅完整截图模式生效）」。
  - 新增「默认模式」行：下拉 `<select id="shotMode">`（OCR 模式 / 完整截图模式），description「OCR 模式下 OCR/截图快捷键只做框选识别复制，贴图快捷键不注册；完整模式恢复截图复制/保存/贴图/标注」。模式切换时「贴图快捷键」行置灰/隐藏（JS 联动）。
- [settings.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/settings.js)：
  - `loadScreenshotConfig()`（L1138-1149）：读取 `cfg.mode` 回填 `shotMode`；fallback `'F1'` → `'F5'`、`'F2'` → `'F6'`。
  - `saveScreenshotConfig()`（L1161-1171）：payload 增加 `mode`，提交 `screenshotSetShortcuts`；`'F1'` fallback → `'F5'`、`'F2'` fallback → `'F6'`。
  - 监听 `shotMode` 变化：OCR 模式时禁用/置灰「贴图快捷键」输入框（值保留，切回完整模式恢复）。
- [tools-core.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/tools-core.js)：
  - `SYSTEM_SCREENSHOT`（L93-102）：name「快捷 OCR」（图标 🔤），description「框选文字区域 → 自动复制识别文本；完整截图模式见设置」，keywords 保留截图/贴图/ocr 等。
  - `openSystemTool`（L683 起）：fallback 快捷键 `'F1'` → `'F5'`、`'F2'` → `'F6'`；面板增加「OCR/截图快捷键」label、「默认模式」下拉、「贴图快捷键」行（OCR 模式置灰，注释"仅完整模式生效"）（复用 `screenshotGetShortcuts().mode` / `screenshotSetShortcuts`），渲染结构对齐 settings 页。

### F. 模型文件与打包

- 将 `electron/screenshot/ocr-models/` 内 v4 文件替换为 v5（实施时用更新后的 `download-ocr-models.ps1` 下载；如网络不可用则从 K:\OCR 的 models 目录拷贝同名 v5 文件）。
- [download-ocr-models.ps1](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/screenshot/download-ocr-models.ps1)（L18-23）：jobs 改 v5 文件名；URL 源：
  - 主：`https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main/models/text_det/ch_PP-OCRv5_det_infer.onnx`（rec 同理，`text_rec`）；cls：`text_cls/ch_ppocr_mobile_v2.0_cls_train.onnx`。
  - 备：huggingface 同路径；字典沿用 PaddleOCR raw / HF space 路径。
  - 若实施时发现某源 404，保持多源回退结构并补 RapidOCR GitHub Release 对应 v5 源；**禁止** 用 v4 文件伪装 v5 文件名。
  - ~/.ps1 必需 UTF-8 带 BOM 约束保持。
- `package.json` extraResources 路径不变（目录名 `ocr-models` 不变，内容换成 v5）。

### G. 结果窗保留

- `ocr-result-window.html` 与 `showOcrResult` 保留不删：供 `screenshot:ocr` IPC（贴图窗/剪贴板图再识别）与潜在「完整模式 OCR 按钮」使用，杜绝回归。

## 5. 假设与决策 (Assumptions & Decisions)

- **自动复制不弹窗**：OCR 模式框选确认后文本直接 `clipboard.writeText`，**复用剪贴板监听气泡**（右下角透明气泡、置顶非聚焦、3.5s 自动关闭）播报"已复制 N 字 + 耗时"；同时先写去重键抑制剪贴板轮询器对同一内容的重复弹窗——完全对标 K:\OCR，且与现有剪贴板助手体验统一。
- **未识别到文字必提醒**：复用同一气泡走警告式变体（无动作按钮），并保留主窗口内 `notifyMainWindow` 提示双保险。
- **模式开关默认 OCR**：`screenshotMode` 默认 `'ocr'`；完整模式行为与今天逐点一致，代码零删除。
- **快捷键默认 F5 / F6**（用户指定）：OCR 截图快捷键默认 `F5`、贴图快捷键默认 `F6`（原 F2），均可在设置页修改；设置页/tools 面板/审计候选默认值全部同步。F5 两种模式都注册（区别默认动作），**F6 贴图仅在完整模式注册**。
- **贴图仅完整模式**：OCR 模式下 F6 不注册、`pasteFromClipboard()` 加非完整模式守卫，覆盖层 `paste-selection` 无触发路径——贴图作为"被隐藏的截图功能"在 OCR 模式完全不可见。
- **模型升级 v5**（用户指定）：必需文件 v5 det + v5 rec + 字典；cls 可选。算法代码不变。下载源可回退但**不混用 v4 文件**。
- OCR 不可用降级：沿用现有 `notifyMainWindow` + `showOcrSetupBar`（`ocr-needs-setup`）引导，不阻塞截图主体。
- **副产物**：OCR 文本经轮询器自动记入「剪贴板历史」（历史与气泡解耦，不受抑制去重影响），无需额外代码。

## 6. 验证步骤 (Verification)

### 静态检查
- [ ] `node --check electron/screenshot/screenshot-service.js electron/screenshot/ocr-service.js electron/main.js frontend/js/settings.js frontend/js/tools-core.js`
- [ ] `node --test electron/screenshot/ocr-service.test.js`（纯函数回归）
- [ ] 仓库回归：`npm run test:editor-all` 不受影响（不涉及改动文件之外逻辑）

### 手动冒烟（`npm start`，Windows/macOS 均验证一次）
1. **默认 OCR 模式**：按 F5 → 覆盖层只显示「🔤 提取文字/取消」，hint 为框选提示；框选 → Enter → 文本自动写剪贴板，响应式触发右下角**剪贴板气泡**（标题「🔤 OCR · 已复制 N 字 · 耗时 Xms」+ 文本预览 + 动作按钮），无结果弹窗；直接到任意输入框 Ctrl+V 验证内容。
2. **无双重弹窗**：OCR 复制后等待 >1.5s（轮询周期），确认**不会**再出现"剪贴板 · 已复制内容"气泡（去重键抑制生效）。
3. **剪贴板历史自动入库**：打开「剪贴板历史」面板，OCR 复制的文本已出现（轮询器 addClipboardHistory 副产物）。
4. **完整模式恢复**：设置页切换「完整截图模式」→ F5 显示完整工具栏（复制/保存/OCR/贴图 + 标注），Enter/双击=复制（原行为）；**F6 贴图生效**（截图/剪贴板图可贴出）。
5. **F6 仅在完整模式**：OCR 模式下按 F6 无反应（未注册）、快捷键检测卡片「贴图」显示 disabled；切到完整模式后 F6 注册生效。
6. **模式切换即时生效**：设置保存后无需重启，再按 F5 覆盖层即新模式；F6 注册/注销同步（refreshShortcuts）。
7. **空识别**：框选纯空白 → 右下角警告式气泡「🔤 OCR 未识别到文字」+ 主窗口内 warn 提示，不复制。
8. **OCR 未就绪**：临时移走模型 → F5 框选 → 提示 OCR 组件未就绪（原有降级路径）；恢复模型后正常。
9. **快捷键可改**：设置页改快捷键（如 Ctrl+Alt+O / Ctrl+Alt+P）→ 旧键失效新键生效；快捷键检测卡片显示 F5/F6 为默认注册。
10. **性能**：普通段落 OCR 从按下到气泡出现应 <1.5s（与 K:\OCR 同级）；重复框选不会重复加载模型（会话缓存，第二次更快）。

### 打包回归（可选）
- [ ] `npm run build:win:dir` 后确认 `resources/ocr-models` 为 v5 模型，启动应用 OCR 可用。