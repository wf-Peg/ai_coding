# 提示词库工具（Prompt Library）设计实现方案

## 一、需求概述

围绕「AI/提示词管理」，在本系统已有的 `PromptConfigService`（18 个系统 Prompt 槽位）基础上，新增一个**提示词库**功能，让用户自管理多套提示词模板，支持**收藏 / 分类 / 复用 / 应用到系统槽位 / 复制**，并提供 **LangGPT 结构化提示词的导入与编辑**能力。

### 已确认的设计决策
1. **入口位置**：作为「工具模块」内嵌子工具（内置工具卡片，点击在遮罩层 iframe 中打开），复用现有工具模块的卡片/搜索/分类架构。
2. **内置模板**：首次启动自动把现有 `PromptConfigService` 的 18 个系统 Prompt 作为内置模板预置进提示词库，用户可直接复用、收藏、改后应用到系统槽位。
3. **LangGPT**：提供 LangGPT 结构化提示词解析导入（从 Markdown 文本/文件导入），并支持按 LangGPT 分段（Role / Profile / Skills / Rules / Workflow / Initialization）结构化编辑。

---

## 二、现状分析（已勘察）

- **后端 Prompt 服务**：`PromptConfigService.java` 管理 18 个系统 Prompt 槽位（核心 3 + 任务格式 1 + 辅助 6 + Wiki 8），提供 `getPromptConfig()` / `savePromptConfig(config)` / `resetToDefault()`，存储于 `~/.cut-shelter/config/prompt-config.json`。前端通过 `ClipController` 的 `/api/clip/prompt-config` 系列接口读写。
- **工具模块后端**：`ToolRegistryService.java` 以「自包含 HTML 页面 + 注册元数据」管理可拔插工具，内置工具定义在 `BUILTIN_TOOLS`，页面存放于 classpath `resources/tools/<id>.html`，用户态复制到 `~/.cut-shelter/tools/`。`ToolController.java` 提供 `/api/tools` 列表、`/{id}/page` 页面、`/{id}/prompt` 提示词、导入/删除/启用禁用等接口。
- **工具模块前端**：`tools.html` + `tools-core.js` 实现卡片网格、搜索、分类 chips、卡片菜单（查看提示词/禁用/删除）、遮罩层 iframe 运行。内置工具页面为完全自包含 HTML（内联 CSS、自带设计令牌、`prefers-color-scheme` 暗色适配，`API_BASE = file: ? 'http://127.0.0.1:8081' : ''`，`fetch` 直连后端）。
- **前端系统 Prompt 配置弹窗**：`clip.html` 中 `PROMPT_TYPE_META` 定义了各槽位的 `title/desc/hint/field`，经 `loadPromptConfig/savePromptConfig` 读写 `/api/clip/prompt-config`。

---

## 三、方案设计

### 3.1 数据模型 `PromptTemplate`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String | 唯一 id |
| name | String | 模板名称 |
| category | String | 分类（剪藏分析 / 整理 / 周报 / Wiki / 写作 / 通用…） |
| description | String | 一句话描述 |
| content | String | 完整提示词正文 |
| tags | List&lt;String&gt; | 关键词（供搜索） |
| favorite | boolean | 是否收藏（置顶） |
| slot | String | 关联的系统槽位 key（如 `clip`、`daily`…），可为空（纯自定义模板，仅复制用） |
| langgpt | boolean | 是否为 LangGPT 结构化模板 |
| sections | Map&lt;String,String&gt; | LangGPT 分段（Role/Profile/Skills/Rules/Workflow/Initialization），非空时 `content` 由它拼装 |
| builtin | boolean | 是否内置（不可删除） |
| createdAt / updatedAt | String | 时间戳 |

### 3.2 系统槽位映射 `SLOT_META`

复用 `PromptConfig` 的字段。`slot` key → `{ field, title, hint }`：

| slot key | PromptConfig 字段 |
|---|---|
| clip | clipAnalyzeSystemPrompt |
| clipTaskFormat | clipAnalyzeTaskFormat |
| daily | dailyOrganizeSystemPrompt |
| weekly | weeklyReportSystemPrompt |
| analyzeContent | analyzeContentPrompt |
| generateSummary | generateSummaryPrompt |
| generateTags | generateTagsPrompt |
| smartOrganize | smartOrganizePrompt |
| generateSynonyms | generateSynonymsPrompt |
| divergentRoleMap | divergentSummaryRoleMap |
| wikiBatchExtract | wikiBatchExtractPrompt |
| wikiGenEntity | wikiGenerateEntityPagePrompt |
| wikiGenConcept | wikiGenerateConceptPagePrompt |
| wikiGenSource | wikiGenerateSourcePagePrompt |
| wikiDetectContradiction | wikiDetectContradictionPrompt |
| wikiQueryIndex | wikiQueryIndexPrompt |
| wikiQuerySynthesis | wikiQuerySynthesisPrompt |
| wikiLint | wikiLintPrompt |

### 3.3 LangGPT 解析规则

解析 LangGPT Markdown 文本，识别一级/二级标题段：
- `# Role`（也可 `# Role: 名称`）→ 提取名称
- `## Profile`、`## Skills`、`## Rules`、`## Workflow`、`## Initialization`、`## Commands`、`## Reminder`
解析后写入 `sections`，并重拼为 `content`。若文本不含这些标题，则视为普通提示词（langgpt=false）直接存入 `content`。

---

## 四、落地改动

### 4.1 后端

**新增 1：`backend/src/main/java/com/example/clip/config/PromptTemplate.java`**
- 纯 POJO，字段见 3.1，含 getter/setter。

**新增 2：`backend/src/main/java/com/example/clip/service/PromptLibraryService.java`**
- 存储：`~/.cut-shelter/prompts/library.json`（`{version, prompts: [...]}`），沿用 `ToolRegistryService` 的读写/初始化模式。
- `@PostConstruct init()`：确保目录存在；若库为空则用 `PromptConfigService.getPromptConfig()` 的当前值预置 18 个内置模板（`builtin=true`，`favorite=false`，`slot` 与 3.2 对应，`category` 归入「系统模板」）。
- 方法：
  - `listPrompts()`：返回全部（favorite 优先排序）。
  - `createPrompt(...)` / `updatePrompt(id, ...)` / `deletePrompt(id)`（builtin 不可删）。
  - `toggleFavorite(id)`。
  - `applyToSlot(id, slot)`：读取 `PromptConfigService.getPromptConfig()`，把模板 `content` 写入对应 field，再 `savePromptConfig(...)` 落库。
  - `parseLangGpt(rawText)`：按 3.3 解析，返回可入库的模板结构（name/content/sections/langgpt）。
  - `listSlots()`：返回 3.2 的 slot 元数据（供前端展示各槽位名称）。

**新增 3：`backend/src/main/java/com/example/clip/controller/PromptLibraryController.java`**
- `@RequestMapping("/api/prompt-library")`，`@CrossOrigin("*")`：
  - `GET /` → 列表
  - `GET /slots` → 槽位元数据
  - `POST /` → 新建（body: name/category/description/content/tags/slot/langgpt/sections）
  - `PUT /{id}` → 更新
  - `DELETE /{id}` → 删除
  - `PATCH /{id}/favorite` → 收藏切换（body: {favorite}）
  - `POST /{id}/apply` → 应用到系统槽位（body: {slot}）
  - `POST /import-langgpt` → 导入 LangGPT 文本（body: {name?, category?, text}），解析并创建模板

**修改 4：`backend/src/main/java/com/example/clip/service/ToolRegistryService.java`**
- 在 `BUILTIN_TOOLS` 追加一个内置工具：
  - id: `prompt-library`，name: `提示词库`，icon: `🧠`，category: `AI 工具`，description: `提示词模板集：收藏/分类/复用，支持应用到系统槽位与 LangGPT 结构化编辑`
  - keywords: `提示词, prompt, 模板, langgpt, 收藏`
  - prompt（开发提示词）：描述本工具应具备的能力（卡片搜索分类、收藏、应用槽位、复制、LangGPT 导入/结构化编辑）。

**新增 5：`backend/src/main/resources/tools/prompt-library.html`**
- 完全自包含 HTML 工具页（内联 CSS、自带设计令牌 + `prefers-color-scheme` 暗色适配、`API_BASE` 同现有工具页）。
- 功能布局：
  - 顶部：标题「🧠 提示词库」+ 副标题 + 右侧「+ 新建模板」「导入 LangGPT」按钮。
  - 工具栏：搜索框 + 分类 chips / 收藏筛选。
  - 卡片网格：复用工具模块卡片样式（名称/描述/分类徽标/收藏星标/菜单）。
  - 卡片菜单：查看 / 编辑 / 收藏 / 应用到系统槽位 / 复制 / 删除（内置不可删）。
  - 编辑弹窗：普通模式（name/category/description/slot 下拉+content 文本域）；LangGPT 模式（分段文本域 Role/Profile/Skills/Rules/Workflow/Initialization，自动拼装 content）。
  - 导入 LangGPT 弹窗：粘贴文本或选择 .md 文件，预览解析结果后导入。
  - 应用到系统槽位弹窗：下拉选择槽位（来自 `/slots`），确认后调用 `POST /{id}/apply`。

### 4.2 前端（工具模块，注册内置工具后自动出现）

- 无需改动 `tools.html` / `tools-core.js` —— 内置工具卡片、遮罩层运行、菜单由现有逻辑自动处理。
- `prompt-library.html` 通过 `fetch(API_BASE + '/api/prompt-library/...')` 与后端交互，`window.confirm` 做删除确认，`navigator.clipboard` 做复制。

---

## 五、假设与决策

1. 提示词库作为「工具模块」内置子工具，不新增顶部导航入口；复用现有工具卡片/遮罩层机制，改动最小、符合用户选择。
2. 内置模板由 `PromptConfigService` 当前值预置，**预置后为快照**，之后系统 Prompt 再改不回写库（避免循环覆盖）；用户如需同步可手动编辑。
3. 「应用到系统槽位」直接调用既有 `/api/clip/prompt-config` 的保存逻辑（经 `PromptLibraryController` 转发到 `PromptConfigService.savePromptConfig`），保证与剪藏模块共用同一份配置。
4. LangGPT 仅做**结构解析 + 分段编辑 + 拼装**，不在工具内调用大模型生成；是否与 AI 生成结合留待后续迭代。
5. 内置模板（builtin=true）不可删除；用户新建模板可删除。

---

## 六、验证步骤

1. **后端编译**：`cd backend && mvn -q -DskipTests compile`。
2. **启动后端**，确认 `~/.cut-shelter/prompts/library.json` 已生成且含 18 个内置模板。
3. **接口自测**（curl）：
   - `GET /api/prompt-library` 返回 18 条；
   - `GET /api/prompt-library/slots` 返回 18 个槽位；
   - `POST /api/prompt-library/import-langgpt`（粘贴 LangGPT 示例）返回解析后的模板；
   - `POST /api/prompt-library/{id}/apply`（body slot=clip）后 `GET /api/clip/prompt-config` 的 `clipAnalyzeSystemPrompt` 已更新。
4. **前端验证**：进入「工具」→ 打开「提示词库」卡片，确认：卡片网格/搜索/分类正常；新建/编辑/删除生效；收藏切换并置顶；复制到剪贴板；应用到系统槽位后回剪藏 Prompt 配置弹窗可见新值；LangGPT 导入与分段编辑正常；暗色主题下样式正常。
5. **回归**：确认现有 4 个工具（PDF/批量重命名/图片转换/CSV↔JSON）不受影响。