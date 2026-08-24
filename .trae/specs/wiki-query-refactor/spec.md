# Wiki 查询链路重构 Spec

> 本文档整合自多轮产品讨论与代码调研：
> 1. 「调研 Wiki 知识库使用逻辑」调研结论与设计方向分析
> 2. 「单个问题消耗 5596 token 是否过多」的成本与 token 构成分析
> 3. 「设计页面支持多模型能力配置 + 优先级序号」的档位路由需求
> 4. 「本地拆词 grep + RAG 是否必要」的检索层设计需求
> 5. 「wiki 搜索是否只对 Web Clipper 生效，可否纳入剪藏/知识」的多数据源需求

## Why — 背景与动机

### 1. 已修复的前置问题（不在本次范围内，仅作背景）

| 问题 | 根因 | 状态 |
|---|---|---|
| Wiki 查询 HTTP 504 + ClientAbortException | Electron 代理对非流式 `/api/*` 请求 30s 超时，而 query 为两段同步 LLM 调用 | 已修复（`/api/wiki/query` 加入无超时列表） |
| 剪藏列表渲染失败（Long 反序列化 UUID） | JSON 数据中存在 UUID 字符串 id，批量 `convertValue` 整体失败 | 已修复（`readClipArrayFromFile` 逐元素跳过无效条目） |

### 2. 本次重构的三个动机

**动机 A — 模型路由"名不副实"，承诺的省成本策略未落地**

- Spec（`llm-wiki-product-direction`）明确承诺：简单任务用便宜模型（DeepSeek），综合分析用强模型（Qwen-Max），可降低 50% 成本。
- 实际代码：`wiki.extraction-model` / `wiki.synthesis-model` 配置项**无任何调用方**；`AiService` 全部 8 个 Wiki 方法均走 `llmProvider.chat(systemPrompt, userMessage)`，由全局 `activeProvider` 单选决定，**阶段 1（定位）与阶段 2（综合）用同一个模型**。
- 用户诉求：设置页支持配置多模型能力，增加优先级/能力档位（越前越简单），让任务按能力自动选模型。

**动机 B — 查询全量塞 index 进 prompt，随规模增长不可持续**

- 当前 50 页 / index 6~10KB（约 3k tokens），塞 prompt 无压力；线性外推 1000 页 ≈ 150~200KB（~50k tokens），逼近上下文上限。
- 现有 `SearchService`（剪藏）与 `KnowledgeService`（知识）均已证明"内存 contains + AI 兜底"是本项目已验证的检索范式，零新依赖即可复用到 wiki 定位。
- 本地拆词召回可替代/前置阶段 1 的 LLM 定位：命中时省一次 LLM 调用，语义问题自动降级回 LLM 保证命中率。

**动机 C — 查询数据源单一，无法利用应用内剪藏与知识**

- 当前查询只读 `wiki/` 页面（来源：Web Clipper → sources → ingest），应用内手动剪藏（`clip-storage/`）与知识条目（`clip-storage/knowledge/`）不在查询范围内。
- 用户诉求：增加开关配置，查询时可纳入剪藏、知识的内容作答。

### 3. 设计原则

- **省 token 优先**：新增能力必须可配置、默认保守（本地检索默认开但只作为 LLM 的前置；多数据源默认关）。
- **零新依赖**：拆词检索用 JDK 原生实现（英文空格词 + 中文 2-gram），不引入分词库/向量库。
- **对现有行为零破坏**：开关关闭时与重构前行为完全一致；模型档位默认值（simple=deepseek, strong=dashscope）兼容现有 single-provider 用户。
- **保留降级链路**：所有新增 AI 调用路径保留原有 fallback 与失败降级。

## What — 目标

### R1 模型档位路由（对应动机 A）

- 新增"任务档位（tier）"概念：`simple`（便宜模型，用于结构化/定位/抽取类任务）、`strong`（强模型，用于综合/矛盾判断类任务）。
- `ModelConfig` / `AppConfig` 新增两个配置字段：`simpleTierProvider`（默认 `deepseek`）、`strongTierProvider`（默认 `dashscope`）。
- `LlmProvider` 接口新增默认方法 `chatForTier(systemPrompt, userMessage, tier)`，`RoutingLlmProvider` 覆盖实现按档位路由（沿用现有 fallback 链）。
- `AiService` 的 8 个 Wiki 方法按任务类型标注档位并改调 `chatForTier`。
- 设置页「AI 模型配置」区新增「简单任务模型」「强任务模型」两个下拉（dashscope/deepseek/custom）。

### R2 本地拆词检索前置层（对应动机 B）

- 新增 `WikiLocalRetriever`：对 `index.md` 条目（页面名 + 摘要）做拆词打分，返回 Top N 页面名及是否达标。
- `WikiQueryService.query` 集成：本地命中（达标）→ 直接用本地结果作为相关页面（**跳过阶段 1 的 LLM 调用**）；未命中 → 降级走 `locateRelevantPages`（现状不变）。
- 配置开关：`wiki.query-local-retrieval-enabled`（默认 `true`）、`wiki.query-local-retrieval-top-k`（默认 5）、`wiki.query-local-retrieval-min-hits`（默认 2）。

### R3 查询多数据源开关（对应动机 C）

- `WikiConfig` 新增：`query-include-clips`（默认 false）、`query-include-knowledge`（默认 false）、`query-extra-top-k`（默认 5）、`query-extra-max-chars`（默认 800）。
- `WikiQueryService.query` 新增可选参数 `includeClips` / `includeKnowledge`（请求体覆盖，未传则用配置值），注入 `SearchService` 与 `KnowledgeService` 检索并拼入上下文。
- 剪藏/知识内容以伪页面形式（key 前缀 `[剪藏] xxx` / `[知识] xxx`）混入 `pageContents`，`synthesizeAnswer` 无需改动。
- 返回结构新增 `extraSources`（各来源条数统计），前端展示来源标签。
- `wiki.html` 查询面板新增「纳入剪藏」「纳入知识」两个 checkbox。

## How — 设计

### 3.1 数据结构变更

```java
// ModelConfig / AppConfig 新增
private String simpleTierProvider = "deepseek";   // 简单任务档位使用的 provider key
private String strongTierProvider = "dashscope";  // 强任务档位使用的 provider key

// WikiConfig 新增（R2）
private boolean queryLocalRetrievalEnabled = true;
private int queryLocalRetrievalTopK = 5;
private int queryLocalRetrievalMinHits = 2;

// WikiConfig 新增（R3）
private boolean queryIncludeClips = false;
private boolean queryIncludeKnowledge = false;
private int queryExtraTopK = 5;
private int queryExtraMaxChars = 800;
```

### 3.2 接口变更

```java
// LlmProvider 新增默认方法（现有实现类零改动）
default String chatForTier(String systemPrompt, String userMessage, String tier) {
    return chat(systemPrompt, userMessage);
}
```

### 3.3 流程变更

**查询流程（重构后）**

```
POST /api/wiki/query {question, includeClips?, includeKnowledge?}
  ├─ 1. 读 index.md
  ├─ 2. 【R2】本地拆词检索 index 条目
  │        ├─ 命中（hits ≥ min-hits）→ relevantPageNames = 本地结果（跳过 LLM）
  │        └─ 未命中 → locateRelevantPages（LLM 兜底，现状不变）
  ├─ 3. 读相关页面内容
  ├─ 3.5 【R3】按开关检索剪藏/知识，拼入 pageContents（带 [来源] 前缀，截断）
  ├─ 4. synthesizeAnswer(question, pageContents)（STRONG 档模型）
  └─ 5. 返回 + extraSources 统计
```

**档位分配**

| AI 方法 | 档位 | 理由 |
|---|---|---|
| `locateRelevantPages` | simple | index 定位是结构化任务 |
| `batchExtractEntitiesAndConcepts` | simple | 批量实体/概念抽取 |
| `generateEntityPage` / `generateConceptPage` / `generateSourcePage` | simple | 页面生成 |
| `lintWikiPages` | simple | 规则化扫描 |
| `detectContradiction` | strong | 需要事实判断力 |
| `synthesizeAnswer` | strong | 核心输出质量 |

### 3.4 拆词算法（WikiLocalRetriever）

```java
// 英文：按空白拆词并小写；中文：连续 CJK 字符段按 2-gram 切分
// 打分：对 index 每个条目（页面名 + 摘要拼接），统计 question 分词命中数
// 达标：命中数 ≥ min-hits（默认 2）；取 Top K（默认 5），按命中数倒序
```

## 不做的功能

| 功能 | 原因 |
|---|---|
| 完整 provider 列表管理 UI（可增删多行 + 拖拽排序） | 档位路由分两步走，本轮为第一步（两档配置）；列表管理为第二步 |
| 向量数据库 / Embedding RAG | spec 既有决策明确排除，本地拆词检索已覆盖中等规模需求 |
| 自动攒批触发 / ingest 异步进度 | 属于入库链路，与本查询链路重构独立，另行立项 |
| `listMarkdownFiles` 改递归（嵌套目录页面） | 属于既有缺陷修复，避免范围蔓延，列入后续 |
| 多 provider 同档并行/权重 | 本轮档位内仅取第一个可用 provider + 现有 fallback 链 |

## 验收标准

1. 档位路由：simple/strong 配置不同 provider 时，`locateRelevantPages` 走 simple 配置的 provider，`synthesizeAnswer` 走 strong 配置的 provider（日志 `[LLM] Routing tier=...` 可验证）；未配置时降级行为与重构前一致。
2. 本地检索：本地命中场景不触发阶段 1 LLM 调用（日志/耗时可验证）；抽象问题（如"两者区别"）能正确降级走 LLM。
3. 多数据源：开启 `includeClips` 后，命中剪藏被拼入上下文且答案可引用；关闭时行为与重构前完全一致；返回 `extraSources`。
4. 前端：设置页两个档位下拉可保存并持久化；wiki 查询页两个 checkbox 生效。
5. 全部变更编译通过（`mvn compile`），现有测试不回归。
6. 默认配置下（档位默认值、开关默认值）用户无感升级。

## 相关文档

- 产品方向规格：[`llm-wiki-product-direction/spec.md`](../../llm-wiki-product-direction/spec.md)
- 现状说明：[`wiki-module-current-state.md`](../../documents/wiki-module-current-state.md)
- 实施计划：[`docs/superpowers/plans/2026-08-11-wiki-query-refactor.md`](../../../docs/superpowers/plans/2026-08-11-wiki-query-refactor.md)
