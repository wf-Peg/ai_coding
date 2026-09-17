---
type: devlog
id: "DEV-2026-09-18-001"
title: "补齐 HARNESS 当前真相层与决策记忆"
date: 2026-09-18 10:00
status: closed
module: tools
commit: "-"
source: trae-session
tags:
  - harness
  - roadmap
  - adr
  - distil
generated:
  by: harness-archive
  at: 2026-09-18 10:00
sources:
  - "HARNESS/roadmap.md"
  - "HARNESS/decisions/"
---

# 补齐 HARNESS 当前真相层与决策记忆

## 一句话

HARNESS 从「档案室」补成「大脑」

## 问题（解决什么）

HARNESS 只有「时间线」那一半（devlog 流水账 + 空模板），缺了「当前真相」（compiled_truth）那一半：`roadmap.md` 三节全空白、`decisions/` 只有占位示例。等于只有日记、没有当前结论——正是「上下文失忆」在项目里的表现。

## 怎么解决的

借文章《当代码实现不再是瓶颈》的「决策记忆 / Project Brain」思想，三步补齐：
1. 激活 `roadmap.md` 为「当前真相」根页面，用 devlog / TODO / 记忆材料回填 Done/Current/Future，并加「有意识地移动」维护纪律。
2. 给 `harness-archive` skill 补「Distill」环节：方向/架构/状态级改动同步 roadmap，被采纳的取舍补 ADR。
3. 把 memory 里的三条架构级约束显性化为真实 ADR（0001 md 真相源 / 0002 双模型分工 / 0003 DSH 手动升级）。

## 产出 / 结果

- `roadmap.md` 三节回填完成；`decisions/` 新增 3 篇真实 ADR 并更新 `_index.md`；`harness-archive` 补 Distill 环节。
- 纯文档/约定层演进，零产品代码改动。

## 关联

- commit：`-`（纯文档演进，未提交）
- 相关文件：`HARNESS/roadmap.md`、`HARNESS/decisions/0001~0003-*.md`、`HARNESS/decisions/_index.md`、`.trae/skills/harness-archive/SKILL.md`