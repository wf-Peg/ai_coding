# KaaS（bybit-exchange/kaas）对比分析与借鉴建议

> 目标：读取 [KaaS (Knowledge-as-a-Service)](https://github.com/bybit-exchange/kaas) 源码文档，评估它与本软件（剪藏 CutShelter）的交集与可借鉴之处，并给出是否值得借鉴、借鉴什么的结论。

---

## 一、结论摘要

**强相关，高交集。** KaaS 与我们最核心的「知识编译 → Wiki 问答」能力处于**同一赛道**，而且本软件现有的 Wiki 模块本身就是一套「按 KaaS 思路手工重实现」的方案（代码里已明注 `借鉴 KaaS TRUNCATION_NOTE`）。

- 已经对齐、无需再借的：无向量 LLM 迭代检索、两步查询、页面分型（entity/concept/synthesis/source）、Wiki→Chat Q&A、MCP `ask` 暴露、多级模型路由。
- **值得借鉴但尚未做/未做透的（真正有增量价值）** 主要有 4 项，按性价比排序：
  1. **增量编译（内容校验和去重）** —— 省 Token/成本的头号优化。
  2. **LLM 连续失败熔断 + 任务重领** —— 防烧钱、防卡死。
  3. **Chat 答案「可核对引用」的 UI 强化**（点开原文、流式标注依据）。
  4. **多来源一键入库到 Wiki**（贴文本/文件/URL 直进编译管道）。
- 不适用/不建议照搬：Go+Python daemon 架构、Docker 部署、SQLite 任务队列、「岗位绑定」哲学。

---

## 二、KaaS 项目概述

- **定位**：Knowledge as a Service——把散乱笔记/文档/会议转写「编译」成可搜索、可问答的个人 Wiki。产物是**人类可读的 Markdown 文章树**，而不是黑箱向量库。
- **核心主张（反传统 RAG）**：不做「切块+向量」，而是 4 阶段 LLM 流水线蒸馏：**提取概念/实体/决策 → 分类归入文章 → 写入或合并 Markdown → 更新索引**；检索时读成篇文章，LLM 沿 master-index 选页，基于全文作答。
- **关键特性**：
  - 检索**无向量**：`master-index → LLM 选页 → 全文上下文`。
  - Chat 回答**带引用、可核对**：标出依据的 wiki 文章，可点开原文、可反驳（SSE 流式）。
  - 知识库**归用户**：产物就是磁盘上的纯 Markdown，可直接改、可 git diff。
  - **增量编译**：按内容校验和跳过已编译语料，加一篇文档只花一篇文档的钱。
  - 可靠性：extract 与 pipeline 并发、任务带**租约**（worker 挂掉可重领）、LLM 连续失败**熔断**。
  - 多来源：粘贴文本 / 上传文件 / 指向 URL。
  - MCP 接入：`ask(query, paths?, model?)` 暴露给任意 coding agent。
- **架构**：Web UI(React+Vite) + Go 后端 + Python AI daemon（Go spawn 常驻子进程）+ SQLite；Docker 单镜像。

---

## 三、与本软件的家底对照（交集点）

本软件已具备的、与 KaaS 同域的能力（通过读本仓库代码/设计文档确认）：

| KaaS 能力 | 本软件对应实现 | 对齐度 |
|---|---|---|
| 4 阶段 LLM 编译（提取→分类→写/合并→索引） | `BatchIngestService` 批量 AI 处理生成 entity/concept/synthesis/source 页面 | 已对齐 |
| 无向量 LLM 迭代检索 | `WikiQueryService`：本地拆词检索优先 + LLM `locateRelevantPages` 兜底 → 读相关页面全文 → 强模型 `synthesizeAnswer`（[WikiQueryService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/wiki/WikiQueryService.java)） | 已对齐 |
| master-index → 选页 | Wiki `index.md` + `WikiIndexService`；页面类型化目录 | 已对齐 |
| Chat 带引用可核对 | SSE 进度 + `relevantPages`/`pageContent` 透传 + `[[Wiki-Link]]` 引用 + 答案可归档为 synthesis 页 | 部分对齐（可核对 UI 偏弱，见 §5.3） |
| 产物为纯 Markdown | Wiki 页面即 `.md`，`ObsidianExportFormatter` 生成 frontmatter；剪藏 JSON 权威 + MD 视图 | 已对齐 |
| 模型分级路由 | `RoutingLlmProvider` 档位：`strong→deepseek-v4-pro`、`simple→deepseek-v4-flash` | 已对齐（对标 KaaS 的 `LLM_SUMMARIZE_MODEL`） |
| MCP `ask` 暴露知识库 | 已有 DSH/MCP 集成，MCP `wiki_ask` 存在（代码注释可见） | 已对齐 |
| 多来源（文本/文件/URL） | 剪藏多来源 + Web Clipper | 部分（URL/文件直进**Wiki 编译管道**的引导较弱，见 §5.4） |
| 增量编译（内容校验和） | **未见**（`wiki` 包中仅 `WikiLintService` 含哈希，非编译去重） | **差距（高价值）** |
| 任务租约 / 熔断 | 本地单机任务，**无熔断** | **差距（有价值）** |

已借鉴的**实证**：[WikiQueryService.java](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/wiki/WikiQueryService.java#L62-L67) 第 62-67 行注释明确 `借鉴 KaaS TRUNCATION_NOTE`（正文超检索预算 8000 字符截断并显式标注，防模型误判缺失）。

---

## 四、核心结论：到底有没有交集

**有，且是本软件目前最像"竞品对标"的一块。** KaaS 的主营（本地优先、LLM 驱动的知识编译、无向量检索、Wiki 问答、产物归用户、MCP 接入）与本软件的「Wiki 模块 + 知识库 + Wiki 问答 + 智能入库」几乎逐点重合。两者本质是**同一个产品理念的两套不同技术落地**：
- KaaS：Go+Python、任务队列、面向"岗位"组织知识、偏服务化/Docker。
- 本软件：Java 单进程、本地 JSON 优先 + Obsidian Vault、面向个人知识沉淀、桌面优先。

因此交集集中在**核心能力层**，而非架构/部署层。真正的借鉴价值来自弥补**本软件 Wiki 管道在成本控制与可靠性上的短板**，而非重复造轮子。

---

## 五、可借鉴之处（按性价比排序）

### 5.1 【高·成本优化】增量编译：内容校验和去重 ✅ 已实施
- **KaaS 做法**：编译按**内容校验和**增量进行，已编译过的语料不再重复付费/重编；加一篇文档只花一篇文档的钱。
- **本软件现状**：`wiki` 服务包内没有编译期的内容去重（仅 `WikiLintService` 用哈希做 lint 检测）。若 BatchIngest 每次都对语料全量重跑 LLM，会持续烧 Token。
- **借鉴落地**：对每条剪藏/文档计算内容哈希，与「已编译语料注册表」（本地 JSON，如 `wiki/.compiled.json` 或 frontmatter 里加 `compiledHash`）比对，命中即跳过 LLM 处理。需守住「文件为真、库为缓存」铁律——只是跳过 AI 重编，不删原始数据。
- **落地记录**：新增 `CompiledCorpusRegistry`（`wiki/.compiled.json` 指纹），`BatchIngestService` 按内容 checksum 去重；已验证同内容二次 ingest/quick → `dedupSkipped=1, pagesUpdated=0`。

### 5.2 【高·省成本+防卡死】LLM 连续失败熔断 ✅ 已实施
- **KaaS 做法**：LLM 连续失败触发**熔断**，不会一直烧钱；任务带**租约**，worker 挂掉手上活可被重新领取。
- **本软件现状**：单机任务，无熔断——某模型/Key 连续失败时会反复重试消耗额度并阻塞队列。
- **借鉴落地**：在 `RoutingLlmProvider`/`AiService` 加一个按模型档位的**连续失败计数器**，达到阈值（如 5 次）后暂停该档位调用 N 分钟并 Toast 提示，可手动复位。租约/重领对本软件单机场景价值低，可只做熔断，不做租约。
- **落地记录**：`RoutingLlmProvider` 内置熔断（threshold=5 / cooldown 300s），`LlmProviderConfig` 注入 `@Primary`；新增 `/api/breakers/llm` + `/reset` 端点。已验证 strong/simple 两档 `open=false` 正常态，reset 成功。

### 5.3 【中·体验】Chat 答案「可核对引用」UI 强化 ✅ 已实施
- **KaaS 做法**：每条回答标出依据的 wiki 文章，**可点开原文、并据此反驳**，SSE 流式。
- **本软件现状**：`WikiQueryService` 已透传 `relevantPages` + 页面片段 + `[[Wiki-Link]]` 引用，但前端「点开引用即跳原文、按引用质疑答案」的交互未完全打通（当前更偏"展示来源列表"而非"可点开/可反驳"）。
- **借鉴落地**：在 Wiki 问答结果渲染里，让每个 `[[页面]]` 引用**可点击跳转对应页面**，并提供一个「对某条引用纠错/追问」入口（复用现有对话上下文）。
- **落地记录**：新增 `openPageModal`/`makeRefsClickable`/`bindPageTags`/`bindRefActions`，引用与相关页标签均点开原文 modal（快速入库的 wiki.html 已含 `pageModal` + `openPageModal`）；每条引用附「追问/纠错」按钮复用问答上下文；后端 `GET /api/wiki/page?name=` 已通。

### 5.4 【中·入口】多来源直进 Wiki 编译管道 ✅ 已实施
- **KaaS 做法**：粘贴文本 / 上传文件 / 一个 URL，都可直接进入编译。
- **本软件现状**：剪藏多来源已具备，Web Clipper 也有；但「临时贴一段文本 / 拖一个文件 / 给一个 URL → 直接编进 Wiki」到 Wiki 编译管道的**显式入口较弱**。
- **借鉴落地**：在 Wiki/工具页加一个「快速入库」输入框（贴文本插入一条 source 页、或提交 URL 抓取后进 BatchIngest），复用现有批量入库链路。
- **落地记录**：wiki.html 新增「快速入库」卡片（`#quickIngestBtn`），调 `POST /api/wiki/ingest/quick`（`WikiIngestController`）；首传已成功生成 source 页（8 pages、2 entities、5 concepts），重复内容被去重，sources 与 `.compiled.json` 落盘。

### 5.5 【已对齐·无需再借】保持现状即可
- 无向量 LLM 迭代检索、两步查询、页面分型、MCP `ask`、模型档位路由、产物为 Markdown——本软件**已对齐**，不必照搬 KaaS 实现。

---

## 六、不适用 / 不建议借鉴

| KaaS 项 | 为什么不借 |
|---|---|
| Go + Python daemon 双进程架构 | 本软件为 Java 单进程桌面应用，拆分得不偿失 |
| Docker / 远程 streamable-http MCP | 本地优先 + 个人场景，stdio/本地 HTTP 已够用 |
| SQLite 任务队列 | 本软件约定"用文件、不用数据库"，队列由现有任务调度器承担 |
| 「绑定岗位而非个人」的知识沉淀哲学 | 本软件核心是**个人**知识沉淀（用户偏好），理念冲突 |
| MIT 代码/实现逐行移植 | 理念对齐已足够；直接搬 Go/Python 代码与本仓库 Java/无框架前端不符 |

---

## 七、建议的后续动作（供决策）

> ✅ **2026-09-16 已全部实施（用户指令「1-4都实施」）**，后端 + 前端均已落地并冒烟验证通过（见 §五 各节状态标注）。开发过程与验收一致，服务保持运行。

> 原始排期（作为历史背景）：

1. **[建议做] 增量编译（内容校验和）**（§5.1）——直接降低长期 Token 成本，与已有「省 token」红线一致。
2. **[建议做] 连续失败熔断**（§5.2）——防烧钱、防空转，纯后端小改动。
3. **[可选] Wiki 问答「可核对引用」UI 强化**（§5.3）——纯前端体验改进，中等改动量。
4. **[可选] Wiki「快速入库」多来源入口**（§5.4）——复用现有链路，入口增强。

每一项都可独立立项，走既有 TODO 规范（01 需求 → spec → tasks → checklist → 验收）。是否需要我针对其中 1-2 项展开详细的实现计划？

---

## 八、验证标准（若采纳任一借鉴项）

- **增量编译**：同一文档重复提交时，第二次无 LLM 调用、wiki 不重建；改内容后能被重编；原始数据不丢失。
- **熔断**：故意用无效 Key 连续触发 5 次后，该档位暂停调用并 Toast 提示；复位/切换 Key 后恢复。
- **可核对引用**：点击答案中 `[[页面]]` 能跳转对应 wiki 页；能针对引用发起追问。
- **快速入库**：贴文本/给 URL 后生成 source 页并进入批量编译；重复内容被去重。