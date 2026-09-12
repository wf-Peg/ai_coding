# AGENT.MD — 剪藏（Clip）项目 AI 编程约束

## 项目概述

剪藏（Clip）是本地优先的个人信息管理工具，支持剪藏、AI分析、专题管理、待办时间线、日报/周报、Git同步、Electron桌面打包。

## 技术栈

| 层   | 技术                             |
| --- | ------------------------------ |
| 后端  | Spring Boot 3.2.0, Java 17     |
| 前端  | HTML5 + CSS3 + JS (ES6+)，无框架   |
| AI  | DashScope SDK + DeepSeek API（deepseek-v4-flash/pro，见「LLM 提供者」分层） |
| 存储  | 本地文件系统（JSON），无数据库              |
| 桌面  | Electron 36+, electron-builder（Node >= 22） |
| 构建  | Maven (后端) + npm (Electron)    |

## 目录结构

```
backend/     → Spring Boot，入口: ClipDemoApplication.java
frontend/    → 纯静态 HTML/CSS/JS，无构建工具
electron/    → Electron 主进程
```

## 代码索引（人 + AI 双通道）

- **静态地图**：`CODE_INDEX.md` 提供全项目「文件 → 类/函数/方法/路由 + 起始行号」骨架，供人和 AI 快速定位。**生成物**，改代码后用 `npm run codeindex:gen` 重新生成。
- **精确查询（推荐 AI 用，走 CLI 按需）**：`codegraph` 已为本仓库建好本地索引，按需精确拿「定义/调用方/影响范围」，避免整文件读取、降低 token 消耗：
  ```bash
  codegraph query "符号名"      # 紧凑：符号定位 → 文件:行号（优先用）
  codegraph callers "符号"      # 紧凑：谁调用了它
  codegraph impact "符号"       # 紧凑：改动影响范围
  codegraph context "任务" --no-code --max-nodes 20  # 受限探索：默认省略源码大块+限节点
  npm run codeindex:status     # 索引状态
  ```
  ⚠️ **Token 预算**：`codegraph explore` / `context` 不带限制会一次性返回大量逐字源码（实测约 4K token/次）。仅在确需跨文件定位时用并务必带瘦身参数（`--no-code`、`--max-nodes` / `--max-files`）；启动阶段先走 `query`/`callers`/`impact` 这类紧凑查询，避免会话 Context 残留膨胀。
- **不要启用 codegraph 的 MCP 服务器（`codegraph serve --mcp`）**：其工具 schema 会每轮注入系统上下文、且 explore 返回体大，会导致每次提问 token 明显上涨。需要索引时用上 CLI 按需调用即可（无 schema 常驻、返回受控）。
  索引为本地自动同步（fs.watch），代码变更后无需手动 rerun；索引库在 `.codegraph/`（已 gitignore）。

## 构建与运行

```bash
# 后端编译
cd backend && mvn clean package -DskipTests

# 后端运行（JAR）
java -jar backend/target/clip-demo-0.0.1-SNAPSHOT.jar

# 后端运行（开发）
cd backend && mvn spring-boot:run

# 前端开发（SPA，含路由 fallback）
cd frontend && node server.js    # 端口 3001

# 一键启动
start.bat       # Windows
./start.sh      # macOS/Linux

# 桌面打包
build.bat       # Windows
./build.sh      # macOS/Linux
```

## DSH（AI 干活）侧车

- **内嵌位置**：Electron 主进程按需拉起 DSH Web sidecar（`integrations/dsh/`），供「AI 干活」面板 iframe 内嵌；启动/复用/退出逻辑在 `electron/main.js`。
- **固定端口 3081**（`dshPort`），避免与用户手动启动的 DSH（默认 3080）冲突；若 3081 已有实例则直接复用，不重复拉起、退出时不杀用户进程。
- **路径统一**：DSH 技能目录 / 侧车路径一律经 `resolveDshHome()` 解析，sidecar 启动、技能安装、技能查询共用同一目录。
- **版本单一常量**：`DSH_VERSION` 唯一管理应用适配的 DSH 版本（升级助手告警 + 兜底 spec 同源）；DSH 不随应用自动升级，仅提供「升级助手」复制 npx 命令由用户手动执行。
- **会话归档**：`integrations/dsh/plugins/clip-capture` 在回合结束（`turn/end`）自动归档，链路见「归档与产品概览迭代」。

## 代码约束

### 后端（Java）

- 包结构：`com.example.clip.{controller,service,model,dto,config,core,utils}`
- Controller 用 `@RestController` + `@RequestMapping`，路径统一 `/api/xxx`
- Service 之间可互相注入，但避免循环依赖
- 数据持久化：通过 `FileStorageService` 读写本地 JSON，**不使用数据库**
- ID 生成：`FileStorageService.idGenerator` 原子自增，启动时扫描已有数据最大值
- 配置：`application.yml` 在 `backend/src/main/resources/` 下，通过 `@Value` 注入
- Controller 放在 `controller/` 包下，确保被 `@SpringBootApplication` 扫描

### 前端（HTML/CSS/JS）

- 纯静态文件，无 npm 构建，无框架，直接操作 DOM
- 样式：内联 `<style>` 或 `styles/` 目录下独立 CSS 文件
- 主题：`theme-notion.css`（Notion风格）、`theme-regular.css`（常规）
- Markdown 渲染：`libs/marked.min.js`
- API 调用：`fetch('http://127.0.0.1:8081/api/...')`
- 每个页面独立 HTML 文件，逻辑内嵌或独立 JS 文件
- 设计上参考obsidian，notion等，做出高级感并贴合全局主题

### LLM 提供者

- 接口：`LlmProvider`（`core/` 包下）
- 实现：`DashScopeLlmProvider`、`DeepSeekLlmProvider`（走 OpenAI 兼容层 `OpenAiCompatibleLlmProvider`）
- 路由：`RoutingLlmProvider` 按场景分发，且按**档位**选模型
- 配置：`ModelConfig` + `ModelConfigService` 支持运行时切换
- **模型档位**：`simple` → `deepseek-v4-flash`；`strong` → `deepseek-v4-pro`。
  - `simple`：剪藏处理、Wiki 页面定位、实体抽取、标签/摘要生成及绝大多数任务。
  - `strong`：`synthesizeAnswer`、`detectContradiction`、`generateKnowledgeSupplement`、会话归档提炼（title/problem/solution/outcome）。
  - 新 AI 任务按此分层选档，勿混用成本与质量。

## 约束规则

1. **不引入新框架**：前端不用 React/Vue，后端不用 MyBatis/JPA
2. **不引入数据库**：存储仅用本地 JSON 文件系统
3. **API 前缀**：所有后端接口统一 `/api/` 开头，`@CrossOrigin(origins = "*")`
4. **端口约定**：后端 8081，前端 3001（application_templete.yml 模板与 Electron 默认一致；独立运行时保持与扩展/前端硬编码一致）
5. **文件编码**：UTF-8
6. **配置模板**：`application_templete.yml` 是模板，`application.yml` 是实际配置（已在 .gitignore）
7. **新增页面**：HTML 文件放 `frontend/`，样式放 `frontend/styles/`，JS 逻辑内嵌或独立文件
8. **新增后端模块**：按现有包结构放置，Controller/Service/Model 各司其职
9. **Electron 改动**：仅修改 `electron/` 目录，不耦合业务逻辑
10. **兼容性**：不破坏现有 API 接口和前端页面
11. **重要的**：代码要增加日志与代码注释，清晰且方便问题排查
12. **SPA 路由约定**：新增页面（如 `topic.html`）必须在 `index.html` 中做两件事：(a) 在 `VIEW_IFRAME` 注册映射；
(b) 在 `pathToView()` 注册 URL path。导航用 `history.pushState`，监听 `popstate` 支持前进/后退。
所有静态服务器必须启用 SPA fallback（`npx serve --single`，Python 需自定义 SPAHandler，Electron 设 `serve-static` 的 `fallthrough: false` + `onerror` 回退到 `index.html`）。
`index.html` 是唯一入口，禁止 `window.location.href` 跳转。
13. **提交历史记录**：每次 `git commit` 后，必须同步追加一条记录到项目根目录的 `commit_history.log`。
    - 格式：`YYYY-MM-DD HH:MM | 提交说明`（日期时间 + 竖线 + 改动摘要）
    - 说明要求：浓缩核心改动内容，30字以内，突出功能点而非技术细节
    - 重复提交合并：若同一功能多次提交注释，合并为一条（如"后端项目代码注释完善（多轮提交合并）"）
    - git 操作后立即执行，不可遗漏
14. **提交推送走脚本**：commit+push 统一用 `scripts/git-push.ps1`；默认仅按 `-Paths` 提交**本次会话改动**文件，用户明说「提交全部」时用 `-All`；脚本自动追加 `commit_history.log` 并推送

## Electron iframe 焦点与键盘事件（高频踩坑）

主界面为「主窗口 + 各模块 iframe」架构（index.html 嵌入 editor.html 等），键盘事件只落在**当前拥有焦点的 document**：

1. **父窗口不拦截普通字符，问题是焦点不在 iframe**：主进程/父页面只拦截全局快捷键（⌘⇧F 等）。若用户输入 "/" 等字符无反应，先怀疑焦点在父窗口（全局搜索框、Pet 输入框、工具栏按钮），而非父窗口 keydown 拦截。
2. **任何初始化/切换流程后必须显式恢复 iframe 焦点**：iframe 内脚本调用 `mainEditor.focus()` 才会把焦点拉回编辑器。缺失时输入落入父窗口，斜杠菜单等依赖编辑器焦点的快捷键全部失效。以下场景都要补：
   - iframe 初始化完成后（异步恢复缓存/渲染之后，不能放在 promise 之前）
   - 视图从其他模块切回编辑器时（`visibilitychange` → `visible` 分支）
   - 关闭浮层/面板/弹窗后
3. **视图切换用 `visibility:hidden` 而非 `display:none`**（避免 iframe 重载丢状态），切回时 `visibilitychange` 会触发，是恢复焦点的可靠挂点；`display:none` 不会触发该事件。
4. **覆盖层（如空文档"直接开始写作"引导层）可见时，document 级 keydown 监听器处理可打印字符要谨慎**：焦点若在编辑器，ACE 已在捕获阶段处理字符（`e.defaultPrevented` 为 true），冒泡到 document 的兜底分支必须检查 `e.defaultPrevented`，否则会重复插入字符导致斜杠触发条件被污染。
5. **iframe 内禁用 Cmd+R/Ctrl+R**（editor.js 已注册 preventDefault），浏览器刷新在 Electron 中无意义且会丢编辑器状态。
6. 排查手段：用 a11y 树（Computer Use）确认键盘焦点元素；输入 "/" 后观察编辑器 val 是否出现 "/" 字符——没有则焦点不在编辑器。

## 需求开发流程

### TODO/ 目录规范

```
TODO/
├── <中长需求目录>/           # 如"工作台与数据层重构需求"
│   ├── 01-<主线任务说明>.md   # 总计划，含分阶段任务和勾选状态
│   ├── 02-<子任务规格>.md     # 每个子任务的 spec
│   ├── 03-<子任务实施任务>.md  # 每个子任务的 tasks
│   └── 04-<子任务验收清单>.md  # 每个子任务的 checklist
├── <其他需求>/...
└── bugs/
    └── bug-history.md        # bug 历史记录，供 AI 和开发者参考
```

### 开发步骤

1. **识别子任务**：从 TODO 中长需求目录的 `01-主线任务说明.md` 中识别当前要做的子任务。
2. **编写 spec**：在 `.trae/specs/<change-id>/` 下创建 spec.md、tasks.md、checklist.md。
3. **实现与验证**：按 tasks.md 逐项实现，完成后勾选，通过 checklist 逐项验证。
4. **归档**：将 spec 文件复制到 TODO 中长需求目录，中文命名按编号排列。
5. **更新主线**：勾选 `01-主线任务说明.md` 中对应子任务，追加"落地状态"章节记录完成情况。
6. **提交与推送**：commit + push，同步更新 `commit_history.log`。

### 验收标准

- 所有 checklist 项必须勾选通过
- 后端全量测试通过（`mvn test`）
- 前端脚本语法检查通过
- 桌面/浏览器冒烟测试通过
- 不破坏现有 API 接口和前端页面
- 不损坏现有业务 JSON 数据

### Bug 历史管理

- 路径：`TODO/bugs/bug-history.md`
- 记录内容：现象、原因、修复方式、经验教训
- 记录时机：每次 bug 修复完成后立即追加
- 用途：后续可依据 bug 历史更新 agent.md 约束，避免同类问题重复出现

## 归档与产品概览迭代

### 概述

产品概览的迭代记录由 **两路会话成果归档** 写入，共用后端 `POST /api/workspace/feature-points/iterations/ai-session`（后端用强模型提炼 title/problem/solution/outcome，落 `feature-point-iterations.json`，按 `source` 区分来源展示）：

- **DSH**：`integrations/dsh/plugins/clip-capture` 插件在每回合结束（`turn/end`, reason=completed）自动聚合会话并归档（`source=dsh-session`）。
- **TraeCode（提交推送自动）**：以提交推送收尾的任务，由 `.trae/skills/git-commit-workflow/SKILL.md` 在推送成功后**自动**调用归档链路，把本会话提炼为 `conversation` 并显式传 `source=trae-session`。
- **TraeCode（暂不提交兜底）**：完成任务但暂不提交时，沿 `.trae/skills/trae-session-archive/SKILL.md` **手动**归档一次（`source=trae-session`）。该 skill 是 TraeCode 侧归档的**唯一事实来源**，提交自动归档与手动兜底共用同一套 endpoint / 字段 / source 约定。

### 归档链路

```
Task 完成（编码/研发，验证通过）
    ├── TraeCode · 提交推送收尾：git-commit-workflow
    │        推送成功后 自动 → POST /api/workspace/feature-points/iterations/ai-session
    │                      { conversation, source: 'trae-session' }
    ├── TraeCode · 暂不提交：trae-session-archive（手动、共享规Ciform）
    │                      → 同上接口（source=trae-session）
    └── DSH：clip-capture 插件 turn/end 自动聚合
             → 同上接口（source 缺省 = dsh-session）
                ↓ 后端 AI 提炼四字段
        产品概览迭代记录（feature-point-iterations.json）
```

### 旧链路现状（已弃用/遗留）

- 后端 `TodoScannerService` 对 `TODO/**/feature-points.json` 的 **自动落库（剪藏/待办）已硬禁用**，不再扫描。
- 产品概览页仍兼容展示既有 `feature-points.json` 旧树（`GET /api/workspace/feature-points`）。
- `product-dev-archive` / `product-dev-history-migrate` 为**遗留 skill**：不再自动执行、不再作为归档主线；仅在有需维护既有 TODO 概览树、或对存量 TODO 目录做一次性 `feature-points.json` 迁移时手动使用。

### 相关技能

- `.trae/skills/git-commit-workflow/` — **主线（提交推送自动归档）**：推送成功后自动写迭代记录（`source=trae-session`），引用 `trae-session-archive` 为唯一事实来源。
- `.trae/skills/trae-session-archive/` — **共享规Ciform + 手动兜底**：完成任务但暂不提交时的手动归档入口（`source=trae-session`）。
- `.trae/skills/product-dev-archive/` — 遗留：写 `TODO/**/feature-points.json`（旧概览树，非主线）
- `.trae/skills/product-dev-history-migrate/` — 遗留：存量 TODO 目录迁移补 feature-points.json