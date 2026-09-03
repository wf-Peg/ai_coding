# 修复 Electron 36 GPU 进程沙箱启动崩溃

## 摘要

内网机器升级新版（Electron 36.9.5 / Chromium 130+）后无法启动，报：

```
[4296:0903/141633.534:ERROR:gpu_process_host.cc:950] GPU process launch failed: error_code=18
[4296:0903/141633.534:FATAL:gpu_data_manager_impl_private.cc:416] GPU process isn't usable. Goodbye.
```

上一版在 [main.js](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/electron/main.js#L51-L53) 加入 `app.disableHardwareAcceleration()` + `disable-gpu` + `disable-gpu-compositing` 后**仍然崩溃**。

**真正根因**：这不是"显卡/硬件加速不可用"，而是 **GPU 子进程在 Windows 沙箱（sandbox）下启动失败**。`app.disableHardwareAcceleration()` 只关闭 GPU 合成，但 Chromium 仍会拉起一个沙箱化的 GPU 进程；在管理员提权（high-integrity）、精简版系统（Ghost Spectre 等）、远程桌面、ACL 受限等内网环境下，该沙箱子进程无法降权启动，反复失败后触发 `FATAL ... Goodbye`。

**结论（社区已验证）**：单加 `--disable-gpu` 无效；必须**禁用 GPU 进程沙箱**（`--disable-gpu-sandbox`），必要时 `--no-sandbox` 兜底。

参考来源：

- [kudu#206](https://github.com/AdventDevInc/kudu/pull/206)（已合并）：`app.disableHardwareAcceleration()` 后 Chromium 仍 spawn GPU 进程，stripped Windows 上 launch 失败；修复用 `--disable-gpu` + `--disable-gpu-sandbox`。

- [sparkle#104](https://github.com/thedogecraft/sparkle/issues/104)：`--no-sandbox` 可启动；高完整性（Admin）profile 下沙箱是主因。

- [agent-browser#1406](https://github.com/vercel-labs/agent-browser/issues/1406)：沙箱无法访问 exe（Access denied 0x5）→ `error_code=18` → FATAL。

## 当前状态分析

- Electron 36.9.5，`electron-builder` 26.15.7。

- [main.js](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/electron/main.js#L46-L54) 已有硬件加速控制块（第 46–54 行，位于模块加载顶部、app ready 前）：

  ```javascript
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  log.info('[GPU] Hardware acceleration disabled for compatibility');
  ```

- 主窗口 [webPreferences](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/electron/main.js#L2014-L2019) 已 `nodeIntegration: false` + `contextIsolation: true`，安全基线良好，为禁用沙箱提供了可接受的前提。

- 诊断脚本 [diagnose-windows.ps1](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/scripts/diagnose-windows.ps1#L311-L316) 已有 GPU 崩溃检测，但其提示语仍指向旧的 `disableHardwareAcceleration` 方案，需同步修正。

## 变更方案

### 1. 禁用 GPU 进程沙箱（核心修复）

文件：`electron/main.js`

将第 51–54 行的硬件加速控制块改为追加两个沙箱开关（保留原有三行，做最小增量改动）：

```javascript
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
// 关键修复：GitHub 多个已合并修复表明，即使禁用硬件加速，Chromium 仍会拉起沙箱化 GPU 子进程；
// 在管理员提权/精简系统/远程桌面等受限 Windows 环境下，该子进程启动失败(error_code=18) →
// FATAL "GPU process isn't usable"。必须禁用 GPU 进程沙箱。
app.commandLine.appendSwitch('disable-gpu-sandbox');
// 兜底：完全禁用 Chromium 沙箱，覆盖 renderer/GPU 等全部子进程，适配最强受限环境。
// 应用已 nodeIntegration:false + contextIsolation:true，主进程安全基线不依赖 Chromium 沙箱。
app.commandLine.appendSwitch('no-sandbox');
log.info('[GPU] Hardware acceleration & GPU sandbox disabled for restricted Windows env');
```

要点：

- 必须在 `app ready` 之前执行（当前位置符合，位于模块加载顶部）。

- `--disable-gpu-sandbox` 精准关闭 GPU 子进程沙箱（对渲染进程影响最小）；`--no-sandbox` 作为终极兜底，确保同环境不再因任何子进程沙箱失败而崩溃。

- 保留注释与日志，便于后续排查。

### 2. 同步诊断脚本提示语（一致性）

文件：`scripts/diagnose-windows.ps1`

将 GPU 崩溃命中处的 `Write-Result "FAIL" ...` 提示语从「需调用 disableHardwareAcceleration + disable-gpu」更新为「需在 app ready 前禁用 GPU 进程沙箱（disable-gpu-sandbox / no-sandbox）」，保持与本次修复一致，避免误导后续定位。

## 假设与决策

- 假设内网机器运行在管理员提权或精简/受限系统，导致 Chromium 沙箱子进程无法启动（与 `error_code=18` + 多次 `ded-launch` 失败相符）。

- 决定在保留 `disable-gpu` / `disableHardwareAcceleration` 的基础上，**追加** **`disable-gpu-sandbox`** **+** **`no-sandbox`**，一次性覆盖 GPU 与渲染子进程两种沙箱失败路径，最大化一次成功概率。

- 安全权衡说明：`no-sandbox` 会关闭 Chromium 进程隔离。但本应用 `nodeIntegration:false` + `contextIsolation:true`，渲染进程无 Node 权限，且为本地剪藏/知识库工具，风险可控；属于社区对内网受限环境的公认妥协方案。若后续有更严格安全要求，可退回仅 `disable-gpu-sandbox`（去掉 `no-sandbox`）单独验证。

- 不改动 [package.json](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/package.json) 构建参数（保持最小变更）。

## 验证步骤

1. `node --check electron/main.js` 确认语法正确。
2. 重新打包 `npx electron-builder --win --dir --x64`（或沿用 `npm run build:win`）。
3. 本机运行 `scripts/diagnose-windows.ps1 -InstallDir <win-unpacked> -Launch`，确认：

   - 不再出现 `GPU process launch failed` / `GPU process isn't usable. Goodbye`；

   - 阶梯序列越过 `cache.after` 并继续（无 FATAL）；

   - 主进程存活（非 exitCode=1）。
4. 判断本机与内网环境差异：若本机原本就未复现，则以「内网机器复测」为准；将新产物拷贝到内网机器验证能正常弹窗。
5. 复测仍失败时，用 `--no-sandbox` 已覆盖的场景已无更多沙箱方向可调，应转查 GPU 驱动的 `error_code` 具体值（如 error\_code=40 为驱动问题）与事件查看器异常码。

## 涉及文件

- `electron/main.js`（改）：追加 `disable-gpu-sandbox` + `no-sandbox` 开关。

- `scripts/diagnose-windows.ps1`（改）：同步 GPU 崩溃检测提示语。

- `commit_history.log`（改）：提交后追加记录。

