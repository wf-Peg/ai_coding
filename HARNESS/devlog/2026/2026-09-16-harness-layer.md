---
type: devlog
id: "DEV-2026-09-16-001"
title: "搭建 HARNESS 开发闭环档案层"
date: 2026-09-16 22:40
status: closed
module: tools
commit: 62baf77
source: trae-session
tags:
  - harness
  - archive
  - devlog
generated:
  by: harness-archive
  at: 2026-09-16 22:40
sources:
  - "HARNESS/README.md"
  - "HARNESS/INDEX.md"
  - "scripts/harness-init.cjs"
  - "scripts/harness-audit.cjs"
---

# 搭建 HARNESS 开发闭环档案层

## 一句话

项目级开发档案层落库

## 问题（解决什么）

开发过程资产散落各处：牛马记录埋在配置目录 JSON 里（不进仓库、非 md，只有产品概览 UI 能看）；Bug 归档只有空模板没纪律；提交/bug/决策/复盘各管各的，没有统一入口，基本无法管理。系统读不到，人也翻不到。

## 怎么解决的

借鉴 GitHub agent-native repo / harness 约定（AGENTS.md 地图化、OKF frontmatter、ADR、split planning、audit 验证管道），新增进仓库的 `HARNESS/` 档案层：

- 分级目录：`devlog/`（牛马大白话）、`bugs/`（按模块）、`decisions/`（ADR 递增编号）+ `README/INDEX/roadmap` 入口。
- 统一 frontmatter 契约（type/id/title/date/status/commit/source/generated），正文中文、路径英文 kebab-case。
- 脚本：`harness-init.cjs`（幂等建骨架）、`harness-audit.cjs`（校验 index/frontmatter/commit 一致性）。
- 归档链路：新增 `harness-archive` skill（唯一事实来源），`git-commit-workflow` 推送成功后自动调用写 devlog/bug。
- `agent.md` 新增「Harness 导航」段（只放指针，不复制细节）。

## 产出 / 结果

- `HARNESS/` 14 项骨架全部就绪，init 幂等（两次运行 0 新建）、audit ERROR=0/WARN=0。
- 已提交 `62baf77`（16 文件 +834 行）并同步 `commit_history.log`。
- 后端牛马 JSON 链未动，md 层为人工/AI 真相源；存量 `.trae/documents` 原位保留。

## 关联

- commit：`62baf77`
- 方案文档：`.trae/documents/harness-开发闭环统一方案.md`
- 涉及文件：`HARNESS/` 全目录、`scripts/harness-init.cjs`、`scripts/harness-audit.cjs`、`.trae/skills/harness-archive/SKILL.md`、`.trae/skills/git-commit-workflow/SKILL.md`、`agent.md`
