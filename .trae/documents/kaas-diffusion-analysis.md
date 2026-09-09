# KaaS「先编译再检索 / 不用 embedding」思路在 CutShelter(剪藏)的发散分析

> 性质：**纯分析文档，本次不落地**。仅评审 KaaS 与 CutShelter 的共性、已对齐部分、待发散点与取舍。
> 结论先行：CutShelter 的 Wiki 子系统**已经近乎 1:1 复刻了 KaaS 的核心主张**，真正的发散点只剩少数几处（MCP `ask` 工具、编译去噪去重的工程健壮性、body-depth 召回缺口）。

---

## 1. KaaS 的核心论点（对照基准）

KaaS(`bybit-exchange/kaas`)与主流 RAG 不同，两个关键选择：

1. **先编译再检索**：不直接对原始碎片做 RAG，先用 LLM 把散乱内容编译成结构化 Markdown Wiki，再在其上检索。
2. **不用 embedding**：检索阶段无向量库、无相似度计算，把「文章目录(master-index)」连问题一起喂给 LLM，让 LLM 像翻目录一样选页、再读全文。

检索三步骤（对应 `_select_relevant`）：
```python
store = KBStore(kb_dir, read_only=True)
catalog = store.existing_articles()                                     # 1. 读 master-index 目录
selected = _select_relevant(catalog, query, model, max_select)          # 2. LLM 从目录里选页
return _read_selected(store, meta_by_path, selected)                    # 3. 读整篇全文做上下文
```

价值层：纯 Markdown 可 git、可手改、可被任意 MCP agent(`ask`)当知识源查询、部署轻、无向量重依赖、可全本地。

---

## 2. CutShelter 现状：大部分已对齐

经代码勘察，CutShelter 的 Wiki 子系统（`backend/.../service/wiki/*`）**已经是 KaaS 的落地形态**，逐条映射：

| KaaS 支柱 | CutShelter 对应实现 | 状态 |
| --- | --- | --- |
| 编译流水线 Extract→Classify→Write→Index | `BatchIngestService` + `VaultWatchService`(监控触发) + `WikiIndexService`(master `index.md` + `log.md`) + `MocGeneratorService`(每类型 MOC 目录页 + 标签云) | ✅ 已有 |
| 产出结构化 Markdown 目录 | `index.md`（页面名+摘要+更新时间，正被 `WikiLocalRetriever`/`locateRelevantPages` 解析） | ✅ 已有 |
| 读目录→LLM 选页→读全文 | `WikiQueryService.query()`：读 `index.md` → 定位页面 → 仅读选中页面 → `synthesizeAnswer`(强模型) | ✅ 已有 |
| 不用 embedding 检索 | `WikiLocalRetriever`：本地拆词打分（英文 blank 拆词 + 中文 2-gram），**无任何向量库**；未命中自动降级 `AiService.locateRelevantPages`(LLM 翻目录挑页，输出 `{"paths":[...]}` 类似 JSON 列表) | ✅ 已有（且比 KaaS 更强） |
| 模型分层(便宜/强) | `chatForTier(simple/strong)`：定位用 simple 模型、综合与知识补充用 strong 模型 | ✅ 已有 |
| 问答→归档为 Wiki 综述 | `archiveAsSynthesis()` → 写入 synthesis 类型页 + 更新 index/log | ✅ 已有 |
| Markdown 可 git、可手改 | Wiki 页面落在 vault，应用级 Git 同步(`GitService`) | ✅ 已有 |
| 用 `[[wikilink]]` 引用组织 | `[[Wiki-Link]]` 引用、反链、`buildLinkIndex`、MOC 聚合 | ✅ 已有 |

**结论：KaaS 的「编译质量第一、检索只是编译产物上的一层薄导航」这一核心思路，CutShelter 已完整落地，甚至在某些点上有超越**（本地预检层省一次 stage-1 LLM 调用、Simple/Strong 模型分层、obsidian 兼容 frontmatter、多数据源把剪藏/知识一并纳入上下文）。

---

## 3. 已实现但比 KaaS 更稳的「发散」点

1. **检索前先做本地拆词预检**（`WikiLocalRetriever`）：命中即跳过 stage-1 的 LLM「翻目录」调用，省 token 又提速；未命中再降级 LLM。KaaS 是纯 LLM 翻目录，这里 CutShelter 已经做了「能简单就不复杂」的超集。
2. **多数据源补充**：检索 `index.md` 之外，`WikiQueryService` 可按配置把应用内剪藏(`searchService`)与知识条目(`searchService.searchKnowledge`)抽取片段一并作为上下文，并带关键词兜底搜索。KaaS 只检索 Wiki 本身。
3. **失败降级链完整**：各阶段 AI 调用失败都返回有意义的降级结果（`status=error + message`），不抛异常打断流。
4. **SSE 思维链**：`/api/wiki/query/stream` 推送 读取索引→定位→读内容→补充→生成→完成 各阶段进度与结构化数据。

---

## 4. 真正的发散点（KaaS 有而 CutShelter 缺，本次仅记录、不落地）

以下方向在评审后值得后续单独评估（按 ROI 排序）。**本次不实现。**

### 4.1 MCP `ask` 工具（高价值、改动小、最贴合 KaaS 旗舰价值）
- **KaaS**：`@mcp.tool() def ask(query, paths=None, model=None)`，复用 chat core 跑一遍「LLM 迭代检索 → 生成带 `[Title](path)` 内联引用的答案」，供 Claude Code / Codex / openclaw 等任意 MCP agent 把 Wiki 当问答知识源。
- **CutShelter 现状**：`integrations/dsh/mcp-server/server.mjs` 已暴露 `clip_search` / `clip_list` / `clip_add` / `wiki_index`(仅返回原始 `index.md`) 等工具，**但没有暴露「两步检索+综合」的问答工具**。
- **发散方向**：新增 `wiki_ask` 工具 → `POST /api/wiki/query`（请求/响应式，天然契合 MCP `tools/call`），返回 Markdown 答案 + `relevantPages` 引用。不必像 KaaS 用 collector 聚合 SSE——直接走非流式 `query()` 即可，改动集中在 `server.mjs` 加一个 tool + 复用已有 REST。
- **取舍**：无。

### 4.2 编译健壮性去噪去重（工程性，需先确认现状分组方式）
- **KaaS**：强调两处工程难点——① 单个 LLM 调用卡死不能拖垮整批（per-call timeout）；② 并行分组不能各自「发明」同名文章（去重）。
- **CutShelter 现状**：`BatchIngestService` 中未检索到 `timeout` / `ThreadPool` / `dedupe` / `duplicate` / `semaphore` 等关键词，需进一步确认它是否已通过「classify→挂到已有页 vs 新建」天然规避了同名页发明问题，以及是否有单调用超时兜底。
- **发散方向**：若缺，可为 LLM 调用加超时/并发上限，并在写入前做同名归并。**改动中、风险中**，需先读 `BatchIngestService` 全文再做判断。

### 4.3 body-depth 召回缺口 / master-index 膨胀（KaaS 自认的短板，CutShelter 同受制约）
- **KaaS 自认**：只靠目录摘要导航，正文深处的知识点如果没进标题/摘要就选不到。并有一线风险：目录随文章量增长而膨胀（简略→查不到，详细→prompt 巨大）——这正是 v2ex 回帖者 imdoge(#7) 指出的点。
- **CutShelter 现状**：`index.md` 同样只含页面名+摘要；本地预检层也只扫 index 摘要，正文召回同样存在缺口。但 CutShelter 另有 `electron/sqlite/indexer.js` 为剪藏建了 SQLite FTS 索引——可作为「轻量正文召回」的现成思路（`/api/wiki` 侧是否复用取决于后续评估）。
- **发散方向（偏研究）**：目录保持紧凑供 LLM 导航，另维护一个针对**全文正文**的轻量 FTS/词索引作 body-depth 兜底，弥补「标题摘要没体现正文深处」的召回。**改动大、需评估价值**，明显与「做核心好用、不过度复杂」偏好冲突，暂缓。

---

## 5. 对 v2ex 评论区争议点的就地回应（供评审参考）

1. **不会巨慢吗？** CutShelter 已用「本地拆词预检省一次 LLM 调用」缓解 stage-1 延迟；综合仍走强模型一次。
2. **有没有 benchmark？** KaaS 无公开 benchmark，CutShelter 亦无。现有证据只有 `tokenEstimate`/`inputChars`/`outputChars` 就地估算，无对照实验——若日后想证明「编译后检索 vs 原始 RAG」，需另设评测。
3. **百万级文档 index.md 会不会爆上下文？** 是真实上限（见 4.3）。CutShelter 目前定位是个人知识库，量级远低于此；索引随规模线性膨胀是保留项的取舍。
4. **和 KG 有无本质区别？** KaaS 与 CutShelter 的「分类+实体/概念/综述页面+MOC」事实上已具轻量知识图谱形态（`GraphService` 建实体关系反链），但未用到图遍历作检索主路径——这是「资料整理归档」与「图推理问答」的定位差异，不必强求。

---

## 6. 本次结论与后续建议（不落地）

1. CutShelter 与 KaaS 的核心哲学已对齐，**无需重做架构**。
2. 最有价值的单点补强是 **MCP `wiki_ask` 工具**（让任意 agent 可问答 Wiki），改动小、ROI 高，可作为下一个试探方向。
3. 编译健壮性与 body-depth 召回属「已知取舍」，除非出现实际卡顿/召回不中再逐项评估，不宜提前投入。

> 本档为记录与评审材料，本次不做代码改动。