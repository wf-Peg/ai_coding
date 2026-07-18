# 智能入库 Skill 实现计划（TRAE Agent Skill）

## 概述

创建 TRAE Agent Skill：用户粘贴任意文本 → Agent 端 AI 识别意图 + 提取字段 → 调用后端 REST API 入库。后端补齐缺失接口，全局兼容异常处理。

## 1. 当前状态

### 已有后端入库接口（可直接调用）

| 模块 | 接口 | 方法 | 请求体 | 响应 |
|------|------|------|--------|------|
| 剪藏 | `/api/clip/add` | POST | `ClipRequest` | `{ id: Long, status: "success" }` |
| 剪藏(内部) | `/api/clip/system` | POST | `ClipRequest` | `{ id: Long, status: "success" }` |
| 待办 | `/api/todo/add` | POST | `TodoContent` | `TodoContent` |
| 话题 | `/api/topic` | POST | `TopicRequest` | `TopicResponse` |
| 知识 | **缺失** | - | - | 需新增 |

### 各模型字段速查

**ClipRequest** — content, type, source, category, title, sourceUrl, siteName, capturedAt, selectedText, contextBefore, contextAfter, captureMethod, target, workflowStatus, tags, useAiTags, fileData, fileName, imageDataList, myThoughts

**TodoContent** — title, priority, deadline, deadlineTime, reminderEnabled, reminderMinutes, completed, category, sourceClipId, sourceUrl

**TopicRequest** — title, summary, content, category, tags, sourceClipId, published, myThoughts

**KnowledgeEntry** — title, summary, insight, tags, keywords, category, sourceClipId

### 已有 Skill 参考

`/workspace/.trae/skills/mobile-clip/SKILL.md` — YAML frontmatter + Markdown 指令

## 2. 方案设计

### 数据流

```
用户: "入库: 明天下午3点前完成报告，高优先级"
  → Agent 加载 smart-ingest skill
  → Agent 用 AI 分析:
      intent = "todo"
      fields = { title: "完成报告", priority: "high", deadline: "2026-07-13" }
  → Agent 用 RunCommand 执行 curl:
      curl -s -X POST http://localhost:8080/api/todo/add \
        -H "Content-Type: application/json" \
        -d '{"title":"完成报告","priority":"high","deadline":"2026-07-13"}'
  → 解析响应，告知用户入库结果
```

### 修改清单

#### 2.1 新增 KnowledgeController

**文件**：`/workspace/backend/src/main/java/com/example/clip/controller/KnowledgeController.java`

端点：
- `POST /api/knowledge` — 创建知识条目
- `GET /api/knowledge` — 查询全部
- `GET /api/knowledge/{id}` — 按 ID 查询
- `DELETE /api/knowledge/{id}` — 删除

**异常处理**：
- 保存失败 → 500 + `{ error: "保存失败" }`
- 记录不存在 → 404
- 入参校验 → 400 + `{ error: "标题不能为空" }`

#### 2.2 创建 Skill 文件

**文件**：`/workspace/.trae/skills/smart-ingest/SKILL.md`

核心指令内容：
1. **意图识别** — 分析文本，输出 clip / todo / knowledge / topic 之一
2. **字段提取** — 按意图类型提取对应字段
3. **API 调用** — 用 curl 调用对应后端接口
4. **异常降级** — 意图模糊时降级为 clip store-only；API 不可用时给出明确提示

#### 2.3 前端入口按钮（可选）

**文件**：`/workspace/frontend/clip.html`

在 textarea 区域增加"智能入库"按钮，hint 用户使用 Skill。

## 3. 实现步骤

### Step 1: 新增 KnowledgeController

- 文件：`/workspace/backend/src/main/java/com/example/clip/controller/KnowledgeController.java`
- 注入 `FileStorageService`
- `POST /api/knowledge` 接收 `KnowledgeEntry` JSON → `storageService.saveKnowledgeEntry()`
- 含完整校验、异常处理、日志

### Step 2: 创建 Skill 文件

- 文件：`/workspace/.trae/skills/smart-ingest/SKILL.md`
- YAML frontmatter：name="smart-ingest", description
- 正文：意图识别规则 + 字段提取指令 + curl 调用模板 + 异常处理 + 使用示例

### Step 3: 前端入口按钮

- 文件：`/workspace/frontend/clip.html`
- 在 textarea 区域增加"智能入库"按钮，提示用户"粘贴内容后点击即可自动识别入库"

### Step 4: 编译验证 + 提交推送

## 4. 异常处理设计

| 场景 | 处理策略 |
|------|----------|
| 用户文本过短（< 5 字） | 提示补充更多内容，不调用 API |
| 意图模糊无法判断 | 降级为 clip store-only，原文即摘要 |
| 字段提取不完整 | 必填字段缺失时用文本前 30 字作为 title，其余字段留空 |
| 后端 API 返回非 200 | 解析错误信息，告知用户具体原因 |
| 后端服务未启动 | 提示"请先启动后端服务（端口 8080）" |
| curl 超时（> 30s） | 提示超时，建议重试 |
| 文本包含 URL | 提取 sourceUrl 字段，type 设为 link-ai |
| 文本含 Markdown 表格/代码 | 保留原格式，作为 content 字段 |

## 5. 验证计划

1. 待办：`"入库：明天下午3点前完成报告，高优先级"` → todo
2. 剪藏：AI 分析报告长文 → clip (ai-text)
3. 知识：`"TCP 三次握手：SYN → SYN-ACK → ACK..."` → knowledge
4. 话题：`"分享一个好用工具：xxx，地址是..."` → topic
5. 模糊：`"今天天气不错"` → clip (store-only 降级)
6. 异常：后端未启动 → 友好提示