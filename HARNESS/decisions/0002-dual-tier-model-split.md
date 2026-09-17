---
type: adr
id: "0002"
title: "双模型档位分工（简单/强任务）"
date: 2026-09-18 10:00
status: accepted
module:
commit: "-"
source: manual
tags:
  - adr
  - llm
  - model-tier
generated:
  by: manual
  at: 2026-09-18 10:00
sources:
  - "project_memory.md"
---

# 0002: 双模型档位分工（简单/强任务）

## 背景 Context

AI 任务复杂度差异大：剪藏处理、Wiki 页面定位、实体抽取等高频轻任务与答案综合、矛盾检测、知识补充等深度推理任务，若统一用最强模型，成本与延迟都高；若统一用弱模型，强任务质量不足。

## 决策 Decision

按任务档位分派模型：
- **强任务（deepseek-v4-pro）**：`synthesizeAnswer`、`detectContradiction`、`generateKnowledgeSupplement`。
- **简单任务（deepseek-v4-flash）**：剪藏处理、Wiki 页面定位、实体抽取及绝大多数其他 AI 任务。

## 后果 / 权衡 Consequences

- 正面：高频任务低成本低延迟，深度任务保质量。
- 负面：需在 `PromptConfigService` / 路由层维护档位映射，新增 AI 任务时要判断归属档位。

## 备选 Alternative

- 全用强模型：被否——成本/延迟不经济，违背"优先轻量、低占用"。
- 全用弱模型：被否——强任务质量不可接受。

## 关联

- 相关配置：`AppConfig` 的 `simpleTierModel` / `strongTierModel`
- 相关代码：`backend/src/main/java/com/example/clip/core/`（RoutingLlmProvider / AiService）