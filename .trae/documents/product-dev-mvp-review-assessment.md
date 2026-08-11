# 产品开发工作台 MVP — 未提交文档审阅与可行性评估

> 审阅时间：2026-08-10
> 审阅范围：本次 git 未提交的 md 文件及其关联代码（spec、SKILL、设计文档、agent.md、新增 Java 文件）
> 说明：本文档为独立审阅评估，未修改任何原文件。

## 一、总体结论

**方向可行，但当前状态不足以直接进入开发。** 核心链路（agent 归档 → TODO 目录 → 后端扫描落库 → 工作台规则展示）思路清晰，MVP 主动砍掉知识图谱、甘特图、独立数据存储等过重设计，方向正确。但存在 **2 个阻断级问题**（feature-points.json 字段解析与 spec 完全错位、双初始化器并存且行为不一致）和 **1 个流程级问题**（tasks.md / checklist.md 仍是旧 spec 内容，照单执行会重建已废弃的独立数据源），照当前状态开发，首轮联调必然失败。

用户提出的两个疑虑（wiki 区看不懂、学习模块未打通）经核查属实：wiki 服务代码已存在但文档分散且与工作台无衔接设计；学习模块存在工作台类型预留（`learning`）却没有任何接入方案。

## 二、审阅文件清单

| 文件 | 状态 | 审阅结论 |
|------|------|---------|
| `.trae/specs/product-dev-workspace/spec.md` | 修改 | 重写后思路正确，但与代码、其他文档多处不一致（见第三节） |
| `.trae/specs/product-dev-workspace/tasks.md` | 未修改 | **仍为旧 spec 内容**，引用已废弃的 `/api/workspace/product-dev/*` 接口 |
| `.trae/specs/product-dev-workspace/checklist.md` | 未修改 | **仍为旧 spec 内容**，验收项指向已废弃的独立数据存储 |
| `.trae/skills/product-dev-archive/SKILL.md` | 修改 | 格式定义与 spec 一致，但后端解析器不按此格式读取（阻断） |
| `.trae/skills/product-dev-history-migrate/SKILL.md` | 修改 | 逻辑合理，依赖 feature-points.json 约定，受同一字段错位问题影响 |
| `.trae/documents/todo-directory-specification.md` | 新增 | 规范较完整，但 `.imported` 增量逻辑与代码实现不符 |
| `.trae/documents/product-dev-workspace-builtin-rules.md` | 新增 | 规则定义与代码不一致（operator 和规则数量均不同） |
| `.trae/documents/workspace-product-dev-view-unify.md` | 修改 | 前端改造方案已写，但 `frontend/workspace.html` 实际未改动 |
| `.trae/documents/product-dev-tag-filter-button-tags-tooltips.md` | 修改 | 埋点接口已在代码中存在，文档与现状一致 |
| `agent.md` | 修改 | 归档约束描述正确，与 spec 同步 |
| `backend/.../config/ProductDevStartupInitializer.java` | 新增 | 与另一个初始化器功能重复，行为不一致（阻断） |
| `backend/.../service/ProductDevWorkspaceInitializer.java` | 新增 | 同上 |
| `backend/.../service/TodoScannerService.java` | 新增 | feature-points.json 字段解析与 spec 错位（阻断） |
| `backend/.../index/Workspace.java` / `WorkspaceIndexService.java` | 修改 | 仅给 TYPES 追加 `product-dev`，与 spec 的 `type: project` 矛盾 |

## 三、阻断级问题（不解决无法进入开发）

### 3.1 feature-points.json 解析字段与 spec 完全错位

`TodoScannerService.java` 的字段读取与三份文档（spec.md、SKILL.md、todo-directory-specification.md）定义不一致：

| 位置 | 文档定义（spec/SKILL/规范） | 代码实际读取 | 后果 |
|------|---------------------------|-------------|------|
| clips[].contentFile | `contentFile` | `clipDef.get("file")` | 永远取不到文件路径，剪藏内容为空 |
| clips[].title | `title` | `clipDef.get("label")` | 标题取不到，退回文件名 |
| clips[].category | `category` | `clipDef.get("type")` | 分类取不到，默认 `requirement` |
| todos[].status | `status: "done"/"todo"` | `todoDef.get("completed")`（boolean） | 待办状态永远解析为未完成 |

这是字段命名层面的硬错位，不是逻辑问题。任何按 spec 生成的 `feature-points.json` 都会被错误解析。

### 3.2 requirement 对象被强转 String，扫描必然抛异常

`TodoScannerService.java` 第 108 行：

```java
String requirement = (String) fp.getOrDefault("requirement", dirName);
```

但 spec 中 `requirement` 是**对象**（含 title/summary/tags/phase 等字段），并非字符串。此强转必然抛出 `ClassCastException`，且该异常不是 `IOException`，不会被内层 catch 捕获，会直接穿透到调用方（初始化器捕获后仅记一条"TODO 扫描失败"）。**结论：只要 TODO 下存在任何按 spec 生成的 feature-points.json，整个扫描导入链路必然失败。**

### 3.3 两个初始化器并存，行为相互冲突

同时存在两个功能重复的启动组件：

| 维度 | ProductDevStartupInitializer | ProductDevWorkspaceInitializer |
|------|------------------------------|--------------------------------|
| 位置 | `config/` 包 | `service/` 包 |
| 触发 | `@EventListener(ApplicationReadyEvent)` | `CommandLineRunner` |
| 工作台名称 | 产品开发 | 产品开发工作区 |
| 颜色 | `#7c3aed` | `#6366f1` |
| 规则数量 | 仅 1 条（tag contains） | 3 条（tag + type + category） |
| 类型 | `product-dev` | `product-dev` |

两者都会执行 `scanAndImport()` 和 `ensureBuiltinWorkspace()`，启动时重复扫描（虽有 `.imported` 防护但日志和时序混乱），且首次创建的工作台属性取决于谁先执行，行为不确定。spec 5.1 中工作台属性（名称、颜色、类型 `project`）与两份代码都不同。

### 3.4 tasks.md / checklist.md 仍是旧 spec，照做即返工

`tasks.md` 和 `checklist.md` 是旧版内容，全部引用已废弃的设计：

- tasks.md：要求"创建 ProductDevController，路径 `/api/workspace/product-dev`"、"实现 9 个 GET 接口"、归档文件写入 `~/.cutshelter/product-dev-archive.json`
- checklist.md：验收 `GET /api/workspace/product-dev/stats` 等 12 个接口、知识图谱力导向图、甘特图、D3.js

而重写后的 spec.md 明确"独立 ProductDev 数据存储 → 废弃，复用剪藏/待办/工作台系统"，知识图谱、甘特图为二期。若 agent 按 tasks.md 开发，等于把上一版已被否定的设计重新实现一遍。**task 清单与 spec 脱节，是本轮最容易引发大返工的文档问题。**

## 四、严重问题（不影响链路成立，但会造成返工或数据错误）

### 4.1 工作台类型三处不一致

- spec 5.1 和 builtin-rules 文档均写 `type: "project"`
- 两个初始化器代码均用 `"product-dev"`，并因此修改了 `Workspace.TYPES`
- 前端 `workspace.html` 侧边栏渲染工作台时如何处理 `product-dev` 类型未知，需核对 `WorkspaceIndexService` 的渲染逻辑

### 4.2 内置规则 operator 四处不一致

| 来源 | tag 规则 | type 规则 | category 规则 |
|------|---------|-----------|--------------|
| spec 5.2 | equals | in | contains |
| builtin-rules 文档 | equals | in | contains |
| StartupInitializer | contains（仅此 1 条） | 无 | 无 |
| WorkspaceInitializer | contains | in | equals |

规则语义直接影响工作台能筛出什么内容，需统一后与 `WorkspaceRuleService.matches()` 的实际行为对照验证。

### 4.3 剪藏落库字段写死

`TodoScannerService` 中 `new ClipContent(content, "product-dev", "product-dev", "product-dev")`，type/source/category 全部硬编码为 `product-dev`，未使用 `config.clipCategory` 和 clipDef 的 `category`。spec 期望分类如 `product-dev/design`，实际全部落为 `product-dev`，后续按分类筛选会失真。

### 4.4 增量导入逻辑缺失

spec 6.2 和 todo-directory-specification 约定：`.imported` 存 ISO 时间戳，`completedAt` 更新后按 `featurePoints[].id` 增量导入。代码实际只写 `"imported at <时间>"` 文本，且只要 `.imported` 存在就整体跳过，**没有实现任何增量逻辑**。意味着 agent 增量归档后，新增功能点不会同步到系统，除非手动删除 `.imported`。

### 4.5 扫描目录路径依赖运行时工作目录

`TodoScannerService` 通过 `@Value("${product-dev.todo-dir:./TODO}")` 读取配置，默认 `./TODO` 相对当前工作目录。但 `application_templete.yml` 中**没有 `product-dev.todo-dir` 配置项**，Electron 主进程 `generateApplicationYml()` 也不会生成。后端若从 `backend/` 目录启动，默认路径指向 `backend/TODO`，扫不到项目根目录的 `TODO/`，静默跳过（仅日志提示"目录不存在"）。spec 6.1 提到"在 AppStartupRunner 中注册扫描逻辑"，实际是初始化器组件，描述与实现不符。

### 4.6 前端 workspace.html 尚未按新 spec 改造

`frontend/workspace.html` 的 `loadProductDev()` 仍调用旧接口 `/api/product-dev/tags|stats|requirements|graph|timeline|archives...`（共 9 个），依赖仍存在于代码库的旧 `ProductDevController`（`/api/product-dev`）。新 spec 要求复用 `/api/workspace/{id}/resolve`，`workspace-product-dev-view-unify.md` 写了改造方案但前端代码零改动（git 状态无 frontend 变更）。旧 Controller/Service/Model 也未按 spec 计划废弃，新旧两套体系并存，前端数据链路仍是旧的。

## 五、用户重点关注项专项分析

### 5.1 wiki 区"看不懂"——文档分散 + 与工作台无衔接设计

wiki 相关内容横跨三处且彼此独立：

- `CODE_WIKI.md`：将产品命名为 CutShelter（碎碎记），描述了 wiki 模块（WikiQueryController 等）
- `.trae/specs/llm-wiki-product-direction/`：规划了基于 Obsidian Vault 的完整 LLM wiki 体系（VaultWatchService、BatchIngestService、WikiPageService、WikiQueryService、WikiLintService 等）
- `.trae/documents/web-clipper-and-wiki-nav-plan.md`：Web Clipper 同步 + wiki 导航集成

代码层面 `backend/service/wiki/` 下 7 个服务、3 个 controller（WikiIngest/WikiLint/WikiQuery）、`frontend/wiki.html` **均已存在**，但：

1. 没有一份文档说明"wiki 现在是什么状态、能做什么、下一步做什么"——llm-wiki-product-direction 是方向规划（P0-P2 未标注完成度），而代码已经实现了一部分
2. spec 1.3 把"Wiki 落库 → 二期"，但 wiki 服务和产品开发工作台（规则筛选 clip/todo）之间没有任何衔接设计——用户的实际疑问"wiki 和产品开发工作台什么关系"在现有文档中找不到答案
3. 命名不统一（CutShelter vs 剪藏 vs Clip），影响搜索和理解

**建议**：补一份 wiki 模块现状文档（已实现能力清单 + 与工作台关系 + 二期规划），而不是让读者在三个文档间拼图。

### 5.2 学习模块"未打通"——只有类型预留，没有接入方案

现状：

- `Workspace.TYPES` 已含 `"learning"`，说明工作台体系预留了学习类型
- 学习计划模块完整存在：`LearningPlanController`、`LearningPlanService`、`LearningPlan` 模型、`learning-plan.html`、Exa 搜索集成
- 但 **LearningPlan 数据模型完全独立**：不在 `ContentIndexService` 的索引范围内，没有生成 `ContentRef`，无法被 workspace 规则系统命中

打通路径（需要决策，见第七节）至少有三条：学习计划产出剪藏/待办（复用本 spec 链路）、ContentIndex 索引学习计划（扩展规则系统）、或建独立学习工作台（复用 pd-builtin 模式）。**当前 spec 对学习模块只字未提，属于明确的设计缺口**，如果目标是"学习模块和产品开发工作台共用一套机制"，需要在本轮补上边界声明（本轮做不做、做到什么程度）。

## 六、文件级评估明细

### 6.1 合理的部分（可保留）

- spec.md 的 MVP 取舍：砍掉独立数据存储、知识图谱、甘特图，聚焦"落库 + 规则筛选"，决策正确
- `product-dev-archive` / `product-dev-history-migrate` 两个 SKILL 的触发时机和目录结构设计合理
- 工作台固定 ID `pd-builtin` + 启动幂等创建，思路正确
- `agent.md` 归档约束章节与 spec 同步，描述一致
- 埋点文档（product-dev-tag-filter-button-tags-tooltips）与代码现状一致（`POST /api/data/action-events` 已存在）

### 6.2 需要返工的部分

| 文件 | 返工内容 |
|------|---------|
| `TodoScannerService.java` | 字段名对齐（contentFile/title/category/status）、requirement 对象解析、category 读取 config、增量导入、todo-dir 配置 |
| 两个初始化器 | 合并为一个组件，统一名称/颜色/类型/规则，与 spec 对齐 |
| `tasks.md` / `checklist.md` | 按新 spec 重写，删除旧接口和废弃功能验收项 |
| 前端 `workspace.html` | 按 workspace-product-dev-view-unify.md 方案实际改造，数据源切到 `/api/workspace/{id}/resolve` |
| 旧 `ProductDevController`/`Service`/`Model` | 明确废弃或删除，避免新旧并存 |
| `Workspace.TYPES` | 与 spec 的 `type: project` 统一（或改 spec，二选一） |
| `.imported` 规范 | 时间戳格式统一 + 增量导入实现 |
| `application_templete.yml` / electron main.js | 增加 `product-dev.todo-dir` 配置 |

## 七、决策点（需要你拍板）

1. **学习模块本轮边界**：完全不做（spec 明确标注）、还是预留接口（如 feature-points.json 增加 learning 字段占位）、还是本轮接入 ContentIndex？
2. **工作台类型**：沿用 spec 的 `project`，还是代码的 `product-dev`（独立类型）？前者无需改 TYPES，后者语义更清晰但需前端支持新类型渲染
3. **旧 ProductDev 体系**：立即删除（干净）还是保留灰度（前端回退安全）？
4. **本轮范围**：是否把 tasks.md/checklist.md 重写纳入本轮任务清单？

## 八、建议的实施顺序

按以下顺序修复后，再进入功能开发：

1. **统一约定**：先定稿 feature-points.json 字段（以 SKILL.md 为准），同步修正 `TodoScannerService` 解析、requirement 对象解析、todo-dir 配置
2. **合并初始化器**：删除一个，保留一个，统一工作台名称/颜色/类型/规则（与 spec、builtin-rules 文档三方对齐）
3. **重写 tasks.md / checklist.md**：作为本轮第一项任务，避免 agent 按旧清单执行
4. **前端改造**：按 view-unify 文档落地，数据源切换 + 隐藏二期 tab
5. **清理旧体系**：删除或停用旧 ProductDevController/Service/Model
6. **补文档**：wiki 现状说明、学习模块边界声明
7. **验证**：构造一个最小的 feature-points.json 示例走完整链路（归档 → 扫描 → 落库 → 规则筛选 → 前端展示），确认全链路数据一致后再铺开存量迁移

## 九、可行性结论

本方案作为 MVP 完全可行，架构取舍正确，技术栈（Spring Boot + 文件存储 + workspace 规则系统）足以承载。当前风险不在设计，而在**文档与实现的三处脱节**（schema 字段、初始化逻辑、任务清单），以及**两个未定边界**（wiki 衔接、学习模块）。这些问题全部属于可修复的一致性问题，不需要推翻设计。建议按第八节顺序修复后进入开发，预计可避免首轮联调失败和一次大返工。
