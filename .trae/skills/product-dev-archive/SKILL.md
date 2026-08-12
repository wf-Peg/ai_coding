---
name: product-dev-archive
description: 产品开发归档 — agent 完成编码任务后自动执行，将需求分析、设计、实现等全流程数据按约定格式写入 TODO 目录，生成的 feature-points.json 直接服务于产品概览页展示。
---

# 产品开发归档 Skill

## 概述

当 agent 完成一个需求或子任务后，**自动执行此 skill**，将需求的全流程数据按约定格式写入 `TODO/{需求中文概述}/` 目录。生成的 `feature-points.json` 由产品概览页直接读取展示，无需经后端扫描落库。

## 核心约定文件：feature-points.json

### 存放路径

`TODO/{需求中文概述}/feature-points.json`

### 完整结构

```json
{
  "version": "2.0",
  "requirement": {
    "title": "需求中文概述",
    "summary": "一句话需求概述",
    "tags": ["product-dev", "标签1"],
    "phase": "completed",
    "createdAt": "2026-08-10T10:00:00",
    "completedAt": "2026-08-10T18:00:00"
  },
  "featurePoints": [
    {
      "id": "fp-001",
      "name": "功能点名称",
      "description": "功能点描述",
      "layer": "backend",
      "tags": ["product-dev", "标签"],
      "designSections": ["架构设计", "接口定义"],
      "tasks": [
        { "title": "子任务1", "status": "done" },
        { "title": "子任务2", "status": "done" }
      ],
      "verifications": [
        { "title": "验收项1", "status": "done" }
      ]
    }
  ],
  "knowledgePoints": [
    {
      "title": "关键技术决策",
      "content": "决策描述",
      "tags": ["product-dev", "技术"]
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 固定 `"2.0"` |
| `requirement.title` | string | 是 | 需求中文概述，与子目录名一致 |
| `requirement.summary` | string | 是 | 一句话描述需求 |
| `requirement.tags` | string[] | 是 | **必须包含 `"product-dev"`** |
| `requirement.phase` | string | 是 | `analysis` / `design` / `implementation` / `testing` / `completed` |
| `requirement.createdAt` | string | 是 | ISO 8601 格式 |
| `requirement.completedAt` | string | 否 | 需求完成时间 |
| `featurePoints[].id` | string | 是 | 唯一标识，格式 `fp-001`，按数字递增 |
| `featurePoints[].name` | string | 是 | 功能点名称 |
| `featurePoints[].description` | string | 是 | 功能点描述 |
| `featurePoints[].layer` | string | 是 | `frontend` / `backend` / `fullstack` |
| `featurePoints[].tags` | string[] | 是 | 必须包含 `"product-dev"` |
| `featurePoints[].designSections` | string[] | 否 | 设计文档中的章节标题，如 `["架构设计", "接口定义"]` |
| `featurePoints[].tasks[]` | object[] | 否 | 实施任务列表 |
| `featurePoints[].tasks[].title` | string | 是 | 任务描述 |
| `featurePoints[].tasks[].status` | string | 是 | `todo` / `done` |
| `featurePoints[].verifications[]` | object[] | 否 | 验收项列表 |
| `featurePoints[].verifications[].title` | string | 是 | 验收项描述 |
| `featurePoints[].verifications[].status` | string | 是 | `todo` / `done` |
| `knowledgePoints[]` | object[] | 否 | 知识积累（如关键技术决策、架构设计等） |
| `knowledgePoints[].title` | string | 是 | 知识标题 |
| `knowledgePoints[].content` | string | 是 | 知识内容 |
| `knowledgePoints[].tags` | string[] | 是 | 知识标签 |

## 执行流程

### 首次归档（目录不存在）

```
1. 识别当前需求，确定需求中文概述
2. 创建 TODO/{需求中文概述}/ 目录
3. 创建 feature-points.json 初始结构
4. 根据当前完成内容：
   ├── 需求分析 → 写入 01-需求分析.md
   ├── 设计文档 → 写入 02-设计文档.md，记录 designSections
   ├── 实施任务 → 追加 tasks（标记 done）
   └── 验收清单 → 追加 verifications
5. 记录 knowledgePoints 中的关键技术决策
6. 更新 phase 和 completedAt
```

### 增量归档（目录已存在）

```
1. 读取现有 feature-points.json
2. 根据本次完成内容：
   ├── 新增功能点 → 追加 featurePoints，id 按最大编号 +1
   ├── 追加 tasks → 追加到对应 featurePoint.tasks
   ├── 追加 verifications → 追加到对应 featurePoint.verifications
   └── 更新已有 tasks/verifications 状态 → 修改 status 为 done
3. 追加 knowledgePoints（去重，按 title 判断）
4. 更新对应 md 文件（追加新章节）
5. 更新 phase 和 completedAt
```

## 归档时机

- **每个子任务完成时**：增量归档当前子任务的 tasks、verifications 和 knowledgePoints
- **整个需求完成时**：归档完整需求，更新 phase 为 `completed`
- **Bug 修复完成时**：在对应需求目录下追加 bug 修复记录

## 内容文件规范

### 01-需求分析.md

```markdown
# 需求分析：{需求中文概述}

## 原始需求
...

## 分析结论
...

## 会话摘要
...
```

### 02-设计文档.md

```markdown
# 设计文档：{需求中文概述}

## 架构设计
...

## 技术方案
...

## 接口定义
...

## 关键决策
...
```

### 03-实施任务.md

```markdown
# 实施任务：{需求中文概述}

## 功能点 fp-001：{功能点名称}

- [x] 子任务1
- [x] 子任务2
- [ ] 子任务3

## 功能点 fp-002：{功能点名称}

- [x] 子任务1
...
```

### 04-验收清单.md

```markdown
# 验收清单：{需求中文概述}

## 功能点 fp-001：{功能点名称}

- [x] 验收项1
- [x] 验收项2

## 功能点 fp-002：{功能点名称}

- [x] 验收项1
...
```

## 注意事项

1. **tags 必须包含 `"product-dev"`**：确保产品概览页能筛选到该需求
2. **featurePoints.id 唯一**：按数字递增，不要重复
3. **knowledgePoints 按 title 去重**：增量归档时避免重复
4. **大需求拆分**：需求较大时按功能点拆分为多个 featurePoints，每个功能点独立记录 tasks 和 verifications
5. **设计文档章节对应 designSections**：记录本次设计涉及的关键章节标题，便于产品概览页展示设计范围