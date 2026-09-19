---
type: devlog
id: "DEV-2026-09-19-001"
title: "首装引导卡重构 · 设置页 8 分组"
date: 2026-09-19 17:00
status: closed
module: electron
commit: 828e12e
source: trae-session
tags:
  - onboarding
  - settings
  - config-window
  - theme
  - guide-core
generated:
  by: harness-archive
  at: 2026-09-19 17:00
sources:
  - "frontend/js/guide-core.js"
  - "electron/config.html"
  - "frontend/settings.html"
  - "frontend/js/settings.js"
---

# 首装引导卡重构 + 设置页 8 分组重排

## 一句话

把"用户第一次进来"做成一次有设计感的引导

## 问题（解决什么）

首装窗口（config.html）硬编码紫色渐变、必填项全标红、端口占了第一屏、存储路径默认 APP_DIR 让"唯一必填"这个约束形同虚设——用户第一次进程序就得手填四个东西，焦虑感拉满。设置页导航也是老问题：存储路径埋在「AI→数据与本地」末段、分组优先级混乱、没有重播引导的入口。

## 怎么解决的

1. 抽自包含共享渲染器 `frontend/js/guide-core.js`（ES5 零依赖、自带 `<style>` 注入、作用域令牌 + `html[data-theme="dark"]` 覆盖），让首装窗口（file://）和设置页（http://）两处复用一个组件，避免跨 source 样式漂移。
2. 首装窗口升级为三张清单卡：存储路径（唯一必填红、首装留空 + 一键填充推荐路径）、AI Key（可跳过）、端口（收进高级折叠卡）。接入 design-tokens 令牌 + 浅/深手动切换。IPC 契约完全不变。
3. 设置页导航按优先级重排 8 组：工作区（置顶必填红）→ AI 与模型 → 集成 → 外观 → 通用 → 快捷操作 → 数据与隐私 → 系统。
4. 设置页新增"工作区"横幅，挂 `openGuideReplay()` 随时重播引导。
5. 全程**不改动任何 element id**——settings.js 绑定全靠硬编码 id，DOM 随便挪、id 必须稳。

## 产出 / 结果

- 首装窗口 3 张 V3 融合风引导卡，深浅色自适，唯一必填生效，AI 可跳过。
- 设置页 8 分组重排完成，存储路径从 AI 分组底部提升到首屏"工作区"分组。
- 引导重播入口已上线（工作区分组顶部"播放引导"）。
- 静态检查全过：8 组 id 唯一性、关键字段 id 唯一性、旧 group-ai 已移除、guide-core 引用齐全。
- 推送 `trae/agent-Q9iuWU` → `wf-Peg/ai_coding`，commit_history.log 同步追加。

## 关联

- commit：`828e12e`（设置页 8 分组）、`fe9f3f0`（首装窗口 V3）、`a2ac2c5`（guide-core 新增）；旧 `group-ai` 已移除；模块：electron + frontend
- 文件：
  - `frontend/js/guide-core.js`（新增）
  - `electron/config.html`（重写）
  - `frontend/settings.html`（导航 + 分组 + 必填红 + 横幅）
  - `frontend/js/settings.js`（追加 `openGuideReplay`）
- 约束：**绝不改 element id / data-target**（settings.js 绑定基础）
- 端口窗口位置：`electron/main.js:2943`、`:7222`、`:7439`（本次未改尺寸，保持 560×700）
