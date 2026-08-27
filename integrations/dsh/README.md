# 剪藏（CutShelter）× DSH 集成 —— Phase 0/1/2/3：MCP 桥 + 会话成果自动归档产品概览 + Agent 面板 + Tools Hub 互通

让 DeepSeek Harness（DSH）的 Agent 能**检索与写入剪藏知识库**（剪藏 / 待办 / 学习计划 / Wiki 索引 / 周报状态 / Tools Hub），完成工作后**把会话成果自动归档进工作台产品概览**（四字段迭代记录），并在剪藏桌面端提供**内嵌的「AI 干活」面板**（iframe），实现"AI 用你的知识库干活，干完自动沉淀"。

> **共享 profile 语义**：本集成的 DSH_HOME 统一为官方默认根 `~/.dsh`，应用拉起（端口 3081）与手动 `dsh web`（端口 3080）共享同一 `web` profile —— 插件 / 技能 / 插件市场安装两端互通（同步由 DSH_HOME 决定，与端口无关）。应用采用**单实例复用优先**：检测到 3080 或 3081 任一已有 DSH 实例即复用打开，避免同 profile 双开导致的 cordis.patch.yml / pnpm 锁并发写。

完整的方向分析与路线图见 [docs/DSH集成探索.md](../../docs/DSH集成探索.md)。

## 组成

```
integrations/dsh/
├── mcp-server/            Node MCP stdio server（代理剪藏 8081 REST）—— Phase 0 + 3
│   ├── server.mjs         13 个工具：clip_search/list/add/delete/categories、
│   │                      todo_list/add/set_status、learning_plan_list、wiki_index、
│   │                      weekly_report_status、tools_hub_list、tools_hub_page
│   ├── package.json       依赖 @modelcontextprotocol/sdk
│   └── test.mjs           standalone 测试（initialize → tools/list → tools/call）
├── plugins/clip-capture/   DSH 本地插件 —— Phase 1
│   ├── index.mjs          注册 clip_session 工具（显式归档四字段）+ turn/end 自动归档监听
│   ├── package.json       依赖 @deepseek-ai/dsh-tools
│   └── test-plugin.mjs    standalone 测试（插件装载 + execute 端到端）
├── cordis.example.yml     dsh web --patch 覆盖层示例（挂 mcp-client + clip-capture；端口 3081）
└── skills/cut-shelter/    SKILL.md 技能包（存储布局 + 读写约定 + 边界 + TODO 约定）
```

> 💡 **想直接上手体验？** 端到端步骤（启动后端 → 启动 patched DSH → 6 个体验场景 → 排查表）见 [docs/DSH体验测试指南.md](../../docs/DSH体验测试指南.md)。
>
> 💡 **Phase 2（剪藏内嵌 Agent 面板）**：改动在 `electron/main.js`（DSH sidecar：单实例复用优先、共享 `~/.dsh` profile、按需启动、profile 化自研集成 + 自动预装 dshmarket）、`electron/preload.js`（IPC）、`frontend/index.html`（「AI 干活」视图 + 主题适配）、`frontend/settings.html`（DSH 设置：插件市场入口）。启动剪藏桌面应用后点导航「AI 干活」即可。

## 插件市场与扩展

应用在 DSH **就绪后自动预装 dshmarket**（DSH 内嵌 Plugin Market，数据源 `awesome-dsh-plugin.com`）。使用路径：**剪藏 设置 → AI 与集成 → DSH Agent → 打开插件市场**（或打开 DSH 根页 → Settings → Plugin Market）。

- **插件安装即共享**：在任一端口装好的插件进同一 `web` profile，两端（手动 3080 / 应用 3081）互通。
- **扩展新插件**：自研集成统一走主进程 `ensureDshPlugin(spec)` 底座（npm 包或 file 路径），拷入 `~/.dsh/plugins/cutshelter/` 稳定目录 + 写 profile patch（`~/.dsh/profiles/web/cordis.patch.yml`，upsert 幂等）。第三方插件从 Plugin Market 管理即可，应用不硬编码其内部路由。

## 快速开始

### 1. 启动剪藏后端

```bash
cd backend && mvn spring-boot:run     # 或 java -jar backend/target/clip-demo-0.0.1-SNAPSHOT.jar
# 验证：http://127.0.0.1:8081/api/health 返回 {"status":"UP"}
```

### 2. 安装依赖并自测

```bash
cd integrations/dsh/mcp-server
npm install
node test.mjs     # Phase 0：要求后端已启动；只读探测 + 带标记的剪藏写入/删除往返

cd ../plugins/clip-capture
npm install
node test-plugin.mjs   # Phase 1：插件装载 + clip_session 端到端（四字段归档→产品概览迭代记录）
```

### 3. 接入 DSH Web

> 推荐走剪藏桌面端（设置 → DSH Agent → 启动）：应用会统一 DSH_HOME、复用/拉起实例、自研集成已 profile 化（拷入 `~/.dsh/plugins/cutshelter/`），并自动预装 dshmarket。以下为手动接入的等价路径。

```bash
npx @deepseek-ai/dsh web --patch ./integrations/dsh/cordis.example.yml
```

打开 `http://127.0.0.1:3080`，Agent 将看到 `mcp__cut_shelter__clip_search` 等 **13 个 MCP 工具**，以及 `clip_session` 插件（合计 14 个可选工具；另有回合结束自动归档，无需调用）。手动实例默认 `~/.dsh`，与应用共享同一 `web` profile。

在 DSH 里试一句：

> 用剪藏知识库工具，搜索"学习计划"相关的内容，然后帮我建一条待办：周五前复习。

### 4.（可选）安装技能包

把 `skills/cut-shelter/` 复制到 DSH 技能目录 `~/.dsh/skills/cut-shelter/`（或在设置页「一键安装技能包」），Agent 会按 `SKILL.md` 的规范读写剪藏。

## 工具清单

| 工具（agent 侧名称 mcp__cut_shelter__*） | 作用 | 备注 |
|---|---|---|
| clip_search | 语义搜索剪藏（query + topK） | 只读 |
| clip_list | 剪藏列表（keyword/workflowStatus/limit） | 只读 |
| clip_categories | 分类树 | 只读 |
| clip_add | 新增剪藏 | 写；默认 useAiTags=false 省 token；自动去重 |
| clip_delete | 删除剪藏 | 破坏性，需用户确认 |
| todo_list / todo_add / todo_set_status | 待办查询/新增/改状态 | 写操作低成本 |
| learning_plan_list | 学习计划列表 | 只读 |
| wiki_index | 知识库 Wiki 索引（Markdown） | 只读 |
| weekly_report_status | 周报状态/路径 | 只读 |
| tools_hub_list | Tools Hub 小工具注册表（id/名称/分类/描述/启用状态） | 只读 |
| tools_hub_page | 读取 Tools Hub 小工具 HTML 源码（前 3000 字符，便于复用） | 只读；需先 `id` |

> 说明：`clip_search` 走后端语义检索（可能涉及嵌入服务）；列表/新增/状态类操作是纯本地接口，不额外消耗 LLM token。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `CUTSHELTER_BASE_URL` | `http://127.0.0.1:8081` | 剪藏后端地址 |
| `CUTSHELTER_TIMEOUT_MS` | `60000` | 单请求超时 |

## 常见问题

- **端口/实例**：应用单实例复用优先——检测 3080（手动）或 3081（应用）任一已有实例即复用，不双开（同 profile 双开会并发写 patch / pnpm 锁）。两端口共享 `~/.dsh` 的 `web` profile。
- **工具不出现**：确认后端已启动（桥在启动时会 listTools，失败只记日志不阻止激活，见 mcp-client `failOnStartupError` 配置）。
- **Windows 路径**：`cordis.example.yml` 中 `command`/`args` 用正斜杠绝对路径，YAML 避免反斜杠转义问题。
- **卸载**：去掉 `--patch` 参数重启 DSH 即可，不影响剪藏本体。
- **删除剪藏要重试**：`clip_add` 会异步触发 AI 分析，刚新增后立即 `clip_delete` 可能被分析写回（后端行为）。删除后建议确认列表里已消失，必要时重试一次。
- **TODO 落库现状**：后端 `TodoScannerService`（读取 `TODO/feature-points.json` 批量导入）在当前构建中**被硬禁用且无调用方**。现阶段请用 `mcp__cut_shelter__todo_add`（API 路径）；若需恢复文件批量导入，需还原扫描器实现并接回启动钩子（见探索文档第 5 节）。

## Phase 1：会话成果自动归档产品概览（clip-capture 插件）

AI 完成一段有保留价值的工作后，成果自动进入**工作台产品概览的迭代记录**（不再落剪藏/待办）。两条路径：

- **自动归档（默认开）**：插件监听会话事件 `session/event` 的 `turn/end`（reason=completed，DSH 0.1.0-rc.7 实测枚举：completed/blocked/aborted/error/max-tokens/interrupted），本轮有产出信号（调用过工具，或 AI 输出足够长）时自动聚合会话文本 POST `/api/workspace/feature-points/iterations/ai-session`，由后端 AI（flash 小模型，一次调用）提炼四字段——`title` 干了什么 / `problem` 解决什么问题 / `solution` 如何解决 / `outcome` 大白话产出——落库为迭代记录（source=dsh-session）。闲聊轮不归档；归档失败仅告警，绝不干扰 DSH。
- **显式归档**：Agent 主动调用 **`clip_session`** 工具自填四字段（source=dsh-agent），该轮自动归档自动跳过避免重复。

- 插件位于 `plugins/clip-capture/`，通过 `cordis.example.yml` 的 `insert` 行挂载；依赖 `@deepseek-ai/dsh-tools`（**版本须与本机 dsh 一致**，当前 0.1.0-rc.7）。
- 基地址可用插件 `config.baseUrl` 或环境变量 `CUTSHELTER_BASE_URL` 覆盖；`config.autoArchive: false` 可关闭自动归档。
- 产品概览迭代记录后端：`FeaturePointIterationService`（`feature-point-iterations.json`），迭代记录现含可选字段 `title/problem/solution/outcome/source`，前端工作台时间线渲染「AI 干活」徽标卡片。
- 旧剪藏收集模式（`source=dsh` 落剪藏）已废弃，会话成果统一走产品概览。

## 后续路线

- Phase 2：剪藏 Electron 内嵌 DSH「Agent 模式」（sidecar `dsh web --patch` + iframe 面板），复用 Phase 0/1 的能力。
- 详见 [docs/DSH集成探索.md](../../docs/DSH集成探索.md) 第 5 节。
