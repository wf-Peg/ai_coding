# HARNESS ↔ 碎碎记 app 联动集成计划（产品概览「开发档案」Tab · 只读 + 内嵌审计）

## 背景与结论先行

用户要求：HARNESS 规则（仓库层 md 档案：devlog/bugs/decisions/roadmap + _index.md 契约 + harness-audit 脚本）与碎碎记 app 做**更好的联动与集成、可视化与维护性**。
上一轮文章（Project Brain / 决策记忆）的启发：把本产品的「决策记忆」＝ HARNESS，做成 app 内可见、可审计、可维护的一等资产。

已确认的两个决策：
1. **入口**：产品概览页（workspace.html 的 product-dev 视图）新增「开发档案」Tab。
2. **深度**：**只读 + 内嵌审计**——app 只读 HARNESS 目录并做可视化与审计，md 仍是唯一真相源；不写回、不双工同步。

当前痛点（探索确认）：
- HARNESS 只能在**仓库层**用：无 git 拉取时 UI 不可见，审计要手动跑 `node scripts/harness-audit.cjs`，不符合"好维护"。
- 产品概览页已存在成熟的 pd-tab 机制（[workspace.html#L255-L261](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/workspace.html#L255-L261)、[workspace.js#L2154-L2163](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/workspace.js#L2154-L2163)）与后端统一配置 [AppConfigService](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/AppConfigService.java)，集成成本低。
- 审计规则可直接镜像现有 [harness-audit.cjs](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/scripts/harness-audit.cjs)（8 条校验，纯 frontmatter 正则 + index 反查，无第三方依赖），用 Java 复刻即可对齐结果。

---

## 现状分析

| 层 | 现状 | 位置 |
|---|---|---|
| HARNESS 目录契约 | devlog（牛马四字段）/ bugs（按模块）/ decisions（ADR）/ roadmap + 每个目录 `_index.md`（时间倒序登记） | [HARNESS/README.md](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/HARNESS/README.md) |
| frontmatter 契约 | 必填 `type/id/title/date/status/commit/source/generated`，可选 `module/tags/sources` | [INDEX.md](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/HARNESS/INDEX.md)、[harness-archive skill](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/.trae/skills/harness-archive/SKILL.md) |
| 审计 | `node scripts/harness-audit.cjs`：1) frontmatter 必填/非空 2) `_index.md` 存在 3) 索引声明文件存在 4) 记录在 index 登记（slug 反查） | [harness-audit.cjs](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/scripts/harness-audit.cjs) |
| app 统一配置 | `~/.cut-shelter/config/app-config.json`，AppConfig POJO + `/api/config` 全量提交 | [AppConfig.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/config/AppConfig.java)、AppConfigService |
| 产品概览页 Tab | `data-pd-tab` 切换 + `data-pd-content` 面板，已有 总览/需求看板/归档 tab；牛马记录已聚合 dsh/trae 会话归档 | workspace.html、workspace.js |
| 真相源分工 | "`HARNESS/devlog` 是人工/AI 文档真相源；feature-point-iterations 只服务概览展示；两者并行、不同步，对不上以 md 为准" | HARNESS/README.md |

本方案不改变真相源分工：**app = 只读消费者 + 审计面**，HARNESS md 与 skill/脚本写入链完全不动。

---

## 变更清单

### 1. 后端：新增 `harnessPath` 配置（开关）

- **文件**：`backend/src/main/java/com/example/clip/config/AppConfig.java`
- 新增字段 `private String harnessPath = "";` + getter/setter。
- 语义：指向**包含 `HARNESS/` 子目录的仓库根目录**（如 `...\code\ai_coding`）。空 = 功能关闭（接口返回 `enabled:false`，前端显示引导）。
- 不迁移、不影响既有字段（Jackson 全量映射，缺省为空串保持关闭态）。

### 2. 后端：新增 `HarnessService`（只读扫描 + 解析 + 审计）

- **文件（新增）**：`backend/src/main/java/com/example/clip/service/HarnessService.java`
- 要求属性：`harnessPath`（从 AppConfigService 读取）。
- 能力：
  1. **解析 frontmatter**：与 cjs 一致——`---` 块内按行正则 `^([a-zA-Z][\w-]*):\s*(.*)$`，缩进行归父键（仅判存在，不判子值）；`tags` 额外解析内联 `[a,b]` 或块列表 `- x`。
  2. **records**：递归扫描 `{harnessPath}/HARNESS/{devlog,bugs,decisions}`，跳过 `_` 前缀与 `README.md`，产出 `HarnessRecord{type,id,title,date,status,module,commit,source,tags,relPath,preview}`（preview = 正文首段前 ~120 字）。
  3. **recordContent**：按相对路径读单篇 md 全文（路径白名单校验：解析后必须位于 HARNESS 目录内），供前端 marked.js 渲染原文弹窗。
  4. **audit**：镜像 cjs 四组校验 → `items[{level:ERROR|WARN, file, message}] + summary{errors,warnings,checked}`，按 devlog/bugs/decisions 三组分别跑。
  5. **roadmap**：粗解析 `roadmap.md` 的 `## Done/Current/Future` 三节，按行分组返回（只做展示，不写）。
- **缓存**：进程内 TTL 缓存（30s）；带 `refresh=1` 参数强制重建（镜像 Wiki `.compiled.json`/TTL 的既有思路，保持轻量）。

### 3. 后端：新增 `HarnessController`

- **文件（新增）**：`backend/src/main/java/com/example/clip/controller/HarnessController.java`，`@RequestMapping("/api/harness")`
  - `GET /api/harness/records?type=&module=&tag=&refresh=` → `{enabled, records[]}`
  - `GET /api/harness/audit?refresh=` → `{enabled, summary, items[]}`
  - `GET /api/harness/roadmap?refresh=` → `{enabled, sections{done,current,future}}`
  - `GET /api/harness/record?path=devlog/2026/2026-09-16-xxx.md` → `{enabled, meta, content}`
- 未配置或 `HARNESS` 目录不存在 → 统一 `{enabled:false}`（HTTP 200，前端空态引导），不抛 5xx。

### 4. 前端：产品概览页新增「开发档案」Tab（workspace.html）

- **文件**：`frontend/workspace.html`
- Tab 按钮（`归档` tab 之后）：
  `<button class="pd-tab" data-pd-tab="harness" ...>📁 开发档案</button>`
- 新面板 `.pd-tab-content[data-pd-content="harness"]` 结构：
  - 顶栏：数据源说明 + 审计徽标（ERROR N · WARN N）+「重新审计」按钮 + 启用状态。
  - 子频道 chips（切内容区）：`时间线 / Bug / 决策 ADR / Roadmap / 审计`。
    - **时间线**：devlog 卡片（id 徽标、title、module 徽标、date、commit 短哈希、status、tags、一句话预览）→ 点击卡片打开 md 原文弹窗（marked.js 渲染）。
    - **Bug**：按 module 分组列表（现象/经验教训预览）。
    - **ADR**：编号卡片列表（背景/决策预览）。
    - **Roadmap**：Done/Current/Future 三列。
    - **审计**：summary 大字 + items 表格（level/file/message），空态"归档纪律良好 ✅"。
  - 未配置（enabled:false）态：引导卡片"在 设置 → 开发档案目录 配置仓库路径后启用"。

### 5. 前端：workspace.js 渲染逻辑

- **文件**：`frontend/js/workspace.js`
- 新增：`loadHarness()`（切到 harness tab 时懒加载一次，内存缓存）、`loadHarnessAudit()`（`重新审计`强制 refresh）、`loadHarnessRoadmap()`、`openHarnessRecord(relPath)`（fetch `/record` → marked 渲染弹窗）。
- 复用既有 `escapeHtml`、`formatDate`、pd-* 样式与弹窗模式；不影响现有 tab 切换逻辑（[workspace.js#L2154-L2163](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/workspace.js#L2154-L2163)）。

### 6. 前端：workspace.css 新样式

- **文件**：`frontend/styles/workspace.css`
- 新增 `.pd-harness-*` 类，复用现有 `--ws-*` design token（色彩/间距/圆角），支持深色主题；列表/卡片风格对齐现有 `pd-*` 体系，不做新布局范式。

### 7. 前端：设置页新增「开发档案目录」输入

- **文件**：`frontend/settings.html` + `frontend/js/settings.js`
- 在存储路径区新增输入项：`开发档案目录（HARNESS 项目根，留空关闭）`，值为 `config.harnessPath`，随 `/api/config` 全量提交保存；旁边说明文案。

### 8. HARNESS/README.md 契约补一行（维护性）

- 在「真相源分工」节补充：app 产品概览页（开发档案 Tab）为 HARNESS 的**只读可视化与内嵌审计面**，写仍走 skill/脚本；审计结果以 `node scripts/harness-audit.cjs` 为准（Java 侧为镜像）。
- 本计划实施完成后按惯例写一条 HARNESS devlog 归档（module: workspace）。

---

## 假设与决策

1. **md 唯一真相源不变**：app 只读不写；不做"补写向导/双工同步"（用户已选定"只读 + 内嵌审计"）。
2. **非 dogfood 用户默认关闭**：`harnessPath` 为空 = 功能不可见，不打扰普通用户；仅配置后启用。
3. **审计以 Java 镜像对齐脚本**：不再从 Java 调 Node 脚本（打包发布无 Node 依赖；循环校验可先跑脚本再对 App 面板结果）。
4. **缓存 30s TTL + refresh 强制**：兼顾快速渲染与最新归档可见，参考知识模块 compiled corpus 的既有 TTL/Fingerprint 思路，够用不重。
5. **不含能力边界**：不做 Git 拉取、仓库自动发现、多仓库管理；只针对单一配置目录。

## 验证步骤

1. **后端编译**：`cd backend && mvn -q compile` 通过。
2. **配置生效**：给 `~/.cut-shelter/config/app-config.json` 写 `"harnessPath": "L:/归档/30_Projects (行动项目)/31_Work (主要工作)/code/ai_coding"`（改完可通过设置页保存），重启后端。
3. **接口校验（curl）**：
   - `GET /api/harness/records` → enabled:true、含 `DEV-2026-09-16-001` 等记录；
   - `GET /api/harness/audit` → summary 的 ERROR/WARN 与 `node scripts/harness-audit.cjs` 输出**逐项一致**；
   - `GET /api/harness/roadmap` → three sections 分组正确；
   - `GET /api/harness/record?path=...` → 能按白名单取回 md 全文、越界路径被拒；
   - 未配置时四接口均 `enabled:false` 且 200。
4. **UI 验证**：工作台 → 产品概览 → 「开发档案」Tab：五个子频道各自渲染；devlog 卡片点击弹出原文 modal（markdown 正确渲染）；「重新审计」按钮触发刷新；深色主题下样式正常；未配置路径时显示引导空态。
5. **归档**：验证通过后写 HARNESS devlog（module: workspace）并更新 `_index.md`，`node scripts/harness-audit.cjs` ERROR=0。

## 相关文件

- `backend/src/main/java/com/example/clip/config/AppConfig.java`（改）
- `backend/src/main/java/com/example/clip/service/HarnessService.java`（新增）
- `backend/src/main/java/com/example/clip/controller/HarnessController.java`（新增）
- `frontend/workspace.html` / `frontend/js/workspace.js`（改）
- `frontend/styles/workspace.css`（改）
- `frontend/settings.html` / `frontend/js/settings.js`（改）
- `HARNESS/README.md`（一行契约说明）