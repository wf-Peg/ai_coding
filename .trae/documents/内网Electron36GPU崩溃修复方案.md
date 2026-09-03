# 内网环境 Electron 新版 GPU 启动崩溃修复方案

## 摘要

内网机器双击新版 CutShelter 无法启动，`app.log` 与诊断脚本控制台输出已暴露**真正根因**：
再次诊断的控制台输出中出现关键崩溃日志（此前被 app.log 截断掩盖）：

```
[ERROR:gpu_process_host.cc:950] GPU process launch failed: error_code=18
[FATAL:gpu_data_manager_impl_private.cc:416] GPU process isn't usable. Goodbye.
[FAIL] 主进程已退出 (exitCode=1)，应用启动即崩溃
```

即：**Electron 36（Chromium 130+）的 GPU 进程在内网/无独显/远程桌面/驱动受限环境下启动失败，导致主进程触发 FATAL 直接退出。**

这与用户观察完全吻合：

- 旧版本（更低 Electron / Chromium）能打开 → 旧 Chromium 在 GPU 失败时可回退到软件渲染；

- 新版本打不开 → 新 Chromium 不再提供纯软件 GPU 进程兜底，GPU 进程不可用即 FATAL 退出。

**核心结论：不是系统管理员禁用软件，也不是 clearCache 问题，而是 Electron 升级后 GPU 硬件加速初始化崩溃。**

## 当前状态分析

- 环境：内网 Win10 19045，无独立 GPU 支撑的软件渲染回退，`GPU process isn't usable` → FATAL(exitCode=1)。

- 现有 [main.js](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/electron/main.js) 未调用 `app.disableHardwareAcceleration()`，也未设置任何软件渲染/禁用 GPU 的 Chromium 开关。

- Electron 版本 36.9.5，新 Chromium 对 GPU 初始化失败不再软件回退。

- 此前的 clearCache 超时降级修复是有效的健壮性改进，但**不是本崩溃的根因**，需保留。

## 变更方案

### 1. 在 app ready 之前禁用硬件加速（主要修复）

文件：`electron/main.js`
位置：在 `app.requestSingleInstanceLock()` 之前的初始化区（约第 4253 行附近），即 `app.whenReady()` 之前。

- 调用 `app.disableHardwareAcceleration();` 显式关闭硬件加速，让 Chromium 走软件渲染路径，规避 GPU 进程启动失败导致的 FATAL 崩溃。

- 为最大化兼容性，同时追加 Chromium 命令行开关（在 ready 前设置同样有效）：

  - `--disable-gpu`

  - `--disable-gpu-compositing`

  - `--disable-software-rasterizer` 需谨慎：它禁的是**软件光栅化降级**；若目标机无任何可用渲染，反而不利。**不启用此开关**。

- 增加日志注释与 `log.info('[GPU] Hardware acceleration disabled for compatibility')` 便于排查。

推荐的开关组合（保守、兼容性优先）：

```javascript
// 关闭硬件加速，规避内网/无独显/远程桌面下新版 Chromium GPU 进程崩溃(FATAL)无法启动
// 该调用必须在 app ready 之前执行
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
```

注意：`--disable-gpu-compositing` 会让合成走软件，对绝大多数此应用界面（非高刷新游戏）性能无感知影响。

### 2. 增强诊断脚本：新增 GPU 崩溃检测

文件：`scripts/diagnose-windows.ps1`

- 在「拉起探测」解析阶梯标记后，额外扫描本次 app.log 与控制台输出中的 GPU 崩溃特征字符串：

  - `GPU process launch failed`

  - `GPU process isn't usable. Goodbye`

  - `gpu_process_host.cc`

- 命中即输出 `FAIL/INFO`：「检测到 GPU 进程崩溃，应用因硬件加速初始化失败退出（新版 Chromium 特性），需关闭硬件加速」。

- 用途：后续回归时一眼定位同类问题，不再需要人工翻完整控制台。

- 保留既有 clearCache 卡点提示（`cache.before`），但补充说明：若同时出现 GPU FATAL 日志，优先判定为 GPU 问题。

### 3. 打包配置（确认项，非必须改动）

文件：`package.json`

- Electron 36 已将 `disableHardwareAcceleration` 支持完好。确认 `electron-builder --win` 打包时 noSandbox/其他参数不干扰软件渲染。

- **不改动任何构建参数**（保持最小变更），仅确认不影响本次修复。

## 假设与决策

- 假设内网机器无可用硬件 GPU 加速或驱动不兼容（从 `GPU process isn't usable` 确证）。

- 决定保留 clearCache 超时降级修复（不回滚），与本次 GPU 修复叠加，形成双保险。

- 决定**不**使用 `--disable-software-rasterizer`，避免在软件渲染路径下二次禁用光栅化。

- 决定不使用 `app.commandLine.appendSwitch('in-process-gpu')`（单进程 GPU 会牺牲稳定性，非必要）。

- 若关闭硬件加速后仍崩溃，则下一步转向检查 Electron 的 `useSharedArrayBuffer`/沙箱/V8，或抓取 `--enable-logging` 完整原生崩溃捕获；但在当前证据下硬件加速是最高概率根因。

## 验证步骤

1. `node --check electron/main.js` 确认语法无误、`app.disableHardwareAcceleration()` 位于 ready 之前。
2. 常规打包 `npx electron-builder --win --dir --x64`（或沿用已验证的 `npm run build:win` 流程）。
3. 本机运行 `scripts/diagnose-windows.ps1 -InstallDir <win-unpacked> -Launch`，确认：

   - 不再出现 `GPU process launch failed` / `Goodbye`；

   - 阶梯序列越过 `cache.after`，继续走到窗口创建（`window.after` / 前端服务起来）；

   - 主进程存活（非 exitCode=1）。
4. 把新产物拷贝到内网机器复测，确认能正常弹窗。
5. 同步更新 `commit_history.log`，追加一行提交记录。

## 涉及文件

- `electron/main.js`（改）：ready 前禁用硬件加速 + GPU 兼容开关。

- `scripts/diagnose-windows.ps1`（改）：新增 GPU 崩溃特征检测与提示。

- `commit_history.log`（改）：追加提交记录。

