# 周报生成 Skill 设计方案

## 摘要

为剪藏项目新增 `weekly-report-gen` skill，用于按周生成工作周报 xlsx 文件。数据源为剪藏待办模块（todoList），通过 title 编码方式承载任务类型/工时/进度等元信息（不扩展 TodoContent 模型），AI 智能识别工作 vs 生活待办，最终输出到 `D:\develop\svnRep\信息科技部\1、职能管理\3、管理周报\2、软件开发跨组\2026\信贷核心\彭文峰\` 目录。后续配合 TRAE Schedule 在每周五 16:00 自动生成。

---

## 当前状态分析

### 周报模板结构（5 个 Sheet）

参考文件：`开发组_周报_20260717_彭文峰.xlsx`

| Sheet 名称 | 行×列 | 用途 | 关键列 |
|-----------|------|------|--------|
| 1.重点工作进度汇报 | 14×7 | 任务列表（精简） | 任务编号/任务名称/计划工时/完成工时/完成进度/本周情况/备注说明 |
| 2.主要工作说明 | 23×12 | 详细说明+工时汇总 | 左(A-F)：任务类型/本周内容/计划工时(h)/实际工时/本周计划完成情况(h)<br>右(H-J)：任务类型/计划工时(h)/本周占比<br>底部：应付工时合计/休假/合计 |
| 3.下周计划 | 20×5 | 下周计划任务 | 任务类型/任务类型/任务名称/下周计划(h)/备注 |
| 统计口径说明 | 103×6 | 任务类型枚举与说明 | 项目开发/需求分析/系统设计/详细设计/架构设计/开发自测/联调测试/缺陷/本周总结/下周计划 |
| 数据项定义 | 43×4 | 字段定义说明 | 周报内部字段说明（不参与填写） |

**任务类型枚举**（从「统计口径说明」提取）：
1. 项目开发（大类，含程序开发）
2. 需求分析
3. 系统设计
4. 详细设计
5. 架构设计
6. 开发自测
7. 联调测试
8. 缺陷
9. 本周总结（自动生成）
10. 下周计划（从待办 deadline 落在下周的提取）

### TodoContent 现状

文件：[TodoContent.java](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/model/TodoContent.java)

当前字段：`id, title, priority, deadline, deadlineTime, reminderEnabled, reminderMinutes, reminderFired, completed, createdAt, category, sourceClipId, sourceUrl`

**缺口**：缺少任务类型、计划工时、实际工时、进度。

### 用户决策

- ✅ 字段扩展：**title 中编码**（不扩展 TodoContent 模型）
- ✅ 本周时间范围：**本周一到本周日**
- ✅ 工作待办识别：**AI 智能识别**（基于 title 关键词）
- ✅ 前端待办创建 placeholder：从「写下要做的事情」改为任务结构范例

### 已有基础设施

- `GET /api/todo/list`（[TodoController.java#L60-L64](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/controller/TodoController.java#L60-L64)）— 返回所有待办（含 completed、createdAtTimestamp）
- `WeeklyReportService.java`（已存在）— 但仅基于剪藏内容，不基于待办，**不复用，独立新建 skill**
- PowerShell COM Excel 自动化已验证可用（本次探索时读取了周报模板）
- 现有 skill 格式约定参考 [smart-ingest SKILL.md](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/.trae/skills/smart-ingest/SKILL.md)

---

## Title 编码格式设计

### 格式

```
<任务内容描述>[<任务类型>,<计划工时>h,<完成进度>%]
```

### 字段说明

| 字段 | 必填 | 格式 | 示例 |
|------|------|------|------|
| 任务内容描述 | ✅ | 自由文本 | 度小满账务文件入账内容开发 |
| 任务类型 | ❌ | 枚举值（见下） | 需求分析 |
| 计划工时 | ❌ | 数字+h（支持小数） | 15h、4.5h |
| 完成进度 | ❌ | 0-100 整数+% | 30% |

### 任务类型枚举

```
项目开发、需求分析、系统设计、详细设计、架构设计、开发自测、联调测试、缺陷
```

### 解析规则（skill 内实现）

1. 提取末尾 `[...]` 中的内容（如无则全为任务描述）
2. 按逗号分割
3. 逐项识别：
   - 含"项目开发/需求分析/系统设计/详细设计/架构设计/开发自测/联调测试/缺陷"关键词 → taskType
   - 匹配 `^\d+(\.\d+)?h$` → plannedHours（去 h 转数字）
   - 匹配 `^\d+%$` → progress（去 % 转数字）
4. 默认值：taskType=项目开发，plannedHours=0，progress=（completed=true 则 100%，否则 0）

### 示例

| title | 解析结果 |
|-------|---------|
| `度小满账务文件入账内容开发[需求分析,15h,30%]` | type=需求分析, hours=15, progress=30% |
| `字节账务文件下载代码开发[项目开发,20h]` | type=项目开发, hours=20, progress=100% (completed) |
| `微众联调配合[联调测试,8h]` | type=联调测试, hours=8, progress=0% |
| `完成月报` | type=项目开发(默认), hours=0, progress=0% |
| `修复sftp连接超时缺陷[缺陷,2h]` | type=缺陷, hours=2, progress=0% |

---

## 提议的变更

### 变更 1：修改前端待办创建 placeholder

**文件**：[todo.html#L1212](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/todo.html#L1212)

**修改**：
```diff
- <input type="text" class="modal-input" id="inputTitle" placeholder="写下要做的事情…" maxlength="120" />
+ <input type="text" class="modal-input" id="inputTitle" placeholder="任务内容[类型,工时h,进度%] 例：账务开发[需求分析,15h,30%]" maxlength="120" />
```

**原因**：
- 引导用户按格式填写 title，便于周报 skill 解析
- 同时支持纯文本（无 `[]` 后缀），向后兼容

---

### 变更 2：新建 weekly-report-gen skill

**目录**：`f:/30_Projects (行动项目)/31_Work (主要工作)/ai_coding/.trae/skills/weekly-report-gen/`

**文件**：
- `SKILL.md` — skill 主配置（YAML front matter + Markdown 正文）

**SKILL.md 内容大纲**：

```markdown
---
name: weekly-report-gen
description: 周报生成 — 基于剪藏待办模块本周完成的任务，按周报模板填充 xlsx 文件，输出到周报目录。
---

# 周报生成 Skill

## 概述
- 数据源：剪藏待办（todoList）本周一 00:00 到本周日 23:59
- AI 智能识别工作待办（默认）/生活待办（忽略）
- 解析 title 中的 [任务类型,工时h,进度%] 编码
- 复制最近的周报模板，覆盖数据区生成新 xlsx
- 输出到：D:\develop\svnRep\信息科技部\1、职能管理\3、管理周报\2、软件开发跨组\2026\信贷核心\彭文峰\
- 文件名：开发组_周报_{本周五日期YYYYMMDD}_彭文峰.xlsx

## 触发场景
1. 用户说"生成周报"/"周报生成"/"weekly report"
2. TRAE Schedule 每周五 16:00 自动触发

## 流程
1. 计算本周时间范围（本周一 00:00 - 本周日 23:59）
2. 调用 GET /api/todo/list 获取所有待办
3. 按 createdAtTimestamp 过滤本周待办
4. AI 识别工作 vs 生活待办（关键词规则）
5. 解析 title 提取 taskType/plannedHours/progress
6. 按 taskType 分组：
   - 已完成（completed=true）→ 进度 100%
   - 进行中（completed=false，有 progress 编码）→ 当前进度
   - 未启动（completed=false，无 progress）→ 0%
7. 下周计划：completed=false 且 deadline 在下周的待办
8. 用 PowerShell 复制最近周报 xlsx 为模板
9. 用 COM Excel 自动化填充数据
10. 另存为本周五日期命名的新 xlsx

## Title 编码格式
[见上述设计]

## 任务类型枚举
项目开发、需求分析、系统设计、详细设计、架构设计、开发自测、联调测试、缺陷

## AI 工作待办识别规则
工作关键词：开发、设计、测试、联调、修复、缺陷、需求、上线、配置、优化、监控、迁移、对接、配合、文档、自测、代码、sftp、API、数据库、接口、加工、入账、对账、清算...
生活关键词：购物、家庭、旅行、生活、健康、运动、读书、买菜、缴费、聚会、生日...
规则：含工作关键词 → 工作；含生活关键词 → 生活；都不含 → 默认工作

## xlsx 填充规则
### Sheet 1 - 重点工作进度汇报
- A 列：任务编号（按顺序 P001、P002...）
- B 列：任务名称（title 去除 [..] 后缀的部分）
- C 列：计划工时（plannedHours）
- D 列：完成工时（progress=100% 时 = plannedHours；否则 = plannedHours × progress/100）
- E 列：完成进度（progress + "%"）
- F 列：本周情况（completed ? "已完成" : "进行中"）
- G 列：备注（sourceUrl 如有）

### Sheet 2 - 主要工作说明
左半部分（A-F）：按 taskType 分组填入：
- A 列：任务类型
- B 列：本周内容（同类型任务 title 拼接）
- C 列：计划工时(h)（同类型任务 plannedHours 求和）
- D 列：实际工时（同类型任务 D 列求和）
- E 列：（空）
- F 列：本周计划完成情况(h)（同 C 列）

右半部分（H-J）：自动汇总：
- H 列：任务类型
- I 列：计划工时(h)（同类型求和）
- J 列：本周占比（该类型工时 / 总工时）

底部：
- H15：应付工时合计 | I15：应付工时 | J15：工时比 | K15：休假 | L15：合计
- H16：第N周 | I16：总工时 | K16：0 | L16：总工时

### Sheet 3 - 下周计划
- A 列：任务类型
- B 列：任务类型（重复填充，模板要求）
- C 列：任务名称（title）
- D 列：下周计划(h)（plannedHours 或默认值）
- E 列：备注

## PowerShell COM Excel 模板
[提供完整的 PowerShell 脚本模板，包含：复制最近周报、打开、填数据、另存为、关闭]

## 异常处理
1. 后端不可用：重试 3 次（0/2/5 秒延迟），失败提示用户
2. 找不到最近的周报模板：从空模板创建（SKILL.md 中附模板结构）
3. title 解析失败：降级为「任务类型=项目开发，工时=0，进度=0%」
4. COM Excel 不可用：报错提示用户检查 Office/WPS 安装
```

---

### 变更 3：可选 - 后端新增按日期范围查询 API（推迟实现）

**文件**：[TodoController.java](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/controller/TodoController.java)

**新增接口**：`GET /api/todo/by-range?startDate=2026-07-14&endDate=2026-07-20`

**原因**：当前 `/api/todo/list` 返回全量数据，待办数量增长后性能下降。
**当前不实现**：数据量小（16 条），skill 在前端过滤足够。后续数据量增长时再加。

---

## 假设与决策

### 假设
1. 用户的周报模板格式稳定（5 个 sheet，列结构不变）
2. 用户主要在剪藏待办模块记录工作待办，偶尔有生活待办
3. 用户的 title 编码会逐步规范，但仍需支持无编码的纯 title
4. PowerShell COM Excel 在用户机器上可用（已验证）

### 决策
1. **不扩展 TodoContent 模型**：用户选择轻量方案，title 中编码字段
2. **不复用现有 WeeklyReportService**：该服务基于剪藏内容生成周报，与待办无关，独立新建 skill 更清晰
3. **不新增后端 API**：复用 `/api/todo/list`，skill 前端过滤
4. **复制模板方式生成 xlsx**：保留原周报的所有格式（合并单元格、样式、列宽）
5. **本周时间范围**：本周一 00:00 - 本周日 23:59（用户选择）
6. **工作待办识别**：AI 关键词规则，默认归类为工作
7. **文件名规则**：`开发组_周报_{本周五YYYYMMDD}_彭文峰.xlsx`
8. **任务类型**：8 个枚举（项目开发/需求分析/系统设计/详细设计/架构设计/开发自测/联调测试/缺陷）

---

## 验证步骤

### 阶段 1：前端 placeholder 修改验证
1. 打开 todo.html，确认 placeholder 显示为「任务内容[类型,工时h,进度%] 例：账务开发[需求分析,15h,30%]」
2. 创建新待办，输入「测试任务[需求分析,4h,50%]」，确认能保存成功

### 阶段 2：skill 解析逻辑验证
1. 准备测试 title 列表（含各种格式：完整编码、部分编码、无编码）
2. 通过 skill 调用解析逻辑，验证每种格式都能正确提取字段
3. 验证默认值回退（无编码 → type=项目开发, hours=0, progress=0%）

### 阶段 3：周报生成端到端验证
1. 手动创建几条本周待办（含工作 + 一条生活）：
   - `度小满账务文件入账内容开发[需求分析,15h,100%]`（completed=true）
   - `字节账务文件下载代码开发[项目开发,20h,60%]`（completed=false）
   - `微众联调配合[联调测试,8h]`（completed=true）
   - `修复sftp连接超时缺陷[缺陷,2h]`（completed=true）
   - `周末买菜`（生活待办，应被过滤）
2. 调用 skill 生成周报
3. 验证：
   - xlsx 文件生成在正确目录
   - 文件名为 `开发组_周报_{本周五日期}_彭文峰.xlsx`
   - Sheet 1 包含 4 条工作待办（不含「周末买菜」）
   - Sheet 2 左半部分按 taskType 分组：需求分析(15h)、项目开发(12h=20×60%)、联调测试(8h)、缺陷(2h)
   - Sheet 2 右半部分工时汇总正确
   - Sheet 3 包含「字节账务文件下载代码开发」（进行中的待办）
4. 打开 xlsx 文件，确认格式未被破坏（合并单元格、列宽、字体样式）

### 阶段 4：自动化触发配置
1. 用户确认手动生成正常后，配置 TRAE Schedule：
   - cron: `0 16 * * 5`（每周五 16:00）
   - timezone: Asia/Shanghai
   - message: 触发 weekly-report-gen skill

---

## 实施顺序

1. ✅ Phase 1 探索完成（已读取周报模板、TodoContent、现有 skill 架构）
2. ✅ Phase 2 用户决策确认（title 编码 / 本周一到周日 / AI 识别）
3. ✅ Phase 3 plan 文件已写
4. ⏭ Phase 4 通知用户审核 → 通过后开始实施：
   - 修改 todo.html placeholder
   - 创建 weekly-report-gen/SKILL.md
   - 验证（手动创建测试待办 + 生成周报）
