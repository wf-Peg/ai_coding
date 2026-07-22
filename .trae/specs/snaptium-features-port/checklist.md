# 验证检查清单

## Task 1: ObsidianExportConfig 配置类

### 功能验证
- [ ] `ObsidianExportConfig.java` 已创建，使用 `@ConfigurationProperties(prefix = "obsidian.export")` 注解
- [ ] 包含 `frontmatterFields`（List<String>）、`calloutTypes`（Map<String, String>）、`fileNameDateFormat`（String）三个字段
- [ ] `application.yml` 中存在 `obsidian.export` 配置段，包含上述三项默认值

### 设计模式验证
- [ ] 配置类与业务逻辑分离，不包含格式化代码
- [ ] 字段有合理默认值，即使 `application.yml` 不配置也能正常工作

## Task 2: ObsidianExportFormatter 服务

### 功能验证
- [ ] `generateFrontmatter()` 返回 `---` 包裹的 YAML 块，包含 date、tags、category、source 字段
- [ ] tags 字段为 YAML 列表格式（`- tag1`），且去重
- [ ] source 字段仅在剪藏有 sourceUrl 时包含
- [ ] `formatTagsInline()` 返回 `#tag1  #tag2` 格式（`#` 前缀，空格分隔）
- [ ] `wrapCallout()` 返回 `> [!type] title` 开头，正文每行前缀 `> `
- [ ] `generateFileName()` 返回 `{分类中文名}_{yyyy-MM-dd}.md` 格式
- [ ] 无标签时 frontmatter 的 tags 为空列表 `[]`

### 设计模式验证
- [ ] `ObsidianExportFormatter` 是独立 `@Service`，不依赖 `ContentOrganizeService`
- [ ] 构造器注入 `ObsidianExportConfig`，不直接 `new`
- [ ] Callout 类型从 config 读取，非硬编码 `"note"` / `"quote"`
- [ ] 文件名日期格式从 config 读取，非硬编码 `"yyyy-MM-dd"`

## Task 3: ContentOrganizeService 接入

### 功能验证
- [ ] 归档文件头部为 YAML frontmatter（`---` 开头），而非 `# 标题`
- [ ] frontmatter 后仍保留正文标题（如 `# 工作项目`）作为正文 H1
- [ ] 正文标签为 `#tag` 格式（非 `tag:#tag`）
- [ ] AI 分析渲染为 Callout（`> [!note] AI 分析`）
- [ ] 用户思考渲染为 Callout（`> [!quote] 💭 我的思考`）
- [ ] 文件名为 `工作项目_2026-07-22.md` 格式（中文名 + ISO 日期）
- [ ] 无标签的剪藏不生成标签段落
- [ ] 原有整理流程（AI 调用、邮件、Git 同步）不受影响

### Obsidian 兼容性验证
- [ ] 用 Obsidian 打开归档文件，properties 面板显示 date/tags/category/source
- [ ] 标签可点击跳转到标签搜索，出现在标签面板
- [ ] AI 分析渲染为蓝色 Callout 块
- [ ] 用户思考渲染为引用样式 Callout 块
- [ ] 文件名在 Obsidian 文件列表中直观可读

### 设计模式验证
- [ ] `ContentOrganizeService` 构造器注入 `ObsidianExportFormatter`，不直接 `new`
- [ ] `organizeCategoryContent()` 中不包含 frontmatter/Callout/标签格式的硬编码逻辑，均委托给 formatter
- [ ] 修改 `application.yml` 中 `callout-types.analysis` 为 `warning` 后，重新整理，AI 分析 Callout 类型变为 `warning`
- [ ] 修改 `application.yml` 中 `file-name-date-format` 为 `yyMMdd` 后，重新整理，文件名日期部分变为 `260722`
