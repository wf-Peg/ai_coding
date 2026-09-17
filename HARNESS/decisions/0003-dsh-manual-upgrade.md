---
type: adr
id: "0003"
title: "DSH 手动升级（不自动联网安装/升级）"
date: 2026-09-18 10:00
status: accepted
module:
commit: "-"
source: manual
tags:
  - adr
  - dsh
  - upgrade
generated:
  by: manual
  at: 2026-09-18 10:00
sources:
  - "project_memory.md"
---

# 0003: DSH 手动升级（不自动联网安装/升级）

## 背景 Context

DSH（DeepSeek Harness）作为 AI Agent 依赖，其版本演进快、卸载安装有风险。若应用在启动时自动联网安装/升级，会带来不可控的破坏、残留与体积膨胀问题。历史上曾因自动注入插件/deps 导致重复注册崩溃与体积过大。

## 决策 Decision

**DSH 一律不自动联网安装、不自动升级。** 应用只做两件事：① 安装完成检查与允许动作；② 「升级助手」——实时识别宿主版本、一键复制升级命令（`npx -y @deepseek-ai/dsh@latest`），由用户在终端手动执行。安装改为用户手动执行。

## 后果 / 权衡 Consequences

- 正面：升级完全可控、可回退，避免自动更新风险与安装体积膨胀（构建已从 extraResources 移除 dsh 离线闭包）。
- 负面：升级步骤需用户主动触发，操作门槛略高（靠升级助手文案降低门槛）。

## 备选 Alternative

- 自动联网安装/升级：被否——曾导致重复注册崩溃、安装体积膨胀、升级不可控。
- 完全去除 DSH：被否——DSH 是 AI Agent 调用知识库的核心能力。

## 关联

- 相关代码：`electron/main.js`（`resolveDshBin` / `startDshAgent` / `dsh-agent:check-install`）
- 相关记录：升级助手 / 版本识别逻辑