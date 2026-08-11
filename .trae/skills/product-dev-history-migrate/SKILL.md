---
name: product-dev-history-migrate
description: 历史存量需求迁移 — 扫描 TODO/ 目录下的历史需求文档，解析并生成 feature-points.json，供后端扫描落库使用。
---

# 历史存量需求迁移 Skill

## 概述

当用户执行"历史迁移"操作时，此 skill 扫描 `TODO/` 目录下的历史需求文档（排除已有 `feature-points.json` 的目录），解析 Markdown 文件内容，提取结构化信息，生成 `feature-points.json` 文件。后端启动时扫描 TODO 目录，自动将这些存量需求落库为剪藏和待办。

## 扫描规则

### 扫描目录

| 目录 | 说明 | 处理方式 |
|------|------|---------|
| `TODO/{需求目录}/` | 中长需求目录，含主线任务说明、子任务规格等 | 解析为需求 + 功能点 |
| `TODO/bugs/` | Bug 历史目录 | 跳过，不处理 |

### 跳过条件

- 目录下已存在 `feature-points.json` → 跳过
- 目录下已存在 `.imported` 标记文件 → 跳过
- 目录下无任何 md 文件 → 跳过

### 文件解析规则

对于每个 Markdown 文件，按文件名前缀和内容关键词映射：

| 文件名模式 | 内容关键词 | 映射类型 |
|-----------|-----------|---------|
| `01-*.md` 主线任务 | 需求、计划、目标 | requirement（需求分析） |
| `02-*.md` 规格 | 规格、spec、设计 | design（设计文档） |
| `03-*.md` 实施 | 任务、实施、开发 | 待办项 |
| `04-*.md` 验收 | 验收、checklist、测试 | 待办项（验收） |
| 其他 `.md` | 包含"设计/架构" | 设计文档 |
| 其他 `.md` | 包含"需求/分析" | 需求分析 |
| 其他 `.md` | 包含"任务/待办" | 待办项 |

### 解析策略

1. **读取文件内容**：完整读取 Markdown 文件
2. **提取标题**：解析 h1/h2/h3 作为章节结构
3. **提取列表项**：解析 `- [ ]` / `- [x]` 作为待办项
4. **生成 featurePoints**：
   - 每个子任务（如"子任务1：xxx"）映射为一个 featurePoint
   - 每个 featurePoint 关联对应的 clips 和 todos
   - 按层级（前端/后端）分类

## 输出

### 生成的 feature-points.json

写入 `TODO/{需求目录}/feature-points.json`，格式与 `product-dev-archive` skill 一致。

### 迁移报告

迁移完成后输出摘要：

```
历史迁移完成
- 扫描目录数: 5
- 生成 feature-points.json: 3
- 跳过（已有）: 1
- 跳过（无内容）: 1
- 提取功能点: 12
- 提取剪藏: 15
- 提取待办: 42
```

## 执行流程

```
1. 扫描 TODO/ 目录下的子目录
2. 对每个子目录：
   a. 检查是否已有 feature-points.json 或 .imported → 跳过
   b. 读取目录下所有 md 文件
   c. 按文件名前缀和内容关键词分类
   d. 提取需求标题、摘要、功能点
   e. 生成 feature-points.json
   f. 写入 .imported 标记文件
3. 输出迁移报告
```

## 注意事项

- 不修改原始文件，只读取不写入（除 feature-points.json 和 .imported）
- 重复迁移检测：通过 `feature-points.json` 和 `.imported` 存在性判断
- 迁移完成后，后端启动时自动扫描 TODO 目录并落库
- 如果存量目录结构不规范，尽量按最佳匹配解析，标记 `phase: "completed"`（历史需求视为已完成）