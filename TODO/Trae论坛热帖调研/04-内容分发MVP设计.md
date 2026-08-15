# 内容分发 MVP 设计（剪藏「一键投递」+ 导出）

> **版本**：v0.3（实施主体为浏览器插件；新增多目标投递 + 答案汇总蒸馏总结）
> **日期**：2026-08-15
> **上游**：`03-内容分发初步设计方案.md`（双通道方案，本 MVP 裁剪为通道 A：内部投递）
> **实施主体**：**浏览器插件（browser-extension/）**——剪藏主入口，Web 版 frontend/ 后续再同步
> **代码事实依据**（已核实）：
> - 后端 `ModelConfig`（core/）：activeProvider = dashscope/deepseek/custom，各 provider 有 apiKey/modelName，另有 simpleTierModel/strongTierModel
> - 后端 `AiService` 可复用方法：`processClipContent`、`analyzeContent`、`generateSummary`、`generateTags`、`smartOrganize`、`generateDivergentSummary`、`organizeContentForKnowledgeBase`
> - `ClipContent`（model/）：已有 summary / analysis / analysisStatus / divergentSummary / myThoughts 等字段
> - 持久化 `FileStorageService`：Jackson `ObjectMapper` 已配置 `FAIL_ON_UNKNOWN_PROPERTIES=false`（L81），加载时逐条 try/catch（L366/L380）→ **旧数据缺失新字段可安全反序列化为 null**
> - 插件端 `browser-extension/clip.html` 加载 `clip.js`（2KB，事件绑定）+ `clip-main.js`（61KB，全部逻辑）：`API_BASE_URL='http://127.0.0.1:8081/api/clip'`（L1）、`DOMContentLoaded`（L71）、列表渲染（L312）、`divergent-summary-${clip.id}` 面板（L448）、`generateDivergentSummary`（L572）、操作按钮沿用 `buildFanActionButton → handleMoreAction` 模式
> - Web 版 `frontend/clip.html`（242KB 单文件）与插件端同构，本期不动

---

## 1. MVP 目标与范围

**一句话**：让剪藏条目可以「一键投递到当前已配置的 AI 模型」执行指定动作（分析/总结/发散/标签/整理），结果回存剪藏并支持 **md/txt/html 导出**。

### 1.1 做（MVP 范围）

| 模块 | 内容 |
|---|---|
| 投递目标列表 | 内置 6 个内部场景目标：深度分析 / 总结提炼 / 发散性总结 / 标签生成 / 智能整理 / 知识库整理（映射 AiService 方法）；随附"当前模型"信息（来自 ModelConfig）。**省 token 定位**：走本地已配置模型，不跳外部平台、不额外计费 |
| 投递执行（**支持多目标**） | `POST /api/dispatch/{targetId}`：按 clipId 加载内容 → 调对应 AiService 方法 → 返回结果文本；前端可对同一剪藏**多选目标依次投递**，得到多个答案 |
| 投递历史记录 | 新增 `DispatchRecord`（clipId/targetId/targetName/result/createdAt），旁路存储 `clip-storage/dispatch-records/{clipId}.json`（**不动 ClipContent 存储结构**）；`GET /api/dispatch/records?clipId=` 供前端展示 |
| 结果回存 | ClipContent 新增 `lastDispatchTarget / lastDispatchResult / lastDispatchAt` 三字段（**全部可空**），最近一次投递回存；前端展示"上次投递"状态 |
| **答案汇总蒸馏（新增）** | `POST /api/dispatch/distill`：汇总该剪藏全部投递结果 → `AiService.distillAnswers` 蒸馏成一份精炼总结（核心结论/各视角要点/分歧点）→ 返回并追加一条蒸馏记录 |
| **前端入口（插件端）** | `browser-extension/clip-main.js` 每条剪藏操作区新增「投递到…」（**模态框多选场景**，串行投递）与「导出 ▾」（md/txt/html）按钮；投递面板含**历史记录列表 + 「蒸馏总结」按钮**；`clip.html` 视需要加模态框容器 |
| 结果面板 | 复用发散性总结面板样式（打字机/展开收起），新增 `dispatch-result-${clipId}` 区域（最近结果 + 历史列表 + 蒸馏结果） |
| 导出 | 插件端前端 Blob 下载：md（正文+元数据）、txt（纯文本）、html（marked 渲染包装），文件名含标题与日期 |

### 1.2 不做（明确排除，后续 spec）

- ❌ 外部 AI 平台投递（复制+跳转浏览器、平台页自动填入）——通道 B
- ❌ docx / png 卡片导出
- ❌ 飞书 Webhook 分发
- ❌ 扩展端 Vault（IndexedDB + LRU + 星标）
- ❌ 系统剪贴板监听 / 全局快捷键 / 托盘投递入口
- ❌ 分发目标注册表的持久化配置（MVP 用内置枚举；自定义目标/平台配置后续 spec）
- ❌ Prompt 模板变量体系（`{content}/{title}/{url}`）——MVP 复用现有场景 prompt
- ❌ 目标级模型选择（MVP 跟随 ModelConfig 当前激活配置与档位）
- ❌ **Web 版 `frontend/clip.html` 同步**（插件端验证后再同步；扩展版 `browser-extension/clip.html`/`clip-main.js` 为本期主体）

---

## 2. 后端设计

### 2.1 ClipContent 新增字段（model/ClipContent.java）

```java
/** 上次投递目标标识（如 internal:divergent） */
private String lastDispatchTarget;
/** 上次投递结果（Markdown 文本） */
private String lastDispatchResult;
/** 上次投递时间（yyyy-MM-dd HH:mm:ss） */
private String lastDispatchAt;
```

- 随 JSON 序列化返回前端（与现有字段一致）；存储沿用现有持久化机制（FileStorageService/JSON）
- 兼容性：字段可空，旧数据不受影响

### 2.2 接口定义（新增 controller/DispatchController.java，前缀 `/api/dispatch`）

**① `GET /api/dispatch/targets`**

返回内置目标列表 + 当前模型信息：

```json
{
  "currentModel": { "provider": "deepseek", "model": "deepseek-v4-flash" },
  "targets": [
    { "id": "internal:analyze",   "name": "深度分析",     "description": "基于剪藏内容的多角度分析" },
    { "id": "internal:summary",   "name": "总结提炼",     "description": "生成结构化摘要" },
    { "id": "internal:divergent", "name": "发散性总结",   "description": "专家级多角色发散分析" },
    { "id": "internal:tags",      "name": "标签生成",     "description": "提取关键词标签" },
    { "id": "internal:organize",  "name": "智能整理",     "description": "AI 分类 + 标签建议" },
    { "id": "internal:knowledge", "name": "知识库整理",   "description": "生成知识库格式内容" }
  ]
}
```

**② `POST /api/dispatch/{targetId}`**（body: `{"clipId": 123}` 或 query 参数）

- 校验：clipId 存在、targetId 合法
- 执行：按映射调用 AiService 方法（见 2.3）
- 成功：回存三字段 → 返回 `{ "success": true, "result": "...", "targetId": "...", "dispatchedAt": "..." }`
- 失败：返回 `{ "success": false, "error": "明确错误信息" }`（模型未配置 / 调用异常 / 内容为空），HTTP 200 携带 success 标志（与现有接口风格一致，便于前端统一提示）

### 2.3 DispatchService 目标→AiService 映射

```java
switch (targetId) {
    case "internal:analyze"   -> aiService.analyzeContent(content);                        // 或 processClipContent
    case "internal:summary"   -> aiService.generateSummary(content);
    case "internal:divergent" -> aiService.generateDivergentSummary(content, category, tags);
    case "internal:tags"      -> String.join("、", aiService.generateTags(content));
    case "internal:organize"  -> aiService.smartOrganize(content);                         // Map → 格式化文本
    case "internal:knowledge" -> aiService.organizeContentForKnowledgeBase(category, content);
}
```

- 发散性总结/整理/知识库整理需要 clip 的 category/tags，从 ClipContent 读取
- 结果统一为 Markdown 文本回存；`smartOrganize` 返回 Map 时格式化为可读文本

### 2.4 异常与边界

- ModelConfig 未配置对应 API Key → 返回"模型未配置，请到设置页配置 API Key"
- 剪藏内容为空 → 返回"剪藏内容为空"
- AI 调用异常 → 捕获并返回"AI 调用失败：{message}"（现有 GlobalExceptionHandler 之外，dispatch 内捕获避免污染统一异常）
- 并发：单用户本地应用，不做锁

### 2.5 数据兼容性与影响面分析（关键约束）

**原则：新增字段全部可空（nullable）；不改动任何既有字段的读写语义；不影响系统主流程与各接口通信。**

| 影响面 | 分析 | 结论 |
|---|---|---|
| 旧数据加载（反序列化） | `FileStorageService` 的 Jackson 已配置 `FAIL_ON_UNKNOWN_PROPERTIES=false`（L81），缺失字段反序列化为 null；加载已有逐条 try/catch（L366/L380），单条异常仅跳过并告警 | ✅ 安全，无需迁移脚本 |
| 新数据保存（序列化） | 新增字段随 `ClipContent` 默认序列化；投递前为 null，Jackson 默认输出 `"lastDispatchXxx": null` | ✅ 仅 JSON 多 3 个 null 键，前端现有渲染不读取，无影响 |
| 旧存储文件 | 仅在既有条目被编辑/投递时才重写文件；不主动批量改写历史文件 | ✅ 零迁移 |
| 各接口通信 | list / search / category / workflow / inbox / getById / delete / to-todo / organize / 周报 / 知识库 / 标签 / 图片 等**均不读取新字段**，返回结构与既有契约不变 | ✅ 无影响 |
| 前端渲染 | 插件端/Web 端渲染 `clip.tags`、`clip.content` 等既有字段路径不变；新增展示代码对 null 判空 | ✅ 无影响 |
| 序列化全局策略 | **不修改** ObjectMapper 全局配置（如 JsonInclude），避免改变既有 JSON 结构 | ✅ 保持现状 |
| 周报/整理/统计聚合 | 新字段不纳入现有聚合逻辑（与 03 设计一致） | ✅ 无影响 |
| **投递历史记录** | 旁路存储 `dispatch-records/{clipId}.json`（DispatchService 自管），**完全不触碰 ClipContent 存储文件**；删除剪藏时记录文件保留（或随删，见实现） | ✅ 隔离，零影响 |

**兜底方案（备选）**：若评审认为改 `ClipContent` 仍不可接受，可降级为"旁路存储"——投递结果写入独立目录 `clip-storage/dispatch-logs/{clipId}.json`，不动模型字段；代价是前端需额外请求读取、且"回存"不再是剪藏数据的一部分（体验弱化）。**MVP 默认采用方案 A（+3 可空字段），理由：反序列化容错已确认、零迁移、契约不变。**

**兼容性回归测试清单（实现后必测）**：
1. 用现有 clip-storage 旧数据启动 → `/api/clip/list` 正常返回，无跳过告警
2. 新增一条剪藏 → 保存/读取正常，JSON 中新增字段为 null 或不影响解析
3. 对旧条目投递 → 回存成功且既有字段（content/summary/analysis/tags）不变
4. `/api/clip/search`、`/api/todo/list`（转待办）、`/api/clip/weekly-report` 等主流程接口抽查正常

### 2.6 蒸馏总结设计（v0.3 新增）

- **触发**：前端投递面板「蒸馏总结」→ `POST /api/dispatch/distill` {clipId}
- **输入**：该剪藏的全部投递记录（按时间排序），拼接为"答案 1（目标名）：…\n答案 2：…"
- **执行**：`AiService.distillAnswers(combined)`——新增方法，`llmProvider.chatForTier(systemPrompt, combined, "simple")`；systemPrompt 为内置蒸馏提示词（核心结论 / 各视角要点 / 分歧点，不新增事实），MVP 硬编码，后续可移入 PromptConfigService
- **输出**：蒸馏结果文本；追加一条 `DispatchRecord{targetId:"internal:distill", targetName:"蒸馏总结"}`；同时回存 ClipContent 最近投递字段（覆盖为蒸馏结果）
- **边界**：无投递记录时返回"暂无投递记录，请先投递至少一个目标"

---

## 3. 前端设计（浏览器插件端：browser-extension/clip-main.js 为主）

> 插件端逻辑集中在 `clip-main.js`（61KB）；`clip.html` 引入 `clip.js` + `clip-main.js`。MVP 改动全部落在 `clip-main.js`（+必要时 `clip.html` 加模态框容器），Web 版 `frontend/clip.html` 后续同步。

### 3.1 入口按钮（操作区，与现有 fan-action 按钮并列）

在 `clip-main.js` 的 `buildFanActionButton` 调用区新增两枚按钮：

```js
fanButtons.push(buildFanActionButton('dispatch', clip.id, '投递到…', renderFanActionIcon('dispatch')));
fanButtons.push(buildFanActionButton('export', clip.id, '导出', renderFanActionIcon('export')));
```

- `renderFanActionIcon` 增加 `dispatch`（发送图标）、`export`（下载图标）两个 case
- `handleMoreAction` 增加分支：
  - `'dispatch'` → `openDispatchModal(clipId)`（新模态框：场景单选列表 + 当前模型信息 + 确认按钮）
  - `'export'` → 展开导出菜单或弹窗（md / txt / html 三项）

### 3.2 投递模态框与结果面板

- **模态框** `dispatchModal`：标题"投递到 AI"，展示当前模型（provider/model，来自 `GET /api/dispatch/targets`），6 个场景单选卡片（名称+描述），「开始投递」「取消」
- 提交：`axios.post('${API_BASE_URL}/../dispatch/' + targetId, { clipId })`（注意 API_BASE_URL 已含 `/api/clip`，跨前缀调用走 `http://127.0.0.1:8081/api/dispatch/...`，实现时统一构造 base 变量）
  - 成功 → 关闭模态框 → 在 `dispatch-result-${clipId}` 区域打字机渲染结果 → 更新"上次投递：目标 @ 时间"
  - 失败 → 顶部 toast 显示 error 信息
- **结果区域**：仿现有 `divergent-summary-${clipId}` section（样式/展开收起/复制按钮复用），支持「重新投递」

### 3.3 导出实现（纯前端 Blob）

```js
function exportClipAs(clip, format) {
  const meta = `# ${clip.title || clip.category || '剪藏'}\n\n> 来源: ${clip.source || ''}${clip.sourceUrl ? ' | ' + clip.sourceUrl : ''}\n> 分类: ${clip.category || ''} | 标签: ${(clip.tags||[]).join(', ')}\n> 时间: ${clip.createdAt || ''}\n\n---\n\n`;
  let content;
  if (format === 'md')  content = meta + (clip.content || '');
  if (format === 'txt') content = (meta.replace(/[#>*`]/g,'')) + (stripMd(clip.content));
  if (format === 'html') content = `<!DOCTYPE html>...<article>${marked.parse(meta + clip.content)}</article>...`;
  const blob = new Blob([content], { type: mime });
  // a[download] + URL.createObjectURL + revokeObjectURL
}
```

- 文件名：`剪藏-{title 清洗}-{yyyyMMdd}.{ext}`
- marked 库插件端已有；html 模板加基础样式（内联 CSS）

### 3.4 设置页

- MVP 不新增设置项（目标为内置）；仅复用现有模型配置（`/api/model-config`）——当前模型信息由 `/api/dispatch/targets` 返回

---

## 4. 文件改动清单

| 文件 | 改动 |
|---|---|
| `backend/.../model/ClipContent.java` | ✅ 已实现：+3 可空字段（lastDispatchTarget/Result/At） |
| `backend/.../model/DispatchRecord.java` | ✅ 已实现：新增投递记录模型 |
| `backend/.../core/AiService.java` | ✅ 已实现：+distillAnswers 蒸馏方法（内置蒸馏 prompt） |
| `backend/.../service/ClipService.java` | ✅ 已实现：+updateDispatchResult 回存方法 |
| `backend/.../service/DispatchService.java` | ✅ 已实现：目标枚举、投递执行、记录旁路存储、蒸馏 |
| `backend/.../controller/DispatchController.java` | ✅ 已实现：GET targets / POST {targetId} / GET records / POST distill |
| `browser-extension/clip-main.js` | ✅ 已实现：卡片📤按钮+内联投递面板（目标多选/投递所选/蒸馏/导出 MD·TXT·HTML）、事件委托、缓存 |
| ~~`browser-extension/clip.html`~~ | 无需改动（面板由 JS 注入） |
| ~~`frontend/clip.html`~~ | **本期不动**（插件端验证后作为后续同步项） |

> 实现说明：投递面板采用**卡片内联展开**（复用发散性总结面板模式）而非独立模态框，减少 HTML/CSS 改动面、结果随卡片展示更直观；投递目标全局加载一次并缓存。后端不改动既有接口契约（见 2.5）。

---

## 5. 验收标准（MVP 完成定义）

1. `GET /api/dispatch/targets` 返回 6 个目标与当前模型信息
2. 配置 API Key 后，对任一条剪藏依次执行 6 个场景投递均返回结果，且**结果回存**（再次加载剪藏可见 lastDispatchResult）
3. 未配置模型时投递返回明确错误提示（前端 toast 可见）
4. 插件端剪藏条目出现「投递到…」「导出」按钮；投递结果以打字机渲染并可复制
5. md / txt / html 三种导出均可下载，内容含元数据头与正文，中文无乱码
6. **兼容性回归**（见 2.5 清单）：旧数据启动 list 正常、无跳过告警；新增剪藏保存正常；对旧条目投递后既有字段不变；search / todo 转待办 / 周报等主流程接口抽查正常
7. 现有功能回归：剪藏增删改查、发散性总结、整理、待办转换不受影响（手动抽查）

---

## 6. 风险与依赖

| 风险/依赖 | 等级 | 应对 |
|---|---|---|
| 依赖用户已配置模型 API Key | 中 | 未配置时给出明确引导（跳设置页） |
| AiService 方法参数/返回差异（Map vs String） | 低 | DispatchService 统一格式化 |
| clip.html 为 24 万字符单文件，改动冲突面大 | 中 | 严格按现有函数模式追加；改动点集中（fanButtons 区、handleMoreAction、新增函数区） |
| 结果回存字段对现有检索/周报的影响 | 低 | 仅新增字段，不纳入现有统计/周报聚合 |
| 模型调用耗时（发散性总结长） | 低 | 前端按钮 loading 态 + 结果面板异步渲染 |

---

## 7. 后续 spec 输入清单（复杂功能）

1. **通道 B 外部投递 spec**：平台注册表持久化与自定义、剪贴板+跳转、平台页自动填入引擎（兼容矩阵）
2. **导出扩展 spec**：docx（前端 docx 库 vs 后端 POI 选型实测）、png 卡片（html2canvas）
3. **分发记录与重放 spec**：DispatchLog 持久化、投递历史视图
4. **模板变量体系 spec**：`{content}/{title}/{url}` 插值、分发模板管理 UI（接入 PromptConfigService）
5. **Web 版同步 spec**：`frontend/clip.html` 对齐插件端投递/导出（插件端验证后）
6. **Agent 能力层 spec**：REST/CLI 封装"抓取→投递"（对齐智能入库方向）
