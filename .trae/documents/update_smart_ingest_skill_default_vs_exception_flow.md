# 计划：更新 smart-ingest Skill 区分默认流程与例外流程

## 背景与目标

用户反馈：默认发送的内容应该由 agent 完成"分析+意图分类+字段提取"后，再调用对应的具体接口入库；只有用户**明确指定**时才走特殊路径。

当前 SKILL.md 的问题：
- 默认流程与例外流程没有明确区分
- 没有说明"智能剪藏"对应 `/api/ingest`（后端 AI 处理）
- 没有说明"剪藏到话题"是强制走 `/api/topic`（跳过 agent 意图识别）

## 后端接口清单（Phase 1 探索结论）

| 接口 | 路径 | 入参 | 处理逻辑 |
|------|------|------|---------|
| 智能入库 | `POST /api/ingest` | `{"text": "原文"}` | 后端 AI 自主做意图识别+字段提取+路由入库 |
| 直接剪藏 | `POST /api/clip/add` | 完整 ClipRequest（title/content/tags/category/sourceUrl/siteName 等） | 直接存储，agent 已整理好字段 |
| 直接待办 | `POST /api/todo/add` | 完整 TodoContent（title/priority/deadline/deadlineTime/category） | 直接存储 |
| 创建话题 | `POST /api/topic` | 完整 TopicRequest（title/summary/content/category/tags） | 直接创建话题 |
| 从剪藏升级话题 | `POST /api/topic/from-clip/{clipId}` | path 参数 clipId | 把已存在的剪藏转换为话题（本次方案不使用） |

## 默认 vs 例外流程定义

### 默认流程（agent 自主处理）
1. agent 接收用户原始文本
2. agent 做意图识别（clip / todo / topic）
3. agent 提取结构化字段
4. **根据识别的意图**调用对应具体接口：
   - `intent=clip` → `POST /api/clip/add`
   - `intent=todo` → `POST /api/todo/add`
   - `intent=topic` → `POST /api/topic`

### 例外流程（用户明确指定类型）
用户在指令中**明确指定类型关键词**时，agent **跳过意图识别**，直接按指定类型走对应接口：

| 用户关键词 | 走的接口 | 说明 |
|----------|---------|------|
| "智能剪藏"、"智能入库"、"smart clip"、"ingest"、"后端AI处理" | `POST /api/ingest` | **特殊路径**：agent 不做字段提取，只传 `{"text": 原文}`，让后端 AI 全权处理 |
| "剪藏到话题"、"作为话题入库"、"添加话题"、"创建话题"、"topic入库" | `POST /api/topic` | 跳过意图识别，强制按话题整理字段入库 |
| "添加剪藏"、"剪藏入库"、"保存为剪藏"、"clip入库"、"clip this" | `POST /api/clip/add` | 跳过意图识别，强制按剪藏整理字段入库 |
| "添加待办"、"创建待办"、"新建待办"、"todo入库"、"todo this" | `POST /api/todo/add` | 跳过意图识别，强制按待办整理字段入库 |

## 修改方案

### 修改文件
- `f:/30_Projects (行动项目)/31_Work (主要工作)/ai_coding/.trae/skills/smart-ingest/SKILL.md`（项目级）
- `C:/Users/pengwenfeng/.trae-cn/skills/smart-ingest/SKILL.md`（全局级，通过 PowerShell 同步）

### 修改内容

#### 1. 在 "概述" 章节后新增"流程决策树"章节

新增决策树明确路由逻辑：

```
用户发送内容
    ↓
检查是否含"强制类型关键词"
    ↓
┌───────────────┬──────────────┐
│ 含关键词       │ 无关键词      │
└───────┬───────┴──────┬───────┘
        ↓              ↓
   走例外流程       走默认流程
        ↓              ↓
   按关键词         agent 做意图识别
   选定接口         + 字段提取
        ↓              ↓
   入库            按识别意图调对应接口
```

#### 2. 新增"强制类型关键词识别"章节

把上方表格完整写入 SKILL.md，明确每个关键词对应的接口。

#### 3. 重写"调用后端接口"章节

按以下结构重新组织：

**3.1 默认流程接口（agent 已整理字段）**
- `POST /api/clip/add`（intent=clip 时调用）
- `POST /api/todo/add`（intent=todo 时调用）
- `POST /api/topic`（intent=topic 时调用）

**3.2 例外流程接口**
- `POST /api/ingest`（用户说"智能剪藏"/"智能入库"时调用，只传 text）
- `POST /api/clip/add`（用户说"添加剪藏"时调用，强制作为剪藏）
- `POST /api/todo/add`（用户说"添加待办"时调用，强制作为待办）
- `POST /api/topic`（用户说"剪藏到话题"/"添加话题"时调用，强制作为话题）

每个接口保留：请求体字段、使用场景、PowerShell 调用模板。

#### 4. 重写"使用示例"章节

保留现有示例，但每个示例明确标注是"默认流程"还是"例外流程"：

**默认流程示例**：
- 示例 1：用户说"入库：明天下午3点前完成报告" → 默认流程 → intent=todo → `/api/todo/add`
- 示例 2：用户说"把这篇文章存起来：TCP三次握手详解..." → 默认流程 → intent=clip → `/api/clip/add`
- 示例 3：用户说"入库这个帖子：V2EX 上大家推荐..." → 默认流程 → intent=clip → `/api/clip/add`（资源汇总必须保留应用名+网址）

**例外流程示例**（新增）：
- 示例 4：用户说"智能剪藏这个内容：xxx" → 例外流程 → `/api/ingest`（只传 text）
- 示例 5：用户说"剪藏到话题：关于AI发展的讨论..." → 例外流程 → `/api/topic`（强制作为话题，跳过意图识别）
- 示例 6：用户说"添加待办：完成月报" → 例外流程 → `/api/todo/add`（强制作为待办）

#### 5. 保留章节（不修改）

- **资源完整性要求**：保留所有现有约束（应用名+网址必须保留）
- **重试机制**：保留 3 次重试 + 延迟 0/2/5 秒策略
- **平台兼容性**：保留 Windows 用 `Invoke-WebRequest` + UTF-8 字节数组
- **异常处理**：保留 5 条异常处理规则

#### 6. 新增"接口选择优先级"章节

明确优先级规则：
1. **用户明确指定类型** > 一切（最高优先级）
2. **agent 意图识别结果** > 默认降级（clip）
3. **字段提取失败** > 降级为 clip，使用原文作为 content

## 同步策略

项目级 SKILL.md 修改完成后，使用 PowerShell 脚本同步到全局：
- 源：`f:/30_Projects (行动项目)/31_Work (主要工作)/ai_coding/.trae/skills/smart-ingest/SKILL.md`
- 目标：`C:/Users/pengwenfeng/.trae-cn/skills/smart-ingest/SKILL.md`
- 编码：UTF-8 无 BOM
- 验证：SHA-256 哈希对比 + BOM 检查

## 假设与决策

### 假设
1. 用户原话"智能剪藏"= `POST /api/ingest`（已通过 AskUserQuestion 确认）
2. 用户原话"剪藏到话题"= `POST /api/topic`（已通过 AskUserQuestion 确认）
3. 默认流程下，intent=topic 时也调用 `/api/topic`（与"剪藏到话题"接口相同，但路径不同——默认走 agent 整理，例外跳过 agent 整理）

### 决策
1. **不使用** `/api/topic/from-clip/{clipId}`：用户明确"剪藏到话题"= `/api/topic`，不需要从已有剪藏升级
2. **保留** `/api/ingest` 作为"特殊路径"：因为它让后端 AI 二次处理，与 agent 自主处理是互斥的两种模式
3. **关键词识别采用包含匹配**：用户说"智能剪藏这个"或"用智能剪藏"都应识别为例外流程
4. **不修改后端代码**：本次只更新 SKILL.md，后端接口逻辑保持不变

## 验证步骤

1. **文件验证**：
   - 项目级和全局级 SKILL.md SHA-256 一致
   - 全局级文件无 BOM
   - 关键章节齐全：流程决策树、关键词识别、默认流程接口、例外流程接口、使用示例

2. **逻辑验证**（阅读 SKILL.md 自检）：
   - 默认流程是否覆盖 clip/todo/topic 三种意图
   - 例外流程是否覆盖 4 种关键词场景（智能剪藏/添加剪藏/添加待办/剪藏到话题）
   - 资源完整性要求是否保留
   - 重试机制是否保留

3. **运行时验证**（可选，由用户执行）：
   - 测试 1：发送"入库：完成月报" → 应走默认流程，agent 识别为 todo，调用 `/api/todo/add`
   - 测试 2：发送"智能剪藏这个：xxx" → 应走例外流程，调用 `/api/ingest`
   - 测试 3：发送"剪藏到话题：关于AI..." → 应走例外流程，调用 `/api/topic`

## 执行步骤

1. 用 Write 工具重写项目级 SKILL.md（基于上述修改方案）
2. 用 PowerShell 脚本同步到全局目录（包含 SHA-256 验证）
3. 输出验证结果（文件大小、SHA、BOM、关键章节存在性检查）
