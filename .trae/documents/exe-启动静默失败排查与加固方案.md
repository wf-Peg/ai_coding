# EXE 启动静默失败：排查与加固方案

## Summary

**现象**：Windows 打包 exe（CutShelter）在**离线云桌面**上双击启动「无反应」——无窗口、无日志（`app.log` 未生成）、无可见进程。
**目标**：① 定位最可能根因（分出主次）；② 提供一套"失败可见化 + 日志可靠落盘 + 单实例降噪"的加固，确保证常启动或失败时都能留痕；③ 给出可复现的验证步骤。

***

## 一、现状分析（基于实际代码，含行号）

### 核心链路

| 环节           | 位置                                                                                                                 | 关键逻辑                                                                  | 静默失败点                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------- |
| 日志模块         | `electron/logger.js` L9-15, L98-102                                                                                | `LOG_DIR = process.cwd()`；写 `cwd/app.log`；失败仅 `console.error`，**不落盘** | 运行目录只读/无权限 → **"没日志"**                |
| 启动早期 require | `electron/main.js` L20-44                                                                                          | 顶层 require 一堆模块 + `new EditorFileService()`                           | 任一 require/构造抛错 → 被兜底吞掉               |
| 异常兜底         | `electron/main.js` L302-311                                                                                        | `uncaughtException`/`unhandledRejection` **仅打日志、keep alive**          | 早期错误被吞 → **进程活着但无窗口**                 |
| 单实例锁         | `electron/main.js` L4654-4703                                                                                      | `requestSingleInstanceLock` 失败 → `app.quit()`；二次实例 `second-instance`  | **静默 quit，无日志说明原因** → 双击"没反应"         |
| 后端拉起         | `electron/main.js` L670-772, L1725-1762                                                                            | spawn java + 轮询 `checkPort`，失败 reject/超时                              | 后端失败不影响建窗（窗口 L4880、后端 L4917）→ 不致"无窗口" |
| 自动更新         | `electron/update-manager.js` L789, L257-326                                                                        | 首次延迟 5s、HTTPS 请求有超时                                                   | 基本不会卡死启动                              |
| 打包资源         | `package.json` build.files=`electron/**`；extraResources=`jre-slim→jre`、`backend jar`、`frontend`、`integrations/dsh` | —                                                                     | 离线/换机后资源缺失 → require 抛错被吞             |

### 日志路径根因（解释"没日志"）

`logger.js` 用 `process.cwd()` 定位日志文件。**双击 exe 时 cwd = 快捷方式/文件管理器打开的目录**，若该目录（云桌面挂载盘/Program Files/只读共享）不可写，`appendFileSync` 每次都抛错但只 `console.error`（无控制台看不到）→ 任何异常都不会落盘 → 用户看到"完全没日志"。

***

## 二、可能根因排序

1. **单实例锁 / 遗留进程（最贴合"无反应"）**：离线云桌面会话重连/冻结后，旧 `CutShelter.exe` 常残留后台但**窗口不可见**。再次双击 → `requestSingleInstanceLock` 判定已有实例 → **静默** **`app.quit()`**；或走 `second-instance`→`showMainWindow()`，但旧窗口不可见（trayHidden/最小化/桌面不显示）→ 看起来"没反应"。且进程短暂存在即退出，任务管理器难以捕捉。
2. **运行目录只读 / 无写权限**：直接导致"无日志"；叠加兜底吞掉早期异常 → "进程存在但无窗口"。
3. **打包资源缺失/损坏（离线换机场景）**：`jre/bin/java.exe`、`backend jar`、`frontend`、`integrations/dsh` 任一缺失 → require 抛错被 `uncaughtException` 吞 → 无窗口无日志。
4. **后端 Java 不可用**（jre 缺失）：仅当 `startupMode` 非 `frontend-only` 同步等待时可能长时间等；默认模式不至于无窗（低概率）。
5. **云桌面图形/GPU**：窗口创建失败（相对少见）。

***

## 三、拟改动（均聚焦"失败可见 + 日志可靠"）

### A. 日志可靠落盘（核心，解决"没日志"）

* **文件**：`electron/logger.js`

* **方式**：日志目录改为**优先 userData 下** **`logs/`、不可写时回退 cwd**；由 `main.js` 显式注入日志目录（`log.init(dir)`），弃用 `process.cwd()` 推断。

* **why**：userData（`%LOCALAPPDATA%\CutShelter`）对当前用户必然可写，双击失败也能留一份日志。

### B. 启动阶段探针（把"卡在哪"显性化）

* **文件**：`electron/main.js`（启动早期 + whenReady 后）

* **方式**：在启动各关键节点（进入 whenReady / 创建窗口 / 拉起后端 / 单实例锁结果 / 异常兜底）写一行进度到探针日志；`uncaughtException` 兜底同时写 userData 探针。

* **why**：离线也能从日志看出执行到哪一步崩溃/停滞，替代"靠猜"。

### C. 打包资源预检（面向离线交付）

* **文件**：`electron/main.js`（探针阶段顺带统计）

* **方式**：一次性 `log.info` 打印：EXE 目录、`resourcesPath`、`jre/bin/java.exe` 是否存在、`backend jar` 是否存在、`frontend` 是否存在、`integrations/dsh` 是否存在。

* **why**：看日志即可直接判定"资源缺失"这一类根因。

### D. 单实例锁可见化 + 二次实例唤醒加固

* **文件**：`electron/main.js`（L4654-4703）

* **方式**：① 锁获取失败时 `log.error` 明确打印"已有实例运行，将退出"并附排查提示（结束旧进程 / 检查任务栏隐藏窗口），不再静默；② `second-instance` 到达而对端窗口存在但 hidden/minimized 时，`restore + show + focus` 强制拉回前台。

* **why**：消除"拖动后没反应"这件最容易误判为启动失败的情形。

***

## 四、假设与决策

* 假定目标 exe 为 **win x64 electron-builder 产物**（安装版 NSIS 或 `win-unpacked` 便携版）。

* 本次只做"失败可见化 + 日志路径修正 + 单实例降噪"，**不改变默认启动模式**（`frontend-only`）、不自动联网。

* 单实例锁**保留**（正常用户只应跑一份），只对"失败静默"与"二次唤醒不可见"做加固。

***

## 五、验证步骤

1. **开发回归**：`npm start` 正常弹窗；改动的 `main.js`/`logger.js` 过 `node --check`。
2. **离线复现加固前**：在**只读目录**放 exe 双击 → 应复现"无日志、无反应"。
3. **加固后复验（关键）**：

   * 只读目录放 exe → 双击启动，`%LOCALAPPDATA%\CutShelter\logs\app.log` 应生成，内含启动探针各阶段行 → 能看出执行到哪、缺什么资源。

   * 先手动起一份再二次双击 → 探针日志出现"已有实例运行，将退出"；首次窗口被最小化时二次双击 → 应能拉回前台。

   * 手动删掉/改名 `resources/jre` → 探针日志打印"jre 缺失"。
4. **实机验证**（目标离线云桌面）：建议先按"D 用户指引"收集信息，再套用修复验证。

