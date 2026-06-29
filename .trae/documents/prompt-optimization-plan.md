# 剪藏 Prompt 体系深度分析与优化建议

## 摘要

经过对剪藏产品全部代码、Prompt 配置、AI 调用链路的深度分析，发现当前 Prompt 体系存在 **架构层、设计层、工程层** 三个维度的结构性问题。本报告逐一列出问题并给出具体修改建议，按优先级排序。

---

## 一、当前 Prompt 架构全景

```
PromptConfigService (3 个 Prompt)
├── clipAnalyzeSystemPrompt      → AiService.processClipContent()        [剪藏分析]
├── dailyOrganizeSystemPrompt    → AiService.organizeContentForKnowledgeBase() [每日整理]
└── weeklyReportSystemPrompt     → AiService.extractKnowledgePoints()    [周报生成]

AiService 内部硬编码 Prompt (6 个)
├── analyzeContent()             → "你是一个专业的内容分析师..."
├── generateSummary()            → "请为以下内容生成一个简短的摘要..."
├── generateTags()               → "请为以下内容提取10个以内的关键词..."
├── smartOrganize()              → "你是一个智能内容分类助手..."
├── generateDivergentSummary()   → 6 种角色 Prompt（按 category 前缀匹配）
└── generateSynonyms()           → "你是一个搜索助手..."
```

---

## 二、问题清单与修复建议

### 问题 1（严重）：clipAnalyzePrompt 被"截断"——用户自定义无效

**现状**：`processClipContent()` 先用 `clipAnalyzeSystemPrompt`，然后**追加 40+ 行硬编码指令**（JSON 格式、分类树、格式要求）。用户自定义 Prompt 只占实际 Prompt 的 ~10%，其余 90% 不可控。

```java
// AiService.java 第 115-142 行
systemPrompt.append(promptConfigService.getClipAnalyzePrompt()).append("\n\n");
systemPrompt.append("请对以下内容完成四项任务...");  // ← 硬编码追加
systemPrompt.append("预设分类：\n").append(getCategoryDescription());  // ← 硬编码追加
systemPrompt.append("请严格按以下JSON格式返回...");  // ← 硬编码追加
```

**影响**：用户在前端"Prompt 配置"弹窗中编辑的 Prompt 实际效果大打折扣，感觉"改了没用"。

**建议**：将完整 Prompt 改为**模板变量**模式，把硬编码部分也纳入 PromptConfigService 管理，用 `{{output_format}}`、`{{category_tree}}` 等占位符替换。

---

### 问题 2（严重）：6 个 AI 方法使用硬编码 Prompt，完全绕过 PromptConfigService

| 方法 | 硬编码 Prompt | 影响 |
|------|-------------|------|
| `analyzeContent()` | `"你是一个专业的内容分析师..."` | 深度分析功能不可调优 |
| `generateSummary()` | `"请为以下内容生成简短摘要..."` | 摘要质量不可控 |
| `generateTags()` | `"请为以下内容提取10个以内的关键词..."` | 标签提取风格不可调 |
| `smartOrganize()` | `"你是一个智能内容分类助手..."` | 智能分类不可调优 |
| `generateDivergentSummary()` | 6 种角色 Prompt | 发散性总结角色不可调 |
| `generateSynonyms()` | `"你是一个搜索助手..."` | 搜索增强不可控 |

**建议**：将这些 Prompt 也纳入 PromptConfigService，或者至少提供默认值常量并允许用户覆盖。

---

### 问题 3（中等）：三个核心 Prompt 设计哲学不一致

| Prompt | 长度 | 风格 | 问题 |
|--------|------|------|------|
| clipAnalyze | ~3 行 | 极简 persona | 太短，没有格式约束，全靠硬编码追加 |
| dailyOrganize | ~200 行 | 完整"角色扮演+工作流+格式+约束" | 对 LLM 来说信息密度过高，容易遗漏关键指令 |
| weeklyReport | ~50 行 | 完整"角色+工作流+JSON约束" | 期望 JSON 输出但用字符串手动解析，容错低 |

**建议**：统一 Prompt 设计模板，每个 Prompt 包含：`# Role` → `# Goal` → `# Output Format` → `# Constraints`。clipAnalyze 应大幅扩充，dailyOrganize 应精简（去掉冗余的角色扮演开场白要求）。

---

### 问题 4（中等）：JSON 解析使用手动字符串操作，脆弱且已多次出问题

**现状**：`extractJsonStringValue()`、`parseProcessResult()`、`parseSimpleJson()` 全部使用手动字符串遍历解析 JSON，代码中已有 4 处注释标注"已知问题"。

**建议**：替换为 Jackson ObjectMapper + 宽松解析策略（`FAIL_ON_UNKNOWN_PROPERTIES=false`），对 LLM 返回的 markdown 代码块做预处理后用标准 JSON 库解析。

---

### 问题 5（中等）：Prompt 配置弹窗 UX 问题

**现状**：前端 Prompt 配置弹窗只有一个 textarea，用户看不到：
- 当前 Prompt 的**完整有效版本**（含硬编码追加部分）
- 各 Prompt 的**使用场景说明**
- 修改后的**效果预览**

**建议**：
- 弹窗增加"预览完整 Prompt"按钮，展示 AiService 实际构建的完整 System Prompt
- 增加"使用场景"说明文字，告知用户该 Prompt 在什么操作时被调用
- 增加 "重置为默认" 的二次确认

---

### 问题 6（低）：缺少 Prompt 版本管理与回滚

**现状**：用户修改 Prompt 后，旧版本无备份，无法回滚。

**建议**：在 `PromptConfigStorageService` 中增加简单的版本历史（保留最近 3 个版本），保存时自动备份。

---

### 问题 7（低）：`{{category}}` 是唯一模板变量

**现状**：dailyOrganizePrompt 中 `{{category}}` 是唯一动态变量。但整理/周报场景中还有大量可用的上下文信息（日期、条目数、分类列表等）。

**建议**：增加 `{{date}}`、`{{count}}`、`{{week_range}}` 等模板变量，让 Prompt 更"智能"。

---

### 问题 8（低）：`generateDivergentSummary()` 角色映射与 PromptConfigService 脱节

**现状**：6 种专家角色（职场/教育/生活/创意/金融/社交）在 `generateRolePrompt()` 中硬编码，与 PromptConfigService 无关。

**建议**：将角色映射纳入 PromptConfigService，增加一个 `divergentSummaryRoleMap` 配置字段，允许用户自定义每个分类对应的专家角色。

---

## 三、优先级排序

| 优先级 | 问题 | 理由 |
|--------|------|------|
| P0 | 问题 1：clipAnalyzePrompt 被截断 | 用户直观感受"改了没用"，体验最差 |
| P0 | 问题 2：6 个方法硬编码 Prompt | 功能覆盖面最广，影响半数 AI 调用 |
| P1 | 问题 4：JSON 手动解析 | 已知 bug 来源，修复后一劳永逸 |
| P1 | 问题 3：Prompt 设计不一致 | 影响 AI 输出质量（但需要实际调优经验） |
| P2 | 问题 5：弹窗 UX | 锦上添花，不阻塞核心功能 |
| P2 | 问题 6：版本管理 | 安全网，日常使用频率低 |
| P3 | 问题 7/8：模板变量/角色映射 | 扩展性需求，当前够用 |

---

## 四、建议实施路径

### 第一步：修复 P0 问题（预计 3-4 小时）

1. **将 `processClipContent()` 的硬编码指令纳入 PromptConfigService**
   - 新增 `clipAnalyzeTaskFormat` 字段，存储"任务描述+JSON 格式+分类树"部分
   - 修改 `AiService.processClipContent()` 改为：`系统Prompt + 任务格式Prompt + 用户内容`
   - 前端弹窗增加第二个 tab/textarea 展示完整 Prompt

2. **将 6 个硬编码 Prompt 提取到 PromptConfigService**
   - 新增 6 个默认常量 + getter 方法
   - 修改对应 AiService 方法调用

### 第二步：修复 P1 问题（预计 2-3 小时）

3. **JSON 解析改为 Jackson**
   - 创建 DTO 类（`ClipAnalysisResult`, `KnowledgeExtractionResult`）
   - 替换 `parseProcessResult()`、`parseSimpleJson()` 等手动解析
   - 保留 markdown 代码块清理逻辑

4. **统一 Prompt 设计模板**
   - 扩充 `clipAnalyzePrompt` 到完整结构
   - 精简 `dailyOrganizePrompt` 的冗余部分

### 第三步：P2 优化（可选）

5. 弹窗 UX 增强
6. 版本历史备份

---

## 五、涉及文件

| 文件 | 变更类型 |
|------|---------|
| `backend/.../service/PromptConfigService.java` | 新增 6 个 Prompt 字段 + 常量 |
| `backend/.../config/PromptConfig.java` | 新增字段 |
| `backend/.../core/AiService.java` | 重构 processClipContent + 6 个方法 |
| `backend/.../service/PromptConfigStorageService.java` | 可选：版本历史 |
| `frontend/clip.html` | Prompt 弹窗 UX 增强 |
| `browser-extension/clip.html` | 同上 |
| `browser-extension/clip-main.js` | 同上 |

---

## 六、风险提示

- 修改 Prompt 结构后，AI 输出格式可能变化，需要验证 `parseProcessResult` 能否正确解析新格式
- Jackson 解析对 LLM 非标准 JSON 的容错性可能不如手动解析，需要充分测试
- 不要一次性改所有 Prompt，建议先改 clipAnalyze 验证效果后再推广