# 智能剪藏兜底问题：根因分析与解决方案

## 摘要

写作区「⚡ 智能剪藏」对 Lettera 文章内容点击后弹出「未检测到剪藏所需落地字段」兜底窗。根因是双通道检测均未命中：

1. **正则通道（确定性）**：结构化识别正则只认 `#{1,4} 标题` 形式的 Markdown 标题，而该内容的 `**摘要**`/`**分析**`/`**标签**` 是**加粗格式**章节，且 `### Lettera 介绍` 等标题不在别名表内 → 正则未命中。
2. **LLM 兜底（本次直接原因）**：正则未命中后走 LLM 轻量抽取，但当前环境 `clip-storage/model-config.json` 中 dashscope/deepseek 的 **API Key 均为空** → 两个 provider 均不可用 → `extractClipTriad` 捕获异常返回 null → `detected=false`。

另发现兜底保存路径将**全文写入 summary**（违反「摘要 ≤100 字、严禁复制原文」约束），属连带设计缺陷。

## 现状分析（Current State Analysis）

### 调用链

```
editor.js smartClip()
  → POST /api/clip/detect-structured   (frontend/js/editor.js:4529)
  → ClipController.detectStructured()  (ClipController.java:236-239)
  → ClipService.detectStructured()     (ClipService.java:1615-1674)
      ① 正则章节识别 parseStructuredSections() → 未命中
      ② LLM 兜底 aiService.extractClipTriad()  → 返回 null（LLM 不可用）
      → detected=false
  → 前端 openModal(smartClipFallbackModal)      (editor.js:4543-4546)
```

### 关键代码位置

| 位置 | 说明 |
|---|---|
| [ClipService.java:1586](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java#L1586) | `SECTION_HEADER_PATTERN = ^#{1,4}\s*([^#].*?)\s*[：:]?\s*$`，仅认 `#` 标题 |
| [ClipService.java:1714-1723](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java#L1714-L1723) | `matchSectionHeader`：标题名必须命中别名表（原文/摘要/分析/标签/我的思考…） |
| [AiService.java:1585-1620](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/core/AiService.java#L1585-L1620) | `extractClipTriad`：LLM 兜底，任何异常返回 null，不区分失败原因 |
| [RoutingLlmProvider.java:291-320](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java#L291-L320) | `getActiveProvider`：Key 为空时仍返回 provider，调用才抛异常 |
| [model-config.json](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/clip-storage/model-config.json) | `dashscopeApiKey`/`deepseekApiKey` 均为空 → `isAvailable()` 全 false |
| [editor.js:4520-4554](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/editor.js#L4520-L4554) | `smartClip()`：detected=false 时弹兜底窗 |
| [editor.js:4608-4638](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/editor.js#L4608-L4638) | `saveSmartClipFallback`：`summary: context.content`（全文当摘要） |
| [editor.html:552](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/editor.html#L552) | 兜底弹窗固定文案「AI 也未提取到摘要/标签」 |

### 根因确认

- **内容层面**：Lettera 内容里 `**摘要**` `**分析**` `**标签**` 为加粗格式（AI 整理/文章摘录的常见形态），正则 `^#{1,4}` 无法命中；`### Lettera 介绍` 等章节名不在别名表。
- **系统层面**：LLM 兜底依赖 API Key，当前环境未配置 → 兜底必然失败 → `detected=false`。
- **连带缺陷**：兜底保存把全文当 `summary` 落库，与 [ClipService.java:364](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java#L364) 注释中「避免 store-only 分支把 content 当 summary」的设计意图相悖。

## 变更方案（Proposed Changes）

### 1.【核心】后端扩展正则：识别加粗章节标题

**文件**：[ClipService.java](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java)（1580-1723 区段）

**改动**：
- 新增 `SECTION_HEADER_BOLD_PATTERN = ^\*{1,3}\s*([^*].*?)\s*\*{1,3}\s*[：:]?\s*$`，用于匹配 `**摘要**`、`*分析*`、`***标签***` 等整行加粗章节。
- 修改 `matchSectionHeader`：先匹配 `#` 标题，未命中再匹配加粗标题；两者均取 group(1) 到别名表查规范键。

**为什么**：加粗章节是 AI 整理产物/文章摘录的常见结构，扩展后此类内容**无需 LLM 即可确定性命中**，零 token 消耗、离线可用。

**边界安全**（已推演）：
- `**注意：测试版暂不支持中文。**` 等整行加粗正文 → 名称不在别名表 → 返回 null，按普通正文处理，无副作用。
- `* 列表项`（单星号）→ 无闭合星号，`\*{1,3}$` 不匹配 → 安全。
- 行中加粗（`这是**加粗**文字`）→ 锚定 `^...$`，不匹配 → 安全。
- 段落交错：`**分析**` 章节内嵌套 `### 核心结论` 等子标题 → 子标题不在别名表，作为 analysis 章节正文的一部分原样保留。

**预期效果**：Lettera 内容 → `**摘要**`→summary、`**分析**`→analysis、`**标签**`→tags（按顿号/逗号拆分出 Lettera、Markdown 编辑器、macOS 等）→ `regexHit=true` → 免确认直接入库，不再弹兜底窗。

### 2. 后端：LLM 兜底失败原因区分 + 日志

**文件**：[AiService.java](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/core/AiService.java)、[ClipService.java](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java)

**改动**：
- AiService 新增 `public boolean isLlmAvailable()`：透传 `llmProvider.isAvailable()`。
- `detectStructured` 第②步前先检查可用性：不可用时 `result.put("aiUnavailable", true)` 并 `logger.warn("[智能剪藏] LLM 兜底不可用（API Key 未配置或服务异常），跳过 AI 解析")`，不再空跑一次注定失败的调用。
- `extractClipTriad` catch 分支补充 `llmProvider.isAvailable()` 判断，日志区分「provider 不可用」与「解析/网络失败」。

**为什么**：当前 catch 吞掉所有异常，前端无从得知是「AI 不可用」还是「内容真无结构」，弹窗文案误导用户。

### 3. 前端：弹窗文案区分 + 兜底保存 summary 修复

**文件**：[editor.html](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/editor.html#L552)、[editor.js](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/editor.js)

**改动**：
- editor.html：兜底弹窗 `<div class="modal-note">` 增加 `id="smartClipFallbackNote"`。
- editor.js：`elements` 映射补充 `'smartClipFallbackNote'`；`smartClip()` 的 fallback 分支按 `detection.aiUnavailable` 动态设置文案：
  - AI 不可用：`未识别到结构化章节，且 AI 解析暂不可用（模型未配置或服务异常）。仍可按原文存入收件箱，稍后手动整理。`
  - AI 已调用但无结果：保留原文案。
- editor.js `saveSmartClipFallback`：`summary` 由 `context.content` 改为 ≤100 字截断预览（`raw.length > 100 ? raw.slice(0, 100) + '…' : raw`），避免全文与摘要重复。

**为什么**：文案诚实反映失败原因；summary 截断是 AI 不可用场景下的务实妥协（后端 [ClipService.java:364](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/backend/src/main/java/com/example/clip/service/ClipService.java#L364) 对显式非空 summary 优先采用，不会回退为全文）。

## 假设与决策（Assumptions & Decisions）

- 用户跳过范围选择，默认覆盖「核心正则扩展 + LLM 失败提示 + summary 修复」三项；三者低风险、直接相关。
- 加粗识别仅限**整行**加粗章节（锚定行首行尾），不处理行中加粗。
- 加粗章节标题在别名表内才生效（摘要/分析/标签/原文/我的思考/想法），普通加粗行不受影响。
- 兜底保存 summary 采用截断而非空串：空串会被后端按 blank 处理回退为全文，截断更能守住 ≤100 字约束。
- 本次不改动「LLM 未配置」本身（属于用户需在设置页配置 API Key 的事项），仅在检测链路中显式提示。

## 验证（Verification）

1. **后端编译**：`cd backend && mvn -q compile` 通过。
2. **核心正则回归（手动/接口）**：用 Lettera 全文 `POST /api/clip/detect-structured` →
   - 期望 `detected=true, method=regex`；
   - `tags` 含 Lettera、Markdown 编辑器、macOS、公测、TestFlight、Panda 等（顿号拆分）；
   - `summary` 为 `**摘要**` 章节正文（≤100 字）；`analysis` 为 `**分析**` 章节内容。
3. **AI 不可用提示（手动）**：当前环境（Key 为空）粘贴无结构短文本 → 兜底弹窗显示「AI 解析暂不可用」文案；后端日志出现 `[智能剪藏] LLM 兜底不可用` warn。
4. **兜底保存（手动）**：走兜底保存后，检查 clip-storage 落库记录 `summary` ≤100 字且不与 `content` 全文重复。
5. **前端回归**：打开编辑器，⚡ 智能剪藏按钮、确认弹窗、兜底弹窗均正常；既有 `## 摘要` 正则路径不受影响（heading pattern 保持不变）。
