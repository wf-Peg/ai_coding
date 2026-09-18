---
type: devlog
id: "DEV-2026-09-18-002"
title: "Jev 文章分析：置信度门控/结构化决策评估后暂缓"
date: 2026-09-18
status: closed
module: backend
commit: "-"
source: trae-session
tags:
  - llm
  - decision
  - confidence-gating
  - jev
  - adr
generated:
  by: harness-archive
  at: 2026-09-18 15:30
sources:
  - ".trae/documents/Jev文章×HARNESS-关系分析优化设计.md"
  - "HARNESS/decisions/0004-decision-confidence-gating-evaluated-not-adopted.md"
---

# Jev 文章分析：置信度门控/结构化决策评估后暂缓

## 一句话

看了篇爆文《AI 圈爆火的 Jev》，把它的"置信度决策"思想摸了一遍：咱们有双档位路由+熔断，但缺置信度和低置信兜底；评估后确认内部 AI 场景撑不起这套机制，暂时不做，只立档案。

## 问题（解决什么）

文章里的 Jev 是"不会聊天、只做判断"的 System One 模型（Noul/Choice/Score 三种原语，输出置信度）。深挖后发现一个概念坑：**文章 "Harness"（AI 执行框架）≠ 咱们 `HARNESS/`（开发档案层）**，不能混谈。真正的落地点是 `RoutingLlmProvider`（模型路由）这类代码，但评估后判断不适用。

## 怎么解决的

1. 澄清概念边界：文章 Harness = 执行框架；本软件 HARNESS = 档案层。
2. 提了 4 个优化方向（P1 结构化决策+置信度 / P2 置信度门控路由 / P3 风险门控 / P4 轻量判断原语），逐项评估。
3. 结论：内部 AI 决策点稀疏低频（摘要/标签等绝大多数是纯生成，冲突检测本质是生成式分析）、风险门控在单用户本地工具上收益最低、自报置信度不可靠不能当硬门控、DSH 是通用 agent 不属于剪藏侧范畴 → P1-P3 暂缓实施，不写代码。
4. `agent.md` 落地「回答范式」（先大白话后详细），`ADR 0004` 记录决策与重启条件。

## 产出 / 结果

- `agent.md` 新增「回答范式（先大白话，后详细）」小节。
- `HARNESS/decisions/0004-decision-confidence-gating-evaluated-not-adopted.md` 新增，记录决策、理由、备选与**触发重启条件**。
- P1-P3 不产生任何沉没代码。

## 关联

- commit：`-`（纯档案演进，未提交）
- ADR：`HARNESS/decisions/0004-decision-confidence-gating-evaluated-not-adopted.md`
- 相关文件：`agent.md`、`.trae/documents/Jev文章×HARNESS-关系分析优化设计.md`