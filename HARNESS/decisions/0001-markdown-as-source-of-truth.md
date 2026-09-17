---
type: adr
id: "0001"
title: "Markdown（HARNESS）作为人工/AI 文档真相源"
date: 2026-09-18 10:00
status: accepted
module:
commit: "-"
source: manual
tags:
  - adr
  - harness
  - source-of-truth
generated:
  by: manual
  at: 2026-09-18 10:00
sources:
  - "project_memory.md"
---

# 0001: Markdown（HARNESS）作为人工/AI 文档真相源

## 背景 Context

项目存在两套并行的"开发记录"：一套是仓库内的 `HARNESS/` 下的 md 档案（devlog/bugs/decisions），另一套是后端写入的 `feature-point-iterations.json`（服务于产品概览页的会话归档展示）。二者记录的是同一批开发活动，但来源、存储、可读性不同，存在"两条线对不齐"的风险。

## 决策 Decision

**以 `HARNESS/` 下的 Markdown 为人工/AI 的文档真相源；后端 `feature-point-iterations.json` 只服务产品概览展示。** 两者并行、不同步、不互相派生；若对不上，一律以 md 为准（人改记录改 md）。

## 后果 / 权衡 Consequences

- 正面：md 进 Git 留痕、AI 与人可读、可回链 commit/文件，是真正可审计的决策记忆。
- 负面：两套记录短期可能不一致，需靠 `harness-audit.cjs` 与书写纪律兜底。

## 备选 Alternative

- 仅依赖后端 JSON：被否——不进仓库、非 md、AI 无法当文档读，属于"主动失忆"。
- 从 md 反向派生 JSON / 产品概览直接读 md：留作未来演进（本期不做，见统一方案 Future）。

## 关联

- 相关方案：`.trae/documents/harness-开发闭环统一方案.md`
- 相关记录：`HARNESS/devlog/2026/2026-09-16-harness-layer.md`