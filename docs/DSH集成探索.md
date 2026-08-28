# CutShelter × DeepSeek Harness 集成探索

> 版本：2026-08 ｜ 状态：探索分析 + Phase 0/1/2/3（部分）可运行验证已完成
>
> 本文回答三个问题：CutShelter 与 DSH 的边界在哪、各自独特价值是什么；有哪些集成方向、成本/收益/风险如何；推荐哪条路线、分几步走、每步如何验证。
>
> 本文吸收了一篇 V2EX 帖子（《体验完 DeepSeek Harness，我打算放弃开发了两年的客户端》）及其评论区的观点，做了批判性评估而非全盘照搬，详见第 3 节。

---

## 1. 结论速览（TL;DR）

- **CutShelter（剪藏）的独特价值 = 数据与采集体验**：本地知识库（剪藏 / 待办 / 专题 / wiki / 学习计划 / 密码库）+ 快速采集入口（桌面端、浏览器扩展、右键/快捷键）。它的智能层（单轮 AI 分析、标签、周报）是通用能力，DSH 可以做得更深。
- **DSH 的独特价值 = Agent 基建**：文件读写、终端、工具调用、子代理、工作流、记忆持久化、插件体系、Web UI —— 全插件化且开源。
- **推荐结论（与帖子同构但更温和）**：**不放弃剪藏的采集 UX，不把剪藏"搬进"DSH 壳**；而是把剪藏的数据与接口**开放给 DSH 的 Agent**，让"AI 用你的知识库干活，干完自动落库"，形成双向价值闭环。
- **推荐落地顺序**：Phase 0（MCP 桥 + 技能包，✅ 已实现）→ Phase 1（会话成果自动落库，✅ 已实现：`clip_session` 插件 + 约定文档化）→ Phase 2（剪藏内嵌 DSH「Agent 模式」，✅ 已实现：Electron sidecar + 前端 Agent 面板）→ Phase 3（Tools Hub 互通 ✅ 已实现；DSH Web 客户端插件 📋 需 DSH 源码构建，见第 5 节）。
- **底线**：密码库保持零知识加密，不开放给 Agent 自动读取；确定性操作（搜索/列表/新增）走本地接口而非 LLM 中转，控制 token 成本；DSH 处于开发者预览期，集成层保持薄（优先 MCP / HTTP / 文件等生态标准）。

---

## 2. 两系统现状与边界

### 2.1 DSH（DeepSeek Harness）是什么

开源 Agent 运行时（harness），DeepSeek 出品，MIT 许可，当前为 **开发者预览版**（文档明示会有兼容性破坏变更）。核心理念：**一切皆插件**，基于 Cordis 插件框架。

| 维度 | 事实（已核实，版本 0.1.0-rc.7） |
|---|---|
| 运行 | `npx @deepseek-ai/dsh web` 起 Web UI（默认 `http://127.0.0.1:3080`）；`dsh --profile headless "任务"` 一次性运行；`dsh plugin` 管理插件 |
| 组合模型 | profile = 组合包（bundle）叠加 + 用户 patch（`cordis.patch.yml` / `--patch` 覆盖层） |
| 工具扩展点 | `ctx.tools.register(defineTool({name, description, parameters, output, execute}))` —— 面向模型的工具注册表，带执行流水线与把关 |
| MCP 客户端 | `@deepseek-ai/dsh-mcp-client` 一等公民：stdio 或 streamable-http 连接外部 MCP server，工具呈现为 `mcp__<serverName>__<工具名>`，支持自动重连、HMR 热换 |
| 技能（Skills） | `dsh-skill-filesystem` 从 `<项目>/.dsh/skills`、`~/.dsh/skills` 等目录发现 `SKILL.md`，以目录/清单方式把"使用手册"喂给模型 |
| 其他扩展点 | 用户命令（commands）、后台工作（jobs）、Agent 事件（`agent/*`、`tools/*`、`session/event`）、Web 客户端插件与对话节点（conversation node）、设置卡片、跨进程 SDK（stdio JSON-RPC 驱动 runtime） |
| 深水区 | API Gateway / Typert（host↔client 内部协议）、Code Mode、LSP、PTY、沙箱/审批策略 —— 对第三方集成不需要深入 |

**对集成最重要的三点**：① 工具是 Agent 能力的标准入口；② MCP 是生态标准的外部能力桥，DSH 原生支持；③ 纯文件数据 DSH 的 `read`/`grep`/`glob` 天然可读，零代码即可获得"读"能力。

### 2.2 CutShelter（剪藏）是什么

个人知识管理 App：Spring Boot 3.2.0 后端（Java 17，端口 8081，spring-ai 0.8.1）+ Electron 桌面壳（sidecar 启动后端 JAR，内嵌 JRE）+ 浏览器扩展。数据**全部本地文件**。

| 模块 | 关键 API（已核实） | 说明 |
|---|---|---|
| 剪藏 | `POST /api/clip/add`、`GET /api/clip/list`、`GET /api/clip/search`、`GET /api/clip/categories`、`DELETE /api/clip/{id}`、`POST /api/clip/organize`、`POST /api/clip/divergent-summary` 等 | `ClipRequest` 字段：content/type/source/category/title/summary/sourceUrl/tags/useAiTags/target/workflowStatus…；`add` 异步触发 AI 分析 |
| 待办 | `GET /api/todo/list`、`POST /api/todo/add`、`PUT /api/todo/{id}/status?completed=` | `TodoContent` 字段：title/priority/deadline/deadlineTime/reminderEnabled/completed/category/sourceClipId… |
| 周报 | `POST /api/weekly-report/generate`、`GET /api/weekly-report/status` | 返回 `{status, content, storagePath}` |
| Wiki | `POST /api/wiki/query`（`{question, includeClips, includeKnowledge}`）、`GET /api/wiki/index`、`GET /api/wiki/pages` | 基于 Obsidian Vault 的 LLM 知识库（索引 → 页面综合），支持 SSE 流式 |
| 知识条目 | `GET /api/knowledge/list`、`POST /api/knowledge/synthesize` 等 | 知识条目与评论 |
| 学习计划 | `GET /api/learning-plan`、`POST /api/learning-plan` | AI 生成路线图 + Mermaid + Exa 资源 |
| 密码库 | `PasswordVaultController` | DES 零知识加密，**不在开放范围内** |
| 工具 Hub | `GET/POST /api/tools` | 自包含 HTML 小工具注册表（PDF 工具箱、批量重命名、图片转换…），**是 UI 小工具，不是 Agent 可调用工具**，两者概念不同 |
| 产品开发工作台 | `product-dev.todo-dir`（配置指向 `./TODO`） | `feature-points.json`（v2.0）由 `FeaturePointsService` 直读服务产品概览；DSH 会话成果经 `FeaturePointIterationService` 落库为迭代记录。旧 `TodoScannerService`（v1 clips/todos 导入）已退役（见第 5 节 Phase 1） |
| 模型 | `DashScope / DeepSeek / OpenAI 兼容 / 智能路由`，`/api/ai/chat/stream` SSE 流式对话 | CutShelter 自带单轮 AI 能力，多提供者可路由 |

数据布局（本地文件）：`clip-storage/`（剪藏正文 JSON+Markdown）、`obsidian-vault/`（wiki 源）、`weekly-report/`、`TODO/`（Agent 产出落库）、`~/.cut-shelter/`（git 配置、工具注册表等）。

### 2.3 边界总结

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  CutShelter（剪藏）           │        │  DSH（DeepSeek Harness）       │
│  独特价值：数据 + 采集体验       │        │  独特价值：Agent 基建 + 生态     │
│  · 知识库：剪藏/待办/wiki/计划   │◄──────►│  · 文件/终端/工具/子代理/工作流   │
│  · 采集入口：桌面/扩展/右键/快捷键 │  集成面  │  · 一切皆插件、MCP、技能、Web UI│
│  · 本地文件优先、Git 同步       │        │  · 记忆持久化、会话日志         │
└─────────────────────────────┘        └──────────────────────────────┘
   知识库/记忆  ▲                        行动/大脑  ▼
                 │ 双向闭环：Agent 用知识库干活，干活成果自动落库
```

---

## 3. V2EX 帖子的启示（批判性吸收）

### 3.1 帖子核心论点（《体验完 DeepSeek Harness，我打算放弃开发了两年的客户端》）

作者（"即我"——个人全维度数据 App）的核心判断：

1. **Agent 能力 + 插件化是每个 AI 应用的必然方向**，且入口层级不断提高（支付宝首页对话化、微信小微内测）。
2. **DSH 把 AI 原生应用要自建的基建全做了**：从 UI、agent loop、工具调用、权限管理、记忆、存储到后台服务，全部插件化、开源、生态起量快。
3. **结论：停止自建客户端，做 DSH 插件即可**。独特价值 = 自己的数据 + 领域 API，不是 harness。作者还给出两个场景：C 端（即我 = DSH 壳 + 登录 + 核心 UI 插件化）、B 端（SaaS = DSH 壳 + 数据接口 + 对话生成页面，销售在客户面前就能交付）。
4. **"产出自动落库"模式**：Agent 干完活，成果自动沉淀进产品数据。

### 3.2 评论区的主要反驳

| 反驳 | 原文大意 | 我们的评估 |
|---|---|---|
| 插件化并非 DSH 首创 | "Pi 完全能做到你提到的所有事情""pi 出了多久了" | 属实：插件化思想 Pi 等先行者早有，DSH 的差异在 Cordis 组合模型的激进程度（连 UI、agent loop 本身都可替换）。**战略结论不受影响**：行业在收敛到"开放 harness + 插件"，应用层该骑上去而不是自建 |
| token 成本 | "中小企业看今日销售统计要烧 3 块钱 token" | 成立：简单确定性操作不应走 LLM。**集成设计必须把搜索/列表/新增这类操作做成低成本本地工具**，Agent 只在需要理解/生成时调用模型 |
| 插件质量/安全 | "一堆插件参差不齐，想想就不放心" | 成立：插件是代码，装载即信任。个人工具场景风险可控（本地、自用），但若做公开生态需要把关机制 |
| 模型迭代杀死工具链 | "小龙虾（Clawdbot）时代也有人这么吹" | 部分成立：harness 层会被模型能力演进压缩，但 MCP/文件/HTTP 这类**生态标准接口**的生命周期远长于具体 harness。这也是我们优先 MCP 而非深绑 DSH 内部 API 的原因 |
| DSH 过拟合自家模型 | "为了证明 v4-pro 的 benchmark 跑分" | 存在这种风险（官方用自家模型打榜），但 DSH 支持任意 OpenAI 兼容端点，集成面不绑定模型 |
| 灵活性 = 复杂性 | "人类天生爱偷懒，成品 UI 有价值" | 成立：**这正是我们不放弃剪藏 UI 的理由**。采集 UX 是剪藏的护城河，Agent 是补充不是替代 |

### 3.3 应用到 CutShelter 的结论

1. **采纳"数据交给 Agent"**：把剪藏 / wiki / 待办 / 学习计划开放为 Agent 可调用的面（Phase 0 的 MCP 桥）。密码库维持零知识边界，不开放。
2. **采纳"产出自动落库"**：DSH 工作成果自动进入产品概览（`FeaturePointIterationService` 迭代记录 / `FeaturePointsService` 直读 `feature-points.json`）。(Phase 1)。
3. **采纳"不重复造 harness"但保留产品壳**：剪藏不自己实现 agent loop / 工具框架（它现有的单轮 AI 对话 + 工具 Hub 与 Agent 是不同层次），把"智能层"开放给 DSH。长期存在"壳倒置"可能（DSH Web 成为主入口、剪藏退化为数据底座 + 采集插件），列为演进方向而非当前决策。
4. **规避评论区踩过的坑**：确定性操作走本地工具控成本；集成层保持薄；不承诺"全部迁移到 DSH"这种激进结论。

---

## 4. 集成方向矩阵

大白话版（给非技术读者）：**① 让 DSH 的 AI 能"用"剪藏；② 把剪藏的数据直接摊给 AI 看；③ 剪藏里加个"AI 干活"入口；④ AI 干完活自动存进知识库；⑤ 给 AI 发本"使用手册"。**

| # | 方向 | 机制 | 成本 | 收益 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| **A** | **DSH 接入剪藏知识库（MCP 桥）** | 剪藏侧提供 MCP server（A1：Node stdio MCP 包装器代理 8081 REST，**零 Java 改动**；A2：Java 内嵌 MCP，spring-ai 0.8.1 无 MCP 模块需手工实现，暂缓）；DSH 用 `dsh-mcp-client` 连接 | 低 | Agent 可检索/写入知识库：clip_search/add、todo、wiki_query、learning_plan、weekly_report 等 | 端口占用；鉴权（本地回环可免） | ✅ **已实现（Phase 0）** |
| **A'** | **零代码数据开放（读）** | DSH 工作区直接指向 `clip-storage/`、`obsidian-vault/` 目录（纯文件），配合 skill 说明存储约定 | 极低 | 读侧能力免费获得（read/grep/glob） | 写侧易破坏数据结构 → 写操作仍走 A | ✅ 文档化 |
| **B** | **剪藏内嵌 DSH「Agent 模式」** | Electron sidecar `dsh web --patch`（固定 3081，已占用则复用）+ 前端"AI 干活"iframe 面板（主题适配） | 中 | 剪藏获得文件/终端/子代理/工作流级 Agent 能力 | 进程/端口管理（已处理：3081 + 复用检测）；打包需内置 dsh | ✅ **已实现（Phase 2）** |
| **C** | **DSH 工作自动落库** | DSH 插件注册 `clip_session` 工具（把会话摘要 POST 到剪藏）+ 沿用 `TODO/*.md` 约定 + 周报 ingest DSH 提交 | 低 | 双向价值闭环（帖子"产出自动落库"） | 摘要质量、去重 | 📋 规划（Phase 1） |
| **D** | **剪藏技能包（SKILL.md）** | 向 `.dsh/skills` 投放 SKILL.md：存储布局约定 + 常用操作规范 | 极低 | Agent 学会按剪藏约定读写数据 | 指令漂移需维护 | ✅ 已交付（Phase 0） |
| **E** | **Tools Hub ↔ DSH 生态** | MCP 桥新增 `tools_hub_list` / `tools_hub_page` 只读工具；概念映射文档化 | 低 | Agent 可了解/复用剪藏既有 HTML 小工具 | 概念错位需澄清（已文档化） | ✅ 已实现（Phase 3） |
| **F** | **DSH Web 客户端插件** | conversation node / client plugin 在 DSH Web 内联渲染剪藏/待办 | 高 | 数据在 Agent 工作区内联可见 | **需 DSH 源码构建**（npx 安装方式无法加载客户端插件） | 📋 留待源码部署时 |
| **G** | **以 DSH 替换剪藏自带 AI 引擎** | — | — | — | **不推荐**：剪藏 Spring AI 多提供者已满足单轮任务；DSH 是 harness 不是 API 服务 | ❌ 不推荐 |

### 4.1 关于方向 B 的澄清（"内嵌 dsh web 模块"）

用户常见的理解是"把 `npx @deepseek-ai/dsh web` 的对话模块 import 进剪藏"。**方向对，但技术实现不是 npm 模块嵌入**：

- DSH Web 是独立应用（`apps/web`），没有对外发布可嵌入的组件库。
- 实际做法：剪藏 Electron 主进程**像现在 spawn Java 后端一样，再 spawn 一个 `dsh web` sidecar 进程**（带 `--patch` 注入 MCP 桥配置），剪藏 UI 用 **iframe** 指向 `http://127.0.0.1:<端口>`（默认 3080，可通过 `--patch` 改端口避免冲突，官方示例即把端口 pin 到 3081）。
- 注意点：DSH 有独立模型配置（需单独填 DeepSeek Key）；打包时把 `@deepseek-ai/dsh` 作为依赖打进 resources（离线可用），而不是让用户现场 npx；备选路线是用 SDK/headless 模式自建对话 UI（更灵活、工作量更大）。

---

## 5. 推荐路线

### Phase 0 —— MCP 桥 + 技能包（✅ 已完成，见 `integrations/dsh/`）

- Node MCP stdio server（`@modelcontextprotocol/sdk`），代理剪藏 8081 REST，暴露 10 个工具：
  `clip_search` / `clip_list` / `clip_add` / `clip_delete` / `clip_categories` / `todo_list` / `todo_add` / `todo_set_status` / `learning_plan_list` / `wiki_index`（+ `weekly_report_status`）
- 剪藏侧 `cordis.example.yml`（`dsh web --patch` 覆盖层，挂 `dsh-mcp-client` 指向本桥）
- 技能包 `skills/cut-shelter/SKILL.md`（存储布局 + 使用规范）
- 验证：桥的 standalone 测试通过（initialize / tools/list / tools.call 对真实 8081 生效）✅；DSH 侧端到端需用户配置模型 Key 后按 README 验证

### Phase 1 —— 会话成果自动落库（✅ 已实现：`clip_session` 插件 + 约定文档化）

- DSH 插件 `clip-capture`：注册 `clip_session` 工具，Agent 完成工作后把成果摘要 POST 到 `/api/clip/add`（`source=dsh`），自动成为剪藏。实现于 `integrations/dsh/plugins/clip-capture/`（依赖 `@deepseek-ai/dsh-tools`，版本与 dsh 一致）。
- **TODO 落库现状（已定论：扫描器退役）**：旧 `TodoScannerService`（曾约定读取 `TODO/feature-points.json` 的 v1 格式 `clips[]/todos[]` 批量导入剪藏与待办）已**退役**——`scanAndImport()` 实现已清空、无调用方。替代分工如下：
  - `feature-points.json`（v2.0：`requirement/featurePoints/knowledgePoints`）由后端 `FeaturePointsService` 直读，经 `GET /api/workspace/feature-points` 服务产品概览页，**不再导入剪藏/待办**；
  - DSH 会话成果经 `FeaturePointIterationService` 的 `POST /feature-points/iterations`（显式）与 `/iterations/ai-session`（自动）落库为四字段迭代记录；
  - 剪藏/待办落库走 **API 路径**（MCP 桥 `clip_add` / `todo_add` / `todo_set_status`），可靠且低成本。
- 可选：基于 `session/event` 在 turn 结束时自动生成摘要并落库（当前为 Agent 显式调用，行为可预期、更省 token）。

### Phase 2 —— 剪藏内嵌 DSH「Agent 模式」（✅ 已实现）

- **Electron sidecar**（`electron/main.js`）：新增 `startDshAgent()` / `stopDshAgent()` / `resolveDshBin()`：
  - 端口固定 **3081**（`dshPort` 配置），避开用户手动启动 DSH 的默认 3080，从根上规避端口冲突；
  - 若 3081 已有 DSH 实例在响应 → **直接复用**（不重复拉起，退出时也不杀用户进程）；
  - 按需启动：前端打开"AI 干活"视图时经 IPC `dsh-agent:ensure` 触发（默认 `dshAgentEnabled=true`），不常驻占资源；
  - dsh CLI 自动探测：配置 `dshBinPath` → 环境变量 `DSH_BIN` → 应用内置 `node_modules` → npx 缓存 → npx 兜底；
  - 生命周期：`quitApp()` / `before-quit` / `will-quit` 中 `stopDshAgent()`（仅停本应用拉起的实例）。
- **前端 Agent 面板**（`frontend/index.html`）：新增"AI 干活"导航视图：
  - iframe 内嵌 `http://127.0.0.1:3081`；顶部面板条显示连接状态（运行中/复用/失败）、刷新、系统浏览器打开；
  - **主题适配**：面板条/边框走剪藏主题变量（notion/regular/dark 自动适配）；iframe 提供"🌗 反色"开关（`localStorage['agent_frame_invert_v1']`，默认 auto=跟随暗色主题反色），暗色主题下视觉一致；
  - 纯浏览器模式（非 Electron）下自动降级为直接探测 3081。
- **IPC**：`dsh-agent:status` / `dsh-agent:ensure` / `dsh-agent:stop`（preload 暴露 `dshAgentStatus` / `ensureDshAgent` / `stopDshAgent`）。
- **打包注意**：正式安装包需把 `@deepseek-ai/dsh` 与 `integrations/dsh/` 作为 extraResources 打进应用（当前为开发模式：探测 npx 缓存或 `DSH_BIN`）。

### Phase 3 —— Tools Hub 互通（✅ 已实现：桥工具）/ DSH Web 客户端插件（📋 需源码构建）

- **Tools Hub ↔ DSH**：MCP 桥新增 `tools_hub_list`（列出剪藏 Tools Hub 的 HTML 小工具注册表）与 `tools_hub_page`（读取小工具 HTML 源码前 3000 字符）。概念澄清：Tools Hub 是"自包含 HTML 小工具"，Agent 工具是"模型可调用函数"，两者通过这两个只读工具互通（Agent 可了解/复用剪藏已有小工具，不能直接执行 HTML）。
- **DSH Web 客户端插件（conversation node）**：技术上可行（`ConversationNodeDefinition` + keyed renderer），但客户端插件需要打进 DSH Web 的构建产物（`pnpm run dev:web` / 完整 build），**对 `npx @deepseek-ai/dsh` 安装方式不生效**——需从源码跑 DSH 才可加载。已按此定位为"可选、留待源码部署时再做"，不在当前交付内。

---

## 6. 风险与边界

| 风险 | 说明 | 对策 |
|---|---|---|
| DSH 预览期破坏性变更 | rc 版迭代快、可能有 breaking change | 集成层只用 MCP / HTTP / 文件等生态标准；MCP 桥与 DSH 版本解耦 |
| token 成本 | Agent 驱动操作逐次消耗 token | 确定性操作（搜索/列表/新增/状态）走本地接口；只有理解/生成类任务（wiki 问答、周报）才触发 LLM |
| 密码库零知识边界 | DES 加密、用户持密钥 | 不把密码库接口暴露给 Agent；文档明确边界 |
| 采集 UX 不妥协 | 剪藏命根子是快速采集 | 保留桌面/扩展/快捷键入口；Agent 是补充入口不是替代 |
| 端口/进程冲突 | DSH 默认 3080 可能被占用；剪藏 8081 | `--patch` 改端口；Electron 侧做端口探测与失败提示 |
| 数据写入破坏 | Agent 直接写文件可能破坏剪藏结构 | 写操作走 API（MCP 桥）而非裸文件；skill 明确"只读目录、写走接口" |
| 包体/依赖 | 内嵌 DSH 增加安装体积 | Phase 2 再做体积评估（DSH 可裁剪 bundle） |

---

## 7. 附录

### A. 关键事实清单（已核实）

- DSH 0.1.0-rc.7：`dsh web` 默认 127.0.0.1:3080；`--patch` 覆盖层语法；`dsh-mcp-client` 配置字段（transport/serverName/command/args/url…）；`dsh-skill-filesystem` 技能根目录顺序（项目 `.dsh/skills` → `.agents/skills` → 自定义 → 用户 `~/.dsh/skills` → `~/.agents/skills`）。
- spring-ai 0.8.1 **不包含** MCP server 模块（MCP 支持自 1.0.0-M 起），故 A2（Java 内嵌 MCP）需手工实现协议或升级 spring-ai，暂缓；A1（Node stdio 包装器）零 Java 改动。
- CutShelter API 实测（本机 8081 启动验证）：`/api/health` UP；`/api/clip/list` 返回数组；`/api/clip/categories` 6 个分类；`/api/todo/list` 数组；`/api/learning-plan` 返回含 phases/mermaidDiagram 的对象数组；`/api/weekly-report/status` 返回 `{status,message,storagePath}`；`/api/wiki/index` 返回 Markdown 索引。
- 剪藏"工具 Hub"是 HTML 小工具注册表（`~/.cut-shelter/tools/registry.json` + 自包含 HTML 页面），**不是 Agent 可调用工具**——与 DSH 工具是两个概念，映射见方向 E。
- 剪藏的"产出自动落库"现为：`feature-points.json`（v2.0）由 `FeaturePointsService` 直读 → 产品概览；DSH 会话成果经 `FeaturePointIterationService` 落库为迭代记录。旧 `TodoScannerService`（v1 导入剪藏/待办）已退役。

### B. Phase 0 交付物（本仓库 `integrations/dsh/`）

```
integrations/dsh/
├── README.md               # 用法：启动桥、接入 DSH、验证、卸载（Phase 0/1/2/3）
├── mcp-server/
│   ├── package.json        # 依赖 @modelcontextprotocol/sdk
│   ├── server.mjs          # MCP stdio server：代理 http://127.0.0.1:8081（13 个工具）
│   └── test.mjs            # standalone 测试（initialize/tools/list/tools.call）
├── plugins/clip-capture/   # Phase 1：clip_session 工具（会话成果落库）
│   ├── index.mjs           # DSH 本地插件（defineTool 注册）
│   ├── package.json        # 依赖 @deepseek-ai/dsh-tools（版本与 dsh 一致）
│   └── test-plugin.mjs     # standalone 测试（插件装载 + execute 端到端）
├── cordis.example.yml      # dsh web --patch 示例（挂 mcp-client + clip-capture；端口 3081）
└── skills/cut-shelter/SKILL.md  # 技能包：剪藏存储布局与使用规范
```

### C. 参考资料

- [deepseek-ai/deepseek-harness（GitHub）](https://github.com/deepseek-ai/deepseek-harness) —— 源码、架构文档（docs/architecture.zh.md）、扩展实操手册（docs/cookbook/）、MCP 客户端文档（packages/mcp/mcp-client/README.md）、技能文档（packages/skill/）
- V2EX 帖子《[体验完 DeepSeek Harness，我打算放弃开发了两年的客户端](https://www.v2ex.com/)》（2026-08）及其评论区
- 对比文章：[DeepSeek Harness 与 Pi 架构差异：极简派和插件派谁更值得入手](https://www.jdon.com/94024-deepseek-harness-vs-pi.html)
- 生态观察：[GitHub 上 dsh-plugin 话题](https://github.com/topics/dsh-plugin)

---

## 8. 交付说明（含测试方法）

### 8.1 交付物清单

| 交付物 | 位置 | 状态 |
|---|---|---|
| 探索分析文档 | `docs/DSH集成探索.md` | ✅ |
| 体验测试指南（端到端步骤 + 排查表） | `docs/DSH体验测试指南.md` | ✅ |
| Phase 0：MCP 桥（13 工具）+ 技能包 + cordis 配置 | `integrations/dsh/mcp-server/`、`integrations/dsh/skills/`、`integrations/dsh/cordis.example.yml` | ✅ 19/19 测试通过 |
| Phase 1：`clip_session` 落库插件 | `integrations/dsh/plugins/clip-capture/` | ✅ 8/8 测试通过 |
| Phase 2：Electron sidecar + 前端「AI 干活」面板 | `electron/main.js`、`electron/preload.js`、`frontend/index.html` | ✅ 已实现（需启动 Electron 应用体验） |
| Phase 3：Tools Hub 互通桥工具 | `integrations/dsh/mcp-server/server.mjs` | ✅ 已实现（13 工具含新增 2 个） |
| 自助安装引导 + 检测解锁（未检测到 DSH 时展示在线同步的安装命令 + 一键复制 + 检测/重试，就绪后才装载面板） | `electron/main.js`、`frontend/tools.html`、`frontend/js/tools-core.js` | ✅ 已实现 |
| 设置页 DSH 配置（启用开关/端口/dsh 路径 + 一键装技能包 + 启动/停止/打开） | `frontend/settings.html`、`frontend/js/settings.js` | ✅ 已实现 |
| 一键安装 cut-shelter 技能包到 `~/.dsh/skills` | `electron/main.js`（IPC `dsh-agent:install-skill`） | ✅ 已实现 |
| Trae 技能同步到 DSH 技能目录（18 个 → `~/.dsh/skills`，6 个 → 仓库 `.dsh/skills`） | —（复制完成，格式兼容已验证） | ✅ 已同步 |
| 完全离线打包 dsh（可选，约 +214MB） | `scripts/build-dsh-offline.mjs` + `prebuild` + extraResources | ✅ 已接通（待验证产物） |

### 8.2 端口约定

- **DSH sidecar 固定 3081**（`electron/main.js` 的 `dshPort`、`cordis.example.yml` 的 `webserver.config.port`）：避开用户手动启动 DSH 的默认 3080，避免端口冲突；3081 已有 DSH 实例时自动复用。
- 剪藏后端 8081、前端 3001 不变。

### 8.2b 首次使用自助安装（CutShelter 不再代为联网安装）

- **不自动安装**：桌面端不再替用户执行 `npx` 联网下载。主进程 `resolveDshBin()` 四级探测（配置 `dshBinPath` → `DSH_BIN` → 内置 node_modules → npx 缓存）都未命中时，返回 `{ needInstall: true, command }`，由「工具 → AI 干活」卡片（`tools-core.js`）与工具页浮层（`tools.html`）展示**在线同步的自助安装命令**（版本由 npm/GitHub 在线解析，`DSH_NPX_SPEC` 可覆盖），用户复制到终端自行执行。
- **检测解锁**：安装完成后点「检测/重试」（IPC `checkDshInstall`，会强制刷新命令版本），检测到 dsh 后即可装载面板。
- **npx 缓存命中即视为已装**：`resolveDshBin()` 命中 npx 缓存（`mode:npx`）时直接用缓存里的 bin.js 启动，不再重新下载。
- **就绪后不代装插件市场**：sidecar 就绪后由主进程 `ensureCutshelterPlugins()` 幂等收紧自研集成（MCP 桥 + clip-capture），dshmarket 预装通过 `ensureDshMarket()` 非阻塞进行，失败仅告警。

### 8.3 测试方法（从零验证到端到端）

**第一步：桥与插件的 standalone 自测**（无需 DSH，需后端在 8081 运行）

```bash
cd backend && mvn spring-boot:run                    # 或 java -jar backend/target/clip-demo-0.0.1-SNAPSHOT.jar
cd integrations/dsh/mcp-server && npm install && node test.mjs        # Phase 0：19 项
cd integrations/dsh/plugins/clip-capture && npm install && node test-plugin.mjs   # Phase 1：8 项
```

**第二步：DSH Web 端到端**（体验"AI 用剪藏知识库"）

```bash
npx @deepseek-ai/dsh web --patch "L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\integrations\dsh\cordis.example.yml"
# 浏览器开 http://127.0.0.1:3081，先问"列出你当前可用的工具"，确认 mcp__cut_shelter__* 与 clip_session
```

四个体验场景（详见 `docs/DSH体验测试指南.md`）：A 读知识库（`wiki_index`/`clip_search`）→ B 写剪藏（`clip_add`）→ C 建待办（`todo_add`）→ D 成果落库（`clip_session`），每步去剪藏前端或 `/api/clip/list` 验证。

**第三步：剪藏桌面端「AI 干活」面板**（Phase 2，需 Electron）

启动剪藏桌面应用 → 顶部导航点 **「AI 干活」** → 主进程自动拉起/复用 3081 的 DSH sidecar → iframe 内嵌 Agent 界面；面板条显示连接状态，右上角「🌗 反色」适配暗色主题、「↗」在系统浏览器打开。切主题（设置里 notion/regular/dark）后面板与 iframe 反色状态同步。

### 8.4 已知限制与后续

- **DSH 预览期**：集成层只用 MCP/HTTP/文件标准，不深绑 DSH 内部 API；升级 DSH 时插件依赖（`@deepseek-ai/dsh-tools`）版本需同步。
- **TODO 批量落库（已退役）**：旧 `TodoScannerService` 已退役（`scanAndImport()` 清空、无调用方）。`feature-points.json` 由 `FeaturePointsService` 直读服务产品概览；剪藏/待办落库走 API（`clip_add`/`todo_add`）。
- **打包**：`integrations/dsh/` 已加入 `package.json` 的 `extraResources`（打进 `<exe>/resources/integrations/dsh`）；主进程**运行时生成 patch**（`buildDshAgentPatch()` 写入 `~/.cut-shelter/config/dsh-agent.patch.yml`），桥/插件路径按打包形态解析，不再依赖仓库内的 `cordis.example.yml`。dsh CLI 探测含 **LOCALAPPDATA** 的 npx 缓存（早期版本误用 APPDATA 导致漏检，已修复）。⚠️ **win-unpacked 现有构建需重新打包（`npm run build:win`）才含上述主进程修复**；临时应急已把资源复制到旧代码查找路径（`win-unpacked/integrations/dsh`）让旧构建走 npx 兜底可用。
- **完全离线（可选，已接通）**：`scripts/build-dsh-offline.mjs` 从 `@deepseek-ai/dsh` 收集生产依赖闭包（约 532 包 / 214MB，含 AWS/Google/Anthropic SDK 与 sharp 原生库）→ `dist-dsh-offline`，`prebuild` 钩子自动生成，extraResources 以 `dist-dsh-offline → resources/dsh-offline` 内置；`resolveDshBin` 优先命中 `resources/dsh-offline/node_modules/@deepseek-ai/dsh`。**代价是安装包约 +214MB**；日常用 npx 缓存 + 首次自助安装（浮层展示命令）即可，无网络/离线分发场景再依赖它。
- **设置页 DSH 区块（已实现）**：设置 → 「DSH Agent（AI 干活）」即时生效区块——启用开关 / 端口（3081）/ dsh CLI 路径（保存写 `config.json`）、**一键安装技能包**（IPC `dsh-agent:install-skill` 复制 `integrations/dsh/skills/cut-shelter` → `~/.dsh/skills/cut-shelter`）、启动/停止/打开面板按钮。
- **Trae 技能同步（已执行，格式兼容零转换）**：`~/.trae-cn/skills/*`（18 个）→ `~/.dsh/skills/`（用户级）；仓库 `.trae/skills/*`（6 个）→ `.dsh/skills/`（项目级）。新增 Trae 技能后重跑复制即可。
- **DSH Web 客户端插件（conversation node）**：需从 DSH 源码构建才可加载，npx 安装方式下不可用，留待源码部署时再做。
- **密码库**：零知识加密，不向 Agent 开放（SKILL.md 已声明边界）。
