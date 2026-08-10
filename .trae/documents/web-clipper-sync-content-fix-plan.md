# Web Clipper 同步内容优化方案

## 问题分析

Web Clipper 同步后，剪藏记录的 `content` 字段只存了一个 wiki-link `[[sources/文件名|标题]]`，导致三个问题：

1. **"原文"显示为 wiki-link 链接**：`renderContent()` 检测到 `[[...]]` 格式，渲染为可点击链接，调用 `openInObsidian()` 打开 `obsidian://open?vault=obsidian&file=sources/xxx`，用户没有叫 "obsidian" 的 vault，报错 "Vault not found"

2. **AI 整理只提取到标题引用**：`applyFullAiOrganize()` 将 `clip.getContent()`（即 `[[sources/xxx|标题]]`）传给 AI，AI 只能看到这个引用，无法分析原文内容

3. **`sourceUrl` 和 `sourceFilePath` 未展示**：`sourceUrl`（原始网页 URL）和 `sourceFilePath`（文件路径）都存了，但前端剪藏详情中没有展示，用户无法通过原始 URL 访问原文

## 修改方案

### 1. `SourceSyncService.java` — 存储实际文件内容

**修改** `syncSources()` 中的 `clip.setContent(...)` 逻辑：

- 解析 frontmatter 后，提取 `---` 之间的元数据后的**正文内容**作为 `clip.content`
- 如果提取后的正文为空，回退到 `summary` 字段（来自 frontmatter description）
- 保留 `sourceFilePath` 和 `sourceUrl` 不变

```java
// 修改前
clip.setContent(buildWikiLink(fileName, title));

// 修改后
String bodyContent = extractBodyContent(content); // 去掉 frontmatter 后的正文
clip.setContent(bodyContent != null && !bodyContent.isBlank() ? bodyContent : clip.getSummary());
```

**新增** `extractBodyContent()` 方法：从 Markdown 内容中去除 frontmatter 部分，返回正文。

### 2. `WebClipperFrontmatterParser.java` — 新增正文提取方法

**新增** `extractBodyContent(String fileContent)` 方法：
- 解析 `---\n...\n---` 之间的 frontmatter，返回 frontmatter 之后的内容
- 如果没有 frontmatter，返回全部内容
- 去除首尾空白

### 3. `clip.html` — 前端展示优化

**修改** `renderContent()` 函数：
- 当 content 是 wiki-link 格式时，不渲染为可点击链接，而是直接显示纯文本（避免 obsidian:// 报错）

**修改** 剪藏详情区域的"原文"展示：
- 在 `content-section` 中增加 `sourceUrl` 的展示（如果有）：显示为外部链接
- 在 `content-section` 中增加 `sourceFilePath` 的展示（如果有）：显示为文件路径文本

**删除** `openInObsidian()` 函数（或保留但不再自动调用）：wiki-link 不再触发 obsidian:// 打开。

### 修改文件清单

| 文件 | 修改内容 |
|---|---|
| `backend/.../service/sync/SourceSyncService.java` | 修改 `syncSources()` 存储正文内容而非 wiki-link；新增 `extractBodyContent()` |
| `backend/.../service/sync/WebClipperFrontmatterParser.java` | 新增 `extractBodyContent()` 静态/公开方法 |
| `frontend/clip.html` | 修改 `renderContent()` 不渲染 wiki-link 为可点击链接；在剪藏详情中展示 `sourceUrl` 和 `sourceFilePath` |

### 边界情况

1. **正文为空**：回退到 `summary`（来自 frontmatter description），再回退到空字符串
2. **没有 frontmatter**：`extractBodyContent()` 返回全部内容
3. **`sourceUrl` 为空**：不显示 URL 链接
4. **`sourceFilePath` 为空**：不显示文件路径
5. **已有剪藏（历史数据）**：content 字段仍是 wiki-link，`renderContent()` 不再渲染为可点击链接，显示为纯文本 `[[sources/xxx|标题]]`（不报错，用户可复制）

### 验证步骤

1. 重启后端，放一个测试 .md 文件到 `sources/` 目录
2. 点击"立即同步"，确认剪藏列表中出现新剪藏
3. 展开剪藏详情：
   - "原文"区域显示的是文件正文内容，不是 wiki-link 链接
   - 能看到原始 URL 链接（如果有）
   - 能看到文件路径（如果有）
4. 点击"快速AI整理"，确认 AI 能正常分析内容（不再只提取到标题引用）
5. 验证 `obsidian://` 不再自动弹出报错