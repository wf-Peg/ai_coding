# 产品开发工作区 — MVP 规格文档（重写）

## 1. 概述

### 1.1 背景与问题

现有工作台模块（`workspace.html`）已具备基于规则的只读视图、看板、建议等功能，剪藏和待办模块也已成熟。但每次与编码 agent 的交互（需求分析→设计→开发→验收）产生的设计产出，**缺少自动归档到系统剪藏/待办模块的机制**，导致设计记录丢失、无法追溯。

原有 spec 设计过重（仪表盘、甘特图、知识图谱、独立 ProductDev 数据存储），**数据链路是断的**——agent 产出没有真正落库到剪藏/待办。本次 MVP 聚焦核心：**打通链路，让 agent 产出自动落库为剪藏和待办，通过工作台规则系统展示**。

### 1.2 MVP 目标

1. **Agent 自动归档**：编码 agent 完成需求/子任务后，自动调用 skill 写入 TODO 目录
2. **后端扫描落库**：后端启动时扫描 TODO 目录，解析 `feature-points.json`，自动创建剪藏和待办
3. **工作台规则筛选**：「产品开发」作为系统内置工作台，通过规则自动筛选 `tag=product-dev` 的内容
4. **存量迁移**：处理 TODO/ 目录下的历史需求文档，生成 `feature-points.json` 后走正常导入流程

### 1.3 MVP 非目标

- ❌ 知识（Knowledge）自动落库 → 二期
- ❌ Wiki 自动落库 → 二期
- ❌ 知识图谱、甘特图 → 后续
- ❌ 功能点自动整合为知识 → 后续（tags 预留）
- ❌ 独立 ProductDev 数据存储 → 废弃，复用剪藏/待办/工作台系统

---

## 2. 核心链路

```
Agent 完成编码任务
    ↓ 自动调用 product-dev-archive skill
写入 TODO/{需求中文概述}/
    ├── feature-points.json     ← ★ 核心约定文件（前后端共享解析规则）
    ├── 01-需求分析.md          ← → 剪藏 Clip（类型: requirement）
    ├── 02-设计文档.md          ← → 剪藏 Clip（类型: design）
    ├── 03-实施任务.md          ← → 待办 Todo（按功能点拆分）
    └── 04-验收清单.md          ← → 待办 Todo（验收项）
    ↓ 后端启动时扫描 TODO/ 目录
后端 TodoScannerService
    ├── 解析 feature-points.json → 提取功能点标签、归类
    ├── ClipService.saveClip() → 剪藏（源内容存储，标记功能点标签）
    └── TodoService.saveTodo() → 待办（status=done 映射为已完成）
    ↓
产品开发工作台（系统内置 workspace pd-builtin）
    └── 规则：tag=product-dev / type=clip,todo / category 包含 product-dev
    └── 筛选该工作台后，导览/看板/剪藏/知识模块只显示该工作台数据
```

---

## 3. TODO 目录新规范

### 3.1 目录结构

```
TODO/
├── {需求中文概述}/                    # 子目录名即需求概述
│   ├── feature-points.json          # ★ 核心约定文件
│   ├── 01-需求分析.md              # 原始需求、分析结论、会话摘要
│   ├── 02-设计文档.md              # 技术方案、架构设计、接口定义
│   ├── 03-实施任务.md              # 可拆分的子任务列表
│   ├── 04-验收清单.md              # 验收项 checklist
│   └── .imported                    # 导入标记文件（记录导入时间戳）
├── bugs/                            # 保留现有
│   └── bug-history.md
└── ... (存量目录，保留不动)
```

### 3.2 feature-points.json — 核心约定文件

```json
{
  "version": "1.0",
  "requirement": {
    "title": "需求中文概述",
    "summary": "一句话需求概述",
    "tags": ["product-dev", "标签1", "标签2"],
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

### 3.3 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | string | 格式版本，当前 `"1.0"` |
| `requirement.title` | string | 需求中文概述，与子目录名一致 |
| `requirement.tags` | string[] | 需求标签，**必须包含 `"product-dev"`** |
| `requirement.phase` | string | 需求阶段：`analysis` / `design` / `implementation` / `testing` / `completed` |
| `featurePoints[].id` | string | 功能点唯一标识，格式 `fp-001` |
| `featurePoints[].layer` | string | 所属层级：`frontend` / `backend` / `fullstack` |
| `featurePoints[].clips[]` | object | 该功能点对应的剪藏，`contentFile` 指向同目录 md 文件 |
| `featurePoints[].clips[].section` | string | 可选，指定 md 文件中的章节标题 |
| `featurePoints[].todos[]` | object | 该功能点对应的待办项 |
| `featurePoints[].todos[].status` | string | `todo` / `done` |
| `config.clipCategory` | string | 剪藏落库分类，默认 `"product-dev"` |
| `config.todoCategory` | string | 待办落库分类，默认 `"product-dev"` |
| `config.autoTag` | string | 自动追加的标签，默认 `"product-dev"` |

### 3.4 存量文件处理

- 存量目录（如 `工作台与数据层重构需求/`）没有 `feature-points.json`，走 `product-dev-history-migrate` skill 迁移
- 迁移时解析 md 文件，自动生成 `feature-points.json`，然后走正常扫描导入流程
- 导入完成后写入 `.imported` 标记文件，避免重复导入

---

## 4. Skill 设计

### 4.1 product-dev-archive（增量归档 Skill）

**触发时机**：Agent 每次完成编码任务后自动执行

**执行流程**：

```
1. 识别当前需求（从 context 中获取需求中文概述）
2. 检查 TODO/{需求中文概述}/ 目录是否存在
   ├── 不存在 → 创建目录，初始化 feature-points.json
   └── 存在 → 读取现有 feature-points.json，增量更新
3. 根据本次完成的内容类型：
   ├── 需求分析 → 写入/更新 01-需求分析.md → 追加 featurePoints[].clips
   ├── 设计文档 → 写入/更新 02-设计文档.md → 追加 featurePoints[].clips
   ├── 实施任务 → 写入/更新 03-实施任务.md → 追加 featurePoints[].todos（标记 done）
   └── 验收清单 → 写入/更新 04-验收清单.md → 追加 featurePoints[].todos
4. 更新 feature-points.json 中的 phase 和 completedAt
5. （可选）调用后端接口立即落库：
   ├── POST /api/clip/add
   └── POST /api/todo/add
```

**约束**：
- 需求较大时拆分为多个功能点（featurePoints），每个功能点产出独立剪藏和待办
- 功能点标签（tags）预留为后续自动整合为知识做铺垫（本期不开发）
- 剪藏做源内容存储，不做 AI 自动分析
- 待办使用计划模式，agent 开发完成后标记已完成

### 4.2 product-dev-history-migrate（存量迁移 Skill）

**触发时机**：用户手动调用，或首次启动时自动检测

**执行流程**：

```
1. 扫描 TODO/ 目录下的子目录（排除 bugs/）
2. 对每个没有 feature-points.json 的子目录：
   a. 读取所有 md 文件
   b. 按标题结构解析内容
   c. 按关键词匹配映射为功能点和剪藏/待办
   d. 生成 feature-points.json
   e. 写入 .imported 标记文件
3. 输出迁移报告
```

---

## 5. 产品开发工作台 — 内置规则

### 5.1 工作台创建

产品开发工作台是**系统内置** workspace，在应用首次启动时自动创建（如果不存在）：

- **固定 ID**：`pd-builtin`（避免重复创建）
- **名称**：产品开发
- **描述**：系统自带的产品开发工作区，自动归集每次编码任务的产出
- **类型**：`project`
- **颜色**：`#2383e2`

### 5.2 内置规则

| 字段 | 操作符 | 值 | 说明 |
|------|--------|-----|------|
| `tag` | `equals` | `product-dev` | 核心规则：所有标记 product-dev 标签的内容 |
| `type` | `in` | `clip,todo` | 限定剪藏和待办类型 |
| `category` | `contains` | `product-dev` | 分类包含 product-dev |

### 5.3 规则效果

- 筛选「产品开发」工作台后，导览页和看板只显示满足上述规则的内容
- 剪藏模块和知识模块也只会出现该工作台的数据（通过 workspace 上下文过滤）
- 用户手动加入的内容不受规则限制，始终保留

---

## 6. 后端扫描落库服务

### 6.1 TodoScannerService

新增 `TodoScannerService`（`@Service`），由 `ProductDevWorkspaceInitializer`（`CommandLineRunner`）在应用启动时触发扫描；同时提供 `POST /api/todo-scan` 手动触发接口，供 Agent 增量归档后无需重启即可落库。

**扫描流程**：

```
1. 遍历 TODO/ 目录下的子目录（排除 bugs/）
2. 对每个子目录：
   a. 检查是否存在 feature-points.json
   b. 读取 .imported 标记（{importedAt, featurePointIds[]}）
   c. 解析 feature-points.json（字段约定见 §3.2）
   d. 对每个 featurePoint（仅处理 id 未导入过的）：
      - 遍历 clips[] → 读取 contentFile 对应 md 文件（可选 section 截取）→ ClipService.saveClip()
      - 遍历 todos[] → status=done 映射 completed=true → TodoService.saveTodo()
   e. 更新 .imported 标记（追加已处理功能点 id）
3. 记录扫描日志
```

### 6.2 重复导入防护

- `.imported` 标记文件为 JSON：`{ importedAt, featurePointIds[] }`，记录导入时间与已处理的功能点 id
- 每次启动读取 `featurePointIds`，仅导入 id 未出现在列表中的功能点（幂等）
- 导入完成后更新 `.imported`（追加新功能点 id、刷新 importedAt）
- 旧版纯文本 `.imported` 解析失败时视为全新导入，不崩溃

---

## 7. 前端页面复用策略

### 7.1 现有组件处理

| 现有组件 | 处理方式 |
|---------|---------|
| 仪表盘统计卡片 | 保留，数据从 `/api/workspace/{id}/resolution` 解析结果统计 |
| 需求看板（Kanban） | 保留，MVP 改为按内容类型分组（剪藏/待办）只读展示 |
| 知识图谱 | 预留口子，隐藏 tab |
| 甘特图 | 预留口子，隐藏 tab |
| 归档列表 | 保留，展示当前工作台解析到的内容 |
| 标签筛选条 | 保留，对解析结果本地过滤（featurePoints 的 tags） |

### 7.2 核心改动

产品开发工作区视图从独立数据源（`/api/product-dev/*`，已删除）切换为复用 workspace 系统：
- 数据入口：`GET /api/workspace/pd-builtin/resolution`（`WorkspaceResolutionView`）
- 仪表盘数据从 `WorkspaceResolution` 解析结果统计（剪藏数/待办数/总数）
- 看板按内容类型分组展示（剪藏 / 待办），MVP 阶段为只读展示
- 标签筛选条对解析结果本地过滤（`activePdTag`），子视图联动
- 归档列表展示当前工作台解析到的内容
- 知识图谱、甘特图 tab 隐藏（二期）
- 「立即扫描」按钮调用 `POST /api/todo-scan` 触发落库

---

## 8. agent.md 更新要点

在现有「产品开发归档」章节基础上更新：

1. **归档时机**：每次子任务完成时立即执行 skill
2. **TODO 目录规范**：子目录命名、feature-points.json 格式
3. **功能点拆分**：大需求按功能点拆分，每个功能点独立剪藏和待办
4. **后端接口调用**：skill 执行后可调用 `/api/clip/add` 和 `/api/todo/add`
5. **存量迁移**：首次使用时通过 `product-dev-history-migrate` skill 迁移存量

---

## 9. MVP 范围

| 功能 | MVP（本轮） | 后续 |
|------|-----------|------|
| TODO 目录规范 + feature-points.json | ✅ | - |
| Skill 自动写入 TODO 目录 | ✅ | - |
| 后端扫描落库（剪藏 + 待办） | ✅ | - |
| 产品开发工作台内置规则 | ✅ | - |
| 前端仪表盘（复用 workspace 数据） | ✅ | - |
| 前端看板（复用 workspace 看板） | ✅ | - |
| 存量迁移（product-dev-history-migrate） | ✅ | - |
| 知识（Knowledge）落库 | ❌ | 二期 |
| Wiki 落库 | ❌ | 二期 |
| 知识图谱 | ❌ | 二期 |
| 甘特图 | ❌ | 二期 |
| 功能点自动整合为知识 | ❌ | 后续（tags 预留） |

---

## 10. 实施计划

### 阶段一：文档与 Skill（本轮）
1. 重写 spec.md ← 当前
2. 更新 agent.md 产品开发归档章节
3. 重写 product-dev-archive SKILL.md
4. 更新 product-dev-history-migrate SKILL.md
5. 编写 TODO 目录规范文档

### 阶段二：后端实现（后续）
1. 创建 TodoScannerService
2. 实现 feature-points.json 解析
3. 实现剪藏和待办自动落库
4. 创建产品开发工作台内置规则

### 阶段三：前端适配（后续）
1. 产品开发工作区视图切换为复用 workspace 数据
2. 隐藏知识图谱和甘特图 tab
3. 归档列表改为展示 TODO 目录列表