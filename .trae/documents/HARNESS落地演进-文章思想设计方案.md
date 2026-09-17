# HARNESS 落地演进设计方案（借「决策记忆 / Project Brain」思想发散）

## 结论先行

文章《当代码实现不再是瓶颈》讲的核心是：**代码库（怎么做）在贬值，决策记忆（为什么这么做）在升值**；要管好项目，必须给项目建一个「大脑」，它由两层构成——

- **compiled_truth（当前真相）**：只写「现在的最新共识」，可重写、保持干净，是 AI 和人随时读的「运行上下文」。
- **timeline（演进时间线）**：只增不改，记录这个真相是怎么一路改过来的。

对照现状，用一句话诊断 HARNESS：

> **HARNESS 已经把「时间线」那一半建起来了（devlog 流水账 + 空模板），但「当前真相」那一半还是空的——roadmap / ADR 全是占位，等于一个只有日记、没有「当前结论」的大脑。**

所以下一阶段推荐的方案不是改方向、也不是加产品功能，而是**把 HARNESS 从「档案室」补全为「大脑」：补上它缺的 compiled_truth 层，并把「Distill（提炼）」这一步接进归档流程**。

---

## 一、文章思想 → HARNESS 的映射（发散落地）

| 文章观点 | 落到 HARNESS |
|---|---|
| 代码库贬值、决策记忆升值 | HARNESS 最值钱的不是 devlog，而是「决策 + 当前共识」；这两块现在是空的，等于最值钱的资产还没开始积累 |
| compiled_truth + timeline 双层 | `roadmap.md`（真相，可重写）+ `devlog/`（时间线，append-only）正好对应；roadmap 现在空着 |
| **没有 Distill，讨论再多只是熵增** | `harness-archive` 目前只「提炼成 devlog」就停了，没有「提炼成当前真相 / 决策」这一步 —— 这是最大的缺失 |
| 目标只能被「有意识地」移动 | roadmap 的 Done/Current/Future 需要「被有意更新」的纪律，而不是随手改；改要能在时间线里对得上 |
| 决策记忆散落在聊天/脑子里 = 主动失忆 | 项目 `project_memory.md` 里已经攒了一批 hard constraints（双模型分工、md 优先真相源、DSH 手动升级……），它们正是「决策记忆」，却从没被落成 ADR |

---

## 二、现状分析（探索确认）

- `HARNESS/devlog/` 有 2 条真实记录（`DEV-2026-09-16-001/002`），正文中文、frontmatter 齐全 ✅
- `HARNESS/decisions/_index.md` 只有 1 条占位示例（`0001 示例`），`decisions/` 目录下**无真实 ADR 文件** ❌
- `HARNESS/bugs/_index.md` 只有 1 条占位示例，无真实 bug 记录 ❌（暂无真实 bug，属正常）
- `HARNESS/roadmap.md` 的 `## Done / Current / Future` **三节全空白** —— 这是「当前真相」层的核心缺口 ❌
- `harness-archive` skill 的写入闭环 = 「提炼 → 落 devlog → 更新 `_index.md` → self-check」，**只有 timeline 追加，没有「真相更新/决策沉淀」环节** ❌
- 契约事实源在 [harness-archive/SKILL.md](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/.trae/skills/harness-archive/SKILL.md)，审计在 [harness-audit.cjs](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/scripts/harness-audit.cjs)，init 在 [harness-init.cjs](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/scripts/harness-init.cjs)

---

## 三、推荐方案（三步，按性价比排序，纯文档/约定层，零产品代码改动）

### 第一步：激活 `roadmap.md`，让它成为「当前真相」根页面（最高杠杆，最先做）

- **文件**：`HARNESS/roadmap.md`
- **做什么**：把它从「空三视图」真正填起来。用现有材料回填 `Done / Current / Future`，来源三处：
  1. `HARNESS/devlog/_index.md`（已做的最近工作 → Done）
  2. `TODO/` 目录下的需求（正做 → Current，backlog 未开工 → Future）
  3. `project_memory.md` 里的「已完成功能清单」与「缓做/不做清单」（→ Done 与 Future 的排除项）
- **写什么形态**：保持 README 定义的「只做链接索引，不复制内容」——每行 = `- <日期> <一句话> → [要点] [回链 devlog 或 TODO/ 目录]`。
- **为什么**：这是文章 compiled_truth 的直接落地。roadmap = 「产品现状的最新共识」，AI/人进来看一眼就知道「现在在做什么、做过什么、明确不做什么」。它空了这么久，正是「上下文失忆」在本项目的具体表现。
- **额外纪律（对应「目标只能被有意识地移动」）**：roadmap 顶部加一行注释说明「本文件是当前真相，变更须在主流程里『有意』更新（不悄悄漂走）；重大方向变更随手附一条 devlog」。

### 第二步：给 `harness-archive` 补上「Distill → 真相/决策」判断环节

- **文件**：`.trae/skills/harness-archive/SKILL.md`
- **做什么**：在现有「写 devlog」流程后追加一步「判断是否需更新真相/决策」：
  - 若本次改动属于 **方向 / 架构 / 状态** 级（而非普通迭代）→ 同步更新 `roadmap.md` 的 Current/Done；
  - 若属于 **被采纳的架构/约束取舍** → 写一条 ADR（`decisions/000N-*.md`）。
- **为什么**：这正是文章「Distill 是关键、没提炼讨论就是熵增」的机制化。现在归档只落 timeline，不落真相，等于每天写日记但从不更新「结论」。顺手的提醒让「当前真相」不是一次性回填、而是持续保鲜。
- **边界（克制）**：默认只写 devlog，不强制每笔都动 roadmap；只有「方向/架构/状态」级才要求同步，避免落成负担。

### 第三步：把「记忆里的决策」显性化为真实 ADR，替换占位示例

- **文件**：`HARNESS/decisions/` 新增 3 篇真实 ADR，并更新 `decisions/_index.md`（删除示例行，换真实行）
- **候选 ADR**（从 `project_memory.md` 的 hard constraints 中挑最「架构级」的 3 条）：
  1. `0001-markdown-as-source-of-truth.md` — Markdown（HARNESS）作为人工/AI 文档真相源，后端 `feature-point-iterations.json` 只服务产品概览展示，两者并行、对不上以 md 为准。
  2. `0002-dual-tier-model-split.md` — 双模型档位分工：简单任务用 `deepseek-v4-flash`，强任务（synthesizeAnswer / detectContradiction / generateKnowledgeSupplement）用 `deepseek-v4-pro`。
  3. `0003-dsh-manual-upgrade.md` — DSH 不自动联网安装/升级，仅提供「升级助手」由用户手动执行。
- **为什么**：文章的「决策记忆」不是抽象概念，就是这些散在 memory 里的约束。把它们落成编号 ADR，决策记忆从此有据可查、可被 AI 读取，不再是「只活在聊天记录里」。

---

## 四、假设与决策

1. **不改产品方向、零产品代码改动**：本方案只动 `HARNESS/` 下的 md 与 `harness-archive` skill，不碰后端 / 前端 / DSH 链路（呼应统一方案里「md 优先真相源与产品展示并行、本期不同步」的既定边界）。
2. **roadmap 保持「链接索引」形态**，不做成「复制内容的大文档」，避免双份维护。
3. **ADR 先落 3 条最核心的**，不追求一次穷尽全部 memory 约束；后续有架构级取舍再按需追加。
4. **bugs/ 本期不动**：暂无真实 bug 记录，占位保留；待出现真实 bug 时自然填充即可，不强行伪造。
5. **可视化/产品联动不算本期**：文章里「人和 AI 共同消费」的展示层是 future，本期先把真相层的地基（roadmap + ADR + Distill 纪律）打牢。

## 五、验证步骤

1. `roadmap.md` 三节 Done/Current/Future 均非空，且每行带日期 + 回链（devlog 或 TODO/ 路径）。
2. `HARNESS/decisions/` 存在 3 篇真实 ADR（0001/0002/0003），frontmatter `type: adr`、编号递增、正文五字段齐全。
3. `decisions/_index.md` 不再有占位示例行，3 篇真实 ADR 均已登记。
4. `harness-archive/SKILL.md` 的「执行流程」里新增了「方向/架构级 → 同步 roadmap / 补 ADR」一步。
5. 跑 `node scripts/harness-audit.cjs` → ERROR=0（roadmap/adr 的登记与文件一致）。
6. 按项目惯例写一条 HARNESS devlog 归档本次演进（module: tools），并同步 `_index.md`。

## 相关文件

- `HARNESS/roadmap.md`（改，核心）
- `HARNESS/decisions/0001-*.md`、`0002-*.md`、`0003-*.md`（新增）+ `decisions/_index.md`（改）
- `.trae/skills/harness-archive/SKILL.md`（改，补 Distill 环节）
- （参考，不改）`HARNESS/README.md`、`HARNESS/INDEX.md`、`scripts/harness-audit.cjs`、`scripts/harness-init.cjs`