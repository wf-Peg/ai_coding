# DSH 版本对齐与宿主机升级机制方案（收敛版）

## 背景（为什么要对齐）

用户问题聚焦三点：

1. **有没有升级机制**（DSH 的升级到底走什么通道）。
2. **如果宿主机升级了 DSH，剪藏应用会不会"不能用"**（升级是否破坏兼容）。
3. **每台机器的 DSH 版本不一样，如何与剪藏应用对齐**。

本方案结论先行：

- **宿主机安装的 DSH 是版本权威**（host-first）。剪藏应用不强制把宿主机 DSH 拉回自己的固定版本，而是"识别→跟随→对齐"。
- 剪藏应用通过 **DSH 主动探测 + 广播** 识别宿主机当前版本，展示在设置页。
- 应用**不自动升级 DSH**。升级是"用户显式触发的动作"：应用提供可一键复制的升级命令，用户自己执行；升级后应用在下一次探测时自动对齐新的版本号。
- 版本差异**只做软提示，不做硬拦截**：检测到宿主版本与内置支持版本不一致时给信息性横幅，不阻止启动、不自动安装。真实兼容性由宿主自身的 profile 幂等重建兜底。

## 当前代码的真实行为（版本为什么漂移）

现状里的关键事实（已核对 `electron/main.js`）：

- `DSH_VERSION = '0.1.0-rc.7'`（`#L153`）只是一个"兜底常量"，**并不是生效锚点**。
- `getDshInstallCommand()`（`#L986-L1019`）的解析顺序是：
  `env DSH_NPX_SPEC → 配置 TTL 缓存 → npm registry latest → GitHub README → 固定版本兜底`。
  → 只用于 `mode:'missing'` 时的安装提示文案（`#L1197`）；用户点"检测/重试"（`force=true`）拉的是 **npm 上的最新 rc**，并写进配置缓存。
- `resolveDshBin()`（`#L1060-L1086`）会按 `配置 dshBinPath → env DSH_BIN → 内置 node_modules → npx 缓存` 找到**某个** dsh 入口，但没有校验它到底是什么版本。
- `persistDshBinIfNpx()`（`#L1132-L1153`）把第一次命中的 npx 缓存路径固化到 `config.dshBinPath`，**一步到位锁死**——之后机器上 DSH 怎么升，应用都只认这个旧路径。这是本方案要修的唯一真 bug。
- 打包安装包**没有内置 DSH**：`integrations/dsh` 只有应用自己的 mcp-server/plugins/skills，没有框架本体；`package.json` 里 `@deepseek-ai/dsh` 在 `devDependencies`，而 `build.files` 只打 `electron/**`。

结论：当前版本的三个问题——**路径被持久化锁死**（升级后还跑旧版本）、**npx 缓存不选最新**（多版本残留时取到哪个算哪个）、**版本完全不可见**（设置页无任何版本信息）——正是担心"升级了会不会不能用 / 每台机子越装越散"的根源。

## 设计原则

1. **以宿主机为准**：哪个 dsh 能被解析到、版本号是多少，就以它为准。应用不"纠正"宿主机版本。
2. **识别优先**：能稳定读出版本号，是"对齐"的地基。读取用纯 fs（读 package.json），不 spawn 子进程。
3. **升级由用户驱动**：应用只给命令、给检测，不偷偷升级。
4. **差异可观测、软提示**：检测到的版本变化只留痕（日志 + 内存态），与内置版本不一致时给横幅提示，不做数值 gate、不做回退栈。

## 核心探测链路（识别宿主机版本）

### `detectDshVersion(bin)`（宿主版本唯一事实来源）

入参：`resolveDshBin()` 解析出的 `{mode, node, script}`（node / npx 两种）。

```
detectDshVersion(bin):
  // 纯 fs 读取，零 spawn：
  // bin.js 路径形如 …/node_modules/@deepseek-ai/dsh/lib/bin.js，
  // 向上一级取包根 package.json 的 version。
  返回 { version, source }   // 读不到 → {version:null, source:null}
```

- 现状没有任何版本读取逻辑：`resolveDshBin()` 只返回入口路径，`startDshAgent()` 的就绪轮询只探测端口（`#L1293` `checkHttpPort`），从不读版本号。本次把版本探测**升级为必选**：读不到就直接标 `version:null`，不走静默成功。
- 不复用 `--version` spawn 探测：入口恒为 bin.js，且 spawn 探测慢、有超时/权限坑，与「轻量优先」冲突。

### `resolveDshBin()` 补两点（修锁死 + 选最新）

- **`config.dshBinPath` 失效即穿透**（`#L1062-L1063` 候选处）：取到该值时先做 `fs.existsSync`，不存在/无效则**跳过该候选继续往下找**，不再被旧缓存路径卡死。
- **npx 缓存选最高版本**（`#L1073-L1084` 扫描处）：扫到多个 `@deepseek-ai/dsh/package.json` 时，按 version 排序取最高者，不再"取到哪个算哪个"。
- （可选）补充 `~/.dsh` / `%USERPROFILE%\.dsh\dsh-cli` 宿主常见安装位置扫描，作为 npx 缓存之外的候选。

### 复用路径的版本读取（运行实例为准）

当 `startDshAgent()` 走**复用分支**（`#L1172`，3080/3081 已有实例在响应）时，磁盘 bin 的版本 ≠ 运行实例版本。此时：

- 尝试从运行实例 HTTP 取版本（如 `GET /version`，超时 1.5s），拿到即用，`source:'runtime'`；
- 拿不到 → 标"运行中（版本未知）"，`version:null`。属 best-effort，不影响复用。

### 落地到现状

- `startDshAgent()`（`#L1162`）拿到 `bin` 后调用 `detectDshVersion(bin)`，把 `{version, source}` 写入内存态，并随 `ready`/复用广播一并下发（`phase:'running'` 旁加 `dshVersion` 字段）。
- 删掉 `persistDshBinIfNpx()`（`#L1132-L1153`）整个函数——它把 npx 缓存路径固化到 `config.dshBinPath` 是升级后仍跑旧版本的元凶。`config.dshBinPath` 仅保留**用户显式设置**语义，不再有代码写入。
- 当前启动路径是直接 `spawn(node, [bin.script, 'web', '--port', n])`（`#L1213` 起，`#L1209` `npxMode=false` 已不直起 npx），启动流程本身不变；变化只在"解析时选最新 + 解析后读版本"。
- `mode:'missing'` 分支维持现状：走 need-install 提示（`#L1196-L1205`），给出安装命令文案，不弹装。

## 宿主版本为主（不强制锁定）

- 只要 `resolveDshBin` 能解析出任何 dsh 入口，**就使用它**，不强制安装应用内置的 `DSH_VERSION`。
- `DSH_VERSION`（`#L153`）含义调整为"**应用内置集成所支持的版本**"（即 `integrations/dsh` 插件/技能打包时对标的 dsh 版本），仅作为设置页横幅的**参考展示值**，不作为启动 gate、不作为比较门槛。

## 对外升级命令（用户显式执行）

不自动升级，应用只"给命令 + 给检测"。设置页新增「DSH 升级助手」区：

- **当前版本**：实时显示探测结果（版本号 + 来源：内置/npx/用户指定/runtime），`version:null` 显示"未检测到/运行中（版本未知）"。
- **一键复制升级命令**（按探测来源给不同命令）：
  - npx/缓存来源：`npx -y @deepseek-ai/dsh@latest --version`（验证后再装上）
  - 用户指定来源：提示"该路径由你配置，移除配置或换装新版后重开启动"
  - 未安装：`npm i -g @deepseek-ai/dsh`（全局装，最容易被 `resolveDshBin` 扫到）
- **点击「检测升级」**：执行 `npx -y @deepseek-ai/dsh@latest --version`，拿到 npm 最新版本号，与当前版本对比，展示"可用更新 x.y → y.z"。**不自动执行升级**，用户确认后在终端自己跑。

### 升级动作触发通道

统一走 `electron/main.js#L2526` 起的一套现有 IPC（status/check-install/ensure/stop/cancel/install-skill/skill-status），新增两个：

- `dsh-agent:detect-version` → 实时 `{ version, source }`（设置页每次打开/手动刷新时调用）。
- `dsh-agent:latest-version` → `{ latest }`（"检测升级"按钮调用，只查 npm latest，不下装不执行）。

`preload.js#L490` 暴露 `detectDshVersionState()` / `checkDshLatest()`。

## 剪藏对齐到升级后的版本

"对齐" = 剪藏应用**在下一次探测时，承认升级后的宿主机 DSH 为新版本**。

- **不新增配置项**。探测结果只存内存态（`dshVersionState`），每次 `startDshAgent()` 重新探测刷新；版本变化仅写日志留痕（`上次版本 → 本次版本`）。
- `startDshAgent()` 拿到 `detectedVersion` 后与内置 `DSH_VERSION` 对比：
  - **一致** → 无提示。
  - **不一致** → 广播/展示信息性横幅"宿主 DSH vY ≠ 应用内置支持版本 vX，通常可正常使用；如遇插件/技能异常请升级 DSH 或联系维护"。**不阻止启动、不自动安装、不做数值大小判断**（rc 版本排序本身不可靠，且新版本不兼容或旧版本兼容都可能发生，数值比较没有真实意义）。
- **核心保证**：宿主 DSH 升级后不需要重装应用，剪藏应用会在下次启动 / 打开面板 / 点"检测"时**自动对齐到新版本**。这就是"升级了 dsh 也能继续用"。

## 兼容性风险与兜底（升级后会不会不能用）

问题 #2 的正解。真实兼容面是应用自带的 `integrations/dsh`（plugins/skills/mcp-server 对标的 dsh-tools），而非 CLI 版本号，因此兜底不依赖版本比较：

1. **不锁死到路径**：删除 `persistDshBinIfNpx`，`config.dshBinPath` 失效即穿透，升级后必解析到新入口。
2. **profile 幂等重建**：DSH 自身/pnpm 负责 profile 依赖重建（幂等）；应用复用运行中实例时重放 `ensureCutshelterPlugins`（`#L1180` 已有），升级后集成自动补全。
3. **无 DSH 时提示清楚**：`mode:'missing'` 走 need-install 分支，给安装/配置路径说明。
4. **不自动升级**：升级是用户动作，应用只做识别 + 展示 + 软提示，不做迁移改造。

## 验证

- **语法**：`node --check electron/main.js`、`node --check electron/preload.js`、`node --check frontend/js/settings.js`。
- **识别**：存在宿主 dsh（含 npx 缓存）时，设置页「当前版本」显示真实版本号与来源；无 dsh 时显示"未检测到"；复用运行中实例且拿不到版本时显示"运行中（版本未知）"。
- **升级对齐**：手动把宿主 DSH 升到新版本（产生新旧两个 npx 缓存）→ 应用下次启动解析到**新版**入口（缓存选最高版本）→ 设置页显示新版本，日志留痕"已对齐到宿主 DSH vY"。
- **失效穿透**：`config.dshBinPath` 指向的旧缓存被 npx 清理后，应用能穿透到其他候选（内置/npx 缓存），不再报"找不到 dsh"误判。
- **删除锁死**：启动成功后 `config.json` 中 `dshBinPath` 不再被代码改写。
- **软提示**：宿主版本 ≠ `DSH_VERSION` 时仅横幅提示，应用照常启动、照常复用。
- **不自动升级**：无 dsh 时不弹装，只有用户点复制命令才走到安装。

## 不做的（保持简单）

- 不做"自动跟随 npm latest"：升级是用户动作，应用只识别 + 给命令 + 对齐。
- 不做"强制覆盖宿主到应用固定版本"：宿主为权威。
- 不做 profile 依赖迁移：宿主版本差异由宿主自身/pnpm 处理，应用只做识别声明。
- 不做版本数值 gate 与回退栈：数值比较无真实意义，回退在 host-first 下无实际效果（应用不持有任何 DSH 副本）。版本状态只存内存 + 日志，不进配置。