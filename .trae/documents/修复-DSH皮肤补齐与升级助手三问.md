# 修复 DSH 皮肤补齐入口 + 升级助手「检测升级/刷新版本」三问

## 一、背景与根因

用户升级 DSH（npx 缓存 `v0.1.2-rc.7`，等待运行的实例）后，设置模块暴露 3 个问题。已在实施前核对根因：

| 问题 | 根因（已定位） |
| --- | --- |
| 1. DSH 皮肤插件没了 | 仓库/依赖中完全无皮肤 bundle（`@linxin666/dsh-web-ui-all` 不存在）。DSH 0.1.x 皮肤改由内置 `dsh-client-ui-theme` / `dsh-typert-registry` / `dsh-web-*` 承载，均在 `node_modules` 里；用户升级后 web 界面 profile 被重置/缺失。**属运行时问题**，需诊断 + 一键补齐入口。 |
| 2. 「检测升级」按钮无效 | 前端 [settings.js#L1950](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L1950) 调 `api.checkDshLatest`，但 [preload.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/preload.js) 未暴露该方法、[main.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js) 也无对应 IPC → `if (!api.checkDshLatest) return;` 静默返回，「死按钮」。 |
| 3. 「刷新版本」报 `v<!doctype html>…` | [main.js#fetchRuntimeDshVersion](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L1234-L1257) 对 `/version` 返回的 HTML SPA 页走 `else if (txt)` 分支，把整段 HTML 当版本号 → mismatch.host = HTML → 上屏报错。 |

用户决策：① 皮肤补「一键补齐入口」；② 版本对齐到 `0.1.2-rc.7`（`DSH_VERSION` + `@deepseek-ai/dsh-tools` 依赖）。

## 二、当前状态分析

- `electron/main.js`：`const DSH_VERSION = '0.1.0-rc.7'`（[L284](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L284)）；`fetchRuntimeDshVersion` 存在 HTML 误判；已有一批 `dsh-agent:*` IPC；无 `check-latest` / 皮肤 IPC。
- `electron/preload.js`：已暴露 `detectDshVersionState`（[L501](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/preload.js#L501)）；无 `checkDshLatest` / 皮肤方法。
- `frontend/settings.html`：DSH 升级助手区在 [L953-965](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/settings.html#L953-L965)，含 `btnDetectDshLatest`/`btnRefreshDshVersion`。皮肤区可加在该 setting-row 之后。
- `frontend/js/settings.js`：DSH 升级助手逻辑在 [L1892-1970](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L1892-L1970)。
- `integrations/dsh/plugins/clip-capture/package.json`：dsh-tools 钉 `0.1.0-rc.7`；插件本地 `node_modules/@deepseek-ai/dsh-tools` 实际 `0.1.0-rc.7`。mcp-server 不依赖 dsh-tools。

## 三、拟定改动

### 修复 ① 版本对齐到 0.1.2-rc.7

| 文件 | 改什么 | 为什么 |
| --- | --- | --- |
| `electron/main.js` | `DSH_VERSION` 常量 `'0.1.0-rc.7'` → `'0.1.2-rc.7'` | 单一常量同时驱动「升级助手告警 supported」与兜底 spec，解决用户运行实例 0.1.2 ≠ 应用适配 0.1.0 的漂移告警 |
| `integrations/dsh/plugins/clip-capture/package.json` | `"@deepseek-ai/dsh-tools": "0.1.0-rc.7"` → `"0.1.2-rc.7"` | clip-capture 插件事件契约（`turn/end`）依赖 dsh-tools 版本与宿主 DSH 对齐；宿主 0.1.2，插件必须 0.1.2 才不会契约断层导致牛马自动归档静默失效 |
| `integrations/dsh/plugins/clip-capture/index.mjs` | 顶部注释 `0.1.0-rc.7` → `0.1.2-rc.7`（仅注释） | 保持一致 |

实施时执行：`cd integrations/dsh/plugins/clip-capture && npm i @deepseek-ai/dsh-tools@0.1.2-rc.7`，使插件本地 node_modules 的 dsh-tools 升到 0.1.2（`prebuild-clean.js` 会校验该依赖存在）。

### 修复 ② 「检测升级」按钮（补 check-latest 契约链路）

| 文件 | 改什么 |
| --- | --- |
| `electron/main.js` | 新增 `ipcMain.handle('dsh-agent:check-latest', ...)`：优先 `await fetchLatestDshVersionFromNpm()`，失败回退 `fetchDshHintFromReadme()`（取其 version），返回 `{ latest }`（取不到为 `null`）。复用已有函数，不新增联网逻辑。 |
| `electron/preload.js` | 在 DSH api 区（`detectDshVersionState` 旁）新增 `checkDshLatest: () => ipcRenderer.invoke('dsh-agent:check-latest')` |

前端 `settings.js` 的 `btnDetectDshLatest` 逻辑无需改动，契约补齐后即生效（展示最新版、比较当前、提示升级命令）。

### 修复 ③ 「刷新版本」HTML 误解析

| 文件 | 改什么 |
| --- | --- |
| `electron/main.js` | 新增纯函数 `semverLikeVersion(txt)`：去掉首字符 `v/V`，匹配 `/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]*)?$/` 才通过；`fetchRuntimeDshVersion` 在 `end` 回调中先经该校验，非版本（HTML/缺 version）一律 `resolve({version:null, ok:false})`，不落入 `else if` 分支；`{"version":"x"}` 分支也必须再过一次校验。 |

效果：运行实例 `/version` 返回 HTML → 判为不可用 → IPC `detect-version` 落磁盘兜底（`resolveDshBin` 按 npx 缓存选最高 → 0.1.2-rc.7）→ 版本如实显示、不再报 HTML，且与 DSH_VERSION 对齐后无漂移告警。

### 修复 ④ 皮肤「一键补齐」入口

DSH `dsh-cmdline` 无 `plugin/profile` 子命令（已核查），方案文档里的 `plugin --profile web install` 是推测命令。皮肤补齐做成**「诊断 + 尽力重装 + 如实反馈」**，避免按钮落到假命令。

| 文件 | 改什么 |
| --- | --- |
| `electron/main.js` | 新增两个 IPC：<br>- `dsh-agent:skin-status`：解析 `resolveDshHome()` + 运行中实例，返回 `{ running, skinHome, webProfileFound }`（检测宿主 web 界面是否可达、是否命中内置主题依赖）。<br>- `dsh-agent:skin-install`：(用户点击才触发，不自动联网) 基于 `resolveDshBin(config)` 解析出 `<node> <bin.script>`，尽力执行 DSH CLI 重装/重置 web 界面配置的命令，spawn 捕获 stdout/stderr 流式回传 `{ success, output }`；命令失败也逐字回传 CLI 输出，让用户可见真实原因。具体子命令在实施阶段用 `<node> <bin.script> --help` 探测得出，取可用者；探测无果则回传提示「请手动执行 <复制的命令>」。 |
| `electron/preload.js` | 暴露 `dshSkinStatus: () => ipcRenderer.invoke('dsh-agent:skin-status')`、`dshSkinInstall: () => ipcRenderer.invoke('dsh-agent:skin-install')` |
| `frontend/settings.html` | 在 DSH 升级助手 setting-row（L965）后新增一个「DSH 皮肤/主题」setting-row：状态描述 `dshSkinDesc` + 「检测状态」+「一键补齐」按钮 `btnDshSkinInstall` + 输出区 `dshSkinResult` |
| `frontend/js/settings.js` | 新增 `initSkinSection()`：加载时调 `dshSkinStatus` 渲染；点击「一键补齐」调 `dshSkinInstall` 展示输出；复用 `showToast` 反馈。在 `initDshAgentSection()` 末尾调用 `initSkinSection()`。 |
| `frontend/styles/settings.css`（如该行在 settings.css） | 皮肤区样式复用现有 `.setting-row/.btn`，一般无需新增 CSS；如输出区用 `<pre>`，补一个等宽字体、可滚动的样式。 |

## 四、假设与决策

- **版本格式**：DSH 版本为 semver（`A.B.C[-rc.N]`），HTML 不匹配即拒绝。
- **运行实例版本来源**：`/version` 多为不可靠（返回 HTML），以磁盘 `resolveDshBin`（npx 缓存按版本取最高）为可靠来源；HTTP 仅作 enhanced 探测且必须过 semver 校验。
- **版本对齐后**：宿主 0.1.2-rc.7 = `DSH_VERSION` → 无漂移告警；clip-capture 插件 dsh-tools 升 0.1.2，保证 `turn/end` 契约匹配，牛马自动归档不失效。
- **皮肤补齐为 best-effort**：仓库无皮肤 bundle，无法凭空恢复社区皮肤；一键补齐旨在「诊断 web profile 是否缺失 + 尽力重装 + 如实反馈输出」，若 DSH CLI 无相应命令，则诚实提示并给出可复制命令，不虚构成功。
- **不自动联网**：皮肤安装仅由用户点击「一键补齐」触发，启动时不自动执行（遵守个人/项目既定不自动联网原则）。

## 五、验证

1. `node --check electron/main.js electron/preload.js frontend/js/settings.js` 通过。
2. `cd integrations/dsh/plugins/clip-capture && npm i @deepseek-ai/dsh-tools@0.1.2-rc.7` 后，`node_modules/@deepseek-ai/dsh-tools/package.json` version = `0.1.2-rc.7`。
3. 契约扫描：`ipcRenderer.invoke('dsh-agent:check-latest')` / `'dsh-agent:skin-status'` / `'dsh-agent:skin-install'` 在 preload 有对应暴露、main 有对应 `ipcMain.handle`。
4. 启动应用回归：
   - 「刷新版本」显示 `当前版本：v0.1.2-rc.7（来源：npx 缓存/运行实例）`，无 HTML，无漂移告警。
   - 「检测升级」可点击出结果：展示 npm 最新版并比较当前版。
   - 「DSH 皮肤/主题」区显示诊断状态；点「一键补齐」有输出反馈（成功或如实错误）。
   - 牛马自动归档仍可用（DSH 0.1.2 与 dsh-tools 匹配）。
5. `git status` 仅含本次改动文件。

## 六、提交

提交信息遵循项目规范（`fix:`/`feat:` + 说明），并同步追加 `commit_history.log`：
`YYYY-MM-DD HH:MM | DSH升级助手修复：check-latest契约/版本对齐0.1.2/HTML版本解析/皮肤一键补齐`