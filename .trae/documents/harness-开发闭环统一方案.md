# Harness 计划：开发闭环统一方案

> 目标：把散落各处的开发期产物（提交/bug/牛马记录/需求/设计/方案/决策/复盘）统筹进**一个分级目录 + md 文档契约**，让「系统（AI）能当文档读，人也能当文章看」，闭环整个开发周期。借鉴 GitHub 社区成熟的 agent-native repo / harness 约定。

---

## 一、当前状态分析（现状是"几张没连起来的纸"）

| 产物 | 现在在哪 | 状态 |
|------|----------|------|
| 提交记录 | 仓库根 `commit_history.log` | ✅ 已有，纯文本平铺 |
| 需求/设计/任务/验收 | `TODO/{需求}/01~04.md + feature-points.json` | ⚠️ 有结构，但 product-dev-archive 已标"遗留"，新链路走后端 |
| 计划/方案文档 | `.trae/documents/*.md` | ⚠️ 约 100 个平铺、命名混杂（中英混排、无分类） |
| Spec/清单 | `.trae/specs/<id>/{spec,tasks,checklist}.md` | ✅ 每变更一套 |
| **牛马记录** | `{configDir}/index/feature-point-iterations.json` | ❌ **不进仓库、非 md**，只有产品概览 UI 能看；四字段 title/problem/solution/outcome + source |
| **Bug 归档** | `TODO/bugs/bug-history.md` | ❌ 只有表头模板，未系统填充；另有 `TODO/bugs/app.log`（原始日志，非 curated） |
| 决策 (ADR) | 散落在 `.trae/documents/*.md` 里 | ❌ 无独立编号、无索引、难以检索 |
| 复盘/发布 | `release-notes-*.md`（根）、`docs/` | ⚠️ 部分存在，无统一 |
| 代码地图 | `CODE_INDEX.md` / `CODE_WIKI.md` / `.codegraph/` | ✅ 已有（供排障降 token） |
| Agent 约束 | `agent.md` | ✅ 已有（≈ AGENTS.md 雏形） |

**核心痛点**：
1. 没有"一个进去就能找到所有东西"的统一入口；每个产物各管各的。
2. **牛马记录是最有价值的复利资产，却埋在配置目录的 JSON 里，仓库/人/AI 都读不到 md。**
3. Bug 归档只有模板没有纪律，基本没在填。
4. `.trae/documents` 平铺堆积，无法按类型检索。

（"牛马"即"会话成果自动归档"，链路：DSH `turn/end` 自动 + TraeCode 提交推送后由 `git-commit-workflow` 调用 `trae-session-archive` 自动 → POST `/api/workspace/feature-points/iterations/ai-session` → 后端落 JSON。）

---

## 二、目标 / 非目标（本次对齐结论）

**目标**
- 建立**进仓库的、md 优先的统一 harness 层**（`HARNESS/`），作为开发闭环的"系统真相源"。
- 分级目录 + 统一 frontmatter/模板契约：AI 读 `INDEX.md` 即得全貌，人读 `README.md` 即晓约定。
- 把**牛马/devlog、bug、决策 ADR** 这三块当前最乱的缺口，补齐为规范 md，并接入写入流程。
- 用**技能 + 脚本**把"写记录"变成低摩擦的默认动作（提交/修复完成即自动追加），而非靠人自觉。

**非目标（本次明确不做）**
- 不改任何产品功能代码（后端 JSON 牛马链路、产品概览 UI、DSH 插件、commit 自动归档 POST 全部**保持原样**）。
- 不迁移 `.trae/documents` 存量 100+ 文档（**原位保留**，仅在索引标注 legacy）。
- 不做"后端从 md 派生 JSON"、"产品概览读 md"等跨产品改造（列入 future）。

> 说明：本次实现"md-first 的 harness 真相源"与"不动后端牛马链"并不冲突——harness 层是**仓库内的文档真相源**（人/AI/后续产品都可读），后端 JSON 链继续服务现有产品概览展示，两者并行，本阶段不双向同步。

---

## 三、借鉴的 GitHub harness 思路 → 落到本项目

| 来源思路 | 落到本项目 |
|---|---|
| **AGENTS.md = 地图，不是手册**（agent-native repo / OpenAI Agents SDK / harness.io） | 改造 `agent.md` 为薄地图，新增"Harness 导航"段，只指路不灌细节；细节按需加载 |
| **仓库是唯一事实来源 / 看见才不违反**（Harness Engineering 支柱1） | 记录**全部进仓库**（`HARNESS/`），不入 configDir；牛马记录从 JSON 落成 md |
| **Trajectory 才是护城河 / 可观测性**（Harness Engineering 支柱，OKF 知识包） | `HARNESS/devlog`（牛马大白话）+ `HARNESS/bugs` + `HARNESS/decisions` 沉淀轨迹，形成可检索资产 |
| **OKF（Open Knowledge Format）frontmatter**：`generated{by,at}` / `sources` / 信任与生命周期 | 每篇记录统一 frontmatter：`type/id/title/date/status/commit/source/tags/generated/sources` |
| **ADR 架构决策 / split planning（done/current/future）** | `HARNESS/decisions/` 递增编号；`HARNESS/README` 里列出"正做/待做/已做"视图 |
| **验证管道 / audit（写文档但没同步→WARN）**（Harness Engineering 支柱4） | `scripts/harness-audit.cjs` 校验：frontmatter 合法、INDEX 可达、bug/devlog 有 commit 关联；`-WhatIf` 可只检查 |
| **Skills 触发式写入 / agent handoffs（Plan→Implement→Review）** | 新增 `harness-archive` skill，`git-commit-workflow` 推送后自动调它写 devlog/bug；`harness-archive` 也支持手动调用 |
| **模板脚手架降低启动成本** | `scripts/harness-init.cjs` 幂等生成目录 + 模板 + frontmatter 骨架 |

---

## 四、分级目录设计（`HARNESS/`）

```
HARNESS/
├── README.md                    # 人读入口：目录约定 + 写记录时机 + 命名/template 对照
├── INDEX.md                     # AI 读入口：全产物定位表 + 读取顺序 + 检索方式
├── devlog/                      # 牛马记录/开发日志（大白话产出）★核心缺口
│   ├── _devlog-template.md
│   ├── _index.md                # 汇总表（时间倒序，AI/人快扫）
│   └── 2026/
│       └── 2026-09-16-<slug>.md
├── bugs/                        # Bug 归档 ★核心缺口
│   ├── _bug-template.md
│   ├── _index.md                # 按模块 + 状态汇总表
│   └── <module>/                # 如 editor/clip/electron/backend 各一
│       └── 2026-09-16-<slug>.md
├── decisions/                   # ADR 架构决策
│   ├── _adr-template.md
│   ├── _index.md
│   └── 0001-<title>.md          # 递增编号
└── roadmap.md                   # Done/Current/Future 三视图：只做链接索引（指向 TODO/ 各需求与 HARNESS 记录），不复制内容
```

### 命名与路径风格（统一约定，置顶写入 `HARNESS/README.md`）

| 层 | 命名方式 | 语言 | 说明 |
|---|---|---|---|
| **Harness 层（新增，规范区）** | 目录/文件名全英文 kebab-case：`2026-09-16-<slug>.md` | 路径英文、**正文中文** | slug 只用稳定英文（如 `multi-cursor-alt-w`），中文标题放 frontmatter.title，不把中文/拼音放进文件名 |
| devlog/bug 的 id | `DEV-2026-09-16-001` / `BUG-2026-09-16-001` | 英文 | 同日按 3 位序号递增；adr 用 `0001` 递增编号 |
| 索引/模板元文件 | `_index.md`、`_devlog-template.md` 等 | 英文 | `_` 前缀 = 元文件，不参与时间线排序 |
| 业务需求层（存量，不动） | `TODO/{中文需求}/01-需求分析.md` | 中文（祖父条款） | 继续中文命名，不迁移、不混合 |
| 规划/规格层（存量，不动） | `.trae/documents/*.md`、`.trae/specs/<id>/` | 混排（保留现状） | 新记录一律进 HARNESS，不再向这两处新增 |

> 基调：**规范区（HARNESS）全英文路径，存量区（TODO/.trae）保持原样**，两层互不迁移混用；下次大版本整理存量时才考虑统一，不在本期做。

**不重复建的地方（对接已有）**
- 提交：仍写 `commit_history.log`（agent.md #13）
- 需求/设计/任务/验收：仍走 `TODO/{需求}/01~04.md`；`HARNESS/README.md` 里说明"详细 spec 一律回链 `TODO/`"避免双份
- 方案草稿：新增文档一律按 `HARNESS` frontmatter 契约并落入对应分类，`.trae/documents` 仅存量保留

---

## 五、统一 frontmatter 契约（每篇记录必备）

```yaml
---
type: devlog | bug | adr          # 所属层
id: "DEV-2026-09-16-001"          # devlog|bug 形如 <Type>-<date>-<3位序号>；adr 用 0001
title: "<一句话标题>"
date: 2026-09-16 14:30
status: closed | open             # devlog/bug 大多 closed；adr 可 accepted|pending
module: editor                    # 可选：影响模块，便于 bugs/devlog 归档检索
commit: abc1234                   # 关联提交短哈希（闭环到 git）
source: dsh-session | trae-session | manual   # 牛马来源，沿用现有 source 约定
tags: [editor, multi-cursor]
generated:
  by: git-commit-workflow | harness-archive | manual   # 谁写的
  at: 2026-09-16 14:30
sources:                          # 可选：证据链（同仓文件/URL）
  - "electron/main.js:802"
---
```

**devlog 正文 = 牛马四字段（大白话）**
```markdown
# <title>
## 一句话          # 10 字内，扫读用
## 问题（解决什么） # ← problem，大白话
## 怎么解决的       # ← solution，大白话
## 产出 / 结果      # ← outcome，大白话
## 关联            # commit、TODO 目录、涉及文件
```

**bug 正文**
```markdown
# <module>：<现象一句话>
## 现象       # 复现/表现
## 根因       # Why
## 修复方式    # 含 commit/PR/文件
## 经验教训（防复发）  # 提炼进 agent.md 的可选输入
## 关联
```

**adr 正文**（经典 Confirmed 结构，轻量）
```markdown
# <id>: <标题>
## 背景 Context
## 决策 Decision
## 后果/权衡 Consequences
## 备选 Alternative
## 关联
```

---

## 六、读写/归档流程（闭环）

**AI 打开仓库怎么读**：`agent.md` → "Harness 导航"段 → `HARNESS/INDEX.md`（全产物定位 + 读取顺序：先 devlog 最近几日 → bugs 相关模块 → decisions）→ 按需进对应文件。

**写记录时机（由技能/脚本强制触达，不靠自觉）**
1. `git-commit-workflow` 推送成功后 → 追加 `commit_history.log`（已有）→ 调用 `harness-archive` 写一条 **devlog**；若本次为 bug 修复 → 同时写一条 **bug** 记录。
2. 任务/修复完成但暂不提交 → 手动 `/harness-archive`（对应 `trae-session-archive` 的手动起止时机）。
3. 架构/方向级改动被采纳 → 手动写一条 **adr**。
4. 每个目录的 `_index.md` 在新增记录时同步追加一行（时间倒序）。

**执行方式**：`harness-archive` skill 负责"判断 → 提炼 → 落文件 → 更新 index → 校验 frontmatter"；**更新对应 `_index.md` 是必做步骤，audit 发现 index 与记录不一致即视为该次归档未走完**（须补写）。`git-commit-workflow` 只负责在推送成功后**调用它**，不内联第二份实现（保持与 agent.md #35"共享规Ciform 单一事实来源"一致）。

**失败容忍与真相源分工**：写 devlog/bug 的 md **失败不阻塞提交**（与 `trae-session-archive` 的失败容忍一致），仅提示即可，产品概览 JSON 归档照常。**`HARNESS/devlog` 是人工/AI 的文档真相源，后端 `feature-point-iterations.json` 只服务产品概览展示**；本阶段两者并行、不同步、不互相派生，若对不上以 md 为准（人改记录改 md）。

---

## 七、具体改动清单（文件 + 做什么 + 为什么 + 怎么做）

### A. 新增目录与模板（脚手架生成，幂等）
- 创建 `HARNESS/{README,INDEX,roadmap}.md` 及 `devlog/ bugs/ decisions/` 各级 `_template.md`、`_index.md`。
- **做什么/为什么**：落地分级目录与契约骨架。
- **怎么做**：手写首版，并用 `scripts/harness-init.cjs` 固化（可重复执行、不重复建）。

### B. 新增脚本
- `scripts/harness-init.cjs`：幂等建目录/模板/空 `_index.md`；`node scripts/harness-init.cjs`。
- `scripts/harness-audit.cjs`：校验各 `_index.md` 与记录一致性、frontmatter 字段齐全、`commit` 关联存在；`-WhatIf` 只读不写；供 CI/提交前抽查。
- **为什么**：验证管道（借鉴）让人/AI 在"写漏了"时被提醒，而不是事后找不到。

### C. 新增/改造 skill
- 新增 `.trae/skills/harness-archive/SKILL.md`：核心写入技能。职责=判断是否值得归档 → 提炼 devlog/bug（牛马四字段大白话）→ 落对应 md → **更新 `_index.md`（必做）** → self-check frontmatter。frontmatter/目录/命名契约以本 skill 为唯一事实来源；写 md 失败仅提示不阻塞提交。
- 改造 `.trae/skills/git-commit-workflow/SKILL.md`：推送成功后、在现有"自动归档 POST 产品概览"**之外**，追加"调用 `harness-archive` 写 devlog（若修复则 bug）"。注意：**只在 md 层追加**；后端 JSON POST、`source` 约定保持不动。
- **为什么**：把"牛马/devlog/bug 落 md"接到现有自动链路上，形成闭环。
- **怎么做**：参照现有 `trae-session-archive` skill 的单一事实来源写法，避免双份实现。

### D. 改造 `agent.md`（≈AGENTS.md 地图化）
- 新增「Harness 导航」段，**只放 3~5 行指针**：`HARNESS/README.md`（人读入口）、`HARNESS/INDEX.md`（AI 读入口）、每层一句话定位；**细节一律落在 `HARNESS/INDEX.md`，不在 agent.md 复制**（防止 agent.md 从"地图"膨胀成"手册"，违背借鉴原则）。
- 更新「Bug 历史管理」「需求开发流程」两段，改为一行指针指向新 `HARNESS/bugs` 与 `HARNESS/devlog`，并把 `TODO/bugs/bug-history.md` 标为存量兼容。
- 新增约束：本次会话若改了代码/修复 bug，**必须**在收尾时写 devlog（bug）记录，否则视为未闭环（与 audit 呼应）。
- **为什么**：AGENTS.md=地图原则，AI 第一眼看到入口与写记录义务，同时控制 agent.md 体积不膨胀。

### E. 存量兼容（不改动）
- `TODO/bugs/bug-history.md`、`.trae/documents/*.md`、`commit_history.log` 格式、后端 JSON 牛马链全部保留。

---

## 八、假设与决策

- **假设**：用户希望最低风险落地方案，产品代码零改动；记录以 md 为准但不影响现有产品概览读取。
- **决策**：采用顶层 `HARNESS/` 作为唯一 harness 真相源；devlog 是后端牛马 JSON 的 **md 版**（同四字段），后端链本期不动；两处对不上时以 md 为准。
- **决策**：`_index.md` 可人工维护，用 audit 脚本兜底校验，不做自动扫描服务（符合"纯文档层"边界）。
- **决策**：命名 slug 采用 `YYYY-MM-DD-<kebab-slug>`，adr 采用递增 `0001-`。
- **决策（命名风格）**：规范区（HARNESS）全英文 kebab-case 路径 + 中文正文；存量区（TODO/.trae）保持原样（祖父条款），两层互不迁移、互不混合；slug 只用稳定英文，中文标题进 frontmatter.title。

---

## 九、验证步骤（验收）

1. `node scripts/harness-init.cjs` → `HARNESS/` 各级目录/模板/`_index.md` 存在且不重复（跑两次幂等）。
2. 手动产出一篇 `devlog`、一篇 `bug`（可跑 `git-commit-workflow` 的一次真实推送验证）：frontmatter 契约齐全、`_index.md` 已更新、`commit` 与真实短哈希一致。
3. `node scripts/harness-audit.cjs`（`-WhatIf`）→ 无 ERROR，可提示 WARN。
4. `agent.md` 的「Harness 导航」链接可直达 `HARNESS/README.md` / `HARNESS/INDEX.md`。
5. 确认后端 JSON 牛马链、产品概览 UI、`commit_history.log` 格式**均未受影响**（回归无变化）。
6. `.trae/documents` 存量文件未被移动/删除（原位保留）。
7. `HARNESS/README.md` 置顶包含「命名与路径风格」约定表，实建目录与约定一致；新记录文件名均为英文 kebab-case、正文中文。
8. `agent.md` 的「Harness 导航」段为 ≤10 行指针，未复制 HARNESS 内部细节。

---

## 十、Future（本期明确不做，留待单独项目）

- 后端从 `HARNESS/devlog` 派生 / 产品概览直接 render 仓库内 md（打通"文档真相源"与"产品展示"）。
- 存量 `.trae/documents/*.md` 按分类自动迁移。
- 从 `HARNESS/bugs` 经验提炼自动写回 `agent.md` 约束。