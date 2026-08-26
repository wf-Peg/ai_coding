# DSH 插件市场集成方案（远见性修订版）

## Summary

从 dsh-market（`https://github.com/dsh-market/dsh-market`）的插件市场切入，为 Clip 应用设计 DSH 插件安装流程与集成方案。本版基于官方资料远见性修订，核心变化：

1. **回归官方 profile 语义**：统一 `DSH_HOME=~/.dsh`（官方默认数据根，`profiles/web` 在其下），使应用拉起（3081）与手动启动（3080）的 `web` profile 物理同根——插件、技能、市场完全共享。这不是"撤回权限顾虑"，而是修正此前自造 `{storagePath}/.dsh` profile 根的偏差。
2. **单实例复用优先**：共享 profile 后同 profile 双开会并发写 `cordis.patch.yml` / pnpm 锁（dsh-market 官方明确警告的场景）。改为检测任一实例在跑即复用打开，不双开。
3. **自研集成 profile 化**：MCP 桥与 clip-capture 插件拷贝到 `~/.dsh/plugins/cutshelter/` 稳定路径并写进 profile patch，手动 3080 实例同样具备剪藏工具，两个入口完全等价；同时为"后续扩展更多插件"提供通用 `plugin-ensure` 底座。
4. **预装 dshmarket 只做激活**：不硬编码市场内部路由/API（第三方高频迭代 v1.28.1），入口打开 DSH 根页，市场 UI 发现交给 DSH 自身 Settings → Plugin Market。

## Current State Analysis

### 现有 DSH 集成基线

| 维度 | 应用管理实例 | 用户手动 `dsh web` |
| --- | --- | --- |
| 端口 | 3081（`config.dshPort`） | 3080（DSH 默认） |
| DSH_HOME | `{storagePath}/.dsh`（`resolveDshHome`） | `~/.dsh`（默认） |
| 注入方式 | `dsh web --patch <运行时生成>` | 无 patch |
| profile | 自造根下的 `web` | 官方根下的 `web` |

关键代码：
- `resolveDshHome(config)`：`electron/main.js#L875-L879`，当前优先 `process.env.DSH_HOME` → `{storagePath}/.dsh` → `APP_DIR/.dsh`。
- `startDshAgent(config)`：`electron/main.js#L1160-L1318`。`#L1165-L1170` 仅检测 3081 端口复用；`#L1215-L1228` spawn 时设 `DSH_HOME: dshHome`。
- `buildDshAgentPatch(patchDir)`：`electron/main.js#L894-L926`，`--patch` 覆盖层注入 `mcp-cut-shelter`（stdio 桥）+ `clip-capture` 插件（file URL）。
- IPC：`electron/main.js#L2306-L2409`（status/check-install/ensure/stop/cancel/install-skill/skill-status）；`preload.js#L490-L537`。
- 前端：`frontend/settings.html#L872` `#dshAgentSection`；`frontend/js/settings.js#L1667-L1826` `initDshAgentSection()`。

### 官方语义关键事实（本版依据）

1. **`DSH_HOME` 是官方环境变量**：指向数据根，per-profile 子目录 `$DSH_HOME/profiles/<name>`（含 workspace + node_modules）。默认 `~/.dsh`。`dsh web` ≡ `--profile web`。
2. **插件安装通道**：`dsh plugin --profile web add <spec>` 安装进 profile 的 `dsh.profile.bundles` + `node_modules`（底层转发 pnpm）。market 安装走同一通道。
3. **patch 层叠顺序**（低→高）：bundle patches（按 `bundles` 顺序）→ profile 的 `cordis.patch.yml` → home 级 `~/.dsh/cordis.patch.yml` → `--patch` 命令行覆盖层。
4. **dsh-market 定位**：DSH 内的市场应用（不是目录服务），数据源 `awesome-dsh-plugin.com/plugins.json`，装法 `dsh plugin --profile web add dshmarket`，需 dsh web ≥ 0.1.0-rc.6；自身也在高频迭代（v1.28.1）。
5. **同 profile 双开风险**：两实例共享 `~/.dsh/profiles/web` 的 package.json / node_modules / cordis.patch.yml，市场安装会触发文件写入与 HMR 竞争。

### 上一版方案遗留问题（本版修正）

- 上一版把共享归因为"撤回权限设计"，实际是"自造 profile 根 vs 官方根"的分裂问题。
- 上一版未处理共享后 `--patch` 独有集成在手动实例缺失的问题。
- 上一版未处理同 profile 双开的并发风险。
- 上一版预装路径悬而未决（patch insert 是否支持 npm 包名/外部包，未定论）。

## Proposed Changes

### 1. `resolveDshHome` 回归官方默认根 `~/.dsh`

**文件**：`electron/main.js#L875-L879`

- 改为：`process.env.DSH_HOME` 存在则用之；否则 `path.join(os.homedir(), '.dsh')`（不再用 `storagePath`）。
- 注释更新为官方语义解释：`~/.dsh` 是 DSH 官方数据根，`profiles/web` 在其下，应用与手动启动共享同一 profile。
- 效果：`install-skill` / `skill-status`（已共用该函数）与运行实例自动同根；cut-shelter 技能包落位 `~/.dsh/skills/cut-shelter` 不变。

### 2. 单实例复用优先（跨端口检测）

**文件**：`electron/main.js` `startDshAgent#L1160-L1170`

- 复用检测从"仅 3081"扩展为**先 3080 后 3081**（或按 `config.dshPort` 排序，两个都查）：
  - 任一端口已有 DSH 实例 → `dshAgentOwned=false`，返回 `{ success:true, reused:true, port }`。
  - 都未运行 → 才 spawn 3081（`config.dshPort`）。
- 前台提示文案同步：复用 3080 时明确告知"已复用 DSH 实例（端口 3080）"。
- 端口探测用现有 `checkHttpPort`；跨端口探测需确认对方确为 DSH（可选增强：`GET /` 响应特征），实现时按现有 `checkHttpPort` 能力决定是否加特征校验（不强求）。

### 3. 自研集成 profile 化（稳定路径 + profile patch）

**文件**：`electron/main.js` 新增 `ensureCutshelterPlugins(config)` 及 IPC。

- 新稳定目录：`~/.dsh/plugins/cutshelter/`，结构：
  - `mcp-server/`（拷贝自 `integrations/dsh/mcp-server`）
  - `clip-capture/`（拷贝自 `integrations/dsh/plugins/clip-capture`，含 node_modules）
- **幂等 copy 策略**：按版本/内容校验（如比对源目录 `package.json` 版本或文件清单 hash，写入 `.cutshelter-version` 标记），源变化才重拷，避免每次启动全量复制。
- 写入 profile patch：`~/.dsh/profiles/web/cordis.patch.yml`（不存在则创建），追加/维护两条 insert 行（`mcp-cut-shelter` stdio 桥 + `clip-capture` file URL），路径指向稳定目录。**保留 merge 逻辑**（文件已有内容不动，只 upsert 自己管理的两行 id）。
- `startDshAgent` 启动前调用该函数；此后 spawn 的 `--patch` 只保留动态项（webserver 端口等运行时变量），不再注入双插件——避免与 profile patch 重复注册。
- **兼容考虑**（此次不清理）：旧方式已写入的 `--patch` 逻辑保留为降级路径（profile 化失败时仍可用 `--patch` 注入，仅记录日志）。

### 4. 预装 dshmarket（激活即止，不锁 UI）

**文件**：`electron/main.js` 新增 `ensureDshMarket(config, bin)`；就绪后调用。

- 检测：`dsh --profile web plugin list`（或读 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`）是否含 `dshmarket`。
- 未装则执行：`dsh plugin --profile web add dshmarket`（复用 `DSH_HOME=~/.dsh` env；spawn 用现有 `resolveDshBin` 解析出的入口），超时与失败仅记日志、广播 warning，**不阻断 DSH 启动**。
- 幂等：已含则跳过。
- 新增 IPC `dsh-agent:market-status` → `{ installed, port }`；`preload.js` 暴露 `dshMarketStatus()`。

### 5. 应用内「插件市场」入口

**文件**：`frontend/settings.html#L872` 区块、`frontend/js/settings.js`（`initDshAgentSection`）

- DSH 区块新增「插件市场」按钮 + 状态行（显示 market 是否已预装）。
- 点击：读取当前 DSH 端口（复用状态里的 `port`），`window.open('http://127.0.0.1:' + port)` 打开**根页**——不硬编码市场内部路由，用户自行进入 Settings → Plugin Market（避免对第三方插件 UI 路由的脆耦合）。
- 文案引导："打开 DSH → Settings → Plugin Market 浏览安装社区插件；安装后 3080 与 3081 实例共享（同一 profile）"。

### 6. 通用插件确保底座（为后续扩展铺路）

**文件**：`electron/main.js` 新增 `ensureDshPlugin(spec, opts)` 内部函数

- 签名：`ensureDshPlugin(spec /* npm 包名或 file 路径 */, { profile:'web', dshHome })` → `{ installed, spec, source }`。
- `ensureDshMarket`、`ensureCutshelterPlugins` 均基于它实现（market 走 npm spec；自研插件走稳定路径 + patch upsert）。
- 未来扩展新插件 = 一行调用，不再写新逻辑。同时更新文档约定：外部插件统一经 Profile Plugin Market 管理，自研集成统一走 `ensureDshPlugin` + 稳定路径拷贝。

### 7. 文档更新

- 更新 `integrations/dsh/README.md`（若存在）或项目文档：说明官方 profile 语义、`~/.dsh` 共享结构（skills/plugins/profiles）、单实例复用策略、插件扩展约定。
- 明确"从市场安装的插件自动同步 3080/3081"的机制说明（同 DSH_HOME 同 profile，与端口无关）。

## Assumptions & Decisions

- **决策（用户已确认）**：
  1. 端口/实例策略 = 单实例复用优先。
  2. 自研剪藏集成 = profile 化，手动实例同样具备剪藏工具。
  3. （继承前轮）DSH_HOME 统一 `~/.dsh`；应用内入口 + 自动预装 dshmarket。
- **假设**：
  - `dsh plugin --profile web add dshmarket` 在目标环境可用（node/dsh + pnpm 可执行；若 pnpm 缺失市场本身会提示一键配置，不阻断）。
  - `process.env.DSH_HOME` 作为官方变量被 dsh CLI 正确读取（已通过官方讨论确认）。
  - dsh web ≥ `0.1.0-rc.7`（devDeps 锁定），满足市场 ≥ rc.6 的要求。
  - profile patch 的 upsert 以 id 为键幂等合并，不动用户手写内容。

## Verification

1. **语法**：`node --check electron/main.js`、`frontend/js/settings.js`；`node -e JSON.parse` 校验 package.json。
2. **共享验证**：应用启动 3081 后 `dsh --profile web --dump-config` 与手动 `dsh web`（3080）输出同一 profile 的插件清单（含剪藏工具、dshmarket）。
3. **单实例复用**：手动起 3080 → 应用点启动 → 返回 reused=true 且不再 spawn 3081。
4. **自研集成等价**：手动 3080 实例的 Agent 能调用剪藏 MCP 工具（clip_*）；`clip-capture` 插件注册成功。
5. **预装幂等**：`dsh-agent:market-status` installed=true；重复启动不重复安装；打开 DSH 根页能进入 Settings → Plugin Market。
6. **市场安装同步**：在 3080 的市场中安装一个测试插件，应用拉起的（复用后同一实例）立即可见——验证"同 profile 同步"。
7. **健壮**：market 预装失败不阻断 DSH 启动，广播 warning 可恢复。