---
name: product-dev-archive
description: 产品开发归档 — agent 完成编码任务后自动执行，将需求分析、设计、实现等全流程数据按约定格式写入 TODO 目录，后端启动时扫描该目录自动落库为剪藏和待办。
---

# 产品开发归档 Skill

## 概述

当 agent 完成一个需求或子任务后，**自动执行此 skill**，将需求的全流程数据按约定格式写入 `TODO/{需求中文概述}/` 目录。后端启动时扫描 TODO 目录，解析 `feature-points.json`，自动落库为剪藏和待办。

## 核心约定文件：feature-points.json

### 存放路径

`TODO/{需求中文概述}/feature-points.json`

### 完整结构

```json
{
  "version": "1.0",
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
      "clips": [
        {
          "title": "剪藏标题",
          "contentFile": "02-设计文档.md",
          "section": "## 某章节",
          "category": "product-dev/design",
          "tags": ["product-dev", "设计文档"]
        }
      ],
      "todos": [
        {
          "title": "待办标题",
          "priority": "high",
          "status": "done"
        }
      ]
    }
  ],
  "config": {
    "clipCategory": "product-dev",
    "todoCategory": "product-dev",
    "autoTag": "product-dev"
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 固定 `"1.0"` |
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
| `featurePoints[].clips` | object[] | 否 | 该功能点对应的剪藏内容 |
| `featurePoints[].clips[].title` | string | 是 | 剪藏标题 |
| `featurePoints[].clips[].contentFile` | string | 是 | 同目录下的 md 文件名 |
| `featurePoints[].clips[].section` | string | 否 | 指定 md 文件中的章节标题（如 `"## 某章节"`） |
| `featurePoints[].clips[].category` | string | 是 | 剪藏分类，如 `"product-dev/design"` |
| `featurePoints[].clips[].tags` | string[] | 是 | 剪藏标签 |
| `featurePoints[].todos` | object[] | 否 | 该功能点对应的待办项 |
| `featurePoints[].todos[].title` | string | 是 | 待办标题 |
| `featurePoints[].todos[].priority` | string | 是 | `high` / `medium` / `low` |
| `featurePoints[].todos[].status` | string | 是 | `todo` / `done` |
| `config.clipCategory` | string | 是 | 剪藏落库分类，默认 `"product-dev"` |
| `config.todoCategory` | string | 是 | 待办落库分类，默认 `"product-dev"` |
| `config.autoTag` | string | 是 | 自动追加标签，默认 `"product-dev"` |

## 执行流程

### 首次归档（目录不存在）

```
1. 识别当前需求，确定需求中文概述
2. 创建 TODO/{需求中文概述}/ 目录
3. 创建 feature-points.json 初始结构
4. 根据当前完成内容：
   ├── 需求分析 → 写入 01-需求分析.md → 追加 clips
   ├── 设计文档 → 写入 02-设计文档.md → 追加 clips
   ├── 实施任务 → 写入 03-实施任务.md → 追加 todos（标记 done）
   └── 验收清单 → 写入 04-验收清单.md → 追加 todos
5. 更新 phase 和 completedAt
```

### 增量归档（目录已存在）

```
1. 读取现有 feature-points.json
2. 根据本次完成内容：
   ├── 新增功能点 → 追加 featurePoints，id 按最大编号 +1
   ├── 追加剪藏 → 追加到对应 featurePoint.clips
   ├── 追加待办 → 追加到对应 featurePoint.todos
   └── 更新已有待办状态 → 修改 status 为 done
3. 更新对应 md 文件（追加新章节）
4. 更新 phase 和 completedAt
```

### 落库（可选，后端扫描会自动处理）

```
POST /api/clip/add
{
  "title": "剪藏标题",
  "content": "从 md 文件读取的内容",
  "category": "product-dev/design",
  "tags": ["product-dev", "设计文档"],
  "source": "product-dev-archive"
}

POST /api/todo/add
{
  "title": "待办标题",
  "priority": "high",
  "category": "product-dev",
  "completed": true
}
```

## 归档时机

- **每个子任务完成时**：增量归档当前子任务的知识点和待办状态
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

1. **tags 必须包含 `"product-dev"`**：确保后端扫描后自动标记，工作台规则能筛选到
2. **featurePoints.id 唯一**：按数字递增，不要重复
3. **contentFile 必须是同目录下的文件名**：不含路径前缀
4. **大需求拆分**：需求较大时按功能点拆分为多个 featurePoints，每个功能点独立产出剪藏和待办
5. **剪藏做源内容存储**：不做 AI 自动分析，只存原始内容
6. **待办使用计划模式**：agent 开发完成后标记 status 为 `done`
7. **功能点标签预留**：tags 字段为后续自动整合为知识做铺垫，本期不开发