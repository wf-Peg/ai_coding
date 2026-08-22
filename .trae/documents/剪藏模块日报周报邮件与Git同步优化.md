# 剪藏模块：日报/周报邮件信息补强 + Git 同步体验重构 + 技能包可发现性设计

> 目标：按序处理剪藏模块 3 个问题——① 日报/周报邮件的"结构化组织/整理信息"不全面；② git 同步仓库体验与交互不清晰；③ 处理完对齐工具清单总表并回归测试。另附带一项设计方向：解决"技能包维护有约定但下次新增无从发现"。

## Summary

- **P0 邮件补强**：把两个生成流程里**已算出来但从未进过邮件**的 AI 整理产物，真正并入邮件正文，让邮件呈现"整理后"的信息而非只罗列原始字段。
  - 周报：每分类的 `mainReport`（主报告）+ `knowledgePoints`（知识点）——它们在 `generateWeeklyReport()` 落盘后即被丢弃，邮件完全未用。
  - 日报：每分类 `organizeCategoryContent()` 产出的 AI 整理 Markdown——同样只在文件、未进邮件。
- **P1 Git 分步状态与详情**：把 `executeGitOperations` 抛出的"一次吞掉错误仅记日志"改造为**分步结果**（pull / commit / push 各自 ok / 文件数 / 消息），错误下沉到前端可见；顺带修复/移除用错目录的失效异步方法。
- **P2 只同步现有表 + 回归**：DSH SKILL.md 14 项工具表、README 保持准确；不新增 DSH 工具。
- **P3 技能包可发现性设计**：双管齐下——① 一个命令行校验脚本（CI/构建期自动拦漂移）；② DSH 设置页一个「技能包状态」轻量区域（运行时可视化：有哪些工具、是否已同步、哪里漂移、一键重新校验）。解决"下次新增无从发现"。

## Current State Analysis

### 问题 1：日报/周报邮件未包含 AI 整理产物
- 日报邮件 `ContentOrganizeService.sendOrganizeEmail()`（[ContentOrganizeService.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java#L665-L857)）只接收 `today, organizedCount, clipsByCategory`，正文 = 概览卡片 + 全局统计 + 逐个剪藏卡片；`organizeCategoryContent()` 产出的 AI 整理 Markdown 在调用点（第168行）即用即弃。
- 周报邮件 `WeeklyReportService.sendWeeklyReportEmail()`（[WeeklyReportService.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/WeeklyReportService.java#L452-L677)）相同，且其第452行签名**根本收不到**第154-177行生成的 `mainReport` 与 `knowledgePoints`——这是最直接的"整理信息不全面"硬缺口。

### 问题 2：Git 同步体验不清晰
- `GitService.executeGitOperations()`（[GitService.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/GitService.java#L87-L140)）`void` 返回，`executeGitCommandSafe` 吞掉全部错误只 `log.warn`；调用方 `GitController /sync`（[GitController.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/GitController.java#L64-L80)）只返回一句 `"Git sync completed successfully"`。
- `pushAsync()`/`pullAsync()` 用 `Paths.get(".")`（后端工作目录，非存储父目录），且**未被任何控制器调用**（死代码、且目标目录错误）。
- 前端 `clip-sync.js::doSyncGit()`（[clip-sync.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js#L76-L94)）只把按钮切成"同步中"→toast 成功/失败，无分步、无详情、无提交文件数。

### 问题 3：工具清单总表现状
- DSH `integrations/dsh/skills/cut-shelter/SKILL.md` 已维护 14 项（13 MCP + `clip_session` 插件），数量自检约定写在"技能包维护约定"。
- 但该约定是**被动**的——没有任何机制在新增工具时"自动发现"遗漏，全靠人工。这正是用户指出的"下次新增无从发现"。

## Proposed Changes

### P0：邮件整合 AI 整理产物

**文件 A — `backend/.../service/ContentOrganizeService.java`**
- 在 `organizeContent()` 的 per-category 循环（第162-174行）内收集 `Map<String,String> categoryDigests`（category → `organizedContent`，即 AI 整理结果）。
- `sendOrganizeEmail()` 签名增加 `Map<String,String> categoryDigests`；在"分类详情"之前插入新的「📌 AI 整理摘要」章节：每个分类渲染其 AI 整理 Markdown（走轻量 `mdToHtml`）。
- 新增私有 `mdToHtml(String)`：先 `escapeHtml`，再处理 `## / ### / - / 1. / **加粗** / 行内代码 / 段落`。仅需满足邮件阅读，不做完整 Markdown 渲染。

**文件 B — `backend/.../service/WeeklyReportService.java`**
- 在 `generateWeeklyReport()` 循环（第138-181行）内收集每个分类的 `mainReport` 与 `knowledgePoints`，放入结构 `Map<String, ReportDigest>`（`ReportDigest { mainReport, knowledgePoints }`，可在类内定义个小 holder 或用 `Map`）。
- `sendWeeklyReportEmail()` 签名增加该结构；新增「📝 主报告」+「🧩 知识点」章节：每分类展示 mainReport，知识点以列表（标题+内容）呈现。
- 同样实现/复用 `mdToHtml`（Java 无共享工具类时在两个 service 内各自放一份轻量实现；若更省，抽一个 `EmailMarkdownUtil` 工具类供两者共用——二选一，默认抽工具类 `EmailMarkdownUtil`，避免重复）。

> 原则：**保留**现有统计卡片 + 全局统计 + 逐条剪藏卡（不做删除），AI 整理产物作为新增头部章节，邮件信息由"统计+罗列"升级为"统计+AI 整理"。

### P1：Git 同步分步状态与详情

**文件 C — `backend/.../service/GitService.java`**
- 将 `executeGitOperations(Path)` 改为返回 `Map<String,Object>`，含 `steps` 数组：每步 `{ name: pull|commit|push, ok: bool, files: int(仅commit), message: String }` 与整体 `ok`。
- 分步捕获：`fetch`→`pull`（输出/失败消息）、`add .` 后 `git diff --cached --name-only | count` 得待提交文件数、`commit`（成功才 push）、`push`（退出码/消息）。复用现有底层 `executeGitCommand`，但 error 分支填充到步骤结果而非只 log。
- **移除**未被调用且目录错误（`Paths.get(".")`）的 `pushAsync()`/`pullAsync()`（含 `pushStatus/pullStatus/pushMessage/pullMessage` 及相关 getter/reset），重构前用 Grep 确认无其他调用方（预期仅在 GitService 内部）。

**文件 D — `backend/.../controller/GitController.java`**
- `/sync` 返回 `gitService.executeGitOperations(parentPath)` 的结构化结果（含 `steps`、整体 ok、message）。失败仍返回 400。

**文件 E — `frontend/js/clip-sync.js`**
- `doSyncGit()` 解析后端结构化响应，调用新增 `renderGitSyncResult(data)`：
  - 成功：摘要行 + 每步 `[✓/✗] pull · N 个文件提交 · push`。
  - 失败：定位失败步骤与消息，`UI.friendlyError`/`UI.toast(type:'error')` 展示。
- 按钮状态与 2s 轮询写 `runStatus` 逻辑保持（不与本模块其它自动刷新冲突）。

**文件 F — `frontend/clip.html`**
- 新增一个隐藏的 `git-sync-result` 展示容器（放 `git-config-modal` 附近），用于渲染分步结果；不做大弹窗框架，复用 `ui-common` 的 toast/modal 风格变量。

### P2：对齐工具清单总表（只同步现有表）
- **不改** DSH 工具能力、**不新增** MCP 工具。
- 核对 `integrations/dsh/skills/cut-shelter/SKILL.md`：维持 14 项 = 13 MCP + `clip_session`；把"技能包维护约定"更新为引用新建的校验脚本（见 P3）。
- 核对 `integrations/dsh/README.md`：工具总数叙事"13 个 MCP + clip_session = 14"确认不变（本轮不新增工具，故计数实际不变化，仅文档指向校验脚本）。

### P3：技能包可发现性设计（解决"新增无从发现"）

采用「命令行校验脚本 + 轻量状态区」并存，各司其职。

**新文件 G — `integrations/dsh/verify-skill-table.mjs`（命令行守卫）**
- 用正则从 `mcp-server/server.mjs` 提取 `registerTool('x')` 的 MCP 工具名集合；从 `plugins/*/index.mjs` 提取本地插件工具名集合。
- 解析 `SKILL.md`「工具清单总表」表格中的工具名集合。
- 比对：① 已注册但表中缺失 → 报错列出；② 表中多余 → 警告；③ 汇总数（N MCP + 插件数）与 README 描述核对 → 不一致提示。退出码非 0 表示漂移，可被 CI / 构建钩子中断。

**文件 H — `integrations/dsh/README.md` / `SKILL.md`**
- 说明运行方式 `node verify-skill-table.mjs`，并写进 SKILL.md「技能包维护约定」：新增/修改工具后必须改 SKILL.md 并跑该校验，否则 CI 拒绝——把"被动约定"变为"可发现的强制校验"。

**新文件 I — 后端技能包状态接口 `GET /api/dsh/skill-status`**
- 新增 `SkillPackageStatusService` + 控制器入口：扫描 `integrations/dsh`（路径由配置 `dsh.integration-root` 提供，带向上查找的回退；找不到则返回 `found:false` 且不报错）。
- 返回对齐结果：`{ mcpTools[], pluginTools[], skillTableCount, drifted[](已注册但SKILL.md缺), excess[](表中多), ok }`（只读比对，不写文件）。
- 复用脚本同源逻辑（Java 版 regex 解析），保证页面与脚本结论一致。

**文件 J — `frontend/js/settings.js` DSH 配置页「技能包状态」区**
- 新增区块：展示工具总数（N MCP + 插件）、同步状态 badge（已同步/有漂移/未检测到）、漂移工具清单、"重新校验"按钮（`GET /api/dsh/skill-status`）。
- 复用 UI.toast/空态；接口失败时展示"未检测到 DSH 技能包目录"并给出校验脚本提示，不阻塞页面。

### P2b：回归测试与修复
- 后端编译：`mvn -q compile`（在 `backend/`）。
- 若存在测试套件：`mvn test` 确认不回归（先 `Glob` 确认有无 `*Test.java`）。
- 前端/脚本语法：`node --check` 于改动后的 `clip-sync.js`、新脚本 `verify-skill-table.mjs`。
- 运行 `node integrations/dsh/verify-skill-table.mjs`，输出"无漂移"。
- 手动功能验证：
  - 启动后端，`POST /api/git/sync` 返回带 `steps` 的结构化结果；`GET /api/git/config`、`POST /api/git/test-connection` 行为不变。
  - 触发日报/周报生成（无真实 SMTP 时确认 `isEmailConfigured` 为 false 静默跳过、且生成流程不因新增签名报错）；若配置测试邮箱，确认邮件含"整理摘要/主报告/知识点"章节。

## Assumptions & Decisions

- **保留既有邮件内容**：只在现有统计/列表基础上**增加** AI 整理章节，不删除原信息。
- **不新增 DSH MCP 工具**（用户选择"只同步现有表"）。
- **mdToHtml 为轻量实现**：覆盖标题/列表/加粗/行内代码/段落即可，充分满足邮件阅读，不做完整渲染。
- **移除失效异步方法**：重构前用 Grep 确认 `pushAsync/pullAsync` 无调用方后将其删除（避免误导性死代码），若要保留则改为使用存储父目录并接入控制器。
- **校验脚本**为无第三方依赖的 Node 脚本，规避 CI 环境安装成本。
- 本轮**不深入** git 密码/Token 加密、SSH 认证、多仓库等（用户未选中），仅在必要时对 `/config` 回显做最小脱敏（密码回填为 `****`）以提升安全性表现，若评估影响现有表单回填则回退该项。

## Verification

1. `mvn -q compile`（backend）通过。
2. `node --check frontend/js/clip-sync.js` 通过；`node --check integrations/dsh/verify-skill-table.mjs` 通过。
3. `node integrations/dsh/verify-skill-table.mjs` 输出"无漂移、13 MCP + 1 插件"。
4. `node --check integrations/dsh/verify-skill-table.mjs` 与 `frontend/js/settings.js` 通过。
5. 手动：`POST /api/git/sync` 返回 `steps` 明细；`GET /api/dsh/skill-status` 返回对齐结果且页面"技能包状态"区正常渲染（含漂移工具清单/未检测到降级）；日报/周报生成流程正常、签名改动不报错；配置测试邮箱后邮件含 AI 整理章节。