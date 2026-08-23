# Electron v36 升级优化 —— 落地范围：端口探测异步化 + 窗口安全加固

## 摘要（Summary）
Electron v28 → v36 / Node 22.19 升级完成。经探索确认：性能侧的 `node:sqlite`、打包器配置等红利已吃到。本次落地聚焦两块：
- **端口探测异步化**：消除主进程里同步 `execSync` 对 `netstat/lsof/taskkill` 的阻塞。
- **窗口安全加固**：把 3 处仍开着 `contextIsolation:false / nodeIntegration:true` 的窗口改成与现代安全基线一致（contextBridge + preload）。

不涉及标题栏 `titleBarStyle` 重构、不迁移进程到 `utilityProcess`（回归风险高、收益低，记录在案不动作）。

---

## 现状分析（Current State）

### 已确认的安全基线（无需改动）
- 主窗口〔main.js:1941-1953〕已 `contextIsolation:true / nodeIntegration:false + preload.js`，符合 v36 安全默认。
- 已使用 `setWindowOpenHandler`、`app.setAppUserModelId`、`requestSingleInstanceLock`、`globalShortcut`、`shell.openPath` 等现代 API，**无已移除(v36)的旧 API**。

### 待改点
| # | 文件:行 | 现状 | 问题 |
|---|---------|------|------|
| A1 | main.js:590-640 `killPortProcess` | 用 `execSync(netstat/taskkill/lsof)` 同步阻塞主进程 | 启动清理、退出时阻塞主线程数百 ms |
| A2 | main.js:595/612/621 | 三处 `execSync` | 同步子进程调用 |
| B1 | main.js:1750-1762 关闭确认弹窗 | `nodeIntegration:true, contextIsolation:false` | 内嵌 HTML 仍开 Node |
| B2 | screenshot-service.js:293-298 截图覆盖层 | `nodeIntegration:true, contextIsolation:false` + 遗留 `enableRemoteModule:false`(v36 no-op) | 覆盖层开 Node；且 `screenshot-window.html:123` 用 `require('electron')` |
| B3 | screenshot-service.js:459 贴图窗口 | `nodeIntegration:true, contextIsolation:false` | 贴图窗开 Node；且 `paste-window.html:77` 用 `require('electron')` |
| B4 | OCR 结果窗 ocr-result-window.html:121 | 依赖 `require('electron')` 的 `ipcRenderer` | 若其对应的 BrowserWindow 也开 Node，一并纳入；否则仅适配 |

- `checkPort`〔main.js:1354〕**已是异步**(HTTP/TCP 轮询)，无需改；阻塞的只有 `killPortProcess`。

---

## 拟定改动（Proposed Changes）

### A. 端口探测异步化

**A1. 把 `killPortProcess(port)` 改为异步**（main.js:590-640）
- what：把内部三个 `execSync` 换成 `child_process.exec`/`execFile` + Promise，函数返回 `Promise<void>`。
- why：启动/退出清理端口时不再冻结主进程；与已异步的 `checkPort` 保持一致。
- how：
  - 引入 `execAsync(cmd, opts)` Promise 封装（基于 `child_process.exec`，保留 `timeout:5000`）。
  - Windows 分支：`netstat -ano | findstr` 结果解析逻辑不变，终止用 `taskkill`（异步）。
  - macOS/Linux 分支：`lsof -ti :port` 取 PID 后用 `process.kill`（同步但非阻塞进程创建，可保留）。
  - 保持容错语义：无占用/命令失败不抛错，走原 log 路径。

**A2. 更新调用点（await 化）**
- 调用点：main.js:795、801、802、1338、4312、4313。
- what：按所在流程决定 await 或 fire-and-forget：
  - 启动清理（795，启动后端前）→ `await killPortProcess(...)`，避免刚清理完端口就被新进程占用。
  - 退出清理（801/802/4312/4313，`before-quit`/`will-quit`）→ fire-and-forget 或轻度 await，不阻塞退出。
  - 1338（DSH 端口释放）→ await 到可用。
- 注意：`execSync('chcp 65001')`〔main.js:4234〕为 Windows 一次性的代码页设置，非性能热点，保留不动。

### B. 窗口安全加固（contextBridge + preload，contextIsolation:true）

原则：不引入额外全局依赖，为截图族窗口建一个**共用的 `screenshot-preload.js`**，用 `contextBridge.exposeInMainWorld('screenshotApi', …)` 暴露所需的 `ipcRenderer.invoke/send/on` 白名单；窗口 HTML 里把所有 `require('electron')` 调用替换为 `window.screenshotApi.*`。

**B1. 关闭确认弹窗（main.js:1750-1762）**
- what：`webPreferences` 改为 `{ contextIsolation:true, nodeIntegration:false, preload:<新增专用 preload> }`。
- how：该弹窗仅为确认文案 + 按钮，需暴露的 IPC 极少（确认执行动作、关闭）。新增一个极简 preload（或直接复用主 preload 的命名空间）把所需 `invoke`/`close` 暴露出来，把内嵌 `<script>` 里的 `require('electron')` 改为 `window.<api>.*`。

**B2. 截图覆盖层（screenshot-service.js:293-298）**
- what：`webPreferences` 改为 contextIsolation:true + `preload: screenshot-preload.js`，去掉遗留 `enableRemoteModule`。
- how：`screenshot-window.html:123` 的 `const { ipcRenderer, clipboard } = require('electron')` 改为使用 `window.screenshotApi`（保留 `clipboard` 对应能力，如需）。逐处替换 `ipcRenderer.send/invoke/on`（该文件约 6 处）。

**B3. 贴图窗口（screenshot-service.js:459）**
- what：同上，`contextIsolation:true + preload`。
- how：`paste-window.html` 的 `require('electron')`（约 20 处 `ipcRenderer.invoke/send`）替换为 `window.screenshotApi.*`；保留滚轮缩放/双击等前端逻辑不变。

**B4. OCR 结果窗（ocr-result-window.html）**
- what：确认该窗创建处的 `webPreferences`；若也为开 Node，则同法加固，否则仅做 HTML 适配到同一 preload。
- how：`ocr-result-window.html:121` 的 `require('electron')` 改用 `window.screenshotApi`。

> 说明：因同属截图族，B2/B3/B4 共享 `screenshot-preload.js`；白名单方法即上述 HTML 里实际用到的 channel（如 `screenshot:confirm/cancel/init/init-error/loading/painted`、`paste:move-to/set-opacity/zoom-at/set-top/save/rearrange/text-ready/rendered/render-error`、`screenshot:copy-last/ocr/open-in-editor/close-paste-windows`）。不使用的 channel 一律不暴露。

---

## 假定与决策（Assumptions & Decisions）

- **落地范围仅限两块**：端口异步化(A) + 窗口安全加固(B)。标题栏重构、utilityProcess 迁移、右键细化均不纳入本计划。
- **不引入第三方依赖**：异步化用 Node 内置 `child_process.exec`；安全加固用 Electron 内置 `contextBridge`。
- **沿用既有 preload 惯例**：主窗口已用 `window.electronAPI`；截图族用独立 `window.screenshotApi`，保持隔离与单一职责。
- **B 部分不改变任何功能行为**：仅替换安全边界与调用方式，截图/贴图/OCR 交互逻辑与体验保持不变。

---

## 验证步骤（Verification）

1. **异步化回归**：反复启动/关闭应用（含模拟端口残留），确认能正确清理端口、后端正常起停、关闭过程不卡顿；`main.js` 无可复现的同步块告警。
2. **关闭弹窗**（B1）：点关闭按钮弹窗正常显示/确认/取消，无 Node 报错。
3. **截图**（B2）：F1 截图 → 拖选 → 确认/复制/取消 全流程正常。
4. **贴图**（B3）：粘贴 → 拖动/缩放/双击置顶/不透明度/复制/OCR/保存 正常，无中断。
5. **OCR**（B4）：对图片执行 OCR，结果窗正常打开/跳转编辑器；缺失模型时降级提示仍生效。
6. **自动化**：`npm run test:editor-all` 通过；如 `npm run test:workspace` 可用则一并跑通。
7. **打包**（选做）：按目标平台 `npm run build:mac:arm`（或对应）成功，发版产物交互正常。

---

## 备注（Notes）
- 本计划为落地清单，尚未改代码；确认后按 A→B 顺序、分次小步实施与验证。