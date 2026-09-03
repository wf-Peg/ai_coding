# 内网启动排查诊断与 Windows 验证脚本方案

## 摘要

内网机器解压新版后 Electron 客户端不弹窗。`app.log` 只输出到 `[Probe] packaged resources` 一步（main.js 4743 行），后续所有日志标记全部缺失，说明主进程在「探针之后、加载配置之前」某处**静默卡住或崩溃**，且没有可定位的异常信息。

本方案做两件事：

1. **代码级插桩**：在 main.js 每个启动阶段之间加"阶梯(Ladder)"日志 + 启动看门狗 + 渲染进程崩溃捕获 + 顶层 try/catch，让内网机器重新打包跑一次即可精确看到卡在哪一步。
2. **一个开箱即用的 Windows PowerShell 检查脚本**：静态校验安装目录关键资源（JRE/后端 JAR/前端），实测 Java 版本、端口占用、残留进程、配置形态，并可拉起应用逐阶段探测，输出 PASS/FAIL 报告。

> 说明：脚本对**当前这份只有 Probe 日志的旧包**也可用（静态校验全部有效）；配合插桩后的新包则能进一步定位到具体卡住的阶段。

***

## 现状分析

关键事实（均来自对 [main.js](file:///f:/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/ai_coding/electron/main.js) 的实际阅读）：

- 日志起点：`[Probe] whenReady entered`(4731)、`[Probe] packaged resources`(4743)，与本机一致。

- 探针之后依次是：`setupIPC()`(4748) → `await session.defaultSession.clearCache()`(4753，随后 4754 应打印 `[Startup] Browser cache cleared`) → `initLocalIndex`(4763，随后 4764 应打印 `[local-index] initialized`) → 截图初始化(4784) → `createTray()`(4796) → 配置迁移检查(4800-4832) → `loadConfig()`(4834，4835 打印 `Config loaded:`) → `killPortProcess`(4845)。

- 用户日志里探针后**再无任何一行**，因此停顿发生在 4743\~4835 之间。候选点：

  - `await session.defaultSession.clearCache()`：内网离线时空闲卡住的高概率点。

  - `initLocalIndex(config.storagePath)`：默认 `storagePath = APP_DIR`（158-166 行），解压目录 `D:\soft\CutShelter` 内含 `integrations/dsh/node_modules` 等大目录，**同步全量扫描可能长期阻塞事件循环**，最符合"探针后无任何日志"的现象。

  - `createTray()`、配置迁移、`loadConfig()` 均较常规，风险低。

- 当前代码即使异常，`uncaughtException`/`unhandledRejection` 会兜底写日志（304-313 行），但**同步卡死（事件循环被占）时兜底也救不了**——这正是需要插桩 + 看门狗的原因。

- 后端正常态 /health 与 /api/health 均返回 200（HealthController），前端静态服务占 `frontendPort:3001`（1840-1944 行），后端占 `backendPort:8081`，供脚本实测用。

***

## 变更内容

### A. `electron/main.js` — 启动阶梯插桩 + 看门狗 + 渲染诊断

1. **新增启动阶梯日志助手**（放在 whenReady 之前）：

   - `const startupTimer = { t0: Date.now(), last: Date.now() };`

   - `function stepLadder(name)`: 打印
     `[Ladder] step:${name} elapsed=${Date.now()-startupTimer.t0}ms gap=${Date.now()-startupTimer.last}ms`
     并更新 `last`。
2. **在关键阶段插入** **`stepLadder(...)`**，每次调用前后各一条（前/后成对）：

   - 探针后：`stepLadder('probe')`

   - `clearCache` 前 `stepLadder('cache.before')`、后 `'cache.after'`

   - `initLocalIndex` 前 `'index.before'`、后 `'index.after'`（后置日志用于证明扫描完成；`initLocalIndex` 返回的 count/generation 前也用它记录）

   - 截图初始化后 `'screenshot.after'`、`createTray` 后 `'tray.after'`、配置迁移后 `'migrate.after'`

   - `loadConfig` 后（即 4835 现有 `Config loaded:` 前）`'config.after'`

   - `killPortProcess` 后 `'ports.after'`

   - 已配置分支：(4962) `startFrontendServer` 前 `'fe.before'`、后 `'fe.after'`，`createMainWindow`(5014) 后 `'window.after'`

   - 首次运行分支：(4892/4899) `startFrontendServer`/`startBackend` 前后同理。
3. **启动看门狗**（probe 后立即启动一个 `setInterval`，例如每 10s 一次，最久 120s）：

   - 条件：若尚未 `createMainWindow` 且尚未打印过 `Config loaded`，则打印
     `[Ladder][STALL] no-window elapsed=${ms}s`。

   - 若干规则触发后（如已创建主窗口或应用已完全启动 `appStartupComplete=true`）自清理 `clearInterval`。

   - 作用：若卡在 `await clearCache` 这类永不 resolve 的异步点，看门狗能持续标记"仍无窗口"，并配合 CPU/内存信息（`process.getCPUUsage()` 当前仅主进程）辅助区分"事件循环被占用"还是"等一个永不完成的 Promise"。
4. **渲染进程诊断补全**（`createMainWindow` 2332 附近）：

   - 增加 `webContents.on('render-process-gone', ...)` 记录 GPU/渲染器崩溃码（reason + exitCode）。

   - 增加 `webContents.on('unresponsive', ...)` 与 `responsive` 日志。

   - 保留并强化现有 `did-fail-load` 日志（打印 errorCode + description，便于看到 -102/-3 及更多错误码）。
5. **顶层 try/catch 兜底**：把 `app.whenReady().then(...)` 的回调体最外层包裹 `try {} catch (e) { log.error('[Startup] FATAL in whenReady:', e); log.writeExceptionLog('electron', ...) }`，与现有分段 catch 形成双保险。

> 均为增量日志/防御代码，不改变既有启动行为与顺序。

### B. `scripts/diagnose-windows.ps1` — Windows 检查/验证脚本（新增）

自包含、纯 PowerShell、UTF-8 写入（脚本头 `[Console]::OutputEncoding` 处理中文）。入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnose-windows.ps1 -InstallDir "D:\soft\CutShelter" [-Launch] [-KeepRunning]
```

输出统一 `[PASS] / [FAIL] / [WARN]` 前缀 + 中文说明 + 结尾汇总报告（可选 `-OutFile report.txt` 导出）。

1. **静态资源校验**

   - 目录存在；可写（日志目录探测：在安装目录下试建 `app.log` 写权限）。

   - `*.exe` 存在（glob 应用可执行文件，productName=CutShelter）。

   - `resources\jre\bin\java.exe` 存在；若存在，`& ...java.exe -version 2>&1` 解析 Java 主版本，**要求 ≥ 17**（匹配项目 JAR 编译版本，规避 UnsupportedClassVersionError）。

   - 系统 `java -version`（作为后备路径提示，非必须通过）。

   - `resources\backend\clip-demo-0.0.1-SNAPSHOT.jar` 存在且 >1KB。

   - `resources\frontend\index.html` 存在。

   - `resources\integrations\dsh` 存在。
2. **运行时环境**

   - 端口占用：`netstat -ano | findstr` 检查 `8081`/`3001`，列出占用 PID；有占用提示清理残留进程。

   - 残留进程：`Get-Process CutShelter -ErrorAction SilentlyContinue`，存在则 `[WARN] 有旧实例运行，单实例锁可能导致本次不弹窗`（对应 4658 行锁逻辑）。

   - 识别配置形态：读 `%LOCALAPPDATA%\CutShelter\config\config.json` 是否存在及其 `configured/startupMode`，提示是"首次运行(应弹设置窗)"还是"已配置(应弹主窗)"。
3. **拉起探测（`-Launch`** **时执行）**

   - `Start-Process` 启动 exe，等待数秒。

   - 确认进程存活（未闪退）。

   - 轮询 `app.log`（记录初始长度 diff），识别**最后一条**阶梯标记，定位停在第几步。

   - 轮询前端 `http://127.0.0.1:3001`（期望 200）与后端 `http://127.0.0.1:8081/api/health`（期望 `status=UP`）。

   - 打印 `[OK] 全链路就绪` 或 `[FAIL] 停在第 X 阶段` + 给出对应根因提示。

   - 默认 `taskkill` 结束本次启动的进程，除非 `-KeepRunning`。
4. **日志尾部**

   - 输出 `app.log`、`backend.log`（若存在）最后 \~40 行到报告，便于协作定位。

### C. `package.json` — 增加快捷脚本

```json
"diag:win": "powershell -ExecutionPolicy Bypass -File scripts\\diagnose-windows.ps1"
```

### D. 重新打包与基线自检

- 用 `npm run build:jlink:win`（记忆约束：必须先准备 JDK→`jre/win`、跑 `build:jlink:slim`，确保内嵌 JRE 进 `resources/jre`）重新打包，使插桩后的 main.js 进入产物。

- 在本机对**健康构建**跑一遍 `diagnose-windows.ps1 -Launch`，确认全部 PASS，作为正常基线，再交给内网机器复测定位。

***

## 假设与决策

- 无法直接触达内网机器，故以"静态脚本 + 阶梯日志"让内网现场自行复现定位根因；方案不臆断单一根因。

- 所有新增日志/注释沿用项目中文惯例；脚本中文输出默认 UTF-8，规避乱码。

- 仅做增量日志与防御，不修改启动顺序与既有逻辑，不引入新依赖。

## 验证步骤

1. 本机复核：`electron .` 或直接 `npm run start`，确认 app.log 出现完整 `[Ladder]` 阶梯序列直至 `window.after`。
2. 打包：`npm run build:jlink:win`，产物解压后运行 `diagnose-windows.ps1 -Launch`，对照预期阶梯标记与前端/后端 HTTP 均通过。
3. 内网机器：解压新包 → 运行脚本（静态校验 + `-Launch`）→ 依据"最后一条阶梯标记"定位停顿阶段并反馈 app.log 尾部，据此收敛根因（clearCache 阻塞 / initLocalIndex 全量扫描过慢等）。

