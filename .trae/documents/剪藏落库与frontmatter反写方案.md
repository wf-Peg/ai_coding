# 剪藏落库与 frontmatter 反写方案（Obsidian 双向打通）

## 一、摘要（Summary）

本方案解决三个问题：

1. **剪藏单向落库，Obsidian 侧无感知**：当前剪藏仅通过 `ContentOrganizeService` 按「分类 × 天」生成汇总 md（`{分类}_{yyyy-MM-dd}.md`），Obsidian 作为工作区打开目录后能看到，但**每条剪藏没有独立文件**，无法被 Dataview 逐条检索。
2. **AI 产出未结构化**：`ClipContent` 的 AI 字段（`summary`/`analysis`/`divergentSummary`/`myThoughts`/`tags`/`category`）只存在本软件 JSON 里，未写进 Obsidian 的 frontmatter，Obsidian 的 Dataview/Tasks 生态无法消费。
3. **剪藏 → 汇总 → 知识 三层链路断裂**：天汇总文件与单条剪藏、长期知识页之间没有引用关系，不可追溯。

**核心设计思路**：新增「一剪藏一文件」落库层 + AI 字段反写 frontmatter；保留现有「分类 × 天」汇总文件，并让**汇总文件通过 `[[双链]]` 引用当日剪藏文件**，形成「剪藏（原子）→ 天汇总（复盘入口）→ 知识页（长期沉淀）」的可追溯链路。最终让 Dataview 能对剪藏结构化数据检索，Obsidian 生态（Tasks/Templater/周报）可直接复用。

不引入新框架、不引入数据库，沿用「本地 JSON 文件 + 现有 service/controller 分层」的既有约束。

---

## 二、现状分析（Current State Analysis）

### 2.1 存储与数据模型
- 无数据库，全部 JSON 文件。`FileStorageService` 为唯一持久层，根路径由 `clip.storage.path` 指向外置 `Clip_Bed\clip-storage`。
- 剪藏：`{分类目录}/{yyMMdd}.json`；整理输出：`clip-organized/{分类目录}/{分类}_{yyyy-MM-dd}.md`。
- `model/ClipContent.java`：已有丰富 AI 字段（见 `L73-118`）：
  - `summary`（AI 摘要）、`analysis`（AI 深度分析）、`divergentSummary`（AI 发散总结）、`myThoughts`（用户思考）
  - `tags`（标签）、`category`（分类）、`sourceUrl`/`siteName`（来源）、`capturedAt`（采集时间）、`analysisStatus`

### 2.2 整理产出现状
- `ContentOrganizeService.organizeContent()`（`L128`）只处理**当日**剪藏，按分类分组 → `organizeCategoryContent()`（`L244`）生成一份 md → `saveOrganizedContent()`（`L420`）写入 `{分类}_{yyyy-MM-dd}.md`。
- `organizeCategoryContent()` 内部：
  - 用 `obsidianExportFormatter.generateFrontmatter()`（`L261`）生成 frontmatter（date/tags/category/source）
  - 对每条剪藏输出：摘要标题、原文、AI 分析 callout、我的思考 callout、标签、分隔线
  - 最后调用 `aiOrganizeContent()`（AI 智能整理，含认知对话模式）
- 前端触发：剪藏模块「整理」按钮 → `POST` 整理接口 → 返回 `storagePath`。

### 2.3 frontmatter 生成能力（已具备）
- `ObsidianExportFormatter.generateFrontmatter(date, tags, categoryName, sourceUrls, aliases, type)`（`L81`）：
  - 按 `ObsidianExportConfig.getFrontmatterFields()` 配置输出字段
  - 已支持 `date/updated/type/aliases/tags/category/source` 等字段，**但无 AI 提炼字段**。
- `generateFileName()`、`wrapCallout()`、`formatTagsInline()` 均已具备。

### 2.4 关键结论
- **「一剪藏一文件」当前不存在**，需新增。
- **AI 字段当前未进 frontmatter**，需扩展 `ObsidianExportFormatter` 支持自定义字段。
- **汇总文件当前不引用剪藏文件**，需在生成时插入 `[[双链]]`。

---

## 三、目标设计（Proposed Design & Changes）

### 总体形态：三层结构，双向打通

```
剪藏（原子）──→ 天汇总（复盘入口）──→ 知识页（长期沉淀）
   │  AI 反写 frontmatter        │  [[双链]] 引用
   └── 一剪藏一文件（Dataview 可检索）
```

### 3.1 新增「一剪藏一文件」落库层

**目标**：每条剪藏生成一个独立 md 文件，带完整 AI frontmatter，供 Dataview 逐条检索。

**存储位置**：`clip-organized/clips/{yyyy}/{MM}/{分类目录}/{yyMMdd}_{短ID}.md`（按年月分片，避免单目录文件过多）。

**触发时机**：与现有整理流程联动——在 `organizeContent()` 中，对当日每条剪藏（或新落库的剪藏）生成独立文件。

**新增文件**：`backend/.../service/ClipVaultExportService.java`
- `exportClipToFile(ClipContent clip)`：为单条剪藏生成 md 并落盘
- `bulletPointFromClip(ClipContent clip)`：生成汇总文件里可复用的条目（含 `[[双链]]`）
- 复用 `ObsidianExportFormatter` 生成 frontmatter 与 callout

### 3.2 AI 字段反写 frontmatter

**目标**：把 `ClipContent` 的 AI 产出写入 md frontmatter，让 Dataview 可查。

**扩展 `ObsidianExportFormatter`**：新增一个重载 `generateClipFrontmatter(ClipContent clip)`，输出字段：

```yaml
---
date: 2026-08-12
updated: 2026-08-12
type: clip
category: 产品开发
tags:
  - AI
  - 编程
source: https://...
site: 知乎
analysis_status: ready
summary: "用一句话概括剪藏核心"
divergent: "AI 发散的扩展角度"
thoughts: "我的思考"
---
```

- `summary`/`analysis_status`/`divergent`/`thoughts` 为新增字段，仅在对应字段非空时输出。
- 通过 `ObsidianExportConfig.getFrontmatterFields()` 扩展配置，保持「按配置输出字段」的既有机制。

### 3.3 汇总文件引用当日剪藏（核心打通）

**目标**：让「分类 × 天」汇总文件通过 `[[双链]]` 引用当日的一剪藏一文件，形成可追溯链路。

**改造 `organizeCategoryContent()`**（`L244`）：
- 为每条剪藏的 `## N. 标题` 小节，追加一行 wikilink 引用：
  ```
  ## 1. 剪藏核心摘要

  📎 来源：[[2026-08-12_3f2a9c|原文剪藏]]
  ```
- 文件名用 `yyMMdd_短ID`（短 ID = 剪藏 id 的短哈希），保证 Obsidian 链接稳定性（不受标题改动影响）。

**Dataview 效果**：`LIST WHERE contains(file.inlinks, ...)` 或按 `category`/`tags` 过滤即可从汇总钻取到单条剪藏。

### 3.4 兼容与回退
- 保留现有「分类 × 天」汇总文件不变，仅在其内部追加引用行。
- AI 字段反写失败时（字段为空）自动省略该字段，不影响文件生成。
- 一剪藏一文件生成失败时，汇总文件仍可正常生成（降级为不引用）。

---

## 四、改动点清单（Change List）

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `service/obsidian/ObsidianExportFormatter.java` | 修改 | 新增 `generateClipFrontmatter(ClipContent)`，支持 AI 字段 |
| `service/obsidian/ObsidianExportConfig.java` | 修改 | `frontmatterFields` 扩展 `summary/analysis_status/divergent/thoughts` |
| `service/ClipVaultExportService.java` | 新增 | 一剪藏一文件生成 + 落盘 + 汇总条目生成 |
| `service/ContentOrganizeService.java` | 修改 | `organizeCategoryContent()` 追加 `[[双链]]` 引用；整理流程联动 `ClipVaultExportService` |

**不引入新依赖**，全部复用现有 `ObsidianExportFormatter`、`FileStorageService`、`ClipContentRepository`。

---

## 五、验收标准（Acceptance Criteria）

1. **一剪藏一文件**：当日新增剪藏后触发整理，`clip-organized/clips/` 下生成对应独立 md 文件，frontmatter 含 AI 字段。
2. **AI 反写**：`summary`/`divergent`/`thoughts` 在剪藏有值的情况下出现在 frontmatter；无值时省略。
3. **汇总引用**：`clip-organized/{分类}/{分类}_{yyyy-MM-dd}.md` 的每个小节含 `📎 来源：[[...]]` 引用，点击可跳转到对应剪藏文件。
4. **Dataview 可查**：在 Obsidian 中粘贴 `TABLE summary, category FROM "clip-organized" WHERE contains(tags, "AI")` 能返回剪藏列表。
5. **回归**：无 AI 字段的历史剪藏不报错；整理失败时汇总文件仍可降级生成。

---

## 六、待确认事项（Open Questions）

1. **一剪藏一文件的目录结构**：采用「按年/月分片」还是「与汇总同目录」？建议按年/月分片，避免文件过多拖慢 Obsidian 索引。
2. **是否反写 `analysis`（深度分析全文）**：`analysis` 内容较长，建议只写 `summary`（一句话）+ `divergent`（要点），`analysis` 全文保留在正文 callout，避免 frontmatter 臃肿。
3. **触发时机**：一剪藏一文件是「整理时统一生成」还是「剪藏入库即生成」？建议整理时生成，与现有流程一致，减少单条写入频繁 IO。