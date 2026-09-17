---
name: harness-archive
description: Harness 开发闭环归档 — 把一次有保留价值的开发/修复会话提炼成 HARNESS/ 下的 md 记录（devlog 牛马大白话，bug 修复写 bugs），并更新对应 _index.md。供提交推送后自动调用（source=trae-session）或手动调用。是 HARNESS frontmatter/目录/命名契约的唯一事实来源。
---

# Harness 开发闭环归档 Skill

## 概述

把开发产生的过程资产沉淀进仓库内 `HARNESS/`（人可读、AI 可读、可版本化）：
- 普通开发/功能 → **devlog**（牛马大白话：一句话/问题/怎么解决/产出）。
- Bug 修复 → 额外写一条 **bugs**（现象/根因/修法/教训）。
- 架构/方向级改动被采纳 → 手动写一条 **ADR**（decisions）。

本 skill 是 `HARNESS` 的 **frontmatter / 目录 / 命名契约的唯一事实来源**。改动需两端同步：`git-commit-workflow` 只负责在推送成功后**调用本 skill**，不内联第二份实现。

## 触发条件

- **自动**：以提交推送收尾的任务，由 `git-commit-workflow` 在推送成功后自动执行本 skill 的「写 devlog」逻辑。
- **手动**：完成任务/修复但暂不提交时，用户说「归档」「写牛马记录」「写开发日志」「记录一下」「harness」等，手动执行本 skill。
- **不写**：纯咨询问答、排障但不改动、仅解释代码、纯文档微调且无保留价值。

## 目录与命名（唯一事实来源）

| 目录 | 内容类型 | 文件名 | id |
|---|---|---|---|
| `HARNESS/devlog/2026/` | 开发日志 | `YYYY-MM-DD-<slug>.md`（英文 kebab） | `DEV-YYYY-MM-DD-001` |
| `HARNESS/bugs/<module>/` | Bug 归档 | `YYYY-MM-DD-<slug>.md`（英文 kebab） | `BUG-YYYY-MM-DD-001` |
| `HARNESS/decisions/` | ADR 决策 | `000N-<title>.md` | `000N` |

约束：
- **路径全英文 kebab-case，正文中文**。slug 只用稳定英文（如 `multi-cursor-alt-w`），中文标题放 frontmatter.title，**不把中文/拼音写进文件名**。
- `module` 取 agent.md scope 一致的模块名：`editor` / `clip` / `workspace` / `wiki` / `backend` / `electron` / `extension` / `tools` 等。
- bugs 子目录按模块小写英文建。

## Frontmatter（每篇必备）

```yaml
---
type: devlog | bug | adr
id: "DEV-2026-09-16-001" | "BUG-..." | "0001"
title: "<一句话标题>"
date: 2026-09-16 14:30
status: closed | open | accepted | pending
module: editor
commit: <短哈希>
source: dsh-session | trae-session | manual
tags: [editor, multi-cursor]
generated:
  by: git-commit-workflow | harness-archive | manual
  at: 2026-09-16 14:30
sources:
  - "electron/main.js:802"
---
```

必填：`type / id / title / date / status / commit / source / generated`。可选：`module`、`tags`、`sources`。

## 写 devlog 的正文模板（牛马大白话四字段）

```markdown
## 一句话
<10 字内>
## 问题（解决什么）
<problem，大白话>
## 怎么解决的
<solution，大白话>
## 产出 / 结果
<outcome，大白话>
## 关联
- commit：`<hash>`；TODO：`TODO/{需求}/`；文件：`<路径>:<行>`
```

## 写 bug 的正文模板

```markdown
## 现象
## 根因
## 修复方式
## 经验教训（防复发）
## 关联
```

## 写 ADR 的正文模板

```markdown
## 背景 Context
## 决策 Decision
## 后果 / 权衡 Consequences
## 备选 Alternative
## 关联
```

## 执行流程

```
1. 判断是否值得归档（见触发条件）。
2. 提炼内容到对应正文模板（devlog 和/或 bug；adr 仅手动）。
3. 落文件到对应目录，文件名按命名约定（同日 id 序号 = 该目录当日已有多条则 +1）。
4. 更新对应 _index.md：在表格**顶部**插入新行（时间倒序）——【必做】，audit 发现 index 与记录不一致 = 归档未走完，须补写。
5. self-check：frontmatter 字段齐全、commit 与真实短哈希一致、路径英文 slug / 正文中文。
```

## 失败容忍

- 落 md / 更新 index **失败仅提示，不阻塞提交**（与 `trae-session-archive` 失败容忍一致）；产品概览 JSON 归档照常。
- 真相源分工：`HARNESS/devlog` 是人工/AI 文档真相源；后端 `feature-point-iterations.json` 只服务产品概览展示。两者并行、本阶段不同步；对不上以 md 为准。

## 验证

- 写完后可跑 `node scripts/harness-audit.cjs` 自查（ERROR 应 0）。