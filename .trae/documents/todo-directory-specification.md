# TODO 目录规范

## 概述

`TODO/` 目录是产品开发工作区的**数据源目录**。Agent 完成编码任务后，自动将需求产出写入该目录；后端启动时扫描该目录，解析 `feature-points.json` 并自动落库为剪藏和待办。

## 目录结构

```
TODO/
├── {需求中文概述}/                    # 子目录名即需求概述，例如 "产品开发工作区设计"
│   ├── feature-points.json          # ★ 核心约定文件（前后端共享解析规则）
│   ├── 01-需求分析.md              # 原始需求、分析结论、会话摘要
│   ├── 02-设计文档.md              # 技术方案、架构设计、接口定义
│   ├── 03-实施任务.md              # 可拆分的子任务列表
│   ├── 04-验收清单.md              # 验收项 checklist
│   └── .imported                    # 导入标记文件（后端写入，记录导入时间戳）
├── bugs/                            # Bug 历史记录目录（保留不动）
│   └── bug-history.md
└── ... (其他存量目录，保留不动)
```

## 子目录命名规则

- 使用**需求的中文概述**作为子目录名
- 示例：`产品开发工作区设计`、`启动模式优化`、`剪藏列表性能优化`
- 简洁明了，能概括需求核心内容
- 避免使用特殊字符（`/` `\` `:` `*` `?` `"` `<` `>` `|`）

## 核心约定文件：feature-points.json

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
      "layer": "frontend",
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

### 字段详解

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 固定 `"1.0"`，用于后续格式升级 |
| `requirement.title` | string | 是 | 需求中文概述，与子目录名一致 |
| `requirement.summary` | string | 是 | 一句话描述需求，显示在列表中 |
| `requirement.tags` | string[] | 是 | 需求标签，**必须包含 `"product-dev"`** |
| `requirement.phase` | string | 是 | 需求阶段：`analysis` / `design` / `implementation` / `testing` / `completed` |
| `requirement.createdAt` | string | 是 | 需求创建时间，ISO 8601 格式 |
| `requirement.completedAt` | string | 否 | 需求完成时间，ISO 8601 格式 |
| `featurePoints` | object[] | 是 | 功能点列表，至少 1 个 |
| `featurePoints[].id` | string | 是 | 唯一标识，格式 `fp-001`，按数字递增 |
| `featurePoints[].name` | string | 是 | 功能点名称 |
| `featurePoints[].description` | string | 是 | 功能点描述 |
| `featurePoints[].layer` | string | 是 | 所属层级：`frontend` / `backend` / `fullstack` |
| `featurePoints[].tags` | string[] | 是 | 功能点标签，必须包含 `"product-dev"` |
| `featurePoints[].clips` | object[] | 否 | 该功能点对应的剪藏内容 |
| `featurePoints[].clips[].title` | string | 是 | 剪藏标题 |
| `featurePoints[].clips[].contentFile` | string | 是 | 同目录下的 md 文件名 |
| `featurePoints[].clips[].section` | string | 否 | 指定 md 文件中的章节标题（如 `"## 某章节"`） |
| `featurePoints[].clips[].category` | string | 是 | 剪藏分类，如 `"product-dev/design"` |
| `featurePoints[].clips[].tags` | string[] | 是 | 剪藏标签 |
| `featurePoints[].todos` | object[] | 否 | 该功能点对应的待办项 |
| `featurePoints[].todos[].title` | string | 是 | 待办标题 |
| `featurePoints[].todos[].priority` | string | 是 | 优先级：`high` / `medium` / `low` |
| `featurePoints[].todos[].status` | string | 是 | 状态：`todo` / `done` |
| `config.clipCategory` | string | 是 | 剪藏落库分类，默认 `"product-dev"` |
| `config.todoCategory` | string | 是 | 待办落库分类，默认 `"product-dev"` |
| `config.autoTag` | string | 是 | 自动追加标签，默认 `"product-dev"` |

## 内容文件规范

### 01-需求分析.md

```markdown
# 需求分析：{需求中文概述}

## 原始需求
（原始需求描述）

## 分析结论
（分析结果）

## 会话摘要
（与 agent 的交互摘要）
```

### 02-设计文档.md

```markdown
# 设计文档：{需求中文概述}

## 功能点 fp-001：{功能点名称}

### 架构设计
...

### 技术方案
...

### 接口定义
...

### 关键决策
...

## 功能点 fp-002：{功能点名称}
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
...
```

### 04-验收清单.md

```markdown
# 验收清单：{需求中文概述}

## 功能点 fp-001：{功能点名称}

- [x] 验收项1
- [x] 验收项2

## 功能点 fp-002：{功能点名称}
...
```

## 导入标记文件：.imported

后端扫描到 TODO 目录并成功导入后，会在子目录下写入 `.imported` 文件：

```json
{
  "importedAt": "2026-08-10T18:00:00",
  "featurePointIds": ["fp-001", "fp-002"]
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `importedAt` | 最近一次导入时间（ISO 8601），用于审计 |
| `featurePointIds` | 已导入的功能点 id 列表，用于增量导入幂等判断 |

后端每次启动时：

1. 检查子目录是否存在 `feature-points.json`
2. 读取 `.imported` 中的 `featurePointIds`
3. 对每个 featurePoint，仅导入 id 未出现在 `featurePointIds` 中的功能点
4. 导入完成后更新 `.imported`（追加新功能点 id、刷新 importedAt）

**兼容说明**：旧版纯文本时间戳格式的 `.imported` 无法解析时，视为全新导入处理。

## 存量处理策略

### 已有 feature-points.json 的目录

正常走扫描导入流程。

### 没有 feature-points.json 的存量目录

走 `product-dev-history-migrate` skill 迁移：
1. 扫描目录下所有 md 文件
2. 按文件名前缀和内容关键词分类
3. 生成 `feature-points.json`
4. 写入 `.imported` 标记文件
5. 后端启动时正常导入

### bugs/ 目录

不处理，保留不动。

## 前后端解析约定

### 前端约定

- 读取 `featurePoints[].layer` 区分前后端功能点
- 读取 `featurePoints[].tags` 渲染标签筛选
- 读取 `requirement.phase` 展示需求阶段

### 后端约定

- 读取 `config` 确定落库分类和标签
- 读取 `featurePoints[].clips[]` 创建剪藏
- 读取 `featurePoints[].todos[]` 创建待办
- 通过 `featurePoints[].id` 判断是否已导入
- 通过 `.imported` 文件判断是否需要增量导入

## 版本升级策略

- 当前版本 `"1.0"`
- 后续版本升级时，`version` 字段递增
- 后端扫描时根据 `version` 选择对应的解析器
- 旧版本文件保持兼容，不强制迁移