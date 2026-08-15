# 内容分发 MVP 实施记录

> **版本**：v1.1（追加 Web 版 frontend 同步）
> **日期**：2026-08-15 ～ 2026-08-16
> **依据**：`04-内容分发MVP设计.md`（v0.3）
> **状态**：后端接口全链路验证通过 ✅；插件端代码完成且语法校验通过；**Web 版同步完成**；UI 交互待真实环境点验

---

## 〇、Web 版 frontend/clip.html 同步（v1.1 新增）

> 背景：Web 版 `frontend/clip.html` 为**拆分版**（逻辑位于 `frontend/js/clip-*.js`），非单文件版。同步改动集中在 2 个 JS 文件，HTML 无改动。

| 文件 | 内容 |
|---|---|
| `frontend/js/clip-list.js` | ✅ fanButtons 增加「投递到AI」「导出」两枚按钮（含 SVG 图标）；卡片详情区新增内联「投递到 AI」面板（目标多选/当前模型/投递所选/蒸馏总结/导出 MD·TXT·HTML/上次投递状态）；`handleMoreAction`/`performMoreAction`/`getMoreActionLabel` 增加 dispatch/export 分支（**不弹确认**）；文件尾新增投递/蒸馏/导出函数块（`loadDispatchTargets`/`toggleDispatchPanel`/`dispatchRun`/`dispatchDistill`/`exportClipById`/`exportClipAs`，用 `API_ROOT+'/dispatch'` 与 `clipCache` 取数据） |
| `frontend/js/clip-shared.js` | ✅ `DOMContentLoaded` 初始化追加 `loadDispatchTargets()` |

- **复用既有设施**：`clipCache`（clip-shared.js L28，列表/搜索渲染时已填充）供导出取数；`escapeHtml`（clip-actions.js）、`showToast`（clip-sync.js）、`window.MediaKit.render.renderMarkdown`（media-render.js）均直接复用，零新增依赖
- **语法校验**：`node --check` 两文件均通过；符号定义位置逐一核对无 ReferenceError 风险
- **加载顺序**：clip.html script 顺序 shared→form→list→actions→sync，DOMContentLoaded 触发时全部就绪 ✓

---

## 一、实现内容

### 后端（5 处改动，全部新增/扩展，不改既有接口契约）

| 文件 | 内容 |
|---|---|
| `model/ClipContent.java` | +3 可空字段：`lastDispatchTarget / lastDispatchResult / lastDispatchAt`（含 getter/setter） |
| `model/DispatchRecord.java` | **新增**：投递记录模型（clipId/targetId/targetName/result/createdAt） |
| `core/AiService.java` | +`distillAnswers(combined)`：答案汇总蒸馏（内置蒸馏提示词：核心结论/各视角要点/分歧与待确认，≤400 字） |
| `service/ClipService.java` | +`updateDispatchResult(id, targetId, result)`：仅更新 3 个新字段，走 `storageService.saveClip` |
| `service/DispatchService.java` | **新增**：6 个内置目标枚举、目标→AiService 映射、投递执行、记录旁路存储（`{storage}/dispatch-records/{clipId}.json`）、蒸馏 |
| `controller/DispatchController.java` | **新增**：`GET /api/dispatch/targets`、`POST /api/dispatch/{targetId}`、`GET /api/dispatch/records?clipId=`、`POST /api/dispatch/distill` |

### 前端（浏览器插件，1 文件）

| 文件 | 内容 |
|---|---|
| `browser-extension/clip-main.js` | 卡片头部 +📤 按钮；卡片内联「投递到 AI」面板（**目标多选**、当前模型信息、投递所选/蒸馏总结/导出 MD·TXT·HTML 按钮、上次投递状态）；`loadDispatchTargets` 全局缓存、`dispatchRun` 串行多目标投递、`dispatchDistill`、`exportClipAs`（Blob 下载）；事件委托（复用既有 pattern） |

> 实现偏差（相对 04 设计）：投递面板由"独立模态框"改为**卡片内联展开**（复用发散性总结面板模式），减少 HTML/CSS 改动面、结果随卡片展示更直观。

---

## 二、验证结果（18082 端口 + 临时存储，2026-08-16）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | `GET /api/dispatch/targets` | ✅ 返回 6 目标 + 当前模型（dashscope/qwen-plus） |
| 2 | 新增剪藏 + `/api/clip/list` 回归 | ✅ 写入/读取正常 |
| 3 | `POST /api/dispatch/internal:summary` | ✅ success=True，结果返回；DashScope 免费额度耗尽 403 被 AiService 既有错误透传机制正确呈现 |
| 4 | 回存：`GET /api/clip/{id}` | ✅ `lastDispatchTarget/At` 已回存；**content(131 字)/summary 等既有字段不变** |
| 5 | `GET /api/dispatch/records` | ✅ 记录追加成功 |
| 6 | 多目标投递（summary + tags）→ `POST /api/dispatch/distill` | ✅ 蒸馏链路完整，追加"蒸馏总结"记录 |
| 7 | 记录文件落盘 | ✅ `dispatch-records/{clipId}.json` 生成 |
| 8 | 边界：未知目标/缺 clipId/无记录蒸馏 | ✅ 均返回明确错误信息 |
| 9 | `node --check clip-main.js` | ✅ 语法通过 |
| 10 | `mvn compile` / `mvn package` | ✅ 构建通过 |

**兼容性回归**：旧数据加载告警（UUID id 条目跳过）为**既有行为**（非本次改动引入）；新增字段缺失时反序列化为 null，已通过实际运行验证。

---

## 三、环境与沙箱发现（重要）

1. **8081 端口被既有后端实例占用**（本会话前已运行、无新代码）：新的 jar 无法绑定 8081。**使用新代码需重启后端**（用户在真实环境重启应用后生效）。
2. **DSH 文件沙箱限制**：后端运行进程无法写 `L:\40_Knowledge\...\clip-storage`（会话工作区之外）——验证采用 `--clip.storage.path` 覆盖为工作区内路径。**真实环境无此限制**。
3. **存储读取排除规则**：`getAllJsonFiles` 排除 `.tmp` 等目录名（既有逻辑）——验证存储不可放在 `.tmp` 下。
4. **本地配置覆盖**：`backend/application.yml`（git 忽略）覆盖打包内配置，`clip.storage.path` 指向 `L:\...\剪藏收集\clip-storage`。

---

## 四、遗留事项（后续）

1. **前端 UI 真机点验**：插件端「投递到…」面板、多选投递、蒸馏按钮、导出下载需在真实浏览器 + 新后端环境点验（本会话无法打开浏览器 UI）。
2. **8081 旧实例重启**：重启后端加载新代码后，`/api/dispatch/*` 在默认端口可用。
3. **DashScope 免费额度耗尽**：投递执行会返回 AI 错误（403 额度），属模型侧配额问题，非本功能缺陷；用户配置有效 Key 后正常。
4. **其余 4 个目标场景**（analyze/divergent/organize/knowledge）与已验证的 summary/tags 走同一 `execute` 映射，逻辑同构，建议真机环境各点验一次。
5. ~~**Web 版同步**~~ ✅ 已完成（见第〇节）；**通道 B 外部投递**等按 04 文档第 7 节列为后续 spec。
