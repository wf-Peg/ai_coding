---
name: smart-ingest
description: 智能入库 — 接收任意文本，AI 自动识别意图（剪藏/待办/话题）、提取结构化字段，并调用后端已有接口入库。
---

# 智能入库 Skill

## 概述

当用户提供文本内容需要入库时，自动识别意图类型（剪藏/待办/话题），提取结构化字段，然后调用后端对应的已有接口完成入库。

## 意图识别规则

根据文本内容判断意图：

- **clip（剪藏）**：长文分析、URL、结构化报告、知识点、无明确行动项或待办属性的内容
- **todo（待办）**：含 deadline/时间限制、优先级、行动项、待办标记、提醒类内容
- **topic（话题）**：分享推荐、观点讨论、社交讨论、对话内容

## 字段提取规则

### clip 剪藏
提取字段：title, content, summary, category, tags, sourceUrl, siteName
- title: 简短标题（≤30字）
- content: 原文内容
- summary: 一句话摘要
- category: 分类（work/study/life/hobby/finance/social）
- tags: 标签数组
- sourceUrl: 来源URL（如有）
- siteName: 来源站点名（如有）

### todo 待办
提取字段：title, priority, deadline, deadlineTime, category
- title: 待办标题（≤50字）
- priority: 优先级（high/medium/low）
- deadline: 截止日期（如"2026-07-20"）
- deadlineTime: 截止时间（如"15:00"）
- category: 分类

### topic 话题
提取字段：title, summary, content, category, tags
- title: 话题标题（≤50字）
- summary: 摘要
- content: 完整内容
- category: 分类
- tags: 标签数组

## 调用后端接口

后端服务运行在 `http://localhost:8080`，请确保服务已启动。

### 剪藏入库
```bash
curl -s -X POST http://localhost:8080/api/clip/add \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ai-text",
    "content": "<content>",
    "title": "<title>",
    "source": "<source>",
    "sourceUrl": "<sourceUrl>",
    "siteName": "<siteName>",
    "category": "<category>",
    "tags": ["<tag1>", "<tag2>"],
    "useAiTags": true,
    "workflowStatus": "inbox"
  }'
```

### 待办入库
```bash
curl -s -X POST http://localhost:8080/api/todo/add \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<title>",
    "priority": "<priority>",
    "deadline": "<deadline>",
    "deadlineTime": "<deadlineTime>",
    "category": "<category>"
  }'
```

### 话题入库
```bash
curl -s -X POST http://localhost:8080/api/topic \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<title>",
    "summary": "<summary>",
    "content": "<content>",
    "category": "<category>",
    "tags": ["<tag1>", "<tag2>"]
  }'
```

## 异常处理

1. **后端不可用**：如果 curl 连接 8080 端口失败，提示用户"请先启动后端服务（端口 8080）"
2. **意图不明确**：默认降级为 clip 剪藏类型
3. **字段提取失败**：使用原文作为 content，title 取原文前 30 字
4. **API 返回错误**：展示后端返回的错误信息给用户

## 使用示例

用户说："入库：明天下午3点前完成报告，高优先级"
→ 识别 intent=todo
→ 提取 title="完成报告", priority="high", deadline="2026-07-19", deadlineTime="15:00"
→ curl POST /api/todo/add
→ 告知用户："待办已入库：完成报告（高优先级，截止 2026-07-19 15:00）"

用户说："把这篇文章存起来：TCP三次握手详解..."
→ 识别 intent=clip
→ 提取 title="TCP三次握手详解", category="study", tags=["网络", "TCP"]
→ curl POST /api/clip/add
→ 告知用户："剪藏已入库：TCP三次握手详解"