---
type: adr
id: "0004"
title: "借鉴 Jev 思想的置信度门控/结构化决策——评估后暂缓"
date: 2026-09-18
status: accepted
module:
commit: "-"
source: manual
tags:
  - adr
  - llm
  - decision
  - confidence-gating
  - jev
generated:
  by: manual
  at: 2026-09-18 15:30
sources:
  - "agent.md"
  - ".trae/documents/Jev文章×HARNESS-关系分析优化设计.md"
---

# 0004: 借鉴 Jev 思想的置信度门控/结构化决策——评估后暂缓

## 背景 Context

阅读文章《AI 圈爆火的 Jev 是什么？如何在 TraeCode 中使用》后，梳理了 Jev（TypeSafe AI 的 System One 决策模型：Noul / Choice / Score 三种原语，输出校准概率）与项目的关系。项目现状：已有双档位模型路由（simple=flash / strong=pro）、连续失败熔断（threshold=5 / cooldown 5min）、多 provider 降级（custom → deepseek → dashscope），但缺乏置信度、低置信兜底、结构化决策。

设计草案提出四个优化方向：P1 结构化决策+置信度、P2 置信度门控路由、P3 风险门控、P4 轻量判断原语。

## 决策 Decision

**采纳 Jev 的设计思想（决策应附带置信度、判断应有兜底），但本阶段不实施 P1-P3，不接入 Jev 服务。**

理由（内部 AI 与 DSH 两侧评估后均不适用）：
- **内部 AI 决策点稀疏且低频**：现有任务绝大多数是"生成内容"（摘要/标签/发散总结/知识补充/回答合成/编辑补全），真正的决策点仅剪藏归类、Wiki 定位等少数低频场景，Jev 的价值（毫秒级、便宜到可随意调用）无从发挥。
- **单用户本地工具，风险门控收益最低**：P3 针对"批量删除/覆盖"的保护收益低，用户即最终决策者，且有 Git 同步/本地文件兜底。
- **自报置信度不可靠**：文章明确大模型"过度自信"（说 99% 确定但答案是错的），LLM 自报 confidence 非校准概率，用作硬门控风险高。
- **成本不对称**：为低频决策点引入"置信度+门控+升级路由"整套逻辑，维护成本大于收益，违背"轻量、快速、低占用、核心功能优先"原则。
- **DSH 侧不重复造轮子**：DSH 是通用 AI 干活 agent，工具选择/风险门控属其自身生态（skills/MCP）范畴，剪藏侧不为其再造一套体系。文章 "Harness"（执行框架）与本软件 `HARNESS/`（开发档案层）概念不同，禁止混用。

## 后果 / 权衡 Consequences

- 正面：不产生沉没代码；决策边界写入档案，后人不会再重复评估同一问题。
- 负面：短期缺少"低置信兜底"，个别判断类任务仍靠正则解析；未来若引入高频自动决策场景需重开评估。

## 备选 Alternative

- P1-P3 全部实施：被否——决策点稀疏低频，维护成本大于收益。
- 仅实施 P3 风险门控：被否——单用户本地工具收益最低。
- 接入 Jev 服务：被否——waitlist-only、社区未生产验证、离线/本地优先定位冲突。

## 触发条件（何时重启）

- 出现**高频自动决策**场景（如批量智能整理、自动路由大量待办）。
- 有自托管/离线可用的"低成本判断模型"（真 Jev 或等效方案）。
- 判断类任务数量增长到"正则解析撑不住、需要结构化输出+置信度"的程度。

## 关联

- 相关代码（评估对象）：`backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java`
- 相关条约：`agent.md` 「回答范式」、`agent.md` 「LLM 提供者」
- 相关记录：`HARNESS/devlog/2026/2026-09-18-jev-decision-p1-p3-evaluation.md`
- 相关文档：`.trae/documents/Jev文章×HARNESS-关系分析优化设计.md`