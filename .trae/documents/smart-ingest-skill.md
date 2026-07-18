# 智能入库 Skill 实现计划

## 概述

将系统基础功能整理为 Skill，核心能力：用户粘贴任意文本，AI 自动识别意图（剪藏/待办/知识/话题），解析为结构化字段，自动匹配后端 API 参数并入库。

## 当前状态分析

### 现有数据入库接口

| 模块 | 接口 | 方法 | 请求体 | 必填字段 |
|------|------|------|--------|----------|
| 剪藏 | `/api/clip/add` | POST | `ClipRequest` | content, type, source, category |
| 待办 | `/api/todo/add` | POST | `TodoContent` | title |
| 话题 | `/api/topic` | POST | `TopicRequest` | title, content |
| 知识 | 无独立控制器 | - | - | 由 FileStorageService 直接管理 |

### 现有 ClipRequest 字段（全量）
content, type, source, category, title, sourceUrl, siteName, capturedAt, selectedText, contextBefore, contextAfter, captureMethod, target, workflowStatus, tags, useAiTags, fileData, fileName, imageDataList, myThoughts

### 现有 TodoContent 字段（全量）
title, priority, deadline, deadlineTime, reminderEnabled, reminderMinutes, completed, category, sourceClipId, sourceUrl

### 现有 TopicRequest 字段（全量）
title, summary, content, category, tags, sourceClipId, published, myThoughts

### 已有能力
- `ClipService.tryParseStructuredContent()` — 已实现 AI 结构化内容自动识别（仅限剪藏）
- `AiService.processClipContent()` — 已实现 AI 摘要/分析/标签/分类生成
- `AiService` 已接入 LLM Provider

## 方案设计

### 核心思路
新增一个**统一智能入库接口** `/api/skill/smart-ingest`，接收简化参数 `{ text }`，用 AI 做意图识别 + 字段提取 + 路由分派。不新增前端页面，直接复用现有剪藏页面的表单区，增加"智能模式"切换。

### 数据流

```
用户粘贴文本 → 前端"智能入库"按钮
  → POST /api/skill/smart-ingest { text: "..." }
    → 后端调用 AI 识别意图 + 提取字段
    → 根据意图路由到对应 Service 保存
  → 返回 { intent, result, redirect }
```

### 修改清单

#### 1. 新增 SkillController（`/workspace/backend/src/main/java/com/example/clip/controller/SkillController.java`）

**单个接口**：`POST /api/skill/smart-ingest`

**请求体**：
```json
{
  "text": "用户粘贴的任意文本内容"
}
```

**后端处理流程**：
1. 调用 AI 识别意图类型（clip / todo / knowledge / topic）
2. 调用 AI 提取结构化字段（根据意图类型不同，提取不同字段集）
3. 路由到对应 Service 保存
4. 返回结果

**响应体**：
```json
{
  "intent": "clip",
  "result": { "id": 123, "title": "..." },
  "redirect": "/api/clip/123"
}
```

#### 2. 新增 SkillService（`/workspace/backend/src/main/java/com/example/clip/service/SkillService.java`）

核心逻辑：

```
smartIngest(String text):
  1. intent = aiService.identifyIntent(text)     → "clip" | "todo" | "knowledge" | "topic"
  2. fields = aiService.extractFields(text, intent) → Map<String, Object>
  3. switch (intent):
       case "clip"    → buildClipRequest(fields) → clipService.saveClip()
       case "todo"    → buildTodoContent(fields) → todoService.saveTodo()
       case "knowledge" → buildKnowledgeEntry(fields) → storageService.saveKnowledgeEntry()
       case "topic"   → buildTopic(fields) → topicService.createTopic()
  4. return result
```

#### 3. AiService 新增 2 个方法（`/workspace/backend/src/main/java/com/example/clip/core/AiService.java`）

**`identifyIntent(String text)`** — AI 意图识别
- Prompt：让 AI 判断此文本最合适的数据类型，返回 `clip` / `todo` / `knowledge` / `topic` 之一
- 判断依据：
  - 如果有 deadline/优先级/待办标记 → todo
  - 如果是结构化分析报告（含摘要/分析/标签）→ clip
  - 如果是对话/分享内容 → topic
  - 如果是知识点/概念解释 → knowledge

**`extractFields(String text, String intent)`** — AI 字段提取
- 根据 intent 类型，让 AI 提取对应的结构化字段
- 返回 `Map<String, Object>`，key 为目标模型的字段名
- 各意图提取目标：

| 意图 | 提取字段 |
|------|----------|
| clip | content, title, summary, analysis, tags, category, sourceUrl, siteName |
| todo | title, priority, deadline, category, content(作为描述) |
| knowledge | title, summary, insight, tags, keywords, category |
| topic | title, summary, content, tags, category |

#### 4. 前端增加智能入库入口（`/workspace/frontend/clip.html`）

在剪藏表单区域增加一个"智能入库"按钮：
- 用户粘贴文本后点击 → 直接调用 `POST /api/skill/smart-ingest`
- 无需选择 type/category/source 等参数
- 成功后显示入库结果 + 跳转链接

**简化参数**：用户只需粘贴文本，其他都由 AI 完成。

## 假设与决策

1. **意图识别用 AI 而非规则**：因为用户文本格式多样，正则/规则无法覆盖。用 AI 做意图分类更可靠。
2. **知识入库暂走 FileStorageService 直接保存**：当前无 KnowledgeController，直接调用 `storageService.saveKnowledgeEntry()`。
3. **不新增前端页面**：复用 `clip.html` 的 textarea 表单区域，增加一个按钮即可，保持简洁。
4. **AI 提取失败时降级为 store-only 剪藏**：如果 AI 字段提取失败或意图模糊，默认以 store-only 类型存入剪藏，原文即摘要，不丢数据。
5. **Skill 不注册为 TRAE Agent Skill**：用户说的是"技能"概念，但实现为后端 REST API + 前端入口更实用，不需要 `.trae/skills/` 目录下的 Agent Skill 定义。

## 实现步骤

### Step 1: AiService 新增意图识别和字段提取方法
- 文件：`/workspace/backend/src/main/java/com/example/clip/core/AiService.java`
- 新增 `identifyIntent(String text)` → String
- 新增 `extractFields(String text, String intent)` → Map<String, Object>

### Step 2: 新增 SkillService
- 文件：`/workspace/backend/src/main/java/com/example/clip/service/SkillService.java`
- 实现 `smartIngest(String text)` 方法
- 注入 AiService, ClipService, TodoService, TopicService, FileStorageService

### Step 3: 新增 SkillController
- 文件：`/workspace/backend/src/main/java/com/example/clip/controller/SkillController.java`
- `POST /api/skill/smart-ingest` 端点

### Step 4: 前端增加智能入库按钮
- 文件：`/workspace/frontend/clip.html`
- 在表单区域增加"智能入库"按钮
- 点击后调用 `/api/skill/smart-ingest`

### Step 5: 编译验证 + 提交推送

## 验证方式

1. 粘贴一段 AI 分析报告（如 V2EX 帖子分析），验证识别为 clip 并自动填充 summary/analysis/tags
2. 粘贴一段待办提醒（如"明天下午3点前完成报告，高优先级"），验证识别为 todo 并提取 title/priority/deadline
3. 粘贴一段知识点（如"TCP 三次握手过程..."），验证识别为 knowledge 并提取 title/summary/keywords
4. 粘贴模糊内容，验证降级为 store-only 剪藏