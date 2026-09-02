# Windows 便携版 exe 双击无反应 — 排查与修复计划

## Summary（摘要）
用户反馈：用 `npm run build:portable:win` 打出便携版 exe，解压后双击，前端无任何显示、无窗口（以前版本正常）。

`build:portable:win` 链路 = `prebuild && electron-builder --win portable --x64`，**不重建后端 jar、不生成 JRE、也不校验产物完整性**。它完全依赖磁盘上已有的 `backend/target/clip-demo-0.0.1-SNAPSHOT.jar` 和 `jre-slim/win`。若这两者缺失或过期，打出来的便携 exe 里 `resources/backend` 或 `resources/jre` 就会缺关键运行时，直接导致启动阶段失败或静默无窗口。

按启动代码，最符合"完全无反应"的路径是：主进程早期抛出异常，被 [main.js:299 的 uncaughtException](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L299-L308) **静默保活**（只写日志、不弹窗），而托盘在 [main.js:4299](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L4298-L4301) 已提前创建 → 进程活着、托盘图标若有但无窗口，用户观感即"双击无反应"。

本计划：先用应用日志定因果 → 修正便携构建链（jar+jre 必产、Windows 也校验 jre）→ 加固"无窗口时也可见报错"。

## Current State Analysis（现状分析，均来自代码取证）

1. **启动门控**（[main.js:4243-4568](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L4243-L4568)）：
   - 未配置：显示 config.html 引导窗。
   - 已配置：`await startFrontendServer(config)` → 按 `startupMode` 决定后端行为 → `createMainWindow(config)`。
   - 后端/前端失败 → `dialog.showErrorBox` + 降级到 Settings 窗（[main.js:4541-4566](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L4541-L4566)）。

2. **静默吞错**（[main.js:297-308](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L297-L308)）：
   - `uncaughtException`/`unhandledRejection` 只 `log.writeExceptionLog`，不弹窗不退出 → **"无窗口但进程在跑"** 的最可能来源。

3. **构建链缺口**：
   - [package.json:35](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/package.json) `build:portable:win` 不跑 `build:jar`、不跑 jlink。
   - [package.json:80-86](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/package.json#L80-L86) `extraResources` 用 `jre-slim/${os}`（Windows→`jre-slim/win`）打进 `resources/jre`。若该目录不存在→空。
   - [electron/afterPack.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/afterPack.js) 校验 JRE 只在 macOS，**Windows 不校验** → 缺 jre 也照样出包，不报错。
   - [electron/main.js:330-388](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L330-L388) `getJavaCommand()` 顺序：`resources/jre` → `resources/runtime` → `APP_DIR/jre` → ... → 最后回退系统 `java`。机器无系统 java 时 → `spawn('java')` ENOENT → 后端起不来。
   - [electron/main.js:466-484](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L466-L484) `getJarPath()` 优先 `resources/backend/clip-demo-0.0.1-SNAPSHOT.jar`，缺失→ `startBackend` 直接 reject "Cannot find backend JAR"（[main.js:670-674](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L670-L674)）。

4. **日志位置**（[electron/logger.js:9-10](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/logger.js#L9-L10)）：`app.log` 写 `process.cwd()`；后端日志 `backend.log` 写 exe 所在目录（[main.js:695](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L695)）。便携版双击启动时 cwd 通常是 exe 所在/来源目录。

## Proposed Changes（变更方案）

### 阶段 1：取证（先做，定因果）
目的：确认是「构建产物缺失」还是「模块加载期崩溃」。
1. 让用户重新解压并双击失败 exe，随后提供两份日志：
   - `app.log`（exe 所在目录）
   - `backend.log`（exe 所在目录）
   - 若 `resources/backend/application.yml` / 配置目录存在，一并看。
2. 判定映射：
   - 日志有 `Found JAR at:` 但是 backend 起不来 / ENOENT java → JRE 缺失（阶段 2A）。
   - 日志有 `Cannot find backend JAR` → jar 缺失（阶段 2A）。
   - 日志只有零星其余模块输出、没有 `=== App Startup ===` 或到此中断 → 模块 require 期崩溃（阶段 2 + 阶段 3 加固）。
   - app.log 为空/根本无文件 → 进程未执行 main.js（asar/解压/sys 层） → 检查便携 exe 用 7z 解开后的目录结构与 `resources/`。

### 阶段 2：修复便携构建链（产物完整）
具体文件与改动：
1. [package.json](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/package.json) — 让 `build:portable:win` 保证产物闭环：
   ```
   "build:portable:win": "npm run build:jar && npm run build:jlink:convert-win && npm run prebuild && electron-builder --win portable --x64"
   ```
   其中 `build:jlink:convert-win` 确保生成 `jre-slim/win`（复用现有 `scripts/build-jlink-slim.mjs` 的 win 产出）。
   说明：如项目已有生成 `jre-slim/win` 的可靠命令（`npm run build:jlink:slim` 在本机 win 下运行即产出 win），则直接复用该命令；否则新增一个明确产出 win 的包装脚本/命令。目标：**任何一条 win 打包命令都不再偷偷依赖"之前恰好生成过"的 jre-slim**。
2. [electron/afterPack.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/afterPack.js) — 将 JRE 存在性校验从"仅 macOS"扩展为全平台：Windows 打包后若 `resources/jre/bin/java.exe` 不存在，直接 `throw` 让构建失败并给出明确错误（缺 `jre-slim/win`），避免再次产出坏 exe。
3. 打包前健康检查脚本（新增轻量 `scripts/check-win-artifacts.js`，或并入 afterPack）：校验便携产物内必须存在
   - `resources/backend/clip-demo-0.0.1-SNAPSHOT.jar`
   - `resources/jre/bin/java.exe`
   - `resources/frontend/index.html`
   - `resources/ocr-models/**`、`resources/integrations/dsh/**`
   缺任一项即中止并打印缺项。

### 阶段 3：加固"无反应"可见性（根治回归）
1. [electron/main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js) — 新增 `showStartupFatalError(title, detail)`：调用 `dialog.showErrorBox`，并尽力打开一个只读错误窗口（复用 config.html 或最小 BrowserWindow）展示 Java/JAR/Frontend 路径与错误信息，确保**任何启动异常都能让用户看到**，而非静默。
2. 把 `uncaughtException`/`unhandledRejection`（[main.js:299-308](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L299-L308)）在保持"不退出"的同时，追加一次 `showStartupFatalError`（做节流，避免重复弹）。这样"进程活着但没窗口"的隐形失败变成可见错误。
3. [electron/logger.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/logger.js#L9-L10) — `app.log` 改写到稳定、可查的位置（打包后写 exe 同目录或 `userData`，而非依赖 `process.cwd()`），保证便携版日志一定落盘、可复盘。

### 约定下的最小改动原则
- 阶段 1 无代码改动，仅取证。
- 阶段 2 只补构建链与校验，不改运行逻辑。
- 阶段 3 只加"错误可见"与"日志落盘"，不动既有成功路径行为。

## Assumptions & Decisions（假设与决策）
- 假设主要产物是**便携版 exe**（用户已确认用 `build:portable:win`）。
- 假设用户手头**能拿到 app.log**（用户已确认）。
- 决策：不改动正常启动成功路径；仅当异常时才新增可见报错，避免弹窗回归。
- 决策：JRE 缺失即便不直接导致"无窗口"，也属构建链缺陷，一并修复；真正的"无窗口"主因以阶段 1 日志结论为准。

## Verification（验证步骤）
1. 阶段 2 后重打包：
   ```
   npm run build:portable:win
   ```
   确认结束退出码 0，无 afterPack/check 抛错。
2. 解包校验（用 7z 打开便携 exe 或运行 `win-unpacked` 同理）：确认 `resources/backend`、`resources/jre/bin/java.exe`、`resources/frontend/index.html` 齐全。
3. 在一台**无系统 Java** 的干净 Windows 机器上双击便携 exe：
   - 正常预期：出现窗口；若后端仍受 JRE 影响，至少出现可见错误框 + app.log/backend.log 可用。
   - 确认不再出现"无任何反应"。
4. 回归：标题栏原生拖拽、右键菜单、F1 截图、双击文件唤起仍正常。
5. 若阶段 1 定位到模块加载期崩溃，则按日志栈修复对应 require（预留给第 3 步决定，不在此固定）。