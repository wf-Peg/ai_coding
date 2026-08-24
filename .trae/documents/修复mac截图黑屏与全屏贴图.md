# 修复 macOS 截图黑屏卡住 + 贴图贴成全屏

## 摘要
截图工具模块在 macOS 上出现两个表象互相关联的 bug：
1. 按 F1 截图后覆盖层**黑屏卡住**（一直停留在"正在截取屏幕…"，无法继续）。
2. 截图确认后「贴图」粘贴出的是一张**全屏图**而非选区。

两条都指向同一根因：**macOS 上 `desktopCapturer` 拿到的是空(`0×0`)/黑帧缩略图**，而代码缺少非空校验、失败兜底与权限引导，导致覆盖层渲染不到图像而"卡住"，裁剪因尺寸为 0 失败后静默回退到全屏原生图从而"贴成全屏"。

## 现状分析（探索结论）
- 激活使用的实现是 [electron/screenshot/screenshot-service.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/screenshot/screenshot-service.js)（[main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L3998-L3999) 注入依赖并初始化；仓库根目录的 `screenshot-service.js` 是旧版，未使用）。渲染层覆盖层是 [electron/screenshot/screenshot-window.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/screenshot/screenshot-window.html)，贴图窗口是 `electron/screenshot/paste-window.html`。
- 截图链路：
  - `startScreenshot()` → `captureScreen()` 用 `desktopCapturer.getSources({types:['screen'], thumbnailSize: size*sf})` 取 `full[0].thumbnail`（screenshot-service.js L113-131）。
  - `encodeForDisplay()` 用 `toBitmap()` 走 raw 位图，否则 `toPNG()`（L146-160）。
  - 渲染层 `showRaw()` **无条件** R/B 交换（screenshot-window.html L214-233），`bg.onerror` 只回传 `painted delta:-1`（L242-259）。
  - 确认时 `handleConfirm()` 用 `lastCaptureSize/displaySize` 换算 crop 矩形，裁剪失败则回退 `cropped = lastCapture`（=全屏）并写入 `lastSnip`（L250-301）。

### 直接导致的缺陷点
1. **无空帧校验**：`captureScreen` 只断言 `full.length>0`，不校验 `img.isEmpty()`/`getSize()` 是否 `0×0` 或全黑。macOS 缩略图为空时不会抛错，`lastCaptureSize=0×0`。
2. **失败路径不回退/超时**：空 PNG → 渲染层 `img.onerror` → 覆盖层永远停在内联 loading 文案，`inFlight` 不重置 → **黑屏卡住**。
3. **裁剪失败静默回退全屏**：`cropRect` 宽高为 0 时 `lastCapture.crop` 抛错 → `cropped = lastCapture`（全屏）→ 写入 `lastSnip` → 贴图/复制都成了**全屏**。
4. **无 macOS 屏幕录制权限检测/引导**：10.15+ 未授予"屏幕录制"权限会拿到空/黑帧，代码无任何提示。
5. **show→hide→capture 时序竞态**：macOS WindowServer 异步合成，`win.show()` 后立刻 `win.hide()` 再抓屏，可能抓到覆盖层深色帧/未刷新帧。
6. **`showRaw` 跨平台字节序假设风险**：macOS 上 `toBitmap()` 的像素序未经验证，若为 RGBA 则无条件交换 R/B 会导致颜色错乱。

> 注：黑屏与贴全屏两个症状基本共享同一根因(空/黑捕获)，修复需在「捕获环节」「确认裁剪环节」双端加固。

## 建议改动

### A. 主进程 `captureScreen`：非空校验 + 重试 + 规模日志（screenshot-service.js）
- 取到 `full[0].thumbnail` 后校验 `img && !img.isEmpty()` 且 `getSize().width>0` 且 `getSize().height>0`；不满足则**重试最多 3 次**，每次间隔 ~60ms。
- 重试仍失败则抛出带"屏幕录制权限/系统合成"语义的明确错误。
- 记录 `log('capture ok', actual WxH, 'display', DIP WxH, 'sf', sf)` 以便诊断。

### B. macOS 屏幕录制权限检测 + 用户引导（screenshot-service.js + main.js）
- main.js 初始化的 deps（L3998-3999）补充传入 `systemPreferences`（在 L11 electron 解构中补 `systemPreferences`）。
- 在 `startScreenshot`（或 `captureScreen`）中，仅当 `process.platform==='darwin'` 时调用 `systemPreferences.getMediaAccessStatus('screen')`：
  - `'denied'` / `'not-determined'`：不进入空图像流程，直接 `closeScreenshotWindow()`、重置 `inFlight`、`notifyMainWindow('需在系统设置→隐私与安全性→屏幕录制 中授权后重试', 'warn', 6000)`，必要时用 `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')` 快速打开设置。
  - 仅在校验失败且状态为 granted 时才归因于"时序竞态/重试"。
- 兼容性兜底：若 `systemPreferences` 缺失，静默跳过权限分支。

### C. 修 `encodeForDisplay` 跨平台像素序（screenshot-service.js + screenshot-window.html）
- macOS 上**统一走 PNG 显示路径**（`image.toPNG()`），保证颜色确定正确；raw `toBitmap()` 快速路径只在 `process.platform==='win32'` 使用（已验证 BGRA）。
- 渲染层 `showRaw` 的 R/B 交换逻辑保持不变（仅 Windows 走 raw，交换正确）；`screenshot:init` 增加 `bgra: process.platform==='win32'` 透传，`showRaw` 仅当 `payload.bgra===true` 才交换——彻底消除跨平台字节序歧义。

### D. 消除 show→hide→capture 时序竞态（screenshot-service.js `startScreenshot`）
- macOS 在 `win.hide()` 之后、`captureScreen` 之前加一小段 `await delay(~50ms)`（`delay` 复用现有 Promise 写法），让 WindowServer 完成刷新，降低抓到覆盖层深色帧概率。
- 保持非 macOS 平台现状（Windows 无此竞态，避免额外延迟）。

### E. 防"卡住"：inFlight 兜底 + 渲染层错误回传（screenshot-service.js + screenshot-window.html）
- `startScreenshot` 增加**超时兜底**：若捕获 + 发图超过 ~2000ms 仍未收到 `screenshot:painted` 成功，主动 `closeScreenshotWindow()` + 重置 `inFlight` + notify 提示，杜绝无限卡死。
- 渲染层 `bg.onerror` / `bgCanvas` putImageData 空图时，改为发送 `screenshot:init-error`（替代仅 `painted delta:-1`），主进程收到后走与 B 相同的失败关闭流程。

### F. 防"贴成全屏"：`handleConfirm` 校验裁剪结果（screenshot-service.js L250-301）
- 计算 `cropRect` 时校验合法：`width>0 && height>0` 且在 `actual` 范围内。
- `crop` 后校验 `cropped && !cropped.isEmpty()`；失败**不再回退 `lastCapture`（全屏）**，而是 `notifyMainWindow('截图数据异常，请重试', 'warn')`、`closeScreenshotWindow()`、返回 `{status:'error'}`，且**不写入 `lastSnip`**。
- `payload.imgData` 不等于台面时（无标注）同样受上述 cropped 校验保护；`createFromDataURL` 结果用 `isEmpty()` 校验。

### G. 验证
- 构建并本地运行 `electron .`（或使用 mac 构建 dmg），依次验证：
  1. 已授予"屏幕录制"权限时：F1 截图出现真实桌面画面（颜色正确、非黑屏）、可拖选，Enter/双击复制。
  2. 选中部分区域后「贴图」（Ctrl+T / 工具栏贴图 / F2 从剪贴板）：贴出的是**选区**而非全屏；再次 F2 仍贴刚才选区（验证 `lastSnip`）。
  3. 取消"屏幕录制"权限后按 F1：不黑屏卡住，出现权限引导提示。
  4. Windows 侧回归：raw 路径截图颜色、选区、贴图不受影响（B/C/D 仅影响 macOS 分支）。
  5. 日志 `screenshot/perf` 与 `capture ok WxH` 正常，确认无空帧、无超时误报。

## 假设与决策
- **假设**：黑屏/贴全屏根因为 macOS 空/黑捕获 + 无校验回退；即便实际是纯权限问题，A/B/D 也已兜底，不会更糟。
- **决策 1**：macOS 显示路径统一走 PNG（确定性正确），raw 快速路径仅保留 Windows。性能取舍以正确性为先。
- **决策 2**：权限引导采用"检测 + 提示 + 可选跳转系统设置"，不自动弹系统授权窗口（避免每次打断）。
- **决策 3**：不删除仓库根目录旧版 `screenshot-service.js`（未被引用，超出本任务范围）。
- **不改动**：贴图窗口交互（移动/缩放/置顶/透明度）逻辑本次不动，仅 `handleConfirm` 的 `lastSnip` 写入做校验。

## 涉及文件清单
- `electron/screenshot/screenshot-service.js`（主改：A/B/C/D/E/F）
- `electron/screenshot/screenshot-window.html`（C/E）
- `electron/main.js`（B：deps 注入 `systemPreferences`，并在 L11 补解构）