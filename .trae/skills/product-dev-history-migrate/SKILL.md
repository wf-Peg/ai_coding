---
name: product-dev-history-migrate
description: 历史存量需求迁移 — 扫描 TODO/ 和 .trae/specs/ 目录下的历史需求文档，解析并映射为产品开发工作区可导入的格式文件。
---

# 历史存量需求迁移 Skill

## 概述

当用户执行"历史迁移"操作时，此 skill 扫描 `TODO/` 和 `.trae/specs/` 目录下的历史需求文档，解析 Markdown 文件内容，提取结构化信息，生成 `{storagePath}/product-dev/migrations/` 目录下的导入格式文件。后端启动时扫描该目录，自动解析入库。

## 扫描规则

### 扫描目录

| 目录 | 说明 | 映射类型 |
|------|------|---------|
| `TODO/` | 中长需求目录，含主线任务说明、子任务规格等 | 需求 + 知识 |
| `.trae/specs/` | 已完成的 spec 文档目录 | 知识 + 待办 |
| `.trae/documents/` | 项目文档目录 | 知识 |

### 文件解析规则

对于每个 Markdown 文件：

1. **读取 frontmatter**（如果有）：提取 title, tags, type 等元数据
2. **解析 Markdown 标题**：提取 h1/h2/h3 作为结构化章节
3. **内容映射**：
   - 包含"需求分析"、"spec"、"规格"等关键词 → 映射为 requirement（phase: analysis）
   - 包含"设计"、"架构"、"技术方案"等关键词 → 映射为 knowledge
   - 包含"待办"、"TODO"、"任务"等关键词 → 映射为 todo
   - 包含"实现"、"编码"、"开发"等关键词 → 映射为 requirement（phase: implementation）
   - 包含"测试"、"验收"、"checklist"等关键词 → 映射为 requirement（phase: testing）

### 输出格式

写入 `{storagePath}/product-dev/migrations/{yyMMdd-HHmmss}-migrate-{source}.json`：

```json
{
  "source": "TODO/xxx/01-xxx.md 等",
  "records": [
    {
      "type": "requirement|knowledge|todo",
      "title": "标题",
      "description": "描述",
      "phase": "analysis|design|implementation|testing|completed",
      "tags": ["标签"],
      "content": "完整 Markdown 内容",
      "sourcePath": "原始文件路径"
    }
  ]
}
```

### 执行流程

```
用户点击"历史迁移"按钮
    ↓
扫描 TODO/、.trae/specs/、.trae/documents/ 目录
    ↓
对每个 Markdown 文件：
    ├── 读取 frontmatter 元数据
    ├── 按标题结构解析内容
    ├── 按关键词匹配映射为目标类型
    └── 生成结构化记录
    ↓
写入 migrations 目录下的 JSON 文件
    ↓
调用后端 POST /api/product-dev/migrate 触发入库
    ↓
显示迁移结果（成功数/失败数）
```

### 注意事项

- 不修改原始文件，只读取不写入
- 重复迁移检测：检查目标文件是否已存在，避免重复导入
- 迁移完成后，在活动日志中记录迁移操作