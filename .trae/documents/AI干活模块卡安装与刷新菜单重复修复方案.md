# AI 干活模块：卡「正在安装」+ 刷新菜单重复 修复方案

## Summary
「AI 干活」面板（内嵌 DeepSeek Harness / DSH Web，端口 3081）存在两个用户可见问题：
1. 点击「AI 干活」后卡在「正在安装/正在启动」数十分钟不变，主进程后台 `npx @deepseek-ai/dsh` 报 `ERR_MODULE_NOT_FOUND` 却未中止、错误也不透传给面板。
2. 在 AI 干活面板内刷新后出现重复菜单栏（外层菜单内嵌到内层）。

本方案针对问题 1 做确定性修复（中止等待 + 透传真实错误 + 自愈/指引），针对问题 2 做防护与诊断（恢复/重载幂等 + 失败状态清理，避免半加载 SPA 渲染出重复菜单），并附验证步骤。

## Current State Analysis

### 问题 1：安装/启动进程报错但面板无限等待
入口：[main.js](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L978-L1094) 的 `startDshAgent(config)`。

- L1035-1053：子进程 `stdout/stderr` 由 `forward()` 每 2.5s 节流后 `broadcastDshProgress(installing|starting, "正在安装："+line, …)`。故终端里的 `ERR_MODULE_NOT_FOUND` 也被当作普通进度行转发，用户只看到「正在安装：node:internal/...ERR_MODULE_NOT_FOUND...」，随后进程退出。
- L1050-1053：`close` 回调仅 `log.info("[DSH Agent] exited with code X")` 置空进程引用，**不中止下方就绪轮询**、不广播失败。
- L1066-1086：就绪轮询 `while(Date.now()<deadline)` 只检查 `checkHttpPort(port)`；即使子进程早已退出，仍会继续空转直到 `deadline`（npx 模式 300s；旧构建可能无超时，导致 761s 仍显示「正在安装」）。
- 面板侧 [index.html](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/index.html#L1066-L1092) `handleAgentProgress` 对 `failed` 只显示 `p.message`；而失败时 `message` 里没有真实报错尾段，用户无从自愈。

### 问题 2：AI 干活面板刷新后重复菜单
- 顶部导航（`titlebar-nav .nav-btn`）是 index.html 静态 HTML，[未查出任何动态注入/重复追加逻辑](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/index.html#L895-L969)。
- agent 视图 iframe `agentFrame` 指向 `http://127.0.0.1:3081`（第三方的 DSH Web SPA），其左侧/顶部菜单由 DSH 自渲染。刷新/重载（`agentReload` L1172、浮动 `#btnRefresh` L1251、就绪后 `loadAgentFrame(…,true)` L1085）会整体重载该 SPA；在 DSH 未安装成功或半加载态重载，SPA 可能渲染出**重复/嵌套的菜单栏**（外层应用菜单 + 内层 DSH 自带菜单叠加）。因 DSH 为外部包，本仓库无法直接改其内部渲染。

## Proposed Changes

### A. [main.js] 中止等待 + 透传真实错误（问题 1，主修）

改 `startDshAgent` 及其辅助逻辑：

1. **新增进程退出状态跟踪**：
   - 引入 `let dshExitedPrompt = null;` 与 `let recentTail = [];`（保存最近约 30 行 stdout/stderr 去行尾崩溃堆栈）。
   - `forward()` 同时把原始行写入 `recentTail`（保留最近 N 行）。
   - `close` 回调：记录 `dshExitedPrompt = { code, timeout: false }`，并在**短暂静默期（约 1s 让剩余 stderr 冲刷后）**判定：若进程已非正常退出且端口未就绪 → `buildDshFailMessage()` 取真实报错尾段，`broadcastDshProgress('failed', message)`，**直接 return**（不再进入等待轮询）。
   - `error` 回调：同样 `broadcastDshProgress('failed', …)` 后 return。

2. **就绪轮询每个循环先看退出标志**：
   ```js
   while (Date.now() < deadline) {
     if (dshExitedPrompt && !(await checkHttpPort(port))) { failAndReturn(); return; }
     if (await checkHttpPort(port)) { /* 原 ready 分支 */ return; }
     /* 原 tick 文案 … */
   }
   ```
   确保子进程一退出就立刻失败，而不是空转到超时。

3. **失败消息去重 & 提炼**（`buildDshFailMessage`）：从 `recentTail` 提取含 `ERR_`, `Error:`, `Cannot find module`, `MODULE_NOT_FOUND`, `npm error` 的关键行作为 message，追加可操作指引：
   > 安装 DeepSeek Harness 失败：`<真实报错前几行>`。
   > 尝试：① 在项目根目录执行 `npm i --save-dev @deepseek-ai/dsh@0.1.0-rc.7` 后重试；② 或清除 npx 缓存 `npm cache clean --force` 后重试；③ 或在设置页设置 DSH CLI 路径（DSH_BIN）后重试。

4. **兜底硬超时**：保留 npx 300s / 本地 90s 上限，但超时失败时也带上 `recentTail` 提炼信息，杜绝「无限等待」。

5. **resolveDshBin 自愈增强**（[L884-956](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L884-L956)）：
   - 因 `@deepseek-ai/dsh` 已是项目 devDependency，当 fallback 落到 npx 前，若本地 `node_modules/@deepseek-ai/dsh` 存在且 bin.js 存在则优先走 `node bin.js`（避免 npx 缓存里缺依赖导致的 ERR_MODULE_NOT_FOUND）。
   - 保留现有优先级链并在日志打印最终解析形态（node/npx），便于排查。

6. **日志**：所有失败分支补 `log.error('[DSH Agent] failed: …')`，符合工程规范。

### B. [index.html] 面板体验与问题 2 防护
1. **问题 1 侧**：
   - `handleAgentProgress` 的 `failed` 分支：将 `p.message` 显式展示（已是），若含关键报错给「重试」「打开说明」按钮；确保失败后 `agentEnsurePromise` 已置空可重试（现 L1155 已做，保持不变）。
2. **问题 2 侧（防护 + 干净失败态）**：
   - 统一重载入口：`agentReload` 与浮动 `#btnRefresh` 在 agent 视图只走 `loadAgentFrame(AGENT_PORT, true)` 单一路径，避免双重重载 SPA 造成菜单叠加。
   - 失败/未安装态：当 `state==='failed'` 且 `checkHttpPort` 不可达时，**隐藏/清空 agentFrame**（置空 src 或覆盖为占位提示页），避免 DSH 半加载 SPA 渲染出重复菜单；仅当端口就绪后再加载。
   - 新增幂等守卫：进入 agent 视图时若 `agentFrame.src` 已指向目标地址且内层 SPA 菜单已渲染，不重复 reload。

### C. 说明/文档
- 在 `docs/DSH体验测试指南.md` 故障排查表补一行：安装报 `ERR_MODULE_NOT_FOUND` → 本地 `npm i --save-dev @deepseek-ai/dsh@0.1.0-rc.7` 或清 npx 缓存。

## Assumptions & Decisions
- **问题 1「卡住」主因判定**：子进程异常退出后轮询未中止 + 错误未透传。761s 超时未触达，推测用户跑的是旧打包构建（体验指南 L106 已提示旧 win-unpacked 需重打包）；本方案修的是代码层面的确定性行为，重打包后生效。
- **问题 2 定位**：因用户跳过澄清、且根因位于外部 DSH Web SPA，假定「重复菜单」出现在 AI 干活面板内、由重载半加载 SPA 触发。本仓库可做的是：单一路径重载 + 失败态清理 + 幂等守卫（防菜单叠加）；若复现证实纯属 DSH 内部渲染，则交付「具备干净失败态 + 单入口重载」的缓解，并给出使用说明。
- **不改动 DSH 外部包**：不自改、不自建 dsh 副本源码。
- 遵循项目规范：UTF-8、关键代码补注释、日志清晰、`git commit` 后同步 `commit_history.log`。

## Verification
1. **问题 1（中止 + 透传）**：
   - 模拟：临时把 dsh 解析强制为 npx 且指向不存在的包，或断开依赖，触发异常退出 → 面板应在数秒内由 `installing` 转 `failed`，message 含真实 `ERR_MODULE_NOT_FOUND`/关键报错与指引；不再出现 ≥5 分钟的「正在安装」。
   - 正常路径：本地 npm 装好 `@deepseek-ai/dsh` 后，应解为 `node bin.js`，直接 visible `正在启动 → 就绪`（跳过 npx 安装）。
2. **问题 2**：安装就绪后进 AI 干活，逐一点 `⟳`、浮动刷新、切走再切回，确认菜单栏不重复；安装失败态下确认面板为提示占位、无 DSH 半加载 SPA 渲染的重复菜单。
3. `node --check electron/main.js` 及前端无语法错误；打包 `npm run build:win` 后按体验指南重走一遍。