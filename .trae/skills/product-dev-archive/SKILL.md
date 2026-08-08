---
name: product-dev-archive
description: 产品开发归档 — agent 完成编码任务后自动执行，将需求分析、设计、实现等全流程数据按后端格式写入本地文件，后端启动后自动解析为产品开发工作区的剪藏、知识、待办、wiki 等。
---

# 产品开发归档 Skill

## 概述

当 agent 完成一个需求或子任务后，自动执行此 skill，将需求的全流程数据按固定格式写入 `{storagePath}/product-dev/archives/` 目录下的 JSON 文件。后端启动时扫描该目录，自动解析为产品开发工作区的结构化数据。

## 归档文件格式

写入文件路径：`{storagePath}/product-dev/archives/{yyMMdd-HHmmss}-{需求标识}.json`

### 归档文件 JSON 结构

```json
{
  "requirement": {
    "title": "需求标题",
    "description": "需求描述",
    "phase": "analysis|design|implementation|testing|completed",
    "tags": ["标签1", "标签2"],
    "content": "需求分析的完整 Markdown 内容"
  },
  "knowledge": [
    {
      "title": "知识标题",
      "content": "知识内容 (Markdown)",
      "tags": ["标签"],
      "category": "product-dev"
    }
  ],
  "todos": [
    {
      "title": "待办标题",
      "description": "待办描述",
      "status": "todo|in-progress|done",
      "priority": "high|medium|low"
    }
  ]
}
```

### 执行流程

```
agent 完成任务
    ↓
检查当前需求是否已归档
    ↓
按上述格式组装数据
    ↓
写入 {yyMMdd-HHmmss}-{需求标识}.json 到 archives 目录
    ↓
记录活动日志到 {storagePath}/product-dev/activity.log
    ↓
（可选）调用后端 API 通知索引更新
```

### 归档时机

- 每个子任务完成时：归档当前子任务的知识点、待办完成状态
- 整个需求完成时：归档完整需求，包括需求分析、设计文档、实现记录、测试结果

### 与 agent.md 的配合

agent.md 中应增加约束，要求 agent 在每次完成任务后自动执行此 skill。具体在 agent.md 的"需求开发流程"章节后增加"产品开发归档"章节。