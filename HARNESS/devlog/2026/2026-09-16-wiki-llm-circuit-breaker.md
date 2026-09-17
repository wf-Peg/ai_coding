---
type: devlog
id: "DEV-2026-09-16-002"
title: "wiki 批量入库检索增强与 LLM 路由熔断"
date: 2026-09-16 23:35
status: closed
module: wiki
commit: fbb047e
source: trae-session
tags:
  - wiki
  - llm
  - circuit-breaker
  - batch-ingest
generated:
  by: harness-archive
  at: 2026-09-16 23:35
sources:
  - "backend/src/main/java/com/example/clip/controller/LlmBreakerController.java"
  - "backend/src/main/java/com/example/clip/service/wiki/CompiledCorpusRegistry.java"
  - "backend/src/main/java/com/example/clip/service/wiki/WikiSearchIndex.java"
  - "backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java"
  - "frontend/wiki.html"
---

# wiki 批量入库检索增强与 LLM 路由熔断

## 一句话

wiki 引擎与 LLM 路由加固

## 问题（解决什么）

wiki 模块在批量入库、检索链路和 LLM 调用上缺少健壮性：批量入库与索引不完整、检索无独立搜索索引；LLM 路由切换缺少熔断，单个模型/provider 故障会拖垮整条调用链；wiki 前端交互也需要升级。

## 怎么解决的

- **LLM 路由熔断**：新增 `LlmBreakerController`（熔断状态查询/控制）+ 增强 `RoutingLlmProvider`（含熔断逻辑），`CompiledCorpusRegistry` 管理编译语料注册，provider 失败自动降级/断路，避免雪崩。
- **检索增强**：新增 `WikiSearchIndex`（独立搜索索引）+ 强化 `WikiIndexService` / `WikiQueryService` / `BatchIngestService`（批量入库时同步建索引），`WikiIngestController` / `WikiQueryController` 接口增强。
- **前端**：`frontend/wiki.html` 大改（+307 行），`AiService` 联动。
- **借鉴调研**：新增 `.trae/documents/KaaS对比分析与借鉴建议.md`，评估 bybit-exchange/kaas 的 Knowledge-as-a-Service 与本软件交集。

## 产出 / 结果

- 16 文件 +1695/-142，提交 `fbb047e` 已推送 main。
- 后端 `mvn compile` 通过；脚本级编译验证 OK（脚本根目录 mvn 定位限制，改在 backend/ 手动编译）。
- 熔断/索引/入库检索链路落地，前端 wiki 交互升级。

## 关联

- commit：`fbb047e`
- 涉及文件：`backend/src/main/java/com/example/clip/controller/LlmBreakerController.java`、`backend/src/main/java/com/example/clip/service/wiki/{CompiledCorpusRegistry,WikiSearchIndex,WikiIndexService,WikiQueryService,BatchIngestService}.java`、`backend/src/main/java/com/example/clip/core/{RoutingLlmProvider,LlmProviderConfig,AiService}.java`、`frontend/wiki.html`、`.trae/documents/KaaS对比分析与借鉴建议.md`
