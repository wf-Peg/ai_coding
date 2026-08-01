# 智能入库 Skill 实现计划

## 目标

将系统基础功能（剪藏、待办、话题）整理为一个 TRAE Agent Skill，用户粘贴任意文本，Agent 自动识别意图并调用后端 API 入库。同时向后端补齐统一入库接口供外部调用，并重构浏览器插件。

## 交付物

| # | 交付物 | 文件 |
|---|--------|------|
| 1 | Skill 指令文件 | `.trae/skills/smart-ingest/SKILL.md` |
| 2 | 后端统一入库接口 | `IngestController.java` + `AiService.java` 新增方法 |
| 3 | 对外接口文档 | 包含在 Skill 文件中 + 本计划附录 |
| 4 | 浏览器插件重构 | `options.js/html` + `popup.js/html` + `background.js` |

## 架构

```
┌─ Agent 路径 ─────────────────────────────────────┐
│  用户粘贴文本 → Skill(AI 意图识别+字段提取)        │
│    → curl 调用后端已有接口(clip/add|todo/add|topic)│
└──────────────────────────────────────────────────┘

┌─ 代码路径 ───────────────────────────────────────┐
│  浏览器插件/前端/外部 → POST /api/ingest { text } │
│    → IngestController(AI 意图识别+字段提取+路由)   │
│    → 返回 { success, intent, id, title }          │
└──────────────────────────────────────────────────┘
```

两条路径内部逻辑等价，区别是 AI 计算在 Agent 侧还是后端侧。

## 实现步骤

### Step 1: 创建 Skill 文件

**文件**：`.trae/skills/smart-ingest/SKILL.md`

这是核心交付物。Skill 指令包含：

**1. 意图识别规则**：Agent 分析文本，判断属于 clip / todo / topic 之一

| 意图 | 特征 | 示例 |
|------|------|------|
| `clip` | 长文、报告、URL、无明确行动项 | "TCP 三次握手过程..." |
| `todo` | deadline、优先级、行动项 | "明天下午3点前完成报告，高优" |
| `topic` | 分享推荐、观点讨论 | "推荐 Obsidian 这个笔记工具" |

**2. 字段提取**：Agent 根据意图从文本中提取结构化字段，直接映射到后端 API 参数

| 意图 | 提取字段 | 目标 API |
|------|----------|----------|
| clip | title, content, summary, analysis, tags, category, sourceUrl | `POST /api/clip/add` |
| todo | title, priority, deadline, deadlineTime, category | `POST /api/todo/add` |
| topic | title, summary, content, tags, category | `POST /api/topic` |

**3. curl 调用模板**：Agent 用 RunCommand 执行 curl，请求对应的后端接口

**4. 异常处理**：
- 后端未启动 → 提示启动服务
- 意图模糊 → 降级为 clip store-only
- 字段提取失败 → 原文前 30 字作 title
- curl 超时 → 提示重试

### Step 2: 后端新增 IngestController

**文件**：`IngestController.java`（POST /api/ingest）

与 Skill 逻辑一致，但在后端用 Java 实现。注入 AiService 做意图识别和字段提取，路由到各 Service。

**文件**：`AiService.java`（新增 `identifyIntent` + `extractFields`）

### Step 3: 浏览器插件重构

**修改 5 个文件**（不影响现有功能）：

| 文件 | 改动 |
|------|------|
| `options.js` | DEFAULT_CONFIG 新增 `ingestUrl: 'http://localhost:8081/api/ingest'` |
| `options.html` | 新增智能入库 API 地址配置项 |
| `popup.js` | 新增 `handleSmartIngest()` 函数 |
| `popup.html` | 表单下方新增"智能入库"按钮 |
| `background.js` | 新增 `smartIngest` message handler，响应适配 `{ success }` 格式 |

### Step 4: 前端入口

`clip.html` textarea 旁增加"智能入库"按钮。

### Step 5: 编译验证 + 提交推送

## 对外接口文档

### POST /api/ingest

```
POST http://localhost:8081/api/ingest
Content-Type: application/json

{ "text": "..." }
```

**响应**：

成功 — `{ success: true, intent: "todo", id: 123, title: "...", redirect: "/api/todo/123" }`

降级 — `{ success: true, intent: "clip", id: 123, title: "...", degraded: true, degradedReason: "..." }`

失败 — `{ success: false, error: "...", errorType: "validation|storage_failed|internal_error" }`