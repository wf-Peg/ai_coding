---
name: trae-session-archive
description: TraeCode 归档收尾 — 完成一段编码/研发任务后，把本会话成果提炼为一条产品概览迭代记录（调用后端 /api/workspace/feature-points/iterations/ai-session，source=trae-session）。与 DSH clip-capture 复用同一条后端链，概览统一展示。
---

# TraeCode 归档收尾 Skill

## 概述

TraeCode 侧「归档收尾」：把一段有保留价值的编码/研发会话的需求 + 产出/决策提炼为紧凑的 `conversation` 文本，POST 给后端，由后端用强模型提炼四字段（title/problem/solution/outcome）并落为产品概览迭代记录。

**本 skill 是 TraeCode 侧归档的唯一事实来源**：既是「完成任务但暂不提交」时的手动归档入口，也是 `git-commit-workflow` 在**提交推送成功后自动归档所引用的共享规Ciform**（同 `source=trae-session`）。endpoint、字段、conversation 规范、source 约定一律以本 skill 为准，改动需在两端同步生效，不得另写第二份。

**注意**：本 skill 走「会话 → 迭代记录」新链路（`/api/workspace/feature-points/iterations/ai-session`），**不写 `TODO/{需求}/feature-points.json`**（旧 product-dev-archive 已降级为遗留）。

## 调用后端

```
POST /api/workspace/feature-points/iterations/ai-session
Content-Type: application/json
Body: {
  "conversation": "<本会话收紧Markdown提炼，≤3000字>",
  "project": "<可选>",                       // 关联的 TODO 需求目录名，无则省略
  "source": "trae-session"                   // 固定标识 TraeCode 来源
}
```

- 后端默认 `source=dsh-session`；必须显式传 `"source":"trae-session"`，前端才会以「TraeCode」徽标展示。
- 响应 `{id, source, title, problem, solution, outcome, createdAt}`，`source=="trae-session"` 即成功。

## conversation 提炼规范

- 内容 = 用户原始需求（一句）+ 本会话实际产出（改动/文件/接口）+ 关键决策（为什么这么做）。
- 用紧凑 Markdown，**提炼而非原文粘贴**；控制在 3000 字内，通常 200–800 字足够。
- 纯运维/闲聊/仅文档小改且无保留价值时，不调用本 skill。

## 何时调用

- **必调用（手动，完成任务但暂不提交）**：完成任务、验证通过，但**不以提交推送收尾**时，手动调用一次本 skill。
- **以提交推送收尾**：由 `git-commit-workflow` 在推送成功后**自动**执行本 skill 相同的归档逻辑（source=trae-session）。此时**勿**再手动重复调用一次，避免同一提交产生两条同名记录。
- **不调用**：纯咨询问答、排障但不改动、仅解释代码。

## 失败容忍

- 接口异常/后端未就绪时仅记录提示，**不阻塞正常交付**（后端对超长会话自动截断并有兜底四字段，成果不丢失）。

## 与 DSH 的关系

- DSH 在每回合结束自动归档（`turn/end` → `source=dsh-session`）。
- TraeCode 侧由 `git-commit-workflow` 在提交推送成功后自动归档，或经本 skill 手动归档（完成任务未提交时）——均 `source=trae-session`。
- 两者共用同一后端提炼接口与同一迭代存储，产品概览中按 source 区分展示。