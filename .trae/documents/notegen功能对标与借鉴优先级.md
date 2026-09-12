# NoteGen 借鉴——实施计划（P0）与 RAG 细化方案

> 决策（用户拍板）：**本轮落地 P0 中除 RAG 的两项**——① 剪贴板即时助手　② 编辑器 HTML→Markdown 粘贴；**RAG 本轮只出细化方案，下轮再决策是否实施**。

---

## 一、本轮实施 A：剪贴板即时助手

### A1. 现状（已具备的底座）
- 主进程已有 `read-clipboard` IPC（[main.js:4363](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js)），但目前只 `clipboard.readText()`。
- Electron 侧已有 `setInterval` 定时轮询先例（如 `reminderTimer = setInterval(checkReminders, 30000)`，[main.js:4812](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js)），可复用做后台监听。
- 项目有"临时窗口"成熟模式（截图贴图/Toast/粘贴窗/OCR 窗，随 `cleanupOnQuit()` 统一 `destroy()`），可复用做气泡窗。
- 前端有全局 toast：`window.UI.toast`（[editor.js:3320](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/editor.js)）。
- 烙库入口：`POST /api/clip/add`（`ClipController.addClip`）+ 服务层 `saveClip(ClipContent)`。

### A2. 方案（大白话）
后台每隔 ~1.5s 看一眼系统剪贴板；发现"最近复制过但还没提示过"的新内容（文字或图片），就在屏幕角落弹一个**置顶小气泡**，带两个按钮：**[记录到剪藏] [忽略]**。点记录就直接按现有流程存成一条剪藏；点忽略或过一会儿自动消失，并且不会重复打扰。

### A3. 具体改动
| 文件 | 改动 |
|---|---|
| `electron/main.js` | 1) 新增剪贴板轮询（复用 `setInterval`，去重靠内容签名：文本=内容哈希，图片=尺寸+字节哈希；与上次标记比对）。2) 新增 `read-clipboard:rich` Handler：一次返回 `{ text, imageDataUrl }`（文本与图片都读）。3) 新增 IPC `clipboard-assistant:record`：收到确认后把当前剪贴内容按类型落为剪藏（走现有新增剪藏逻辑）。4) 新增"剪贴板气泡窗"（复用临时窗口模式，`contextIsolation`+`destroy()`），随 `cleanupOnQuit()` 清理。 |
| `electron/preload.js` | 暴露 `readClipboardRich()`、`clipboardAssistant.record(meta)`、与气泡窗对应的 on/信号。 |
| `frontend/clipboard-toast.html` + `.js/.css`（新增） | 置顶小气泡窗：展示内容预览 + [记录][忽略]，忽略后关闭；记录则回主进程触发落库。支持无内容/纯图片两种预览。 |
| 设置项（`config`） | 开关"剪贴板即时助手"（默认开），以及忽略列表（可选，本轮可只做开关+冷却）。 |

### A4. 默认决策/取舍
- 用**主动轮询**而非系统级事件监听（跨平台一致、改动小）；轮询间隔 1500ms。
- 去重策略：维护"上次已提示签名"，只有变化才提示；同内容 10s 内不重复。
- 气泡窗**始终置顶但可关闭**，避免打扰；图片以缩略图展示。
- 记录入口复用现有 `POST /api/clip/add`，不在本轮改动后端落库。

### A5. 验证
- 手动复制一段文本→出现气泡→点记录→剪藏列表出现该条。
- 复制一张图片→气泡显示缩略图→记录成功。
- 连续复制同一内容→只提示一次；冷却期内不重复。
- 退出应用时气泡窗/轮询随 `cleanupOnQuit()` 正常销毁，无残留进程。

---

## 二、本轮实施 B：编辑器 HTML→Markdown 粘贴

### B1. 现状
- 编辑器基于 **ACE**：`mainEditor`、`compareEditor`（[editor.js:227-230](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/editor.js)）。当前从网页复制的是 `text/plain`，粘贴即原样插入 HTML 源码，无转换。
- 前端已用 libs CDN（d3/mermaid 在 `frontend/libs`），可继续以本地文件方式引入 `turndown.js`（无需后端）。

### B2. 方案（大白话）
从网页复制内容粘进编辑器时，ACE 默认接收的是"纯文本"。我们拦截 ACE 的粘贴：从剪贴板同时读取 `text/html`；若检测到富文本，就用 turndown 转成干净的 Markdown 再插入光标处，避免把网页一堆 `<p>/<div>/<style>` 塞进来。

### B3. 具体改动
| 文件 | 改动 |
|---|---|
| `frontend/libs/turndown.min.js`（新增） | HTML→Markdown 转换器（本地引入，可控版本）。可在 `editor.html` 用 `<script>` 引入。 |
| `frontend/js/editor.js` | 给 `mainEditor` 绑定 ACE `paste`/`beforeinput` 拦截：从 `clipboardData` 取 `text/html`；若非空且与纯文本差异明显→`new TurndownService({headingStyle:'atx'}).turkdown(html)`，`preventDefault()` 后把 MD 插入光标；否则走默认纯文本粘贴。 |
| `frontend/editor.html` | 在 ACE 脚本之后引入 `turndown.min.js`。 |

### B4. 默认决策/取舍
- 仅对 `mainEditor`（主编辑区）启用；`compareEditor` 不做转换（对比场景保持原样）。
- 保留网站图片远程链接；若后续要"下载图床"，另开任务（见 RAG 文档第⑤节，不做）。

### B5. 验证
- 浏览器复制一段带标题/列表/链接的网页，切到编辑器 Ctrl+V → 得到结构化 Markdown（`#`/`-`/`[a](url)`）。
- 复制普通纯文本 → 行为不变。
- `node --check frontend/js/editor.js` 通过；编辑器内其余功能（格式化/导出）不受影响。

---

## 三、RAG：收敛到「升级既有 wiki 查询」，不新建入口（供下轮决策；决策项 = 是否上阶段二向量）

### C0. 方向修正（沿用上轮拍板）
- **弃用「新建『问我资料』独立入口」设定**。已核实：[wiki.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/wiki.html) 的「知识库查询」(`POST/GET /api/wiki/query/stream`，[WikiQueryService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/wiki/WikiQueryService.java)) **本就是"问我自己的资料"**：同时检索剪藏+知识（`includeClips`/`includeKnowledge`）、SSE 流式、相关页面 + 额外来源（📎剪藏/📖知识）标注、AI 生成回答。
- 结论：**RAG = 升级 `WikiQueryService` 的召回质量**，UI 复用 wiki 现有查询界面，几乎不动。

### C1. 现状（已核实，比早前认知更强）
- 入口已存在（见 C0），不在本方案范围内新建。
- 当前召回序列为三级：**本地拆词(词法)检索 index 摘要 → 正文 grep 兜底 → 双未命中时 LLM 选页兜底**（`aiService.locateRelevantPages`）→ 读相关页 → LLM 依据材料生成回答（含可选的第二次「知识补充」强调用）。
- 即当前**已具备「词法召回 + LLM 兜底」双保险**，属轻量 RAG；`EmbeddingConfig.java` 整文件注释，向量语义召回未启用。

### C2. 目标（大白话）
"问我自己的资料"：提问 → 从剪藏 + 知识里召回最相关片段 → 拼 prompt → LLM 依据材料回答并标注引用。重点是**召回更准、代价更可控**，而非再造入口。

### C3. 分阶段
**阶段一（默认走这条路，低成本打磨召回质量）**
- 把本地词法召回从「拆词 + grep」升级为**轻量 BM25 词法检索**：词形归一（去大小写/标点/抽词干）、停用词滤噪、标题加权、近义/复合词轻度扩展——**纯本地、零向量依赖**。
- 保留 LLM 选页兜底作语义安全网；打磨词法结果与 LLM 结果的**混合去重合稿**。
- 交互：wiki 现有查询界面；可选把同一 `/api/wiki/query/stream` **嫁接到编辑器 pet**（新增「🔍 问我资料」快捷项），让写作态也能调全库。
- 改动面：`WikiLocalRetriever` + `WikiQueryService` 合并逻辑（+ 可选 pet 前端）。缺点：召回仍是"字面"，对近义/口语化提问提升有限。

**阶段二（向量召回 = 可选增强，需先评估后做）**
- 存储：推荐本地 `sqlite-vec`（同库同源、离线、免部署、易扩展）。
- 关键决策在 **embedding 模型**而非存储：
  - 在线 API（OpenAI/阿里，现有 `EmbeddingConfig` 取消注释即可）：免维护，但**按 token 计费 + 每次查询延迟 + 内容外送**。
  - 本地小模型（如 bge-small/m3e）：离线、隐私、无限调用，但需模型文件体积 + 自建 embedding 服务。
- 流程：切块 → embedding 入库 → 查询向量召回 →（可选 rerank）→ 与词法结果合并 → 生成。

### C4. 与 editor pet 机器人的差异（已为既定事实，避免重复做入口）
| 维度 | wiki「知识库查询」 | 编辑器 pet 机器人 |
|---|---|---|
| 心智形态 | 检索态 · 对着全库提问 | 写作态 · 围绕当前文档/选区 |
| 作用域 | 剪藏 + 知识全库 | 光标处 / 选中片段 |
| 是否检索全库 | ✅ 是 | ❌ 否（仅当前文本操作） |
| 回答出处标注 | ✅ relevantPages / 来源列表 | 无 |
| 后端 | `/api/wiki/query/stream` | `/api/ai/chat/stream` |
二者互补：pet 只"嫁接" wiki 查询入口即可，不新增第三种入口。

### C5. 成本与效果评估：阶段二向量，值不值得做
> 结论先行：**本轮不建议上阶段二向量，ROI 偏低**；建议先把阶段一词法升级做扎实，向量列为 P3 可选，且若做倾向本地小模型而非在线 API。

| 类别 | 内容 | 判定 |
|---|---|---|
| 效果增量 | 个人资料以剪藏/笔记的实词、事实性内容为主，词法召回已够用；向量主要利好"换说法/近义/口语化提问" | 净增量偏"锦上添花" |
| 语义兜底现状 | 已有 LLM 选页兜底部分覆盖语义缺口 → 向量收益被稀释 | 增量进一步收窄 |
| 开发成本 | embedding 流水线（切块+向量表+增量同步+混合合并），跨 backend 多处改动 | 中 |
| 运行成本（**大头在 embedding 模型，不在 sqlite-vec**） | sqlite-vec 存储本身免费/易；在线 API=按量+延迟+内容外送；本地小模型=体积+自建服务 | 高 / 需权衡 |
| 一致性/维护 | 知识、剪藏变更需重 embedding，否则向量漂移 → 又多一对"文件为真、库为缓存"的衍生缓存 | 维护面扩大 |
| 综合 | 收益被 LLM 兜底稀释、成本集中在 embedding 模型与增量同步 | **ROI 偏低，P3 可选** |

---

## 四、本轮的边界
- 只实现 **A（剪贴板即时助手）与 B（编辑器 HTML→MD）**；RAG 按 C 暂缓，下轮决策后再单独排实施。
- 完成后：`node --check` 改动 JS；重启后端/重载前端手测两点；随后一并提交（RAG 文档单独留档，不进本轮提交）。