# DSH 集成实际体验测试指南

按本指南可完整走一遍"DSH Agent 使用剪藏知识库"的真实体验。已按本机环境核实：DSH_HOME=`C:\Users\pengwenfeng\.dsh`（模型配置已就绪，新实例自动复用，无需重新填 Key）；node=`C:\nvm4w\nodejs\node.exe`。

> 前置概念：`--patch` 是给 DSH 叠加一层配置（挂 MCP 桥 + clip-capture 插件），**不修改**你现有的 DSH 配置；端口 3081 避开你日常用的 3080。

---

## 步骤 0：启动剪藏后端

> 前置说明：DSH CLI 的获取优先级 = 配置 `dshBinPath`/环境变量 `DSH_BIN` → 应用内置 → **本机 npx 缓存**（执行过 `npx @deepseek-ai/dsh web` 即命中）→ npx 联网兜底（版本固定 `@deepseek-ai/dsh@0.1.0-rc.7`，可用 `DSH_NPX_SPEC` 覆盖）。**本机已满足**（日常 3080 实例即来自 npx 缓存）。

```bash
cd L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding
java -jar backend\target\clip-demo-0.0.1-SNAPSHOT.jar
```

验证：浏览器打开 `http://127.0.0.1:8081/api/health`，应看到 `{"status":"UP",...}`。
（也可以用 `cd backend && mvn spring-boot:run`。）

## 步骤 1：启动带集成的 DSH

> ⚠️ `--patch` 的路径**相对于当前命令行目录**解析：要么先 `cd` 到仓库根目录，要么写绝对路径。在用户主目录（`C:\Users\xxx>`）直接跑会报 `failed to read overlay ... ENOENT`。

```bash
# 方式 A：先切到仓库根目录
cd /d "L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding"
npx @deepseek-ai/dsh web --patch ./integrations/dsh/cordis.example.yml

# 方式 B：绝对路径，从任何目录都可跑
npx @deepseek-ai/dsh web --patch "L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\integrations\dsh\cordis.example.yml"
```

启动成功的标志：终端无报错；日志中出现 mcp-client 连接、clip-capture 插件加载的信息（若 mcp-client 连接失败只记日志不阻断启动）。

## 步骤 2：打开体验界面

浏览器访问 **`http://127.0.0.1:3081`**（不是 3080！）。

确认工具就绪：给 Agent 发一句

> 列出你当前可用的工具，特别是与"剪藏/cut_shelter"相关的。

它应回答能看到 `mcp__cut_shelter__clip_search`、`clip_add`、`todo_add` 等 11 个桥工具，以及 `clip_session`。

## 步骤 3：四个体验场景（按顺序，每个都去剪藏侧验证）

### 场景 A —— Agent 读你的知识库（只读，无副作用）
> 用剪藏知识库工具，查一下 Wiki 索引里有哪些实体（用 wiki_index 工具）。

预期：Agent 调用 `mcp__cut_shelter__wiki_index` 并总结索引内容（当前 52 个页面）。
若知识库有剪藏，也可试：`clip_search` 搜关键词。

### 场景 B —— Agent 写一条剪藏（有副作用，验证入库）
> 新增一条剪藏：内容"这是一条体验测试剪藏，来自 DSH Agent"，标题"DSH体验测试-01"，标签[dsh体验]，不要用 AI 标签。

预期：Agent 调用 `clip_add`，返回 `id=xx`。
**剪藏侧验证**：打开剪藏前端（`http://127.0.0.1:3001` 或 Electron 应用），应能看到这条剪藏；或直接 `GET http://127.0.0.1:8081/api/clip/list` 确认。

### 场景 C —— Agent 建待办
> 帮我创建一条待办：周五前写完周报，优先级 high，截止日期本周五。

预期：Agent 调用 `todo_add` 返回 id。
**剪藏侧验证**：`GET http://127.0.0.1:8081/api/todo/list` 可见该待办；前端待办时间线页面也能看到。

### 场景 D —— 会话成果自动落库（Phase 1，clip_session）
> 本次会话验证完成：DSH 能通过 MCP 桥检索剪藏知识库、创建剪藏与待办。用 clip_session 把这段成果总结保存进知识库。

预期：Agent 调用 `clip_session`（`source=dsh`），返回 id。
**剪藏侧验证**：`clip/list` 中出现 `source=dsh` 的剪藏。

## 步骤 4：清理与恢复

- 体验完：停掉步骤 1 的进程即可（Ctrl+C），**不影响**你的日常 3080 DSH 和剪藏本体。
- 测试产生的剪藏/待办：在剪藏前端手动删除，或按 id 调 `DELETE /api/clip/{id}` / `DELETE /api/todo/{id}`。
- 想让集成**常驻**（每次 `dsh web` 都带）：把 `cordis.example.yml` 的内容合并进 `C:\Users\pengwenfeng\.dsh\profiles\web\cordis.patch.yml`（当前为 `[]`）。建议先体验满意后再固化。

## 步骤 5：剪藏桌面端「AI 干活」面板（Phase 2）

不用手动起 DSH——启动剪藏 Electron 桌面应用后：

1. 顶部导航点击 **「AI 干活」**（工具右侧的新按钮）；
2. 主进程自动探测并拉起/复用 `http://127.0.0.1:3081` 的 DSH sidecar（固定 3081，避免与手动启动的 3080 冲突；3081 已有实例则直接复用）；
3. **首次使用自动安装**：若本机没有 DSH（无缓存/无内置），应用会**替用户执行 `npx @deepseek-ai/dsh@0.1.0-rc.7 web`**（联网下载，约 1–5 分钟），面板实时显示进度：`检测 → 正在安装（含已等待秒数与实时日志）→ 正在启动 → 就绪`；安装/启动期间可点「取消」，失败可点「重试」。安装成功后 dsh 缓存路径会自动固化到配置，下次秒起；
4. iframe 内嵌 Agent 界面，顶部面板条显示连接状态（运行中/复用/失败）；
5. **主题适配**：面板条/边框跟随剪藏主题（notion/regular/dark）；右上角「🌗 反色」可让 iframe 视觉适配暗色主题（默认 auto=跟随暗色，可在常开/关闭/自动间切换，记忆在 localStorage）；「↗」在系统浏览器打开。

## 步骤 5b：设置页 DSH 配置与技能包（建议项）

设置 → 「DSH Agent（AI 干活）」区块（即时生效）：

- **启用开关 / 端口 / dsh CLI 路径**：改完点「保存设置」（写入 `~/.cut-shelter/config/config.json`，端口/路径重启应用生效）；
- **一键安装技能包**：把 `cut-shelter` 技能复制到 `~/.dsh/skills/cut-shelter`（DSH 自动发现）；
- **启动 / 停止 / 打开面板**：手动管理 3081 实例。

## 步骤 5c：Trae 技能同步（已执行）

Trae 技能已同步到 DSH 技能目录（格式兼容，无需转换）：

- 全局：`~/.trae-cn/skills/*`（18 个）→ `~/.dsh/skills/`（用户级，任何工作区可用）；
- 项目：仓库 `.trae/skills/*`（6 个）→ `.dsh/skills/`（项目级，本仓库工作区可用）。

> 重复技能名以用户级为准覆盖。新增 Trae 技能后重跑一次复制即可（或手动拷贝到 `~/.dsh/skills/`）。
5. 退出应用时自动关闭本应用拉起的 DSH sidecar（复用的实例不杀）。

> 说明：面板由主进程**运行时生成 patch**（`buildDshAgentPatch()` → `~/.cut-shelter/config/dsh-agent.patch.yml`），桥/插件路径按形态解析（开发=仓库 `integrations/dsh`，打包=`resources/integrations/dsh`，已内置进 `extraResources`）。dsh CLI 自动探测：`DSH_BIN` → 内置 node_modules → npx 缓存（LOCALAPPDATA）→ npx。⚠️ **旧版 win-unpacked 构建需重新打包（`npm run build:win`）才包含主进程修复**；临时应急已复制 `integrations/dsh` 到 `dist-electron/win-unpacked/integrations/dsh`（旧代码查找路径）。非 Electron 的纯浏览器前端会自动降级为直接探测 3081。

## 步骤 6：Phase 3（Tools Hub 互通）

MCP 桥已新增 `mcp__cut_shelter__tools_hub_list`（列出剪藏工具中心的小工具）与 `tools_hub_page`（读取小工具 HTML 源码）。在 DSH 里试：

> 用 tools_hub_list 看看剪藏的工具中心里有哪些小工具，再用 tools_hub_page 读一下 pdf-toolbox 的实现思路。

---

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 启动报 `failed to read overlay ... ENOENT` | `--patch` 用了相对路径且不在仓库根目录运行 → 先 `cd /d` 到仓库根目录，或用绝对路径（见步骤 1） |
| 启动报 `Received protocol 'l:'` | 插件 name 用了盘符路径 `L:/...` → 必须写成 `file:///L:/...` URL（见 `cordis.example.yml`） |
| 启动报 `cannot get property "config" without inject` | 插件里访问配置要用 `apply(ctx, config)` 第二参数，不要用 `ctx.config`（见 `plugins/clip-capture/index.mjs`） |
| 桥进程没被拉起（看不到 `node ... server.mjs`） | 新增插件必须放在 `- insert:` 块里；顶层 `- id:` 条目是"替换已有条目"语义，对不存在的新插件无效 |
| 3081 打不开 / 端口被占 | 改 `integrations/dsh/cordis.example.yml` 里 `webserver.config.port` 换端口重启 |
| Agent 说看不到 `mcp__cut_shelter__*` 工具 | ① 剪藏后端没起（先过步骤 0）；② node 路径不对（`where node` 核对 `command`）；③ 看 DSH 终端日志里 mcp-client 的报错 |
| 工具调用了但报 HTTP 错误 | 桥默认连 `http://127.0.0.1:8081`，确认后端在该端口（`/api/health`） |
| 模型不可用/没反应 | DSH 设置→模型里确认有可用提供方（本机已配 wuan-ds 等）；与集成无关 |
| 中文路径报错 | 确认命令行的引号完整；`cordis.example.yml` 内路径用正斜杠 |

---

## 想更快？也可以只用 CLI 冒烟

只想确认"桥 + 插件能被 DSH 加载"而不开浏览器：

```bash
npx @deepseek-ai/dsh --profile headless --patch ./integrations/dsh/cordis.example.yml "列出你能用的工具名称"
```

（headless 一次性运行会打印最终回答后退出。若报模型未配置，回到步骤 2 用 Web UI 体验。）
