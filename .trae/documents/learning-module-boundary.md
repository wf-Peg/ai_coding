# 学习模块与产品开发工作台 — 边界声明

> 目的：明确学习模块（学习计划）在本次产品开发工作台 MVP 中的边界，避免"想打通但没方案"导致的范围蔓延。

## 一、现状

- 学习计划模块完整存在：`LearningPlanController`（`/api/learning-plan`）、`LearningPlanService`、`LearningPlan` 模型、`frontend/learning-plan.html`、Exa 搜索集成
- 工作台体系 `Workspace.TYPES` 已预留 `"learning"` 类型
- `ContentRefMapper.fromLearningPlan()` 已能将学习计划映射为 ContentRef（type=learning-plan，含 tags）

## 二、本轮 MVP 边界（产品开发工作台）

**学习模块不在本轮 MVP 范围内**，具体而言：

| 事项 | 本轮 | 说明 |
|------|------|------|
| 学习计划自动落库为剪藏/待办 | 不做 | 与知识/Wiki 落库同列二期 |
| 学习计划进入 pd-builtin 工作台 | 不做 | pd-builtin 规则限定 `type in clip,todo`，天然排除学习计划 |
| 独立学习工作台 | 不做 | 类型已预留（learning），但无创建逻辑 |
| 学习计划 ContentRef 索引 | 已存在 | 系统索引已含 learning-plan 类型（无需改动） |

**决策依据**：产品开发工作台聚焦"编码任务产出归档"，学习计划是用户自主学习的数据，两者数据形态和消费场景不同。先让产品开发链路（归档 → 落库 → 规则展示）稳定闭环，再考虑学习模块接入。

## 三、二期打通候选方案（本期不实施，仅记录）

1. **学习工作台复用 pd-builtin 模式**：仿照产品开发工作台，创建固定 ID 的 `learning` 内置工作台，规则 `tag contains learning` 或 `type equals learning-plan`，自动聚合学习计划
2. **学习计划产出归档**：学习计划阶段完成时，Agent 调用归档逻辑写入 TODO 目录，走与产品开发相同的落库链路（需扩展 feature-points.json 支持 learning 类型）
3. **ContentIndex 已就绪**：`ContentRefMapper.fromLearningPlan()` 已存在，规则系统可直接命中 `type=learning-plan` 的内容，技术前提已具备

## 四、对 agent 的约束

- 开发过程中**不要**为实现学习模块打通而修改 pd-builtin 规则、feature-points.json 结构或 TodoScannerService
- 如用户后续要求打通学习模块，先评审本节方案一/二再动工
