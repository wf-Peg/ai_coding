# 产品开发工作区 — 规格文档

## 1. 概述

### 1.1 背景
现有工作台模块已作为 `index.html` 中的一个 tab（`workspaceView`）嵌入，提供了基于规则的只读视图、看板、建议等功能。但缺乏：
- **产品开发全流程管理**：从需求分析到开发完成的完整归档与追溯
- **数据可视化**：需求进度、待办完成率、知识积累等统计图表
- **跨模块全链路打通**：剪藏、知识、待办、Wiki 模块的有机联动
- **自动归档机制**：Agent 完成任务后自动将过程数据写入产品开发工作区
- **历史存量迁移**：将 TODO/ 和 .trae/ 目录下的历史需求文档一键迁移到产品开发工作区

### 1.2 目标
1. **增强工作台 tab**：在现有工作台模块中新增「产品开发」子视图，兼容现有 tab 结构
2. **数据可视化**：需求看板、进度统计、甘特图、知识图谱预览
3. **扩展通用性**：模块化设计，支持后续扩展更多工作区类型
4. **自动归档 Skill**：Agent 完成后自动归档到剪藏、知识、待办、Wiki
5. **历史存量迁移 Skill**：处理 TODO/ 和 .trae/ 目录下的历史需求文档，自动映射为可导入的格式文件
6. **agent.md 更新**：约束 Agent 每次完成任务后执行归档，以及存量迁移的触发方式

---

## 2. 功能规格

### 2.1 工作台 tab 增强（现有 workspace.html 改造）

#### 2.1.1 导航结构扩展
在 `workspace.html` 的侧边栏 `sidebar-nav` 中新增「产品开发」入口：

```html
<button class="sidebar-nav-item" data-view="product-dev" type="button">
  <span class="icon">&#9881;</span> 产品开发
</button>
```

点击后切换到产品开发工作区视图，而不是现有的 overview/detail 视图。

#### 2.1.2 产品开发工作区视图（新增视图层）

**视图结构：**

```
产品开发工作区
├── 总览仪表盘 (Dashboard)
│   ├── 需求统计卡片（总数/进行中/已完成/已归档）
│   ├── 进度趋势图（按周/月）
│   ├── 待办完成率环形图
│   ├── 知识积累折线图
│   └── 最近活动列表
├── 需求列表 (Requirements)
│   ├── 需求看板（Kanban 风格：待分析/分析中/设计中/开发中/测试中/已完成）
│   ├── 需求表格（可排序、筛选、搜索）
│   └── 需求详情弹窗（关联剪藏/知识/待办/Wiki）
├── 知识图谱 (Knowledge Graph)
│   ├── 需求-知识关联图（力导向图）
│   └── 模块依赖关系图
├── 时间线 (Timeline)
│   ├── 甘特图（需求计划 vs 实际进度）
│   └── 里程碑标记
└── 归档记录 (Archive)
    └── 自动归档的历史需求列表
```

#### 2.1.3 数据可视化组件

采用轻量级图表库（如 Chart.js CDN 或纯 CSS/SVG 实现），避免引入构建工具：

| 图表类型 | 用途 | 数据源 |
|---------|------|--------|
| 统计卡片 | 需求总数、进行中、已完成 | `/api/workspace/product-dev/stats` |
| 环形图 | 待办完成率 | `/api/workspace/product-dev/todo-stats` |
| 折线图 | 知识积累趋势 | `/api/workspace/product-dev/knowledge-trend` |
| 柱状图 | 各阶段需求分布 | `/api/workspace/product-dev/phase-distribution` |
| 力导向图 | 需求-知识关联 | `/api/workspace/product-dev/relation-graph` |
| 甘特图 | 需求时间线 | `/api/workspace/product-dev/timeline` |

#### 2.1.4 数据模型扩展

```json
{
  "productDev": {
    "requirements": [
      {
        "id": "req-20260808-001",
        "title": "需求标题",
        "description": "需求描述",
        "phase": "analysis",        // analysis | design | development | testing | completed | archived
        "priority": "high",          // high | medium | low
        "createdAt": "2026-08-08T10:00:00",
        "updatedAt": "2026-08-08T10:00:00",
        "completedAt": null,
        "tags": ["前端", "Electron"],
        "relatedClips": [1, 2, 3],
        "relatedKnowledge": [1, 2],
        "relatedTodos": [1, 2, 3],
        "relatedWikiPages": ["启动模式设计"],
        "timeline": {
          "plannedStart": "2026-08-08",
          "plannedEnd": "2026-08-15",
          "actualStart": "2026-08-08",
          "actualEnd": null
        },
        "milestones": [
          { "title": "需求评审", "date": "2026-08-09", "completed": true }
        ],
        "archive": {
          "clips": [...],
          "knowledge": {...},
          "todos": [...],
          "wiki": {...}
        }
      }
    ],
    "settings": {
      "autoArchive": true,
      "archivePath": "~/.cutshelter/product-dev-archive.json"
    }
  }
}
```

### 2.2 后端 API 扩展

#### 2.2.1 新增接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace/product-dev/stats` | 获取产品开发统计 |
| GET | `/api/workspace/product-dev/todo-stats` | 待办完成率统计 |
| GET | `/api/workspace/product-dev/knowledge-trend` | 知识积累趋势 |
| GET | `/api/workspace/product-dev/phase-distribution` | 各阶段需求分布 |
| GET | `/api/workspace/product-dev/relation-graph` | 需求-知识关联图数据 |
| GET | `/api/workspace/product-dev/timeline` | 甘特图时间线数据 |
| GET | `/api/workspace/product-dev/requirements` | 需求列表（支持分页/筛选） |
| POST | `/api/workspace/product-dev/requirements` | 创建需求 |
| PUT | `/api/workspace/product-dev/requirements/{id}` | 更新需求 |
| DELETE | `/api/workspace/product-dev/requirements/{id}` | 删除需求 |
| POST | `/api/workspace/product-dev/archive` | 自动归档（由 Skill 或后端定时调用） |
| GET | `/api/workspace/product-dev/archive/list` | 归档历史列表 |

#### 2.2.2 数据存储

- 存储路径：`{configDir}/index/product-dev.json`
- 使用现有的 `FileStorageService` 机制读写
- 与现有工作台索引数据在同一目录，便于统一管理

### 2.3 产品开发工作区归档 Skill

#### 2.3.1 Skill 定义

在 `.trae/skills/product-dev-archive/` 目录创建：

```markdown
# product-dev-archive — 产品开发工作区归档 Skill

## 触发时机
每次 Agent 完成剪藏应用的开发任务后自动执行。

## 功能
按后端格式要求将需求分析、设计、开发过程写入本地文件，
后端启动后（或定时）读取该文件，自动解析为产品开发工作区的：
- 剪藏（Clip）：原始需求、会议记录、讨论内容
- 知识（Knowledge）：设计文档、架构方案、技术决策
- 待办（Todo）：子任务、验收项、Bug 修复
- Wiki：产品文档、架构说明、使用手册

## 归档文件路径
`~/.cutshelter/product-dev-archive.json`

## 数据格式
{
  "requirementId": "req-YYYYMMDD-XXX",
  "title": "需求标题",
  "description": "需求描述",
  "phase": "completed",
  "clips": [
    {
      "title": "原始需求描述",
      "content": "...",
      "category": "product-dev/requirements",
      "tags": ["需求分析"],
      "source": "product-dev-archive"
    },
    {
      "title": "会议讨论记录",
      "content": "...",
      "category": "product-dev/meetings",
      "tags": ["会议"],
      "source": "product-dev-archive"
    }
  ],
  "knowledge": {
    "title": "设计文档：XXX",
    "summary": "一句话摘要",
    "content": "Markdown 格式的完整设计文档",
    "category": "product-dev/design",
    "tags": ["设计文档"],
    "sourceClipIds": [1, 2]
  },
  "todos": [
    {
      "title": "子任务描述",
      "priority": "high",
      "category": "product-dev",
      "completed": true
    }
  ],
  "wiki": {
    "title": "功能模块说明",
    "content": "Markdown 格式的 Wiki 页面内容",
    "pageType": "entity"
  }
}

## 后端解析流程
1. 后端启动时扫描 `~/.cutshelter/product-dev-archive.json`
2. 解析每个归档条目：
   - 调用 POST /api/clip/add 创建剪藏
   - 调用 POST /api/knowledge 创建知识
   - 调用 POST /api/todo/add 创建待办
   - 通过 WikiPageService 创建 Wiki 页面
3. 创建完成后，将归档标记为已处理
4. 通过 WebSocket 或 IPC 通知前端刷新
```

#### 2.3.2 Skill 注册

在 `.trae/skills/product-dev-archive/SKILL.md` 中注册，确保 Agent 能自动发现并调用。

### 2.4 agent.md 更新

在 `agent.md` 末尾追加以下内容：

```markdown
## 产品开发工作区归档约束

### 归档触发
每次完成需求开发后，必须执行以下步骤：

1. **整理归档数据**：按产品开发工作区数据格式，整理本次需求的：
   - 原始需求描述 → 剪藏（Clip）
   - 设计文档/技术方案 → 知识（Knowledge）
   - 子任务列表 → 待办（Todo）
   - 产品文档/架构说明 → Wiki

2. **写入归档文件**：将上述数据写入 `~/.cutshelter/product-dev-archive.json`

3. **调用后端接口**：将归档数据通过 HTTP 请求写入后端：
   - 调用 `POST /api/clip/add` 创建剪藏
   - 调用 `POST /api/knowledge` 创建知识
   - 调用 `POST /api/todo/add` 创建待办
   - 调用 `POST /api/wiki/archive` 或通过 WikiPageService 创建 Wiki 页面

4. **关联需求**：将创建的剪藏/知识/待办/Wiki 的 ID 关联到产品开发工作区的需求记录中

### 数据格式规范

#### 剪藏（Clip）格式
POST /api/clip/add
{
  "title": "需求标题",
  "content": "需求详细内容（Markdown）",
  "type": "text",
  "category": "product-dev/requirements",
  "tags": ["product-dev", "需求分析"],
  "source": "product-dev-archive"
}

#### 知识（Knowledge）格式
POST /api/knowledge
{
  "title": "设计文档标题",
  "summary": "一句话摘要",
  "content": "Markdown 格式的完整内容",
  "category": "product-dev/design",
  "tags": ["product-dev", "设计文档"],
  "sourceClipIds": [1, 2]
}

#### 待办（Todo）格式
POST /api/todo/add
{
  "title": "任务描述",
  "priority": "high|medium|low",
  "category": "product-dev",
  "completed": false
}

#### Wiki 格式
目前 Wiki 通过 WikiPageService 以文件方式管理，可通过以下方式创建：
1. 直接写入 Vault 中的 Wiki 目录
2. 调用 POST /api/wiki/archive 接口归档为 synthesis 页面

### 归档示例
完整示例见 `.trae/skills/product-dev-archive/SKILL.md`
```

### 2.5 前端页面样式

#### 2.5.1 产品开发工作区视图样式

在 `workspace.html` 中新增样式，与现有设计系统保持一致：

```css
/* ── 产品开发工作区 ── */
.product-dev-view { display: none; }
.product-dev-view.visible { display: block; }

/* 仪表盘卡片 */
.pd-dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
.pd-card { padding: 20px; border: 1px solid var(--ws-border); border-radius: var(--app-radius-lg); background: var(--ws-surface); }
.pd-card-value { font-size: 28px; font-weight: 700; color: var(--ws-primary); }
.pd-card-label { font-size: 12px; color: var(--ws-muted); margin-top: 4px; }
.pd-card-trend { font-size: 11px; margin-top: 8px; }

/* 图表容器 */
.pd-chart { width: 100%; height: 200px; position: relative; }
.pd-chart canvas { width: 100% !important; height: 100% !important; }

/* 需求看板 */
.pd-kanban { display: flex; gap: 12px; overflow-x: auto; padding: 8px 0 16px; }
.pd-kanban-col { flex: 1; min-width: 200px; max-width: 280px; border: 1px solid var(--ws-border); border-radius: var(--app-radius-lg); background: var(--ws-subtle); }
.pd-kanban-col-header { padding: 12px 14px 8px; border-bottom: 1px solid var(--ws-border); font-size: 13px; font-weight: 650; }
.pd-kanban-card { padding: 12px; margin: 8px; border: 1px solid var(--ws-border); border-radius: var(--app-radius); background: var(--ws-surface); cursor: pointer; }
.pd-kanban-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); }

/* 知识图谱 */
.pd-graph { width: 100%; height: 400px; border: 1px solid var(--ws-border); border-radius: var(--app-radius-lg); overflow: hidden; }

/* 甘特图 */
.pd-timeline { width: 100%; overflow-x: auto; }
.pd-gantt { display: grid; grid-template-columns: 200px 1fr; gap: 0; min-width: 600px; }
.pd-gantt-labels { border-right: 1px solid var(--ws-border); }
.pd-gantt-bars { position: relative; }
.pd-gantt-bar { position: absolute; height: 24px; border-radius: 4px; background: var(--ws-primary); opacity: 0.8; }
```

---

## 3. 技术方案

### 3.1 前端

#### 3.1.1 图表库选择
- 使用 **Chart.js** CDN（`https://cdn.jsdelivr.net/npm/chart.js`）用于统计图表
- 使用纯 CSS/SVG 实现甘特图，避免额外依赖
- 力导向图使用 D3.js CDN（`https://d3js.org/d3.v7.min.js`）

#### 3.1.2 视图切换
在 `workspace.html` 的侧边栏增加 `data-view="product-dev"` 按钮，点击后：
1. 隐藏 overview 和 detail 视图
2. 显示产品开发工作区视图
3. 加载对应的 JS 逻辑（内联在 workspace.html 中或独立 JS 文件）

#### 3.1.3 数据流
- 所有产品开发数据通过 `/api/workspace/product-dev/*` 接口获取
- 使用 `fetch` + async/await 模式
- 数据缓存：使用 `sessionStorage` 或内存缓存，减少重复请求
- 实时更新：通过 `setInterval` 定时刷新（30 秒）

### 3.2 后端

#### 3.2.1 新增 Controller
创建 `ProductDevController.java`，路径 `/api/workspace/product-dev`

#### 3.2.2 新增 Service
创建 `ProductDevService.java`，负责：
- 需求 CRUD
- 统计数据聚合
- 归档文件解析
- 与 ClipService、KnowledgeService、TodoService、WikiPageService 的联动

#### 3.2.3 数据模型
创建 `ProductDevRequirement.java` 模型类，包含所有需求字段。

#### 3.2.4 归档解析
创建 `ProductDevArchiveService.java`，负责：
- 启动时扫描归档文件
- 解析并调用各 service 创建数据
- 标记已处理条目
- 记录处理日志

### 3.3 Skill 设计

共设计两个 Skill，分工明确：

| Skill | 触发时机 | 用途 |
|-------|---------|------|
| `product-dev-archive` | 每次 Agent 完成开发任务后自动执行 | 增量归档当前需求 |
| `product-dev-history-migrate` | 用户手动调用 / 首次启动时一键执行 | 存量迁移历史需求 |

#### 3.3.1 product-dev-archive（增量归档 Skill）

**文件结构**
```
.trae/skills/product-dev-archive/
├── SKILL.md          # Skill 定义
├── archive.sh        # 归档脚本（可选）
└── template.json     # 归档模板
```

**执行流程**
1. Agent 完成开发任务
2. 自动调用 `product-dev-archive` skill
3. Skill 读取当前完成的需求信息
4. 按格式写入 `~/.cutshelter/product-dev-archive.json`
5. 调用后端 API 创建数据
6. 更新 agent.md 中的归档记录

#### 3.3.2 product-dev-history-migrate（存量迁移 Skill）

**用途**
将项目中已有的历史需求文档（TODO/ 目录和 .trae/specs/ 目录下的 .md 文件）一键迁移到产品开发工作区，补齐存量数据，使产品开发工作区从一开始就拥有完整的历史记录。

**文件结构**
```
.trae/skills/product-dev-history-migrate/
├── SKILL.md              # Skill 定义
├── migrate.sh            # 迁移脚本（可选）
└── template.json         # 迁移模板
```

**执行流程**
1. 用户手动调用 `product-dev-history-migrate` skill（或首次启动时自动检测）
2. Skill 扫描以下目录结构：

```
TODO/
├── <需求目录>/
│   ├── 01-主线任务说明.md     → 解析为需求本身 + 知识（设计文档）
│   ├── 02-子任务规格.md       → 解析为知识（规格文档）
│   ├── 03-子任务实施任务.md    → 解析为待办列表
│   ├── 04-子任务验收清单.md    → 解析为待办（验收项）
│   └── ...其他.md
├── bugs/
│   └── bug-history.md        → 解析为剪藏（Bug 记录）
└── 其他需求/...

.trae/specs/<change-id>/
├── spec.md                   → 解析为知识（规格文档）
├── tasks.md                  → 解析为待办列表
└── checklist.md              → 解析为待办（验收项）
```

3. 解析规则：

| 源文件 | 目标类型 | 映射逻辑 |
|--------|---------|---------|
| `01-主线任务说明.md` | 需求 + 知识 | 文件名作为需求标题，内容作为剪藏，提取设计决策作为知识 |
| `02-子任务规格.md` | 知识 | 规格详情作为知识条目 |
| `03-子任务实施任务.md` | 待办 | 每个任务项拆分为一个待办 |
| `04-子任务验收清单.md` | 待办 | 每个验收项拆分为一个待办，标记为验收类 |
| `bug-history.md` | 剪藏 | 每条 Bug 记录作为一条剪藏 |
| `spec.md` | 知识 | 完整规格文档作为知识 |
| `tasks.md` | 待办 | 任务列表作为待办 |
| `checklist.md` | 待办 | 验收项作为待办 |
| `commit_history.log` | 时间线 | 提交记录作为需求时间线的事件 |

4. 输出格式

```json
{
  "version": "1.0",
  "generatedAt": "2026-08-08T10:00:00Z",
  "source": "history-migration",
  "migrationSummary": {
    "totalRequirements": 5,
    "totalClips": 15,
    "totalKnowledge": 8,
    "totalTodos": 42,
    "totalWikiPages": 3
  },
  "requirements": [
    {
      "requirementId": "req-history-001",
      "title": "工作台与数据层重构需求",
      "sourcePath": "TODO/工作台与数据层重构需求/",
      "description": "从主线任务说明中提取的摘要...",
      "phase": "completed",
      "completedAt": "2026-07-15T00:00:00Z",
      "clips": [
        {
          "title": "主线任务：工作台与数据层重构",
          "content": "从 01-主线任务说明.md 读取的完整内容",
          "category": "product-dev/requirements",
          "tags": ["product-dev", "历史迁移", "工作台"],
          "source": "product-dev-history-migrate"
        }
      ],
      "knowledge": [
        {
          "title": "规格文档：工作台只读骨架",
          "summary": "从 02-子任务规格.md 提取的摘要",
          "content": "完整 Markdown 内容",
          "category": "product-dev/spec",
          "tags": ["product-dev", "历史迁移", "规格"],
          "sourceClipIds": []
        }
      ],
      "todos": [
        {
          "title": "实现内容索引加载",
          "priority": "high",
          "category": "product-dev",
          "completed": true,
          "source": "03-子任务实施任务.md"
        },
        {
          "title": "验收：内容索引加载正常",
          "priority": "medium",
          "category": "product-dev/checklist",
          "completed": true,
          "source": "04-子任务验收清单.md"
        }
      ]
    }
  ]
}
```

5. 写入统一的归档文件：`~/.cutshelter/product-dev-archive.json`（与增量归档 Skill 共用同一文件）
6. 后端启动时统一解析，区分 source 字段（`product-dev-archive` vs `product-dev-history-migrate`）

**使用场景**
- 首次部署产品开发工作区时，一键迁移所有历史需求
- 后续新增历史项目时，手动调用迁移指定目录
- 支持通过参数指定扫描路径：`product-dev-history-migrate --path=TODO/某个历史需求`

---

## 4. 数据结构定义

### 4.1 归档文件 JSON 结构

```json
{
  "version": "1.0",
  "generatedAt": "2026-08-08T10:00:00Z",
  "requirements": [
    {
      "requirementId": "req-20260808-001",
      "title": "启动模式优化",
      "description": "取消 Lite 版本，支持三种启动模式...",
      "phase": "completed",
      "completedAt": "2026-08-08T10:00:00Z",
      "clips": [
        {
          "title": "需求文档：启动模式优化",
          "content": "## 原始需求\n\n取消 Lite 版本...",
          "category": "product-dev/requirements",
          "tags": ["product-dev", "启动模式"],
          "source": "product-dev-archive"
        }
      ],
      "knowledge": {
        "title": "设计文档：启动模式优化方案",
        "summary": "设计了三种启动模式：完全启动、前端先行、前端异步后端",
        "content": "# 启动模式优化方案\n\n## 架构设计\n\n...",
        "category": "product-dev/design",
        "tags": ["product-dev", "启动模式", "架构设计"],
        "sourceClipIds": []
      },
      "todos": [
        {
          "title": "实现 frontend-only 模式",
          "priority": "high",
          "category": "product-dev",
          "completed": true
        },
        {
          "title": "实现 frontend-async-backend 模式",
          "priority": "high",
          "category": "product-dev",
          "completed": true
        }
      ],
      "wiki": {
        "title": "启动流程架构",
        "content": "# 启动流程架构\n\n## 三种模式\n\n...",
        "pageType": "entity"
      }
    }
  ]
}
```

### 4.2 后端 API 响应格式

```json
// GET /api/workspace/product-dev/stats
{
  "totalRequirements": 5,
  "activeRequirements": 2,
  "completedRequirements": 3,
  "archivedRequirements": 0,
  "totalTodos": 15,
  "completedTodos": 10,
  "totalKnowledge": 4,
  "totalWikiPages": 3
}

// GET /api/workspace/product-dev/phase-distribution
{
  "labels": ["待分析", "分析中", "设计中", "开发中", "测试中", "已完成"],
  "data": [1, 2, 0, 1, 0, 3]
}

// GET /api/workspace/product-dev/relation-graph
{
  "nodes": [
    { "id": "req-1", "label": "启动模式优化", "type": "requirement", "group": 1 },
    { "id": "knowledge-1", "label": "启动模式设计文档", "type": "knowledge", "group": 1 }
  ],
  "edges": [
    { "source": "req-1", "target": "knowledge-1", "relation": "设计文档" }
  ]
}
```

---

## 5. 数据可视化设计

### 5.1 仪表盘
- 4 个统计卡片：总需求、进行中、已完成、待办完成率
- 2 个趋势图：知识积累趋势（折线）、待办完成率（环形）
- 最近活动列表：显示最近 10 条归档记录

### 5.2 需求看板
- 6 列看板：待分析、分析中、设计中、开发中、测试中、已完成
- 支持拖拽切换阶段
- 点击卡片显示需求详情

### 5.3 知识图谱
- 力导向图展示需求与知识的关联
- 节点颜色区分类型（需求/知识/待办/Wiki）
- 悬停显示详情，点击跳转

### 5.4 甘特图
- 横轴为时间（周/日）
- 纵轴为需求列表
- 条形表示计划/实际时间范围
- 里程碑标记为菱形

---

## 6. 扩展性设计

### 6.1 模块化架构
- 产品开发工作区作为独立模块，不耦合现有工作台逻辑
- 通过 `data-view` 属性切换，便于后续添加更多工作区类型
- 图表组件独立封装，可复用

### 6.2 插件化规则
- 后续可配置不同工作区类型的规则模板
- 归档文件格式支持版本升级
- 后端 API 设计为 RESTful 风格，便于扩展

### 6.3 数据兼容
- 不破坏现有工作台数据结构和 API
- 新增数据存储独立文件，不影响已有索引
- 归档文件格式支持向前兼容

---

## 7. 实施计划

### 7.1 阶段一：前端视图（2 天）
1. 在 workspace.html 中新增产品开发工作区视图
2. 实现仪表盘、统计卡片
3. 集成 Chart.js 图表
4. 实现需求看板

### 7.2 阶段二：后端 API（2 天）
1. 创建 ProductDevController
2. 创建 ProductDevService
3. 实现数据模型和存储
4. 实现统计接口

### 7.3 阶段三：归档 Skill（1 天）
1. 创建 SKILL.md
2. 实现归档文件生成逻辑
3. 实现后端归档解析服务

### 7.4 阶段四：集成与文档（1 天）
1. 更新 agent.md
2. 前后端联调
3. 测试与验收