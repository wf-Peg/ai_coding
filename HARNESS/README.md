# HARNESS — 开发闭环档案室

> 把散落各处的开发期产物（提交 / bug / 牛马记录 / 需求 / 设计 / 方案 / 决策 / 复盘）统筹进**一个进仓库的分级目录 + md 文档契约**：系统（AI）能当文档读，人也能当文章看。

本文件是**人读入口**；AI 请走 [`INDEX.md`](./INDEX.md)。

## 目录约定

| 层 | 目录 | 内容 | 读入口 |
|---|---|---|---|
| 开发日志（牛马） | `devlog/` | 大白话产出：解决什么问题、怎么解决、产出 | `devlog/_index.md` |
| Bug 归档 | `bugs/` | 现象/根因/修法/经验教训（按模块分子目录） | `bugs/_index.md` |
| 架构决策 ADR | `decisions/` | 递增编号的决策记录 | `decisions/_index.md` |
| 长周期韧性 | `roadmap.md` | Done/Current/Future 三视图（只做链接索引） | — |

## 命名与路径风格（统一约定，务必遵守）

| 层 | 命名方式 | 语言 | 说明 |
|---|---|---|---|
| **Harness 层（规范区）** | 目录/文件名全英文 kebab-case：`2026-09-16-<slug>.md` | 路径英文、**正文中文** | slug 只用稳定英文（如 `multi-cursor-alt-w`）；中文标题放 frontmatter.title，不把中文/拼音放进文件名 |
| devlog/bug 的 id | `DEV-2026-09-16-001` / `BUG-2026-09-16-001` | 英文 | 同日按 3 位序号递增；adr 用 `0001` 递增编号 |
| 索引/模板元文件 | `_index.md`、`_devlog-template.md` 等 | 英文 | `_` 前缀 = 元文件，不参与时间线排序 |
| 业务需求层（存量，不动） | `TODO/{中文需求}/01-需求分析.md` | 中文（祖父条款） | 继续中文命名，不迁移、不混合 |
| 规划/规格层（存量，不动） | `.trae/documents/*.md`、`.trae/specs/<id>/` | 混排（保留现状） | 新记录一律进 HARNESS，不再向这两处新增 |

> 基调：**规范区（HARNESS）全英文路径，存量区（TODO/.trae）保持原样**，两层互不迁移混用；下次大版本整理存量时才考虑统一，不在本期做。

## 写记录时机（由 skill/脚本强制触达，不靠自觉）

1. **提交推送成功后**：`git-commit-workflow` 会自动调用 `harness-archive` 写一条 devlog（本次为 bug 修复则同时写一条 bug）。无需手动。
2. **任务/修复完成但暂不提交**：手动执行 `harness-archive` skill。
3. **架构/方向级改动被采纳**：手动写一条 ADR（`decisions/`）。
4. 新增记录时必须同步更新对应目录的 `_index.md`（时间倒序，**必做**）。

## 不重复建的地方（对接已有）

- **提交**：仍写根目录 `commit_history.log`（agent.md #13），HARNESS 不复制提交流。
- **需求/设计/任务/验收**：仍走 `TODO/{需求}/01~04.md`。HARNESS 里的 devlog/bug/ADR 若涉及某需求，一律**回链** `TODO/{需求}/` 目录，避免双份内容。
- **方案草稿**：不再向 `.trae/documents` 新增；按本目录 frontmatter 契约落入对应分类。

## 契约速查

- 每篇记录头部 frontmatter 字段：`type / id / title / date / status / module? / commit / source / tags / generated{by,at} / sources?`（详见各 `_template.md`）。
- devlog 正文 = 牛马四字段大白话：一句话 / 问题（解决什么）/ 怎么解决的 / 产出·结果 / 关联。
- bug 正文 = 现象 / 根因 / 修复方式 / 经验教训 / 关联。
- adr 正文 = 背景 / 决策 / 后果权衡 / 备选 / 关联。

## 真相源分工

- `HARNESS/devlog` 是**人工/AI 的文档真相源**。
- 后端 `feature-point-iterations.json` 只服务产品概览展示，本阶段两者并行、不同步、不互相派生；若对不上以 md 为准。
