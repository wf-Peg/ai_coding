# 提交推送自动写产品概览迭代记录 — 实施计划

## 目标

让 TraeCode 侧在「提交推送」与「完成任务」两条收尾路径上，都**自动**往产品概览写一条迭代记录；做到**提交推送即归档**，且与既有 `trae-session-archive` 手动链路的**具体实施内容保持同步**，不产生第二种不一致的归档写法。

## 现状分析（探索结论）

- 后端 `POST /api/workspace/feature-points/iterations/ai-session` 已就绪
  （`backend/.../controller/WorkspaceController.java#L1148-L1183`）：入参 `{conversation, project?, source?}`；
  `source` 缺省回落 `dsh-session`，**必须显式传 `source=trae-session`** 前端才标「TraeCode」徽标；AI 提炼四字段失败时返回 200 兜底，不丢会话成果。
- DSH 侧已**自动**归档：`integrations/dsh/plugins/clip-capture/index.mjs#L171-L222` 监听 `session/event → turn/end`（`reason.kind=completed` 且存在"产出信号"）即自动聚合归档（source=dsh-session）；并把 `pwsh`（跑 git 提交）划为"运维工具"，纯提交轮不单独归档。
- TraeCode 侧目前**仅手动**：`.trae/skills/trae-session-archive/SKILL.md` 由 agent 完成任务、准备提交前主动调用一次（source=trae-session）。
- `scripts/git-push.ps1`（git-commit-workflow 的执行体）只做暂存→编译→commit→追 log→push，**不含归档**；DSH 也可能经 `pwsh` 复用它，因此**不建议**在脚本里内联 POST（会误标 source / 与 turn/end 重复归档）。
- 提交推送由 `.trae/skills/git-commit-workflow/SKILL.md` 编排，是 TraeCode 侧收尾的**唯一确定性入口** → 在此处自动归档即可保证"提交推送即归档"。

## 设计方案：技能级编排，trae-session-archive 作为共享归档规Ciform

- **归档的单一事实来源** = `trae-session-archive` skill（conversation 提炼规范 + endpoint + source 约定）。改动不回写第二份 endpoint 说明。
- **触发点 = 提交推送成功之后**：`git-commit-workflow` 在 `git-push.ps1` 成功返回后，调用一次归档（source=trae-session）。语义最准确：只有真的推送成功，才落记录。
- **完成任务但暂不提交**：继续走 `trae-session-archive` skill（手动、隐性触发），与提交归档共用同一规范。

## 具体改动

### 1. `.trae/skills/git-commit-workflow/SKILL.md`（主改动）
- 标题旁更新"核心流程"说明：提交推送成功后**自动归档**一条产品概览迭代记录。
- 「执行流程（4 步）」改为 **5 步**，新增第 5 步 **提交推送后自动归档**：
  - 触发条件：`git-push.ps1` 输出 `已提交并推送：<hash> → <branch>`（即成功）且本次改动**有保留价值**（纯文档微调/闲聊式提交可跳过，判定沿用 trae-session-archive 的"何时调用"）。
  - 内容与调用：按 **trae-session-archive skill 的 conversation 提炼规范**生成 `conversation`（需求一句 + 产出/文件/接口 + 关键决策，≤3000 字），POST `/api/workspace/feature-points/iterations/ai-session`，Body `{conversation, project?, source:'trae-session'}`。
  - 失败容忍：后端未就绪 / 接口异常仅提示不阻塞，不重复推送语义。
- 「注意事项」补充：归档步骤直接复用 trae-session-archive 的规范与 endpoint，不自行改写成第二份；不要在 git-push.ps1 里内联归档（DSH 复用会误标 source）。

### 2. `.trae/skills/trae-session-archive/SKILL.md`（同步更新，作为共享规Ciform）
- 「概述 / 注意」明确：本 skill 既是手动归档入口，也是 **git-commit-workflow 提交推送自动归档所引用的共享规Ciform**——改动需在两端同步生效。
- 「何时调用」改述：
  - 完成任务、**暂不提交**的归档 → 手动调用本 skill。
  - 以**提交推送**收尾的任务 → 由 git-commit-workflow 在推送成功后自动执行本 skill 相同的归档逻辑（source=trae-session）；本 skill 不再要求 agent 额外重复调用一次，避免同一提交产生两条同名记录。
  - 纯咨询/排障不改动 → 仍不调用。
- endpoint / conversation 规范 / source 约定**保持不变**（作为唯一事实来源）。

### 3. `agent.md`（约束文档同步）
- 「归档与产品概览迭代 → 概述」TraeCode 子弹补充：**提交推送由 `git-commit-workflow` 在推送成功后自动归档**（`source=trae-session`）；`trae-session-archive` 为共享规Ciform，负责"完成任务但暂不提交"的兜底归档。
- 「归档链路」图同步补一条 TraeCode 提交推送分支，标注"自动、推送成功后、source=trae-session"。
- 「相关技能」补充确认为双入口：git-commit-workflow（提交推送自动）+ trae-session-archive（暂不提交手动 / 共享规Ciform）。

## 不改动项（刻意保持）

- 后端 `WorkspaceController` / `FeaturePointIterationService`：已支持 `source=trae-session`，无需改。
- 前端 `workspace.js`：已按 source 区分徽标，无需改。
- `scripts/git-push.ps1`：不内联归档（避免 DSH 复用误标/重复归档）。
- DSH `clip-capture`：turn/end 自动归档保留不变。

## 假设与决策

- "提交推送自动归档"采用**技能级编排**（用户已确认），而非脚本级内联。
- 归档时机 = **推送成功后**（最准确；`-WhatIf` 预览模式不触发归档）。
- 同一 TraeCode 会话的一次提交只会归档一次（git-commit-workflow 触发一次）；DSH 与 TraeCode 属不同会话来源，按 source 区分展示，属既有设计。
- 纯文档/无保留价值的提交由 agent 按规范自动跳过，避免"提交即制造噪音卡片"。

## 验证步骤

1. 通读 `.trae/skills/git-commit-workflow/SKILL.md` 与 `.trae/skills/trae-session-archive/SKILL.md`，确认两处 endpoint、字段、source 完全一致（无第二份实现）。
2. 抽查 `agent.md` 归档节与两 skill 描述一致。
3. 起后端后，模拟一次"提交推送"：手工以 git-commit-workflow 的归档 POST（source=trae-session）打到 `POST /api/workspace/feature-points/iterations/ai-session`，返回 `source=="trae-session"` 即链路通。
4. 打开产品概览页，确认该条记录带「TraeCode」徽标展示。