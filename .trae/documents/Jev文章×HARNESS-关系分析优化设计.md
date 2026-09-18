# Jev（System One）文章 × 剪藏 HARNESS：关系深度分析 + 落地优化设计

## 一、任务与交付物

用户要求：
1. **深度分析**文章（AI 圈爆火的 Jev）与本软件 HARNESS 的关系
2. **设计优化**（把 Jev 思想落进本软件可执行的优化方向）
3. **「先大白话输出，后详细说明」作为每次提问后的回答范式**，同步到 `agent.md`
4. 全程「先大白话、后详细」，本计划文档的处理顺序与 `agent.md` 段落均遵循该范式

交付物：本计划文档（含三类内容）+ `agent.md` 追加「回答范式」小节。

---

## 二、大白话版（先读这段）

### 文章到底讲了啥？
有个叫 **Jev** 的 AI，**不会聊天、只做判断**。你问它一句话，它不回作文，回一个数字/选项/评分，比如"这条工单紧急吗？92% 紧急"。它又快（毫秒级）、又便宜、还能告诉你"它有多确定"。

它解决的是软件里 AI 的痛点：普通大模型写一堆文字让程序去抠结论，又慢又容易抠错，还不清楚自己会错。Jev 干脆不写文字，专做"判断"这一件事。

它有三种用法：**Noul（是/否）、Choice（多选一、带概率）、Score（打分、带置信度）**。

### 和我们的 HARNESS 有啥关系？
这里**先澄清一个大坑**：文章说的 "Harness" 和咱们的 "HARNESS" **根本不是一回事**：
- **文章里的 Harness** = AI 的执行框架（模型路由、工具选择、风险门控那些"决策点"，比如 LangChain 的 Jev Harness、Jev-router 做模型路由）。
- **咱们的 HARNESS** = 开发过程的档案层（devlog / bug / ADR / roadmap 那套 md 记录）。

所以不能混谈。**真正和文章有关系的是咱们的 `RoutingLlmProvider`（模型路由）这类代码**，不是 `HARNESS/` 文件夹。

### 咱们现在做到哪、缺哪？
**已有**（和 Jev 同源的思路）：
- 双档位模型路由（simple=flash / strong=pro）
- 失败熔断（连续失败 5 次冷却 5 分钟）
- 多 provider 自动降级（custom → deepseek → dashscope）

**缺 Jev 的**（咱们从没做过的核心理念）：
1. **没有"置信度"**：模型说"99%确定"但我们不知道它真有多确定，出错只能靠人发现。
2. **没有"低置信兜底"**：不知道啥时候该转人工/转更强模型。
3. **没有"结构化决策"**：判断仍是"让大模型写段话"，靠正则/关键词去抠，又慢又脆。
4. **没有"轻量判断原语"**：Noul/Choice/Score 这种"快且便宜"的决策没有；现在**任何**判断（哪怕只是"这条剪藏要不要收")都要走一次完整大模型。

### 一句话总结关系
> **文章的 Jev = 把"判断"从"写作文的大模型"里拆出来；咱们的 HARNESS 负责"记"，`RoutingLlmProvider` 负责"选"，但还缺一个"轻、快、带置信度、能兜底"的判断层。Jev 思想提示的下一步，就是补这个判断层。**

---

## 三、详细版（设计说明）

### 3.1 关系图谱（三层对照）

| 维度 | 文章（Jev/TypeSafe） | 本软件现状 | 结论 |
|---|---|---|---|
| 决策模型 | 专门的 System One 模型（不生成文本） | 无；判断全走通用大模型 `llm.chat()` | **缺轻量判断层** |
| 输出形态 | 结构化 `{noul/choice/score, probabilities, confidence}` | 自由文本 → 正则/解析器抠 | **缺结构化决策原语** |
| 置信度 | 校准概率（0-1）+ confidence | 无；模型过度自信无法察觉 | **缺置信度/低置信兜底** |
| 路由 | Jev-router / ModelRouterMiddleware 按复杂度选模型 | `RoutingLlmProvider.chatForTier`（simple/strong）+ 熔断 | **有档位路由，但无"动态按需选档"** |
| 门控 | shell 命令概率门控、风险分级 | 无；高危操作无 AI 兜底 | **缺风险门控** |
| "Harness" | 执行框架（tool selection/continue/stop） | 咱们的 `HARNESS/` 是**档案层**，概念不同 | **警惕概念混用** |
| 归档/记忆 | 决策记忆 → 项目大脑 | `HARNESS/` devlog/ADR/roadmap（真相层） | **档案层已是强项** |

### 3.2 关键判断：Jev 本身是否要接入？

**结论：本阶段不建议直接接入 Jev 服务**（waitlist-only、美西、社区项目过新、非安全边界）。本文真正值得借鉴的是它的**设计思想**，而不是它的 API。落地方向分三层，从"靠 LLM 也能做"到"造轻量判断层"：

### 3.3 推荐的优化方向（按性价比排序，前 4 项可单独立项）

**P1｜结构化决策 + 置信度提示（最高性价比，纯 Prompt/解析层，零依赖）**
- 给现有"判断类"方法（如 `detectContradiction`、剪藏归类、Wiki 页面定位）统一加一个**信心入口**：在 system prompt 里要求输出 JSON `{decision, confidence(0-1), rationale}`，并对低 confidence（< 0.5）单独分支（转 strong 或转人工）。
- 文件：`backend/src/main/java/com/example/clip/core/AiService.java` 相关方法 + 相关 `PromptConfigService` 模板。

**P2｜置信度门控路由（confidence-gated routing）**
- 在 `RoutingLlmProvider` 之上加一层"先 simple 后按需升级"：让 flash 尝试判断，inline confidence 低则自动升级 pro（或标记兜底）。这正好接上文章"Jev 输出置信度→低置信转人工/重模型"的模式，但用现有双档位实现。
- 文件：`RoutingLlmProvider` / `ModelConfig` / 新增 `TierGate` 辅助。

**P3｜风险门控（高危操作 AI 判断）**
- 借鉴文章"shell 命令概率门控"：对剪藏的破坏性操作（批量删除、覆盖导出、清空）加一个"Noul 式"确认——超低置信才弹人工确认，置信高则放行。可用现有 LLM 走一次轻量判断（而非真 Jev）。
- 文件：前端删/清操作 + 后端一个 `RiskGateService`。

**P4｜先想后做：轻量判断原语抽象（Phase 1 不做，立旗）**
- 若 P1-P3 验证有效，再抽象一个 `DecisionPrimitive`（judge/classify/score 三种），统一 LLM 后端；将来要换真 Jev 只需替换该原语的 provider。
- 文件：`core/` 下新增 `DecisionService` 接口 + LLM 实现（占位，未来可切 Jev MCP）。

**暂缓（明确不做）**：直接安装 typesafe-ai/skills、接入 Jev MCP、把它当安全边界。
- 理由：waitlist、社区未生产验证、我们离线/本地优先定位，依赖远端需谨慎。

### 3.4 agent.md「回答范式」更新（本任务必做交付）

在 `agent.md` 的「Token 节省」之后新增一小节「回答范式」，内容：

```markdown
## 回答范式（先大白话，后详细）

AI 助手回答任意问题时，默认按「先大白话、后详细说明」组织输出：

1. **先大白话（2~4 句通俗比喻版）**：用最浅白的话讲清核心结论，让用户先秒懂"在说什么"。
2. **后详细说明（分层展开）**：大白话之后，再按需给出结构化、带文件/代码/依据的细节分析。
3. **长回答必加小标题**：`### 大白话版` 与 `### 详细版（分层）` 两段式；无必要的短回答可省。

这条不适用于纯指令式操作（如"提交"、"读文件"），只约束"解释/分析/设计讨论"类回答。
```

---

## 四、落实到 HARNESS 的档案更新（呼应不同概念）

- **ADR**：新增一篇 `0004-decision-primitive-and-confidence-gating.md`，记录"借鉴 Jev 思想落地置信度门控 + 结构化决策，但本阶段不接入 Jev 服务"的架构决策，并明确"文章Harness≠本软件HARNESS"的概念边界，防止后人混用。
- **devlog**：归档本次分析（module: backend / 决策层）。

---

## 五、验证步骤

1. `agent.md` 新增「回答范式」小节，段首含「先大白话，后详细说明」关键词。
2. P1-P3 以**独立子任务**验证：例如给 `detectContradiction` 加 confidence 输出后，单体测试断言低置信分支触发降级。
3. `RoutingLlmProvider` 单测覆盖"低置信→升级 pro"路径与现有熔断不冲突。
4. 后端 `mvn compile` 通过；回归熔断/降级既有用例不破坏。
5. 新增 ADR 0004 与 devlog 归档，`harness-audit` ERROR=0。

## 六、假设与决策

- **决策**：本阶段不接 Jev 服务，只借鉴设计思想（置信度门控、结构化决策、轻量判断原语），用现有 LLM 双档位实现。
- **决策**：P4 轻量原语抽象设为"Phase 1 不做"，避免过度设计；P1-P3 见效后再立。
- **决策**：文章 Harness 与本软件 HARNESS 概念不同，不混入现有档案层语义；Jev 思想的落地点在 `RoutingLlmProvider`/`AiService` 决策层，不在 `HARNESS/` 目录。
- **边界**：P1-P3 属"新增 AI 决策能力"，应在独立 TODO 需求目录立项，不拒绝既有功能。

## 相关文件

- `agent.md`（改：新增回答范式小节）
- 潜在（P1-P3）：`core/AiService.java`、`core/RoutingLlmProvider.java`、`ModelConfig`、`PromptConfigService` 模板、`RiskGateService`（新增）
- `HARNESS/decisions/0004-*.md`（新增 ADR）、`HARNESS/devlog/`（归档）