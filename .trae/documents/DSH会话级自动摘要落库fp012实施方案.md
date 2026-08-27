# DSH 会话成果自动归档产品概览 —— 最终方案（fp-012，定稿）

## 0. 一句话定案

DSH 插件监听 `session/event` 的 `turn/end` 事件，回合结束时**自动**把本轮 AI 工作的成果（干了什么 / 解决什么问题 / 如何解决 / 大白话产出）归档进**工作台产品概览的迭代记录**，不再落剪藏/待办；后端 AI 负责把会话内容提炼成这四个字段。

## 1. 可行性验证结论（已实测源码，非猜测）

证据（本机 DSH 0.1.0-rc.7 安装包源码）：

| 能力 | 证据 | 结论 |
|---|---|---|
| 插件可订阅事件 | [dsh-agent-loop/lib/index.js#L48](file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L48-L49)：官方插件自身用 `ctx.on("session/event", (subject, event) => …)` | ✅ `ctx.on` 可行（Cordis 上下文） |
| "回合结束"必有信号 | 同上 [#L592-L595](file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js#L592-L595)：`session.append("turn/end", { turn, reason })` 在 finally 中保证执行。**实测枚举 reason.kind ∈ completed / blocked / aborted / error / max-tokens / interrupted（崩溃合成）——源码中不存在 "final"** | ✅ 触发点确定：`event.type === "turn/end" && reason.kind === "completed"`（正常收尾） |
| 能取本轮内容 | [dsh-session/lib/index.js#L1095-L1096](file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-session/lib/index.js#L1095-L1096)：`turn/start`、`turn/end`、`user/message`、`assistant/message`、`tool/call`、`tool/result` 均为 append-only 会话事件，`data.turn` 可筛本轮；`session.events` 可直接读 | ✅ 聚合一回合消息可行 |
| 产出信号可判 | `tool/call` 事件记录本轮调用的工具名。**实测 data = `{ turn, step, callId, name, arguments }`，工具名在 `data.name`（不是 `data.block.name`）** | ✅ 可用"本轮是否调用过工具"作守卫 |

## 1.0-bis 运行时实证（2026-08-27，真实内核验证，非静态分析）

除源码证据外，另写运行时实证脚本 [verify-events.mjs](file:///L:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/integrations/dsh/plugins/clip-capture/verify-events.mjs)，直接加载本机 DSH 0.1.0-rc.7 安装包内**真实的 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-session` 代码**（零 mock），走真实事件总线，7 项断言全部 PASS：

| 断言 | 结果 |
|---|---|
| `ctx.on("session/event")` 在 root ctx 订阅能收到会话广播 | ✅（收到 2 条） |
| 收到 `turn/end` 事件 | ✅ |
| `turn/end.data = { turn: 1, reason: { kind: "completed" } }` | ✅ kind=completed |
| 回调签名 `(subject, event)`：第一参数即 session，`subject.id` 可读 | ✅ |
| `subject.events` 可读且可按 `ev.data?.turn` 聚合本轮（自动归档聚合所需全部 API） | ✅ |
| `turn/start` 同样广播（回合生命周期完整） | ✅ |
| 传播不依赖特殊作用域：SessionStore.enter 后广播走共享事件总线，root 订阅即可收全 | ✅ |

> 旁证：广播实现 `collectSessionCallbacks` 直接复用 Cordis 标准 `dispatch`（dsh-session #L1279-L1281），官方插件 dsh-agent-loop 亦以同款 `ctx.on("session/event", (subject, event))` 订阅并自过滤（其源码 #L48）。**结论：`ctx.on(…)` 订阅方案可行，按本方案实施。**
>
> 小提醒（不影响插件）：`assistant/message` 等 surface 事件由 agent-loop 带 `{ surfaceOp: "append" }` 选项写入；插件是纯订阅方、只读 `session.events`，无需关注该选项。

## 1.1 事件 data 结构（0.1.0-rc.7 源码实测）

| 事件 | data |
|---|---|
| `turn/start` / `turn/end` | `{ turn }`；turn/end 多 `reason: { kind }` |
| `user/message` | 即 message 对象（含 `content[]`） |
| `assistant/message` | `{ turn, step, message, usage? }` |
| `tool/call` | `{ turn, step, callId, name, arguments }` |
| `tool/result` | `{ turn, step, message, error? }` |

`session.events`（getter，[dsh-session #L1398](file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-session/lib/index.js#L1398-L1399)）返回冻结快照数组，按 `ev.data?.turn === turn` 即可聚合本轮。

## 2. 数据流向（定稿）

```
DSH 回合结束 (turn/end, reason=completed)
  → clip-capture 插件监听 session/event
  → 守卫：本轮有"产出信号"才继续（调用过写工具：clip_add/todo_add/…，或本轮消息量达阈值）
  → 聚合本轮 user/assistant 消息文本
  → POST /api/workspace/feature-points/iterations/ai-session  { conversation, project }
  → 后端 AI（复用生成摘要管线，小模型一次调用）提炼 { title, problem, solution, outcome }
  → 写入迭代记录文件 feature-point-iterations.json（source=dsh-session）
  → 产品概览时间线渲染「AI 干活记录」卡片
```

**显式路径保留**：`clip_session` 工具改为归档工具（Agent 主动调用，自己给四字段，不走 AI 提炼），与自动路径写同一迭代记录表。

## 3. Proposed Changes

### 3.1 后端

**文件**：`backend/src/main/java/com/example/clip/service/FeaturePointIterationService.java`
- `add()` 记录结构扩展字段：`title`（干了什么）、`problem`（解决什么问题）、`solution`（如何解决）、`outcome`（大白话产出）、`source`（默认 `manual`，AI 会话为 `dsh-session`）。旧记录无此字段，前端需容错。
- 新增 `addAiSession(project, conversation)`：调用 AI 提炼四字段 → `add()` 落库（具体 AI 调用方式实现时参考现有 `ClipService` 摘要/分析链路的 `PromptConfigService`/目标模型，用 flash 小模型一次调用）。

**文件**：`backend/src/main/java/com/example/clip/controller/WorkspaceController.java`
- 在迭代记录接口组（现有 `/api/workspace/feature-points/iterations`，`#L1059` 附近）新增端点 `POST /api/workspace/feature-points/iterations/ai-session`：入参 `{ conversation: string, project?: string }`；返回 `{ id, title, problem, solution, outcome, source }`。失败不阻断，返回 200 + 兜底四字段（title=「AI 干活记录」，outcome=截断输入）。

### 3.2 DSH 插件（clip-capture）

**文件**：`integrations/dsh/plugins/clip-capture/index.mjs`
- 保留并改造 `clip_session` 工具：参数改为 `project/title/problem/solution/outcome/tags`（可选参数，Agent 显式归档用），落点改为 `POST /api/workspace/feature-points/iterations/ai-session`。`inject` 增加 `session`（如需直读会话对象）。
- 新增自动监听（`config.autoArchive !== false` 默认开）：
  ```js
  ctx.on("session/event", (subject, event) => {
    if (event.type !== "turn/end") return;
    if (event.data?.reason?.kind !== "completed") return; // 实测枚举无 "final"
    // 1) 用 subject.events 聚合本轮 events（ev.data.turn === event.data.turn）
    //    tool/call 工具名取 ev.data.name
    // 2) 守卫：本轮有产出信号（tool/call 含工具，或文本量达阈值）
    // 3) 只对最近归档过的不重复归档（turn 号单调递增去重）
    // 4) 异步 POST 后端（失败仅 console.warn，绝不 throw 干扰 DSH）
  });
  ```
- 输出与错误处理保持现有 `callApi` 风格，不新增外部依赖。

### 3.3 前端（workspace 产品概览）

**文件**：`frontend/js/workspace.js`（产品概览区块 `#L2004` 起，迭代记录渲染已存在）
- 迭代记录卡片/时间线渲染扩展：`title/problem/solution/outcome` 四个字段如实展示（有则显示；旧记录仅 `note` 照旧），`source=dsh-session` 打「AI 干活」标记 + 可筛选。
- 无四字段的旧记录按原样式渲染，不做破坏性改动。

**文件**：`frontend/styles/`（workspace 样式文件）补「AI 干活记录」卡片样式（若有单独样式文件，按现有工作台风格内联）。

### 3.4 技能包与文档
- `integrations/dsh/skills/cut-shelter/SKILL.md`：`clip_session` 工具说明改为"归档会话成果到产品概览（四字段）"；约定"干完活必须归档或由自动归档兜底"。
- `integrations/dsh/README.md`：Phase 1 段将"会话成果落库（剪藏）"叙述更新为"会话成果自动归档产品概览 + 可保留剪藏"。
- `TODO/DSH（DeepSeek Harness）集成/feature-points.json`：fp-012 状态置为已实施（任务/验证 status 改 done），并更新描述与 knowledgePoints。
- `docs/DSH体验测试指南.md`：新增场景 E（自动归档四字段）。

## 4. Assumptions & Decisions
- **决策**：自动归档默认开、产出信号守卫、四字段由后端 AI 提炼、显式与自动同源去重；不新增后端 LLM 之外的依赖。
- **保留**：旧 `clip_session`（落剪藏）语义由新"归归档产品概览"替代；如需保留"落剪藏"作为显式可选，用 `clip_add` 即可（发现剪藏无意义则不保留）。

## 5. Verification
0. **（已完成 ✅）** 运行时实证：`node integrations/dsh/plugins/clip-capture/verify-events.mjs` —— 用真实 cordis + dsh-session 内核验证 `ctx.on("session/event")` 可订阅 `turn/end`（7 项断言 PASS）。
1. 后端：`mvn -DskipTests compile` 通过；`curl POST /api/workspace/feature-points/iterations/ai-session -d '{"conversation":"..."}'` 返回四字段，且 `/api/workspace/feature-points/iterations` 可见。
2. 插件：`node --check integrations/dsh/plugins/clip-capture/index.mjs`；`node test-plugin.mjs`（如测试覆盖归档路径需同步更新断言）。
3. 端到端（场景 E）：启动 DSH + 后端 → 对话完成一轮（有产出，如 `clip_add`）→ **无需 Agent 显式调用** → 产品概览出现 source=dsh-session 的迭代记录，四字段渲染正确；纯闲聊轮不产生记录。
4. 旧数据兼容：feature-point-iterations.json 中旧记录（仅 note）仍正常渲染。
5. 语法：`node --check electron/main.js`、`frontend/js/workspace.js`。

### 5.1 自动化回归（新增，`mvn test` + 两个 node 脚本）

| 套件 | 命令 | 覆盖 |
|---|---|---|
| 后端端点单测 | `mvn test -Dtest=WorkspaceControllerAiSessionTest` | AI 提炼成功四字段/失败兜底（title=AI 干活记录+outcome 截断）/空 conversation=400；全量 `mvn test` 126 用例无回归 |
| 插件自动归档 | `node integrations/dsh/plugins/clip-capture/test-auto-archive.mjs`（**无需后端**，stub fetch） | completed+工具产出触发聚合、blocked/闲聊不触发、显式 clip_session 抑制、同 turn 幂等去重、多轮不污染 |
| 插件显式归档 | `node test-plugin.mjs`（需后端 8081） | clip_session 工具注册/参数/端到端落库 source=dsh-agent + 清理 |

> 自动归档测试暴露并已修复一处真实缺陷：`user/message` 事件 data 是纯 message 对象、**不带 turn 字段**（agent-loop 用 `session.append("user/message", message)`），原 `ev.data.turn === turn` 过滤会把用户消息全部丢掉。已改为按 `[turn/start, turn/end)` 事件区间聚合（index.mjs `aggregateTurn`），历史轮不污染本轮。