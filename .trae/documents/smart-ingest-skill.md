# 智能入库 Skill 实现计划（TRAE Agent Skill）

## 概述

创建一个 TRAE Agent Skill，用户粘贴任意文本后，Agent 端用 AI 识别意图（剪藏/待办/知识/话题），提取结构化字段，然后调用后端已有 REST API 完成数据入库。

## 核心设计

**Agent 侧做智能识别**，**后端侧做数据持久化**。Skill 本身是一段 Agent 指令，描述如何分析文本、提取字段、调用 HTTP API。

## 当前状态分析

### 已有后端入库接口

| 模块 | 接口 | 方法 | 请求体模型 | 关键字段 |
|------|------|------|--------|----------|
| 剪藏 | `/api/clip/add` | POST | `ClipRequest` | content, type, source, category, title, sourceUrl, tags, myThoughts, workflowStatus |
| 待办 | `/api/todo/add` | POST | `TodoContent` | title, priority, deadline, deadlineTime, category |
| 话题 | `/api/topic` | POST | `TopicRequest` | title, summary, content, category, tags, myThoughts |
| 知识 | **无 REST 接口** | - | - | 需新增最小化接口 |

### 已有 Skill 格式参考

`/workspace/.trae/skills/mobile-clip/SKILL.md` — YAML frontmatter (name, description) + Markdown 指令正文。

### 后端端口

Spring Boot 默认 `8080`。

## 方案设计

### 数据流

```
用户: "帮我入库: 明天下午3点前完成报告，高优先级"
  → Agent 加载 smart-ingest skill
    → Agent 用 AI 分析文本 → intent=todo, fields={title:"完成报告", priority:"high", deadline:"2026-07-13"}
    → Agent 调用 curl POST http://localhost:8080/api/todo/add -d '{...}'
  → 返回入库结果
```

### 修改清单

#### 1. 新增 Skill 文件（`/workspace/.trae/skills/smart-ingest/SKILL.md`）

Agent Skill 指令，包含：
- 意图识别规则（clip / todo / knowledge / topic）
- 各意图的字段提取模板
- 后端 API 调用命令（curl 格式）
- 故障降级策略

#### 2. 新增 KnowledgeController（`/workspace/backend/src/main/java/com/example/clip/controller/KnowledgeController.java`）

知识模块目前无 REST 接口，Skill 无法直接调用。新增最小化接口：

- `POST /api/knowledge` — 创建知识条目，接收 `KnowledgeEntry` JSON，返回保存后的实体

#### 3. 前端入口（可选）（`/workspace/frontend/clip.html`）

在剪藏页 textarea 旁增加"智能入库"按钮，引导用户使用 Skill。非必须，Skill 本身不需要前端。

## 实现步骤

### Step 1: 新增 KnowledgeController
- 文件：`/workspace/backend/src/main/java/com/example/clip/controller/KnowledgeController.java`
- 端点：`POST /api/knowledge` 接收 `KnowledgeEntry` JSON → `storageService.saveKnowledgeEntry()`

### Step 2: 创建 Skill 文件
- 文件：`/workspace/.trae/skills/smart-ingest/SKILL.md`
- YAML frontmatter + 完整指令正文

### Step 3: 前端增加入口按钮（可选）
- 文件：`/workspace/frontend/clip.html`
- 在 textarea 旁增加"智能入库"按钮，引导用户使用此 Skill

### Step 4: 编译验证 + 提交推送

## 验证方式

1. 在 TRAE 中输入"帮我入库：明天下午3点前完成报告，高优先级"，验证识别为 todo 并调用 `/api/todo/add`
2. 输入 AI 分析报告，验证识别为 clip 并调用 `/api/clip/add`
3. 输入知识点，验证识别为 knowledge 并调用 `/api/knowledge`
4. 输入模糊内容，验证降级为 clip store-only