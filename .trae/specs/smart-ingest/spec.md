# 智能入库（Smart Ingest）Spec

## Why

用户粘贴任意文本后，需手动选择类型、分类、标签等参数才能入库，操作链路长。需要一个统一入口，自动识别意图并路由到对应模块。

## What Changes

- **新增** `POST /api/ingest` 统一智能入库接口，接收 `{ text }`，AI 识别意图后路由入库
- **新增** `AiService.identifyIntent()` / `extractFields()` 两个 AI 方法
- **新增** `.trae/skills/smart-ingest/SKILL.md` TRAE Agent Skill
- **修改** 浏览器插件 `options.js/html` + `popup.js/html` + `background.js`，新增智能入库模式
- **修改** `frontend/clip.html`，新增智能入库入口按钮
- **不改动** 现有剪藏/待办/话题接口，保持完全兼容

## Impact

- Affected specs: 无（新功能）
- Affected code: `AiService.java`, `IngestController.java`(新), `background.js`, `options.js`, `options.html`, `popup.js`, `popup.html`, `clip.html`, `.trae/skills/smart-ingest/SKILL.md`(新)

## ADDED Requirements

### Requirement: 统一智能入库接口
系统 SHALL 提供 `POST /api/ingest` 端点，接收 `{ text }` 参数，自动识别意图并入库。

#### Scenario: 待办入库
- **WHEN** 调用方 POST `{ "text": "明天下午3点前完成报告，高优先级" }`
- **THEN** 系统识别 intent=todo，提取 title/priority/deadline，调用 TodoService 保存，返回 `{ success, intent:"todo", id, title }`

#### Scenario: 剪藏入库
- **WHEN** 调用方 POST `{ "text": "TCP 三次握手: SYN → SYN-ACK → ACK..." }`
- **THEN** 系统识别 intent=clip，提取 title/content/summary/tags，调用 ClipService 保存，返回 `{ success, intent:"clip", id, title }`

#### Scenario: 话题入库
- **WHEN** 调用方 POST `{ "text": "推荐 Obsidian 笔记工具，支持双向链接" }`
- **THEN** 系统识别 intent=topic，提取 title/summary/content/tags，调用 TopicService 保存，返回 `{ success, intent:"topic", id, title }`

#### Scenario: AI 失败降级
- **WHEN** AI 意图识别或字段提取失败
- **THEN** 系统降级为 clip store-only，原文即内容，返回 `{ success, intent:"clip", degraded:true }`

#### Scenario: 参数校验失败
- **WHEN** text 缺失、为空、或少于 5 字符
- **THEN** 返回 400 `{ success:false, error, errorType:"validation" }`

### Requirement: 统一响应格式
系统 SHALL 对所有调用方返回统一格式的 JSON 响应。

#### Scenario: 成功响应
- **WHEN** 入库成功
- **THEN** 返回 `{ "success": true, "intent": "clip|todo|topic", "id": <number>, "title": "<string>", "redirect": "<string>" }`

#### Scenario: 降级响应
- **WHEN** AI 分析失败但数据已安全存储
- **THEN** 返回 `{ "success": true, "intent": "clip", "id": <number>, "title": "<string>", "degraded": true, "degradedReason": "<string>", "redirect": "<string>" }`

#### Scenario: 错误响应
- **WHEN** 请求或处理失败
- **THEN** 返回 `{ "success": false, "error": "<string>", "errorType": "validation|storage_failed|internal_error" }`

### Requirement: TRAE Agent Skill
系统 SHALL 提供 `smart-ingest` Skill，Agent 侧执行意图识别和字段提取后调用后端已有接口。

#### Scenario: Skill 待办入库
- **WHEN** 用户说"入库：明天下午3点前完成报告，高优先级"
- **THEN** Agent 识别 intent=todo，提取字段，curl 调用 `POST /api/todo/add`，告知用户结果

#### Scenario: Skill 后端不可用
- **WHEN** curl 连接 8081 端口失败
- **THEN** Agent 提示"请先启动后端服务（端口 8081）"

### Requirement: 浏览器插件智能入库
插件 SHALL 支持智能入库模式，调用 `POST /api/ingest`。

#### Scenario: 智能入库按钮
- **WHEN** 用户在 popup 点击"智能入库"
- **THEN** 插件将 textarea 内容 POST 到 `/api/ingest`，显示结果

#### Scenario: 兼容现有剪藏
- **WHEN** 用户使用现有剪藏表单
- **THEN** 行为与重构前完全一致，不受影响

## MODIFIED Requirements

无。不改动现有接口。

## REMOVED Requirements

无。

---

## 附录：接口文档

### POST /api/ingest — 智能入库

**描述**: 接收任意文本，AI 自动识别意图（剪藏/待办/话题）并路由入库。

**请求**:
```
POST /api/ingest
Content-Type: application/json
```

**请求体**:
```json
{ "text": "明天下午3点前完成报告，高优先级" }
```

**成功响应** (200):
```json
{
  "success": true,
  "intent": "todo",
  "id": 42,
  "title": "完成报告",
  "redirect": "/api/todo/42"
}
```

**降级响应** (200, AI失败但数据已存储):
```json
{
  "success": true,
  "intent": "clip",
  "id": 99,
  "title": "明天下午3点前完成...",
  "degraded": true,
  "degradedReason": "AI 意图识别失败，已降级存储为剪藏",
  "redirect": "/api/clip/99"
}
```

**校验失败** (400):
```json
{ "success": false, "error": "内容不能为空", "errorType": "validation" }
```

**存储失败** (500):
```json
{ "success": false, "error": "存储失败: ...", "errorType": "storage_failed" }
```

**响应字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| intent | string | 识别意图: clip/todo/topic |
| id | number | 存储后的记录ID |
| title | string | 提取的标题 |
| redirect | string | 跳转路径 |
| degraded | boolean | (可选) 是否降级存储 |
| degradedReason | string | (可选) 降级原因 |
| error | string | (失败时) 错误信息 |
| errorType | string | (失败时) validation/storage_failed/internal_error |

**curl 示例**:
```bash
# 待办入库
curl -X POST http://localhost:8081/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"text":"明天下午3点前完成报告，高优先级"}'

# 剪藏入库
curl -X POST http://localhost:8081/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"text":"TCP 三次握手: SYN → SYN-ACK → ACK，是建立可靠连接的基础"}'

# 话题入库
curl -X POST http://localhost:8081/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"text":"推荐 Obsidian 笔记工具，支持双向链接和本地存储"}'
```

**意图识别规则**:
- clip（剪藏）：长文分析、URL、结构化报告、知识点、无明确行动项或待办属性的内容
- todo（待办）：含 deadline/时间限制、优先级、行动项、待办标记、提醒类内容
- topic（话题）：分享推荐、观点讨论、社交讨论、对话内容

**降级策略**:
- AI 意图识别失败 → 降级为 clip 存储
- AI 字段提取失败 → 降级为 clip store-only，原文即内容
- 降级时仍返回 200，success=true，附带 degraded=true