# MCP `wiki_ask` 接入说明 + 系统内化设计评估

> 日期：2026-09-09
> 模块：DSH / 任意 MCP agent 接入剪藏知识库 Wiki 问答
> 关联：`integrations/dsh/mcp-server/server.mjs`、后端 `WikiQueryService`、前端 `wiki.html`

---

## 一、大白话：这是什么

剪藏里有一套「先编译再检索、不用向量库」的 Wiki 问答（参考 KaaS 思路）：
把散乱的剪藏/文档先用 AI 编译成一页页结构化的 Markdown Wiki，提问时先翻目录定位相关页面、再读整页综合出带 `[[Wiki-Link]]` 引用的答案。

之前这套问答只有**应用内的一个页面**（工具中心 → Wiki）能用。
这次加了个 MCP 工具 `wiki_ask`，让**外面的 AI 助手（DSH、Claude Code、Codex 等）也能直接问你的知识库**——不需要人工去剪藏页面里查，跟 KaaS 的招牌能力对齐。

一句话：**同一个问答能力，从"只能在自己页面里用"变成"任何 AI 助手都能调"**。

---

## 二、新工具：`wiki_ask`

在现有 MCP bridge（`integrations/dsh/mcp-server/server.mjs`）中新增，注册名为 `mcp__cut_shelter__wiki_ask`（agent 侧具体前缀依接入方式而定）。

| 项 | 说明 |
| --- | --- |
| 用途 | 把 Wiki 当问答知识源做综合检索问答：index 目录定位 → 读相关页面 → 强模型综合成 Markdown 答案（含 `[[Wiki-Link]]` 引用、可选知识补充）。 |
| 与 `clip_search` 区别 | `clip_search` 只做关键词匹配返回剪藏列表；`wiki_ask` 是基于**编译后的结构化 Wiki** 的语义问答，带综合答案。 |
| 与 `wiki_index` 区别 | `wiki_index` 只返回原始 `index.md` 目录；`wiki_ask` 走完整两步检索+综合。 |

**入参（inputSchema）**

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `question` | 是 | — | 自然语言问题 |
| `includeClips` | 否 | false | 是否把应用内剪藏内容作为补充上下文纳入 |
| `includeKnowledge` | 否 | false | 是否把知识条目作为补充上下文纳入 |

**出参（textResult 的文本 + JSON）**

- 纯文本：问题、相关页面列表、token 估算、Markdown 答案、知识补充
- JSON：`{status, relevantPages, tokenEstimate}`

实现上直接调用既有 `POST /api/wiki/query`（非流式 `query()`），复用同一 `WikiQueryService`，无需在 MCP 层重复实现检索逻辑（同 KaaS 的 `ask` 复用 chat core）。

---

## 三、如何让 AI 助手接入

前提：剪藏后端在 `127.0.0.1:8081` 运行（默认）；MCP server 入口为 `integrations/dsh/mcp-server/server.mjs`（stdio transport）。

### 3.1 DSH（剪藏内置 agent）
DSH 通过 npx / 本地 mcp-client spawn 该 server，具体技能表登记路径可参考现有工具登记。确认技能表列出 `wiki_ask` 即可被 DSH 调用。

### 3.2 Claude Code
```bash
claude mcp add cut-shelter -- \
  node <剪藏项目绝对路径>/integrations/dsh/mcp-server/server.mjs
```
默认走 `http://127.0.0.1:8081`；如后端地址不同，注入环境变量：
```bash
claude mcp add cut-shelter -- \
  env CUTSHELTER_BASE_URL=http://你的地址:8081 \
  node <剪藏项目绝对路径>/integrations/dsh/mcp-server/server.mjs
```

### 3.3 Codex CLI
```bash
codex mcp add cut-shelter -- \
  node <剪藏项目绝对路径>/integrations/dsh/mcp-server/server.mjs
```

### 3.4 其它 OpenCode / Cline 等
任何支持 stdio MCP 的客户端，都指向同一入口即可，工具名统一为 `cut-shelter`（`tools/call` 时选 `wiki_ask`）。

### 3.5 环境变量
| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CUTSHELTER_BASE_URL` | `http://127.0.0.1:8081` | 剪藏后端地址 |
| `CUTSHELTER_TIMEOUT_MS` | `60000` | 单次请求超时（wiki_ask 含 LLM 综合，按需调大，如 `120000`） |

---

## 四、验证方法

1. 语法：`node --check integrations/dsh/mcp-server/server.mjs`
2. 集成（需后端在线）：`node integrations/dsh/mcp-server/test.mjs`
   - 校验 `tools/list` 包含 `wiki_ask`
   - 对 `wiki_ask` 发空问题探针（走后端短路降级，返回文本，不耗 token）
3. 手工：在某 agent 里调用 `wiki_ask`，提问一个知识库里已编译的话题，确认返回带引用的答案。

> 注意：后端未启动时集成测试无法跑通（依赖 8081），先启动剪藏应用再测。

---

## 五、是否需要「提升在系统内」——设计评估

### 结论：**能力已内部化，无需重复内建；入口提升属可选，不建议现在做**

理由：

1. **能力早已在系统内**：`frontend/wiki.html` 已提供完整的 Wiki 综合问答 UI（`/api/wiki/query/stream`：问题输入、思维链进度、可选纳入剪藏/知识、归档综述）。MCP `wiki_ask` 只是把同一个 `WikiQueryService` 开放给外部 agent，二者共用同一套检索与 endpoints，不构成"外部有、内部没有"的缺口。
2. **内部重复入口会堆叠复杂度**：若再在编辑器 AI 聊天里塞一个"问知识库"模式，等于两个相似且互相替代的入口，违反"做核心好用、不过度复杂"的取向，还增加维护面。
3. **真正可选的提升方向（量力而行，非必须）**：
   - 把 `wiki.html` 的入口从"工具中心"提到更显眼位置（如顶栏/剪藏页浮窗），提高发现率——纯 UI 层，改动小、无架构风险。
   - 若编辑器 AI 助手(`editor-ai-chat-core`)未来想支持"问整个知识库"，届时再复用 `wiki_ask`/`/api/wiki/query`，作为可选能力接出即可；当前不做。

### 建议
- 本期：保留 `wiki.html` 为内部入口，外部用 `wiki_ask`。两者能力一致，不再新增重复入口。
- 若后续发现内部入口使用率低，再做「入口提升」的小改动，届时单独立项。

---

## 六、后续未落地项（本档记录，暂缓）

按 ROI 与「不过度复杂」取向，以下不再本次实现，仅留存备查：
- 编译流水线去噪去重（`BatchIngestService` 超时/并发上限/同名页归并）—— 出现实际卡顿或重复页后再评估。
- body-depth 召回 / `index.md` 膨胀 —— 个人知识库量级低，暂缓；真需要时再考虑 FTS 兜底。

> 到系统内化评估为止，本期落地仅为「MCP `wiki_ask` 工具」+「本说明与评估」。