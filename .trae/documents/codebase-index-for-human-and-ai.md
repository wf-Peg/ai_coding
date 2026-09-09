# 项目代码索引层方案（人 + AI 双通道）— 选型调研与实施计划

## 需求回顾
为 `ai_coding`（CutShelter）这个仓库搭建一层「人和 AI 都能用」的索引：
- **人**能看懂：浏览、定位文件与模块、理解结构。
- **AI**能据此排查代码问题与路径，且在 AI 编写/修改开发时**减少 token 消耗**（避免盲目 grep / 全文件读取）。
- 落地范围：**仅作为本项目 AI 开发辅助**（不改产品功能、不集成进 CutShelter 产品）。
- 形态：静态可读地图 + MCP 服务器**组合**。

## 一、调研结论（可选方案横向对比）

按技术路线分为三类：

| 类别 | 代表项目 | 特点 | 对本项目的适配 |
|---|---|---|---|
| **静态可读地图**（提交 git，人/AI 只读一次） | Aider repo-map（tree-sitter+PageRank，~1k token）、rtt/reducethemtokens（骨架缩减 ~90%）、codeindex 的 README_AI.md、CodeMap | 产物小、零常驻服务、可提交、人可直接看 | ✅ 最贴合「人能看懂」 |
| **MCP 精准查询服务器**（AI 按需深查） | **CodeGraph**（colbymchenry/codegraph，29k★，tree-sitter+SQLite+增量+自带 Node 运行时，40+ 语言，跨平台）、mcp-ctags（ctags+ripgrep，最轻量）、Serena（LSP 级）、CodeRLM | 精确回答「定义在哪/谁调用/引用」并给出行区间，避免整文件读取、token 最低 | ✅ 最贴合「AI 排查 + 减 token」 |
| **语义知识图谱**（较重） | Graphify（85k★，tree-sitter+知识图谱，36 语言）、Codebase-Memory、Axon | 支持语义/跨模块调用图，但需常驻服务、较厚重 | ⚠️ 对本仓库偏重，暂不入 |

> 出处（调研来源）：Aider repo-map 官方文档（tree-sitter 替代 ctags、PageRank+token 预算）；Aider 官网 ctags 文档；rtt/reducethemtokens README（骨架 ~90% 压缩）；CodeGraph 深度解析（tree-sitter+SQLite+MCP、增量更新）；mcp-ctags README；Stacklit 维护者做的「full codebase context tools」对比表；AgentPatterns repository-map-pattern（parse→rank→fit 三段）；codeindex README_zh（README_AI 导航索引、`--no-ai` 纯结构化、增量/基准 ~-28% token）。

## 二、推荐方案（两件套，均服务于本项目 AI 开发）

```
                          ┌────────────────────────────┐
  人阅读 / AI 方向定位  →  │  静态地图 CODE_INDEX.md      │  ← 提交 git，~1-2k token
        （会话开头读一次）  │  (tree-sitter 结构骨架)      │
                          └────────────────────────────┘
                                       ↑
                          ┌────────────────────────────┐
  AI 排查问题 / 减 token →  │  MCP 服务器 CodeGraph        │  ← SQLite 索引，按需精确查询
        （按需精准查询）    │  find_symbol/引用/caller      │     定义/引用/调用方
                          └────────────────────────────┘
            生成物：CODE_INDEX.md（提交）+ __codeindex__/（gitignore，可重建）
```

- **Layer A（人可读 + AI 方向定位）**：生成一份紧凑、可提交的 `CODE_INDEX.md`（tree-sitter 提取符号/签名缩略），人直接浏览，AI 会话开始时读一次获取项目地图。零常驻服务。
- **Layer B（AI 精准排查 + 省 token）**：本地跑一个 **CodeGraph** MCP 服务器，对仓库建 SQLite 索引，AI 通过 `structure / find symbol / find references` 精确拿「定义、行号、调用方」，无需整文件扫描。
- 两件套共享同一套 tree-sitter 解析产物，避免重复解析。

### 为什么选 CodeGraph（Layer B 主选）
- 覆盖本项目全部一手语言：前端/Electron 的 **JS/TS** 与后端的 **Java**（tree-sitter 40+ 语言）。
- **自动同步（默认开启）**：fs.watch 监听文件变更即增量更新，无需 git hook、无需 rerun，索引始终不陈旧。
- 自带运行时、**Windows/macOS/Linux 三平台**（本机为 Windows）。
- SQLite 落盘，索引稳定可复用；对 agent 暴露单入口 `codegraph_explore`，一次调用返回「源码 + 调用路径」，token 消耗最低。
- 备选：若嫌重，可用极轻量的 `mcp-ctags`（universal-ctags + ripgrep），但符号为扁平列表、跨文件引用弱，故不作为主选。

## 三、实施步骤

### Step 1 — 确认环境依赖（一次性）
- 需要 Node ≥18（本机已满足，electron 要求 ≥22）。
- 需要网络可安装 `@colbymchenry/codegraph`（或按其文档的一键安装命令）。
- 检查确认后，进入 Step 2。

### Step 2 — Layer B：安装并初始化 CodeGraph MCP 服务器
1. 全局安装 CLI（免编译、自带运行时，Windows 任一可用）：
   `npm i -g @colbymchenry/codegraph` （或 `irm .../install.ps1 | iex`）。
2. **接线 agent**：`codegraph install`（自动配 Claude Code/Cursor/Codex 等）。
   - TraeCode 官方未列：需**手动**在 TraeCode 的 MCP 连接器加 `codegraph`（stdio），或复用 [DSH MCP bridge](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/integrations/dsh/mcp-server) 注册机制。
3. **建索引**：仓库根目录 `codegraph init` → 生成 `.codegraph/` 并全量建图。
4. **自动同步（默认开启）**：CodeGraph fs.watch 监听，文件每次变更即增量更新，无 git hook、无需 rerun。
5. **排除规则**：把 `node_modules/`、`dist/`、`jit/`、`integrations/**/node_modules`、`.git/` 加入索引忽略（本仓库 integrations 依赖极大，必须排除，否则 watcher 拖慢且索引膨胀）。
6. **遥测**：若需严格本地，配置中关闭 telemetry。
7. **git**：`.gitignore` 增加 `.codegraph/`（SQLite 可 `codegraph uninit` 重建，CLI 是全局安装不入库）。
8. 在 `package.json` scripts 增加：`"codeindex:init": "codegraph init"`、`"codeindex:ui": "codegraph ui"`（给人看的浏览器视图 127.0.0.1:4747）。

### Step 3 — Layer A：生成静态地图并提交 git
1. 用 tree-sitter 结构解析（复用或并行跑 CodeMap/rtt 这类 CLI）生成紧凑的 `CODE_INDEX.md`：
   - 按模块（electron / frontend / backend/src / scripts / integrations）分节；
   - 每个文件列出：路径、类/函数/方法签名、关键行号区间；
   - 控制在 ~1-2k token 量级，精简到「地图 + 签名」，不夹实现体。
2. 将 `CODE_INDEX.md` **提交到 git**（供人和 AI 引用），并在顶层 `README.md` 或 `agent.md` 增加一行说明指向该文件。
3. 若采用自动生成工具（如 rtt），同步其生成的 `.claudeignore`/忽略规则与增量命令说明；`CODE_INDEX.md` 视为生成物，重跑脚本覆盖。

### Step 4 — 联调 + 交付
- 手动跑一次索引与 `CODE_INDEX.md` 生成，验证输出。
- 验证静态地图可在浏览器/编辑器中正常阅读。
- 验证 MCP 查询（`codegraph_explore`）返回正确路径与行号：文件读取归零、1–4 次调用即定位。
- 验证**自动同步**：改一行代码保存后，`codegraph ui` 里图随即更新（无需 rerun）。
- **确认排除规则生效**：watcher 未监听 node_modules，索引体积合理。
- 把使用方式（如何刷新索引、如何注册给 agent、生成物如何维护、telemetry 开关）写入项目说明。

## 四、你问的四个关键点（已对照 CodeGraph 官方 README 核实）

> 以下基于 CodeGraph 2026-08 官方 README / CHANGELOG 核实，非推测。

### 1. 是本地直接接入吗？
**是，100% 本地（local）**。
- 安装：`npm i -g @colbymchenry/codegraph`，或 Windows 一键 `irm .../install.ps1 | iex`；自带运行时、免编译。
- `codegraph install` 会把 **MCP 服务器**自动接入支持的 agent：Claude Code、Cursor、Codex CLI、opencode、Hermes Agent、Gemini CLI、Antigravity、Kiro、GitHub Copilot。
- ⚠️ **对本项目 EvovNote/TraeCode 的接入**：官方列表**未列出 TraeCode**。若用 TraeCode 消费，需手动在 TraeCode 的 MCP 连接器配置里加 `codegraph` stdio server；或复用现有 [DSH MCP bridge](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/integrations/dsh/mcp-server) 的注册机制。计划里会带上这条「手动接线」步骤。
- `codegraph ui` 本地起一个浏览器视图（`http://127.0.0.1:4747`），供人查阅调用方/被调用方。

### 2. 内部实现逻辑？
- 核心引擎是 **Rust 内核（codegraph-kernel）**，用 **tree-sitter** 做确定性 AST 解析（无需 LLM、零 API 成本）。
- 提取每个符号 + 跨文件 call/import/inheritance 边，落到本地 `.codegraph/`（SQLite/知识图谱）。
- 对 agent 暴露的默认工具面收敛为 **`codegraph_explore`** 这一个入口（官方近期把默认面 cut 到 explore + 减少读文件），一次调用返回「相关源码 + 符号间调用路径（含 grep 抓不住的动态跳转）」。对照：无 CodeGraph 时 agent 靠 grep/glob/Read 逐文件重建结构，7 个基准仓库里最多要 **43 次工具调用 / 19 次文件读**；有 CodeGraph 只要 1–4 次 explore、**文件读取归零**。
- 基准（Claude Opus 4.8，2026-08）：**工具调用 -88%、耗时 -53%、token -62%、成本 -44%**（OkHttp Java、VS Code TS、Excalidraw 等 7 库覆盖 Java/TS/Python/Rust/Go/Swift）。

### 3. 代码更新会自动重建索引吗？
**会自动，且无需 re-run。**
- 「Auto-sync 默认开启：CodeGraph **监听项目文件变更，每次改动即增量更新图谱**」（官方原话：`CodeGraph watches the project and updates the graph on every file change — the index is never stale.`）。
- 走 **fs.watch 增量**而非每次全量重建 → 这部分是持续的轻量开销。
- 你要做的：给索引配置**排除规则**，把 `node_modules/`、`dist/`、`jit/`、`integrations/**/node_modules`、`.git/` 排除掉，否则 watcher/索引会扫到海量依赖文件（本仓库 `integrations` 下 node_modules 极大，必须排除）。

### 4. 是否有额外开销？有一条必须提前知道的坑
- **一次性**：首次 `codegraph init` 全量建图（本仓库 ~100k 行一手源码，秒级到分钟级，纯本地 CPU，无 LLM 成本）。
- **持续**：fs.watch 监听 + 增量解析（低频、可忽略；排除 node_modules 后更轻）。
- **磁盘**：`.codegraph/` 一个 SQLite 库，需加入 `.gitignore`（可 `codegraph uninit` 重建）。CLI 本体是全局安装，不入仓库。
- **⚠️ 残留上下文占用（与本项目「减 token」目标强相关，务必读）**：CodeGraph 官方实测——**吞吐 token 降 62%，但会话结束时窗口内的「检索上下文残留」反而多 ~80%**（VS Code 上 67k vs 18k）。原因：它一次返回一个大而密的 verbatim payload 并留在窗口里；而 grep-and-read 是很多小块结果、会被逐出。**若你跑长会话且窗口小，要为它留预算**。中和方案：继续保留 Layer A 的紧凑 `CODE_INDEX.md`（~1-2k token、读完即用、不占常驻），避免依赖 CodeGraph 做过重的全局浏览。
- **遥测（telemetry）**：项目自带 TELEMETRY 指标上报（自建 Cloudflare D1）。若要严格本地/隐私，需在配置里显式关闭，计划中列为一项配置动作。

## 五、决策与假设
- **范围**：仅作为本项目 AI 开发辅助，不修改产品业务代码；不动现有 DSH 升级流程。
- **主选 MCP 引擎**：CodeGraph；若安装受网络/体积约束，降级为 mcp-ctags（更轻，但跨引用弱）。
- **静态地图**：采用紧凑 tree-sitter 结构骨架（签发式）而非全量 dump（Repomix 类全量并不省 token，排除）。
- **git 策略**：提交 `CODE_INDEX.md`；SQLite 索引与运行缓存 gitignore 且可通过命令重建。
- **语言覆盖**：本仓库一手语言为 JS/TS + Java，均在 CodeGraph/tree-sitter 支持范围，无需额外安装语法包。

## 五、验证清单
1. `npm run codeindex:init` 成功建立索引，无报错。
2. `CODE_INDEX.md` 生成成功，文件较小（<20KB），覆盖 electron/frontend/backend/src/scripts/integrations 全部模块。
3. MCP 服务器配置后，agent 能查到某个已知符号（如后端一个 controller / 前端一个 service）的定义与引用，返回正确的文件路径与行号。
4. `.gitignore` 生效：索引 DB 未进版本库；`CODE_INDEX.md` 已提交。
5. （可选）提交代码后 run `npm run codeindex:update` 增量刷新，未全量重建。

## 待办建议（如需进入实施）
1. 安装并初始化 CodeGraph MCP（Step 2）
2. 生成并提交 CODE_INDEX.md（Step 3）
3. 注册到 TraeCode / DSH MCP 配置并联调（Step 2.3 / Step 4）