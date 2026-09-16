# HARNESS — INDEX（AI 读入口）

> AI 打开本仓库的「harness 资料入口」。先扫这张定位表，再按需进对应文件，避免盲目翻找。
> 本文件与各 `_index.md` 由 `scripts/harness-audit.cjs` 校验一致性（index 与记录不对应 = 归档未走完）。

## 全产物定位

| 要查什么 | 去哪看 | 读取方式 |
|---|---|---|
| 开发日志（牛马大白话，按时间倒序） | `devlog/_index.md` → `devlog/2026/*.md` | 先读 index 快扫最近几日，再进具体文件 |
| Bug 归档（按模块） | `bugs/_index.md` → `bugs/<module>/*.md` | 按模块过滤 |
| 架构决策 ADR | `decisions/_index.md` → `decisions/000N-*.md` | 编号递增 |
| 长周期韧性（Done/Current/Future） | `roadmap.md` | 只做链接索引，指回 TODO/ 与 HARNESS 记录 |
| 需求/设计/任务/验收 | `TODO/{需求}/01~04.md` | 关联 devlog/bug/ADR 回链的落点 |
| 提交历史 | 根目录 `commit_history.log` | 纯文本 |

## 建议读取顺序（新任务开始时）

1. `roadmap.md` — 了解当前在做什么/正做队列。
2. `devlog/_index.md` — 最近几日动向（避免重复已做的事）。
3. `bugs/_index.md` — 若涉及相关模块，先看是否已有已知坑。
4. `decisions/_index.md` — 若改动方向偏架构，先查是否有相关 ADR。
5. 如需细节，再进具体 md 文件；详细 spec 一律回链 `TODO/{需求}/`。

## 检索方式

- 按类型：目录前缀（devlog / bugs / decisions）+ `_index.md` 过滤。
- 按模块/标签：frontmatter 的 `module`、`tags` 字段 grep。
- 按提交：frontmatter 的 `commit` 短哈希 <-> `commit_history.log` 互查。

## 写记录义务

- 改了代码 / 修了 bug：收尾时**必须**写 devlog（bug）记录，否则视为未闭环。
- 新增记录 = 落 md + 更新对应 `_index.md`（必做）+ frontmatter 字段齐全。