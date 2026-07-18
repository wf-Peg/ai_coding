# 通用智能入库接口 + Skill 实现计划

## 概述

创建**统一后端接口** `POST /api/ingest`，接收任意文本，后端 AI 识别意图+提取字段+路由入库。浏览器插件和 TRAE Agent Skill 共用同一接口。

## 1. 当前状态分析

### 有完整前端 UI 的模块（可入库目标）

| 模块 | 入库接口 | 请求体 | 前端页面 |
|------|----------|--------|----------|
| 剪藏 | `POST /api/clip/add` | `ClipRequest` | `clip.html` |
| 待办 | `POST /api/todo/add` | `TodoContent` | `todo.html`（iframe in index.html） |
| 话题 | `POST /api/topic` | `TopicRequest` | `topic.html` |

### 知识模块状态

知识模块（`KnowledgeEntry`）只有 model + FileStorageService 存储方法，**无前端页面、无 Controller**。本次不纳入独立意图，知识类内容通过剪藏入库（category="knowledge", type="store-only"）。

### 已有 AI 能力

- `AiService.processClipContent()` — 已实现摘要/分析/标签/分类生成
- `ClipService.tryParseStructuredContent()` — 已实现 AI 结构化内容自动识别
- `AiService` 已接入 LLM Provider

## 2. 核心设计

### 数据流

```
任意调用方（浏览器插件 / TRAE Agent Skill / 前端）
  → POST /api/ingest { text: "明天下午3点前完成报告，高优先级" }
    → 后端 AiService 识别意图 → "todo"
    → 后端 AiService 提取字段 → { title, priority, deadline }
    → 路由到 TodoService.saveTodo()
  → 返回 { intent: "todo", id: 123, title: "完成报告", redirect: "/api/todo/123" }
```

### 简化参数

调用方只需传 `{ text }`，不需要 `type`/`source`/`category` 等字段，全部由后端 AI 推理。

### 意图分类

| 意图 | 识别特征 | 入库目标 |
|------|----------|----------|
| `clip` | 长文分析、URL、结构化报告、无明确待办属性 | 剪藏（ai-text） |
| `todo` | 含 deadline/优先级/行动项/待办标记 | 待办 |
| `topic` | 分享推荐、对话讨论、社交内容 | 话题 |

知识类内容 → 归入 clip（category="knowledge"），不做独立意图。

## 3. 修改清单

### 3.1 新增 AiService 方法

**文件**：`/workspace/backend/src/main/java/com/example/clip/core/AiService.java`

新增两个方法：
- `identifyIntent(String text)` → 返回 `"clip"` / `"todo"` / `"topic"`
- `extractFields(String text, String intent)` → 返回 `Map<String, Object>`

AI prompt 设计要点：
- 意图识别：让 LLM 判断文本最匹配的数据类型，严格三选一
- 字段提取：根据意图类型，让 LLM 从文本中提取结构化字段，以 JSON 格式返回

### 3.2 新增 IngestController

**文件**：`/workspace/backend/src/main/java/com/example/clip/controller/IngestController.java`

单端点：`POST /api/ingest`

**请求**：`{ "text": "..." }`

**处理流程**：
1. 校验 text 不为空（< 5 字返回 400）
2. 调用 `aiService.identifyIntent(text)` 识别意图
3. 调用 `aiService.extractFields(text, intent)` 提取字段
4. 根据 intent 路由到对应 Service：
   - `clip` → 构建 `ClipRequest` → `clipService.saveClip()`
   - `todo` → 构建 `TodoContent` → `todoService.saveTodo()`
   - `topic` → 构建 `Topic` → `topicService.createTopic()`
5. AI 调用失败时降级为 clip store-only

**响应**：
```json
{
  "success": true,
  "intent": "todo",
  "id": 123,
  "title": "完成报告",
  "redirect": "/api/todo/123"
}
```

**异常处理**：

| 场景 | HTTP | 响应 |
|------|------|------|
| text 为空或 < 5 字 | 400 | `{ success: false, error: "内容过短，请提供更多信息" }` |
| AI 意图识别失败 | 200 | 降级为 clip store-only，`{ intent: "clip", degraded: true }` |
| AI 字段提取失败 | 200 | 降级为 clip store-only，原文即摘要 |
| 目标 Service 保存失败 | 500 | `{ success: false, error: "入库失败: ..." }` |
| 整体异常 | 500 | `{ success: false, error: "..." }` |

### 3.3 创建 Skill 文件

**文件**：`/workspace/.trae/skills/smart-ingest/SKILL.md`

YAML frontmatter：
```yaml
name: "smart-ingest"
description: "智能入库：粘贴任意文本，自动识别意图并存入剪藏/待办/话题。Invoke when user says 入库、智能入库、smart ingest、帮我存、自动入库 等关键词。"
```

Skill 指令正文（精简版）：
- 让用户提供文本内容
- 用 `RunCommand` 执行 curl 调用 `POST http://localhost:8080/api/ingest`
- 解析响应，告知用户入库结果
- 后端不可用时提示启动服务

### 3.4 前端入口按钮（可选）

**文件**：`/workspace/frontend/clip.html`

在 textarea 区域增加"智能入库"按钮，简化用户操作链路。

## 4. 实现步骤

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `AiService.java` | 新增 `identifyIntent()` + `extractFields()` |
| 2 | `IngestController.java` | 新增 `POST /api/ingest` 端点 |
| 3 | `.trae/skills/smart-ingest/SKILL.md` | 创建 Skill 文件 |
| 4 | `clip.html` | 增加"智能入库"按钮 |
| 5 | 编译验证 + 提交推送 |

## 5. 验证计划

1. **待办**：`"明天下午3点前完成Q3报告，高优先级"` → intent=todo, 提取 title/priority/deadline
2. **剪藏**：粘贴 AI 分析报告 → intent=clip, 自动填充 summary/analysis/tags
3. **话题**：`"推荐一个工具：Obsidian，笔记神器..."` → intent=topic, 提取 title/summary/content
4. **模糊降级**：`"今天天气不错"` → intent=clip, degraded=true, store-only
5. **异常**：后端未启动 → Skill 提示"请先启动后端服务"
6. **浏览器插件**：插件调用同一接口，验证返回结果一致