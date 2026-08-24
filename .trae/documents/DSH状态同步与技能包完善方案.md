# DSH 状态同步修复 与 技能包补齐方案

## 一、摘要 / Summary

本次任务解决两个关联问题，并按"适用的 / 可扩展的"长期规划落地：

1. **修复 DSH 运行状态不同步**：设置模块「DSH Agent（AI 干活）」页在 DSH 由其他入口（如工具→AI 干活）启动后仍显示"未运行（端口 3081）"。
2. **补齐技能包（SKILL.md）并科普用法**：当前技能包遗漏了 MCP 桥已实现的 `tools_hub_list` / `tools_hub_page`（Phase 3 Tools Hub 互通），README 工具清单也不一致（11 vs 13）。补齐 SKILL.md 到覆盖全部 13+1 个工具，并同步修正 README，为后续新增工具建立"一份清单、一处维护"的可持续约定。

## 二、现状分析与根因 / Current State Analysis

### 2.1 状态不同步根因
- [settings.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/js/settings.js#L1656-L1666) 中 `refreshRunStatus()` 仅在 `initDshAgentSection()` 初始化时执行一次，且在**本页**点击 启动/停止/保存 后手动再刷（L1681/L1715/L1724）。
- DSH 亦可由**其它入口**启动/停止：主框架 [index.html](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/frontend/index.html#L1137-L1168) 的 AI 干活视图（`ensureDshAgent` / 3081 探测）。此路径不反向通知设置页 → 设置页状态不刷新。
- 但主进程已具备**事件广播**：`broadcastDshProgress()`（[main.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/main.js#L1057-L1064)）向 `mainWindow.webContents` 发送 `dsh-agent-progress`，主窗口 `webPreferences.nodeIntegrationInSubFrames: true`（[main.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/main.js#L1920-L1923)），因此**设置 iframe 内的 preload `api.onDshAgentProgress` 可收到该广播**（[preload.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/preload.js#L519-L522)）。
- 结论：修复 = 事件驱动（订阅 `onDshAgentProgress` 后刷新）+ 兜底轮询（周期 `dsh-agent:status` 探测，覆盖外部启动），两者都仅改动前端 `settings.js`，不影响主进程/后端。

### 2.2 技能包不完整
- MCP 桥 [server.mjs](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/integrations/dsh/mcp-server/server.mjs#L82-L260) 实际注册 **13 个工具**：clip_search / clip_list / clip_add / clip_delete / clip_categories / todo_list / todo_add / todo_set_status / learning_plan_list / wiki_index / weekly_report_status / **tools_hub_list** / **tools_hub_page**；另有 clip-capture 插件的 **clip_session**（第 14 个）。
- 现 [SKILL.md](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/integrations/dsh/skills/cut-shelter/SKILL.md) 已覆盖前 11 + clip_session，但**缺少 tools_hub_list / tools_hub_page**，且未给出"完整工具清单/签名"总表。
- [README.md](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/integrations/dsh/README.md) 工具表（L68-L78）只列 11 个，与"13 个工具"注释（L12-L14）及 L56"11 个工具"不一致。

### 2.3 一键安装技能包机制（科普，现网事实）
- 设置页「一键安装技能包」→ `api.installDshSkill()` → IPC `dsh-agent:install-skill`（[main.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/main.js#L2280-L2303)）：把 `integrations/dsh/skills/cut-shelter/`（含最新的 SKILL.md）复制到 `~/.dsh/skills/cut-shelter/`。
- DSH 通过 `dsh-skill-filesystem` 从 `~/.dsh/skills` 等目录发现 `SKILL.md`，把内容作为"使用手册"喂给 Agent（见 [docs/DSH集成探索.md](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/docs/DSH集成探索.md)）。
- 因此 `integrations/dsh/skills/cut-shelter/SKILL.md` 是**唯一搬运源**；补齐它=补齐一键安装后 Agent 的操作手册。技能包状态由 `dsh-agent:skill-status` 探测该 SKILL.md 是否存在（[main.js](file:///l:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding/electron/main.js#L2308-L2312)）。

## 三、拟变更 / Proposed Changes

### Part 1：修复 DSH 状态不同步
文件：`frontend/js/settings.js`（仅此一处，最小改动）

在 `initDshAgentSection()` 的 `refreshRunStatus()` 定义之后增加两件事：

1. **事件驱动刷新**：订阅 `api.onDshAgentProgress(cb)`，回调内调用 `refreshRunStatus()`（DSH 启动/就绪/失败等阶段变化时立即刷新）。把订阅句柄存入 `runStatusCleanup`（供后续清晰解除；当前设置页随应用生命周期驻留，也可不解除）。
2. **兜底轮询**：`setInterval(refreshRunStatus, 2000)`；为降低隐藏页开销，监听 `document.visibilitychange`，仅当 `document.visibilityState === 'visible'` 时轮询，隐藏时停止。初始立即执行一次（现状已有）。

改动后行为：任意入口启动/停止 DSH，设置页「运行状态」描述 ≤2 秒内自动更新为「运行中（端口 3081，本应用拉起/复用实例）」或「未运行（端口 3081）」。

### Part 2：补齐技能包 SKILL.md
文件：`integrations/dsh/skills/cut-shelter/SKILL.md`

在保留现有 frontmatter（`name/description`）与既有章节前提下，做以下增补：

1. **新增「工具清单总表」附录**（单处维护）：列出 14 个工具（13 MCP + clip_session），含名称、作用、读写性质、关键参数、示例，覆盖新增的 `tools_hub_list` / `tools_hub_page`。
2. **补 `tools_hub_list` / `tools_hub_page` 用法小节**：说明 Tools Hub 是 HTML 小工具注册表，Agent 可用只读工具浏览工具中心并阅读小工具实现思路；给出场景示例。
3. **明确 `clip_delete` 边界**：破坏性操作需用户确认、重复尝试（后端异步分析写回可能需重试），与现有 README 常见问题对齐。
4. **新增「技能包维护约定」**（可扩展性的落地机制）：约定—只要在 `server.mjs`/clip-capture 新增或修改 MCP 工具，就必须同步更新本 SKILL.md「工具清单总表」，保持单一事实来源；并注明 SKILL.md 源文件位于仓库 `integrations/dsh/skills/cut-shelter/`，一键安装会整体覆盖。

### Part 3：同步修正 README
文件：`integrations/dsh/README.md`

- 工具清单表（L68-L78）补 `tools_hub_list` / `tools_hub_page` 两行，标注"只读 / Phase 3"。
- 修正 L56 与结构注释（L12-L14）口径为一致：统一"13 个 MCP 工具 + clip_session 插件 = 14 个可选工具"。改为："Agent 将看到 `mcp__cut_shelter__*` 的 13 个工具，以及 `clip_session`（Phase 1）"。
- 保留原有配置/常见问题/路线章节。

### Part 4：科普说明（输出给用户，写入本方案与最终回复）
写给用户的能力说明要点：
- **技能包是什么**：一份 `SKILL.md`（Markdown 使用手册），DSH 的技能加载器把它作为"知识库使用规范"喂给 Agent，指导 Agent 如何用 MCP 工具读写剪藏。
- **一键安装**：把仓库内的 Skill 源整体复制到 `~/.dsh/skills/cut-shelter/`；改动源文件后重装即覆盖生效。
- **使用方式**：DSH 里 Agent 侧工具为 `mcp__cut_shelter__<工具名>`；读多用文件/MCP 只读工具（省 token），写必走 MCP 工具、避免直改数据文件。
- **是否完整可扩展**：补齐后覆盖 14 个工具；未来新增工具只需按"维护约定"在 SKILL.md 总表补一行 + 更新 README。

### Part 5：长期扩展规划（写入方案，作为可执行方向）
1. **技能包单一事实来源**：以 `SKILL.md` 的「工具清单总表」为唯一维护点，README 只引用内核数，避免 11/13 这类漂移。
2. **（可选，后续）同步脚本**：新增 `integrations/dsh/scripts/sync-skill-tools.mjs`，用正则提取 `server.mjs` 的 `registerTool('<name>'` 与 plugin 的 `defineTool` 工具名，自动重写 SKILL.md 总表并校验列表一致；在 CI/prebuild 可选执行。**本期不做，仅列为后续路线，避免过度工程**。
3. **状态同步复用性**：把「事件 + 定时轮询」的 DSH 状态刷新下沉为一个可复用小工具（如 `ui` 里维护 `startAgentStatusWatcher(api, cb)`），未来其它含 sidecar 状态的模块复用。

## 四、假设与决策 / Assumptions & Decisions

- 状态修复仅改 `frontend/js/settings.js`，不改主进程/后端（事件已具备）。
- 轮询间隔 2000ms + `visibilitychange` 节流，开销可忽略，符合"轻量、低占用"。
- 技能包补齐以手动维护 + 文档约定为主；同步脚本列为后续，不本期新增（避免过度工程）。
- 技能包描述以工具名/用途/参数为准，不臆造后端不存在的接口。
- SKILL.md 源仍为仓库 `integrations/dsh/skills/cut-shelter/`，作为一键安装的搬运源。

## 五、验证 / Verification

- **状态同步**：
  1. 启动应用 → 设置页初始显示"未运行（端口 3081）"。
  2. 切到「工具 → AI 干活」启动 DSH → 返回设置页 ≤2s 内变为"运行中（端口 3081）"。
  3. 在设置页点「启动」→ 描述即时更新；点「停止」→ 描述更新为"未运行"。
- **技能包**：
  4. `node --check` 校验改动的 JS 语法通过。
  5. `SKILL.md` frontmatter（name/description）完整；总表含 14 行工具；`tools_hub_list`/`tools_hub_page` 有单独小节。
  6. `README.md` 工具表出现 14 个条目、无 11/13 矛盾表述。
  7. 设置页点「一键安装技能包」→ 成功提示 + `dshSkillStatus` 变为已安装；`~/.dsh/skills/cut-shelter/SKILL.md` 为新内容。
- **回归**：设置页原有 保存/启动/停止/打开 逻辑不受影响；DSH 复用/置顶行为不变。