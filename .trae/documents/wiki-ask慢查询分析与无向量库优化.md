# wiki_ask 慢查询细化分析与无向量库优化落地

> 日期：2026-09-09
> 性质：分析 + 落地。基于实测（wuanai provider 下，单次 wiki_ask 全链路 112s，慢时 >240s）对延迟构成做细化拆解，探索 grep/分片等不依赖向量数据库的提速方案，并按建议落地。

---

## 1. 延迟构成细化分析（基于代码走读 + 实测）

`WikiQueryService.query()` 的链路是**全串行**的，逐阶段：

| # | 阶段 | 实现 | 本地耗时 | LLM 调用 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | 读取 index.md | `readPage` 本地 I/O | 毫秒级 | 无 | 61 页约几 KB |
| 2 | 定位页面 | `WikiLocalRetriever`（index 摘要拆词打分，minHits=2, topK=5） | 毫秒级 | **仅本地未命中时 1 次 simple** | 命中即跳过 LLM |
| 3 | 读取选中页 | 本地 I/O | 毫秒级 | 无 | **无内容上限**，长页整篇进入后续 prompt |
| 4 | 综合答案 | `synthesizeAnswer`（强模型） | — | **恒 1 次 strong** | 输入 = 全部选中页全文 |
| 4.1 | 知识补充 | `generateKnowledgeSupplement`（强模型） | — | **恒 1 次 strong** | 无条件执行，与 includeKnowledge 无关 |
| 5 | Token 估算 | 纯计算 | 微秒 | 无 | — |

**结论：本地环节（I/O、拆词、打分）全是毫秒级，瓶颈 100% 在 LLM 调用。**
- 最好情况也有 **2 次串行强模型调用**（第 4、4.1 步），实测 wuanai 下强模型单次约 50-60s → 112s 由此而来。
- 本地未命中时再加 1 次 simple 调用（第 2 步），最坏 3 次串行 → 超过 240s。
- `includeClips/includeKnowledge=true` 时，第 4 步输入会额外携带剪藏/知识片段，输入变大，进一步拖慢强模型。

### 何时会"本地未命中"（触发 slow path）
`INDEX_ENTRY` 正则只匹配 `- [[页面名]] — 摘要 (updated: ...)` 行，只扫**目录摘要**。页面的知识点若只在**正文深处**、标题摘要未体现，本地层选不到 → 必然走 LLM 兜底（这正是 KaaS 自认的 body-depth 缺口，v2ex #7 imdoge 指出的也是它）。

---

## 2. grep/分片能否缩短时间？（方案探索，全部无向量库）

### 2.1 结论先行
- **grep/分片本身不缩短"单次 LLM 生成"的时间**——强模型生成 50-60s 是上游 API 决定的，本地再怎么快也压缩不了这段。
- 但它们能**减少 LLM 调用次数与输入量**，这才是真正的杠杆：本地命中 → 省一次 simple 调用；输入更小 → 强模型首 token 更快、生成更短。

### 2.2 方案清单与取舍

| 方案 | 作用 | 效果 | 决策 |
| --- | --- | --- | --- |
| A. **知识补充改为可选**（第二次强模型调用按需开关） | 直接砍掉一次强模型调用 | 最好情况 2 次调用 → 1 次，**延迟约减 40-50%** | ✅ 本次落地（wiki_ask 默认关，前端默认开保持原体验） |
| B. **正文 grep 兜底**：本地 index 检索后，对全部 Wiki 页面正文做 token 命中打分，补足 topK | 提高本地定位命中率；同时补 body-depth 召回缺口（顺带解决 KaaS 短板） | 本地命中率大幅上升 → 更多场景跳过 stage-1 LLM；召回更全 | ✅ 本次落地（61 页 × 几 KB，毫秒级成本） |
| C. **输入截断 + 截断标注**：单页正文 >8K 字截断，附"[此处超预算被截断]"说明 | 缩小强模型输入，防个别长 source 页撑爆 prompt | 输入减小 → 综合/补充都快；防"把截断当缺失" | ✅ 本次落地（借鉴 KaaS `TRUNCATION_NOTE`） |
| D. **目录分片**：index 超阈值时按 entity/concept/synthesis/source 分片喂 LLM | 缩小 stage-1 LLM 的目录 prompt | 61 页下毫无收益（index 才几 KB）；>数百页才有意义 | ❌ 暂缓，文档记录（当前不触发，避免过度设计） |
| E. 答案/页面缓存 | 相同问题直接返回 | 个人知识库问重率低，命中率不划算；引入失效管理复杂度 | ❌ 不做 |
| F. synthesize 与 supplement 并行 | 减少串行 | 二者有依赖（supplement 需避免重复已有答案），无法并行 | ❌ 不可行 |
| G. **分阶段耗时日志** | 可观测性 | 便于后续验证与回归 | ✅ 本次落地（轻量 log） |

> 说明：D（分片）是规模防御策略。当前 61 页 index 全文仅几 KB，把它按类型拆片对延迟的影响为零。增长策略备忘：当 index 条目 >200 行时，将目录按类型生成 4 个子目录（MOC 已有此结构），stage-1 让 LLM 或本地层先选类型再选页——届时再实现。

### 2.3 为什么不引入向量数据库（与 KaaS 同一立场）
- 个人知识库量级（数百页）下，grepp 式全文扫描是**毫秒级**的，向量检索的收益（语义相似）在此量级完全可以用"LLM 兜底"换取。
- 引入 embedding/向量库 = 增加重依赖（镜像、模型下载、存储同步），与"轻量、不过度复杂"的取向冲突。KaaS 的自评与 CutShelter 的定位一致：**编译质量第一，检索只是薄导航**。

---

## 3. 落地内容（决策完整的改动清单）

### 3.1 后端 `WikiQueryService`
1. 新增重载 `query(question, includeClips, includeKnowledge, includeSupplement, callback)`；旧重载默认 `includeSupplement=true`（Web UI 行为不变）。
2. 阶段 2：本地 index 检索结果不足 topK 时，调用新增的正文兜底（3.2）合并补足；合并结果为空才降级 LLM。
3. 阶段 3：读页时按 `WIKI_PAGE_MAX_CHARS=8000` 截断，附 `TRUNCATION_NOTE` 标注。
4. 阶段 4.1：`includeSupplement=false` 时跳过 `generateKnowledgeSupplement`。
5. 各阶段计入 `System.currentTimeMillis()` 时长并 log（定位/综合/补充三处）。

### 3.2 后端 `WikiLocalRetriever`
- 新增 `retrieveBodyMatches(question, nameToBody, topK, minHits)`：token 化复用现有 `tokenize`，对（页面名+正文）做命中计数，按命中数倒序取 topK，minHits 门槛取 `max(1, 配置minHits-1)`（正文信号弱于摘要，门槛略降但仍有下限）。
- `WikiQueryService` 通过 `wikiPageService.listAllPages()+readPage` 构建 nameToBody（61 页毫秒级）。

### 3.3 后端 `WikiQueryController`
- `POST /api/wiki/query`：body 读取 `includeSupplement`（缺省 true）。
- `GET /api/wiki/query/stream`：新增 `includeSupplement` 请求参数（缺省 true）。

### 3.4 MCP `wiki_ask`（server.mjs）
- 新增 `includeSupplement` 参数，**默认 false**（提速优先）；`includeClips/includeKnowledge` 维持默认 false。
- 说明文档同步补一句"默认不生成知识补充，感知上比 Web UI 快约一次强模型调用"。

---

## 4. 验证方式

1. `mvn -f backend/pom.xml compile` 编译通过。
2. **重启应用**（后端为 Spring Boot，改动需重启生效）。
3. 实测对比：`node integrations/dsh/mcp-server/smoke-ask.mjs --question="WinUI 和 Fluent Design 是什么关系？"`
   - 观察点①：`usedLocalRetrieval=true`（本地 index+正文命中，应跳过 stage-1 LLM）；
   - 观察点②：无"知识补充"段（includeSupplement 默认 false）；
   - 观察点③：后端日志 `[WikiQuery] synthesizeAnswer used N ms`，单次调用应 < 之前的 112s；
   - 观察点④：正文兜底命中——构造"摘要里没有、只在正文提到"的问题，应仍能选中相关页面（body-depth 召回）。
4. Web UI（wiki.html）问答行为不变：知识补充默认仍在，SSE 思维链正常。