# 开发计划：dsh 自助安装 + 模块收纳工具中心 + 导航菜单配置

## 标题栏菜单头布局（改动后）

```
[编辑][工作台][剪藏][工具][设置]
```

顶栏只保留 5 个固定入口。除「编辑/工作台/剪藏」外的其余模块（**知识、Wiki、密码、AI干活**，以及**学习计划、数据观测台**）全部收纳进「工具」模块作为子工具卡片，进入工具页统一访问。工具页内可对这些模块子工具配置**是否显示到标题栏菜单头 + 顺序**（复用现有 config.json 持久化）。

> 说明：顶栏的主入口固定为 编辑/工作台/剪藏/工具/设置。知识/Wiki/密码/AI干活 等不再直接出现在顶栏，而是作为工具卡片收纳；但保留「工具设置」里把这些模块重新固定/排序的能力，方便用户按需把高频模块固回顶栏（可选）。

## 摘要（大白话）

1. **减小安装体积**：把内包的一大堆 dsh 依赖（3.3 万个文件、约 192 MB）从安装包里拿掉，安装更快、体积显著变小。
2. **dsh 改用户自助安装**：CutShelter 不再自动联网下载，只提示一条 `npx` 命令；同时检测 dsh 是否装好。
3. **AI干活作为工具之一 + 前置校验**：进入「工具 → AI干活」时先检测 dsh 是否就绪；未装则展示安装说明与步骤，并需用户「激活/重试」确认后才装载面板；装好后解锁。
4. **导航重构**：标题栏只保留 编辑/工作台/剪藏/工具/设置；知识/Wiki/密码/AI干活、学习计划/数据观测全部收纳进工具模块（复用现有 `module` 子工具卡片机制）。
5. **工具设置**：工具模块内可配置各模块子工具是否显示到标题栏菜单头及顺序（存 config.json）。
6. **后端就绪广播**：启动后端后，工具模块及各模块子工具页面同样能收到后端就绪通知并自动刷新（复用现有 `notifyAllFrames` → tools.html `onBackendReadyRefresh` 通路）。

## 目标决策（已与用户确认）

| 项 | 决策 |
|---|---|
| dsh 安装形式 | **npx 免安装**：提示 `npx @deepseek-ai/dsh@0.1.0-rc.7 web` |
| 应用是否自动安装 dsh | **完全取消**应用内 npx 自动联网安装 |
| AI干活激活校验 | **前置检测 + 激活**：未装显示说明/安装步骤，需用户确认后重试；装好解锁装载面板 |
| 配置持久化 | **复用现有 config.json**（loadConfig/saveConfig 已存在） |
| 非核心模块归属 | **收纳到工具中心**：标题栏仅留 编辑/工作台/剪藏/工具/设置 |
| 后端就绪广播 | 接入现有 `notifyAllFrames` → 工具模块及子工具自动刷新 |

## 现状分析（探索结论，已核实）

- **安装体积元凶**：
  - `scripts/build-dsh-offline.mjs` 生成 `dist-dsh-offline/node_modules`（33000 文件、~192 MB）。
  - `package.json` `build.extraResources` 内置为 `resources/dsh-offline`；`scripts.prebuild` 调用 `build-dsh-offline.mjs`。
- **dsh 启动逻辑**（`electron/main.js`）：
  - `resolveDshBin()`（L894）：`dshBinPath` 配置 → `DSH_BIN` → 内置 node_modules → npx 缓存 → **npx 自动联网兜底**。
  - `startDshAgent()`（L1006）：找不到本地 dsh 时自动 `npx @deepseek-ai/dsh@0.1.0-rc.7 web`（联网 1–5 分钟，超时 300s），广播 `installing` 状态。
  - `dsh-agent:ensure/status/stop/cancel` IPC（L2091-L2127）。
- **前端 AI干活视图**（`frontend/index.html`）：
  - `ensureDshAgentRuntime()` → `dsh-agent:ensure`；`handleAgentProgress()` 处理 `detecting/installing/starting/ready/failed` 五态。
  - 纯浏览器模式已走「直接探测 3081 + 手动启动提示」。
- **导航/视图**：
  - 标题栏 `nav`（index.html L568-626）为**静态写死按钮**：编辑/工作台/剪藏/知识/Wiki/密码/工具/AI干活/设置。
  - `pathToView`（L1212）、`viewMap`/`VIEW_IFRAME`（L934-959）、`renderView`（L972）。
  - `navigateModuleTool` 白名单（L854-861）现仅含 `learning-plan`/`data-observability`。
- **工具模块（Tools Hub）**：
  - `frontend/js/tools-core.js`：`MODULE_TOOLS` 常量（L71-94）含学习计划/数据观测，`module:true`、`system:true`，点卡片走 `openModule` → `postMessage({type:'navigateModuleTool',view})` 跳主框架视图。
  - 菜单 `openMenu`（L546）对 system 工具只给一个「打开/查看说明」，无操作菜单。
  - 无「是否显示到标题栏/顺序」配置 UI。
- **后端就绪广播**：
  - 主框架 `notifyAllFrames`（L757）广播到含 toolsFrame 在内的全部模块 frame；tools.js 收到 `refresh`/`backendState:ready` 调 `onBackendReadyRefresh()` 重载工具列表与运行中工具。
- **配置持久化**（`electron/main.js`）：`CONFIG_DIR/CONFIG_FILE`（L139-142）、`loadConfig/saveConfig`（L198-218），`dshBinPath/dshPort/dshAgentEnabled` 等已存于此。
- **生效入口**：`electron/main.js` / `electron/preload.js`（package.json `main` 指向 `electron/main.js`）；根目录 `main.js`/`preload.js` 为旧备份，不改。

## 变更方案

### A. 减小安装体积 + 取消自动安装（`package.json`、`electron/main.js`、`electron/preload.js`）

**文件**：`package.json`
- `build.extraResources`：**删除** `dist-dsh-offline → dsh-offline` 条目（L99-105）。
- `scripts.prebuild`：删除 `node scripts/build-dsh-offline.mjs` 调用，保留 `generate-icons` 与 `prebuild-clean`。
- 保留 `scripts/build-dsh-offline.mjs` 文件本身（研发急需时手动用），只是不再进默认打包。
- 其余 extraResources（jar/frontend/TODO/jre/ocr-models/integrations/dsh）保留。

**文件**：`electron/main.js`
- `resolveDshBin`（L894）：探测不到本地 dsh 时返回 `{ mode:'missing' }` 而非 `{ mode:'npx' }`；保留 npx 缓存扫描（用户手动 `npx @deepseek-ai/dsh web` 后即命中）。
- `startDshAgent`（L1006）：去掉自动 npx spawn 分支；当 `resolveDshBin` 返回 `missing`：
  - `broadcastDshProgress('need-install', '未检测到 DeepSeek Harness，请按说明自行安装后重试（命令：npx @deepseek-ai/dsh@0.1.0-rc.7 web）')`；
  - 返回 `{ success:false, needInstall:true, message:'...' }`。
  - 移除 `installing` 相关文案与 `npxMode ? 300000 : 90000` 超时分支，统一本地 bin 启动路径。
  - 保留：端口复用、patch 生成、本地 bin 启动、就绪轮询、`persistDshBinIfNpx`（npx 缓存命中固化）。
- 新增 IPC `dsh-agent:check-install`：查 `checkHttpPort(port)` → `{ installed, port, command, hint }`。

**文件**：`electron/preload.js`
- 新增 `checkDshInstall: () => ipcRenderer.invoke('dsh-agent:check-install')`。

### B. AI干活：工具卡片 + 前置检测激活（`frontend/js/tools-core.js`、`frontend/index.html`、`frontend/tools.html`）

**`frontend/js/tools-core.js`**
- 扩展 `MODULE_TOOLS`，把非核心模块全部收纳为子工具卡片（`module:true, system:true, category:'首页模块'`）：
  - `module-knowledge`（知识，`viewName:'knowledge'`）
  - `module-wiki`（Wiki，`viewName:'wiki'`）
  - `module-vault`（密码，`viewName:'vault'`）
  - `module-agent`（AI干活，`viewName:'agent'`，**带前置校验**）
  - 保留已有 `module-learning-plan`、`module-data-observability`
- `openModule(t)`：对 `viewName==='agent'` 走专用激活校验（见下）；其余一律 `navigateModuleTool` 跳主框架。
- 新增 `openModuleAgent()`：
  1. 查询 `api.checkDshInstall()`；
  2. 已就绪 → `navigateModuleTool('agent')`；
  3. 未就绪 → 弹出工具内说明浮层（含 npx 命令、「复制命令」「检测/重试」按钮），不跳转；点击「检测/重试」轮询端口，就绪后跳转。
- `openMenu`：对 `module` 工具卡片新增菜单项「⚙ 显示到顶栏」与排序（前移/后移），并保留「🚀 打开」。排序/显隐写入主进程 config（`navHeaderTools`），详见 C 节。

**`frontend/index.html`**
- 扩展 `navigateModuleTool` 白名单（L854-861）为：`learning-plan`/`data-observability`/`knowledge`/`wiki`/`vault`/`agent`。
  - 对 `agent`：`renderView('agent')` + `ensureDshAgentRuntime()`（现有 renderView 内已对 agent 触发 ensure）。
- `handleAgentProgress`（L1062）：新增 `case 'need-install':` → 状态灯 `off`「未检测到 DSH」，显示安装指引 + 重试，隐藏 loading/取消。
- `ensureDshAgentRuntime` 失败分支：当 `r.needInstall` 为真 → 走 `need-install` 态。
- 顶栏 nav 改为**动态渲染**（见 C 节）。

### C. 标题栏精简 + 工具配置「显示到菜单头/顺序」（`frontend/index.html`、`electron/main.js`、`frontend/js/tools-core.js`）

**`frontend/index.html`**
- 标题栏 `nav`（L568-626）缩减为固定四项：编辑/工作台/剪藏/工具/设置。（知识/Wiki/密码/AI干活按钮移除。）
- nav 改为**运行时动态生成**：
  - 维护一个全局可配置的「菜单头工具列表」`headerTools`（默认 = 固定五项排序）。
  - 提供函数 `applyHeaderNav(config)`：读取 config.json 里 `navHeaderTools`（数组，含各模块 viewName 及其顺序），把被启用固定到菜单头的子模块（如知识/Wiki/密码/AI干活/学习计划/观测）追加渲染到「工具」之前或之后。
  - 初次加载时调用一次；监听 config 变更/返回时刷新。
- `pathToView`、`viewMap`、`VIEW_IFRAME`、`renderView` 均无需大改（view 体系已支持这些模块的 viewPanel）。
- `notifyAllFrames` 已含这些 frame，无需改。

**`electron/main.js`**
- 配置结构扩展：`config.navHeaderTools`（数组，元素 `{ view, label, icon?, order }`）。沿用 `loadConfig/saveConfig`，无新表。
- 保持 `dshAgentEnabled` 等既有键不变。

**`frontend/js/tools-core.js`**
- 对 module 工具卡菜单新增「⚙ 显示到顶栏 / 隐藏」开关与「前移/后移」排序项（本里程碑**核心交付**，非可选）：写入主进程 config（`api.saveConfig` → `navHeaderTools`），并 `postMessage` 通知主框架 `applyHeaderNav` 刷新。
- 默认这些模块子工具**不进顶栏**（收纳态），用户手动固定才显示；固定后按配置顺序渲染到「工具」按钮之后。

> 说明：C 节「工具内配置显示到顶栏/排序 ↔ 顶栏动态渲染」为**核心交付**（用户明确要求）。实施顺序上可先做「顶栏固定五项（收纳）」最小版，再落地配置 UI；但两者都在本里程碑范围内。

### D. 后端就绪广播贯通工具模块（核对/补齐，`frontend/js/tools-core.js`）

- 现有 `notifyAllFrames` → tools.html `onBackendReadyRefresh` 已覆盖「工具列表刷新」「运行中工具重载」。
- 补齐：工具内正在运行的自包含小工具页面收到 `backendState:ready` 时刷新（`refreshOpenTool` 已实现）。
- 核对学习计划/数据观测/知识/Wiki/密码 等模块子工具**在跳到主框架后**，其顶层 view 的 frame 已联网（viewMap 已含），后端就绪时 `notifyAllFrames` 会到达——无需额外改动。仅回归确认即可。

### E. 文档与注释同步

- `docs/DSH体验测试指南.md`：更新「步骤 5」自动安装描述 → 自助安装（npx 命令）+ 检测解锁；更新故障排查表。
- `TODO/DSH（DeepSeek Harness）集成/02-设计文档.md`：更新 dsh CLI 解析优先级与「离线闭包不再默认内置」。
- `TODO/DSH（DeepSeek Harness）集成/04-验收清单.md`：fp-006 加注「不再默认内置」。
- 若涉及导航变更，在 `TODO/工作台与数据层.../01-*.md` 或新增归档记录说明顶栏精简与工具收纳。

## 假设与决策

1. **npx 免安装**：用户 `npx @deepseek-ai/dsh@0.1.0-rc.7 web` 后 dsh 落 npx 缓存，现有 `resolveDshBin` 缓存扫描即命中，无需新路径逻辑。
2. **完全取消自动安装**：杜绝「安装卡很久」再次发生；未装只给指引+检测/重试。
3. **解锁粒度**：以 3081 端口可访问为 dsh 就绪判据（复用 `checkHttpPort`）；就绪即允许装载 AI干活 iframe。
4. **模块收纳**：知识/Wiki/密码/AI干活 + 学习计划/观测，全部作为 `module:true, system:true` 子工具卡片；`openModule` 用 `navigateModuleTool` 跳主框架视图，保持 iframe 父子通信完整（规避嵌套 iframe 拦截问题）。
5. **顶栏固定五项**：编辑/工作台/剪藏/工具/设置；其余凭 config 可选固定到顶栏（默认收纳）。
6. **生效入口**：只改 `electron/` 下主进程/预加载；根目录 `main.js`/`preload.js` 为旧备份不改。
7. **config 复用**：菜单头配置存 config.json，不新增后端表。

## 验证步骤

1. **语法/测试**：
   - `node --check electron/main.js`、`node --check electron/preload.js`、`node --check frontend/js/tools-core.js`、`node --check frontend/js/settings.js`。
2. **本地启动回归（开发态，`npm start`）**：
   - 顶栏显示 5 项（编辑/工作台/剪藏/工具/设置），无知识/Wiki/密码/AI干活独立按钮。
   - 工具中心卡片：知识/Wiki/密码/AI干活/学习计划/数据观测均可点开并跳转到对应顶层视图。
   - AI干活：本机 3081 已有 dsh → 卡片点击直接装载面板；未装（改端口/清缓存模拟）→ 显示安装说明 + npx 命令 + 重试，无自动下载进程。
   - 「设置→显示到顶栏」：勾选某模块后顶栏出现该入口且按配置顺序排列，取消后消失。
3. **后端就绪广播**：启动后端后，工具列表自动刷新、运行中的工具页面重载；各模块子工具顶层视图正常联网。
4. **打包体积验证（关键）**：
   - `npm run build:win`，确认 `dist-electron/win-unpacked/resources/` 不再含 `dsh-offline/`；安装包较 277 MB 显著减小（预计 ≈97 MB，去 192 MB 的闭包里大部分冗余与 jre 三份中的非本平台部分）。
   - 用新安装包装一次：安装明显更快、应用正常启动、手动装好 dsh 后 AI干活解锁。
5. **回滚检查**：确认 `resolveDshBin` 对本地已有 npx 缓存实例兼容，不误判 missing。

## 范围与例外

- 不做：DSH 客户端插件（fp-011）、TODO 目录扫描（fp-010）等无关项。
- 不删除 `scripts/build-dsh-offline.mjs`（保留手动能力），仅移出默认打包。
- 不自动 git 提交；如需提交按项目规范追加 `commit_history.log`。

## 实施顺序建议

1. **A（体积 + 取消自动安装）** → 立竿见影解决安装慢；回归启动。
2. **B（AI干活前置检测激活）** → 配合 A，未装即提示+激活。
3. **D（后端就绪广播核对补齐）** → 与 B 并行，保证工具模块功能刷新正常。
4. **C（顶栏精简 + 工具配置显隐/顺序）** → 导航重构，最后落地并全量回归。
5. **E（文档）** → 收尾同步。