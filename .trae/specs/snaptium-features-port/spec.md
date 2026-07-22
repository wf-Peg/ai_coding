# Obsidian 兼容归档格式 — MVP 规格说明

## Why

当前 `ContentOrganizeService.organizeCategoryContent()` 生成的归档 Markdown 文件存在 5 个具体的 Obsidian 兼容性问题，导致用 Obsidian 打开时体验明显不佳：

| # | 问题 | 当前代码位置 | 当前行为 | Obsidian 中的表现 |
|---|------|-------------|---------|------------------|
| 1 | 无 YAML frontmatter | 第 236-238 行 | 文件以 `# 标题` + `整理日期:` + `---` 开头 | 无法解析为 properties，无元数据面板，无法按属性筛选 |
| 2 | 标签格式错误 | 第 265 行 | `tag:#xxx` | 渲染为纯文本，不可点击，不进入标签面板 |
| 3 | AI 分析无 Callout | 第 254-256 行 | `### AI分析` + 纯文本 | 普通标题+正文，无视觉区分 |
| 4 | 用户思考无 Callout | 第 258-260 行 | `### 💭 我的思考` + 纯文本 | 同上，无高亮提示 |
| 5 | 文件名不友好 | 第 160 行 | `{category_value}_{yyMMdd}.md`（如 `work_260722.md`） | 不直观，分类为英文 value 非中文名，日期格式不可读 |

这 5 个问题修复集中在单个方法内，bug 风险低，且在 Obsidian 中打开归档文件时**立刻可感知**（properties 面板出现、标签可点击、Callout 渲染为彩色块、文件名直观）。

## What Changes

### MVP 范围（本次实现）

**Obsidian 兼容归档格式**：修改归档 Markdown 生成逻辑，使其符合 Obsidian 原生语法：

1. **生成 YAML frontmatter** — 文件头部添加 `---` 包裹的元数据块，包含 `date`、`tags`、`category`、`source` 字段，Obsidian 自动解析为 properties
2. **修正标签格式** — 从 `tag:#xxx` 改为 Obsidian 标准 `#xxx`，标签可点击、进入标签面板
3. **AI 分析使用 Callout** — 用 `> [!note] AI 分析` 包裹，Obsidian 渲染为蓝色提示块
4. **用户思考使用 Callout** — 用 `> [!quote] 💭 我的思考` 包裹，Obsidian 渲染为引用块
5. **文件名规范化** — 改为 `{分类中文名}_{yyyy-MM-dd}.md`（如 `工作项目_2026-07-22.md`）

### 不在 MVP 范围（后续迭代）

| 功能 | 原因 |
|------|------|
| 溯源引用系统（脚注 `[^N]`） | 需修改 AI prompt 让其生成引用标记，复杂度高，感知间接 |
| 基于标签的内容关联（wiki-link） | 需扫描全部剪藏计算 Jaccard 相似度，感知依赖多文件共存 |
| MOC 索引生成 | 需扫描目录、生成索引文件，感知间接，可后续单独迭代 |

## Design Principles

1. **职责分离** — 格式化逻辑从 `ContentOrganizeService` 抽离到独立的 `ObsidianExportFormatter` Service
2. **可配置化** — Callout 类型、文件名日期格式、frontmatter 字段通过 `@ConfigurationProperties` 配置，非硬编码
3. **低耦合** — `ContentOrganizeService` 通过构造器注入 `ObsidianExportFormatter`，不直接内联格式化代码
4. **最小改动** — MVP 只改 `organizeCategoryContent()` 的格式化部分和 `organizeContent()` 的文件名生成，不动整理流程、AI 调用、邮件、Git 等逻辑

## Impact

- Affected specs: 无（新增功能）
- Affected code（新增）:
  - `backend/.../service/obsidian/ObsidianExportFormatter.java` — Obsidian 格式化服务（frontmatter 生成、Callout 包裹、标签格式化、文件名生成）
  - `backend/.../service/obsidian/ObsidianExportConfig.java` — 可配置项（@ConfigurationProperties）
- Affected code（修改）:
  - `backend/.../service/ContentOrganizeService.java` — 注入 `ObsidianExportFormatter`，在 `organizeCategoryContent()` 中调用其方法替代硬编码格式；在 `organizeContent()` 中用其生成文件名
  - `backend/.../resources/application.yml` — 新增 `obsidian.export` 配置段

## ADDED Requirements

### Requirement: Obsidian 兼容归档格式

系统 SHALL 在内容整理归档时生成 Obsidian 兼容的 Markdown 格式，包含 YAML frontmatter、Obsidian 标签语法、Callout 语法和友好文件名。

#### Scenario: YAML Frontmatter 生成
- **WHEN** 系统执行每日内容整理，将剪藏归档为 Markdown 文件
- **THEN** 文件头部生成 YAML frontmatter（`---` 包裹），包含以下字段：
  - `date`: 整理日期（yyyy-MM-dd 格式）
  - `tags`: 该文件所有剪藏的标签去重列表（YAML 列表格式）
  - `category`: 分类中文名
  - `source`: 来源 URL 列表（仅当剪藏有 sourceUrl 时包含）
- **AND** frontmatter 字段可通过 `application.yml` 的 `obsidian.export.frontmatter-fields` 配置

#### Scenario: Obsidian 标签格式
- **WHEN** 归档文件正文中包含标签
- **THEN** 标签以 Obsidian 标准 `#tag` 格式展示（而非当前的 `tag:#tag` 格式）
- **AND** 多个标签以空格分隔

#### Scenario: AI 分析 Callout
- **WHEN** 归档文件中包含 AI 分析内容
- **THEN** AI 分析使用 Obsidian Callout 语法包裹：`> [!note] AI 分析` 后跟 `> ` 前缀的分析正文
- **AND** Callout 类型可通过 `application.yml` 的 `obsidian.export.callout-types.analysis` 配置（默认 `note`）

#### Scenario: 用户思考 Callout
- **WHEN** 归档文件中包含用户思考内容
- **THEN** 用户思考使用 Obsidian Callout 语法包裹：`> [!quote] 💭 我的思考` 后跟 `> ` 前缀的思考正文
- **AND** Callout 类型可通过 `application.yml` 的 `obsidian.export.callout-types.thoughts` 配置（默认 `quote`）

#### Scenario: 文件名规范化
- **WHEN** 系统生成归档文件
- **THEN** 文件名使用 `{分类中文名}_{yyyy-MM-dd}.md` 格式（如 `工作项目_2026-07-22.md`）
- **AND** 分类中文名取自 `getCategoryName()` 返回值的一级分类名称（不含 ` > ` 子分类）
- **AND** 日期格式可通过 `application.yml` 的 `obsidian.export.file-name-date-format` 配置（默认 `yyyy-MM-dd`）

#### Scenario: 无标签时的处理
- **WHEN** 该分类下所有剪藏均无标签
- **THEN** frontmatter 的 `tags` 字段为空列表 `[]`，正文中不生成标签段落
