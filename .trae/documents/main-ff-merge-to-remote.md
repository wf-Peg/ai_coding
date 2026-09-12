# 以远端 main 为准，本地 main 快进同步

## Summary
将本地 `main` 快进同步到远端 `origin/main`（`b02db96`，比本地多 22 个提交）。

经核对，本地 `main`（`c9f2c36`）是远端 `origin/main` 的严格祖先：本地领先 0、落后 22，`merge-base` 即本地 head。**本地不存在任何远端缺失的独有提交**，因此无需"合并补回本地改动"，只需一次无冲突的快进。用户已确认采用"以远端为准直接快进"。

## Current State Analysis（已核实）
- 唯一远端：`origin` → https://github.com/wf-Peg/ai_coding.git
- 本地 `main` = `c9f2c36`；`origin/main` = `b02db96`
- `git rev-list --left-right --count main...origin/main` = `0  22`（领先0、落后22）
- `git merge-base main origin/main` = `c9f2c36`（= 本地 head）→ 无分叉
- `feature-simple-codex`：领先 0、落后 115，同样无独有提交（本次不动）
- 无 stash、工作区干净（`git status` 仅显示 behind 22）

## Proposed Changes
本地工作区与历史在同步前保持现状，不修改任何文件内容；仅更新本地 `main` 分支指针与远端追踪引用。

> **为何不需要删除本地 `main`？**
> 因为本地 `main`（`c9f2c36`）是 `origin/main`（`b02db96`）的严格祖先（领先 0、落后 22），无分叉、无独有提交。
> "删除本地 main + 重新从远端 checkout" 的最终结果与快进合并**完全一致**，但删除会引入副作用（需临时切换分支、分支引用短暂消失、reflog 记录污染、更易误操作）。
> 只有在本地存在**远端缺失的分叉提交**、需要"以远端为准并丢弃本地"时才需要 `git reset --hard`（等价于重建）。
> 本仓库不具备该前提，故快进合并即最干净、零副作用的同步方式。

### 步骤
1. `git fetch origin` — 拉取远端最新引用（此操作已执行过，可再执行一次确保最新）。
2. `git merge --ff-only origin/main` — 将本地 `main` 快进到远端 head，无冲突、不产生多余 merge commit。
3. （可选）若需以远端为基准重置到完全干净状态：`git reset --hard origin/main`。仅在确认无未提交/未推改动时使用，**默认不执行**。

## Assumptions & Decisions
- **以远端为准**：本地 `main` 直接快进，丢弃性风险为零（本地无独有提交）。
- **不生成合并提交**：因无分叉，使用 `--ff-only`，避免无意义的 `merge commit`（用户已确认）。
- 不触碰 `feature-simple-codex` 分支、不修改 `.gitignore`、「学习/观测」模块等业务配置。
- 若步骤 2 意外失败（意味着 fetch 之后远端又变化或存在分叉），立即停止并重新核对 `git log origin/main --not main` 后再处理，不做猜测性 force。

## Verification
1. `git status` → 显示 `Your branch is up to date with 'origin/main'`。
2. `git log --oneline -5` → 顶部为 `b02db96`，与 `origin/main` 一致。
3. `git rev-list --left-right --count main...origin/main` → `0 0`。
4. （可选）`git diff main origin/main` → 为空。
5. 建议在快进后对项目做一次构建/冒烟验证，确认远端带来的 22 个提交在当前工作区可用（可选，视工程规模决定）。