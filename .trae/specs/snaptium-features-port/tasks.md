# Tasks

## 任务总览

MVP 聚焦：修复 `ContentOrganizeService` 归档 Markdown 的 5 个 Obsidian 兼容性问题（无 frontmatter、标签格式错误、AI 分析无 Callout、用户思考无 Callout、文件名不友好）。改动集中、感知直接、bug 风险低。遵循职责分离和可配置化原则，将格式化逻辑抽离为独立 Service。

---

- [ ] Task 1: 创建 `ObsidianExportConfig` 配置类
  - [ ] SubTask 1.1: 创建 `backend/.../service/obsidian/ObsidianExportConfig.java`，使用 `@ConfigurationProperties(prefix = "obsidian.export")`
  - [ ] SubTask 1.2: 配置字段：
    - `frontmatterFields`: List<String>（默认 `["date", "tags", "category", "source"]`）
    - `calloutTypes`: Map<String, String>（默认 `{"analysis": "note", "thoughts": "quote"}`）
    - `fileNameDateFormat`: String（默认 `yyyy-MM-dd`）
  - [ ] SubTask 1.3: 在 `application.yml` 中新增 `obsidian.export` 配置段，写入上述默认值

- [ ] Task 2: 创建 `ObsidianExportFormatter` 服务
  - [ ] SubTask 2.1: 创建 `backend/.../service/obsidian/ObsidianExportFormatter.java`，`@Service`，构造器注入 `ObsidianExportConfig`
  - [ ] SubTask 2.2: 实现 `generateFrontmatter(LocalDate date, List<String> tags, String categoryName, List<String> sourceUrls)` → 返回 `---\n...\n---\n\n` 格式的 YAML 字符串
    - tags 去重后以 YAML 列表格式输出（`- tag1\n- tag2`）
    - sourceUrls 仅在非空时包含 `source` 字段
    - 仅输出 `frontmatterFields` 中配置的字段
  - [ ] SubTask 2.3: 实现 `formatTagsInline(List<String> tags)` → 返回 `#tag1  #tag2  ` 格式（空格分隔，每项 `#` 前缀）
  - [ ] SubTask 2.4: 实现 `wrapCallout(String title, String content, String calloutTypeKey)` → 返回 `> [!type] title\n> 正文行1\n> 正文行2` 格式
    - calloutTypeKey 从 config 的 `calloutTypes` Map 取值（如 `analysis` → `note`）
    - content 多行时每行前缀 `> `
  - [ ] SubTask 2.5: 实现 `generateFileName(String categoryName, LocalDate date)` → 返回 `{categoryName}_{date格式化}.md`
    - categoryName 取一级分类名（不含 ` > ` 子分类，调用方传入时已处理）
    - 日期格式从 config 读取

- [ ] Task 3: 修改 `ContentOrganizeService` 接入格式化服务
  - [ ] SubTask 3.1: 构造器注入 `ObsidianExportFormatter`
  - [ ] SubTask 3.2: 修改 `organizeCategoryContent()` 方法：
    - 收集该分类所有剪藏的标签去重列表、来源 URL 列表
    - 调用 `formatter.generateFrontmatter()` 生成 frontmatter，放在文件最前面
    - 移除原有的 `# 标题` + `整理日期:` + `---` 开头（frontmatter 已含 date 和 category）
    - AI 分析部分调用 `formatter.wrapCallout("AI 分析", clip.getAnalysis(), "analysis")` 替代 `### AI分析\n\n` + 纯文本
    - 用户思考部分调用 `formatter.wrapCallout("💭 我的思考", clip.getMyThoughts(), "thoughts")` 替代 `### 💭 我的思考\n\n` + 纯文本
    - 标签部分调用 `formatter.formatTagsInline()` 替代 `tag:#xxx` 格式
    - 无标签时不生成标签段落
  - [ ] SubTask 3.3: 修改 `organizeContent()` 方法中第 160 行文件名生成：
    - 从 `category + "_" + dateSuffix + ".md"` 改为 `formatter.generateFileName(getTopCategoryName(category), today)`
    - 新增 `getTopCategoryName()` 私有方法，从 `getCategoryName()` 结果取 ` > ` 前的一级分类名

# Task Dependencies

- Task 1（配置类）→ Task 2（格式化服务依赖配置类）→ Task 3（ContentOrganizeService 依赖格式化服务）
- 严格顺序执行：1 → 2 → 3

# 设计模式说明

- **职责分离**: `ObsidianExportFormatter` 专注 Obsidian 格式化逻辑，`ContentOrganizeService` 专注整理流程编排，职责不混杂
- **可配置化**: Callout 类型、frontmatter 字段、文件名日期格式均通过 `ObsidianExportConfig`（@ConfigurationProperties）配置，修改 `application.yml` 即可调整，无需改代码
- **低耦合**: `ContentOrganizeService` 通过构造器注入 `ObsidianExportFormatter` 接口依赖，不直接内联格式化代码；未来若需支持其他导出格式，可抽象 `ExportFormatter` 接口后扩展（MVP 暂不引入接口，避免过度设计）

# 验证方式

1. 触发一次内容整理（POST `/api/clip/organize` 或等待定时任务）
2. 在 `clip-organized/{category}/` 目录下找到生成的 `.md` 文件
3. 用 Obsidian 打开该文件，验证：
   - properties 面板显示 date/tags/category/source 字段
   - 标签可点击，出现在标签面板
   - AI 分析渲染为蓝色 Callout 块
   - 用户思考渲染为引用 Callout 块
   - 文件名为 `工作项目_2026-07-22.md` 格式
4. 修改 `application.yml` 中 `obsidian.export.callout-types.analysis` 为 `warning`，重新整理，确认 AI 分析 Callout 变为黄色
