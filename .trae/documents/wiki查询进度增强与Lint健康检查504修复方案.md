# Wiki 查询进度增强 + Lint 健康检查 504 修复 + 模型档位说明

## 一、摘要

针对用户反馈的三个问题：

1. **Wiki 查询进度展示不够详细**：当前思维链只显示阶段名和简单文字，缺少具体检索到的页面名称、内容摘要、数据片段等细节
2. **Lint 健康检查 504 超时**：同步 POST 请求执行时间长，前端代理 30s 超时导致 504；另外用户不清楚 Lint 有什么用
3. **模型档位使用明细**：哪些处理用了复杂模型（strong/deepseek-v4-pro），哪些是简单模型（simple/deepseek-v4-flash）

---

## 二、当前状态分析

### 2.1 Wiki 查询进度（WikiQueryService.java）

当前进度回调 `ProgressCallback` 接口只有 `onProgress(stage, message)` 两个字段，推送的内容只有：

| 阶段 | 当前 message |
|------|-------------|
| 读取索引 | 正在读取 Wiki 索引文件... |
| 定位页面 | 正在定位相关页面（本地检索优先）... / 正在调用大模型挑选相关页面... |
| 读取内容 | 正在读取 N 个相关页面内容... |
| 补充资源 | 正在纳入剪藏/知识条目... |
| 生成答案 | 大模型正在综合 N 份内容生成答案... |
| 完成 | 查询完成 |

缺少：具体检索到的页面名称、页面内容摘要片段、剪藏/知识条目具体内容、"大模型知识补充"的说明

### 2.2 Lint 健康检查（WikiLintService.java + WikiLintController.java + main.js）

- `WikiLintService.lint()` 是同步方法，扫描所有页面 + 调用 AI 检测，耗时可能 > 30s
- `WikiLintController` 只有 `POST /api/wiki/lint`（同步）和 `GET /api/wiki/lint/report`
- `electron/main.js` 第 924-925 行：`noTimeout` 只豁免了 `/api/wiki/query` 和 `/api/ai/chat/stream`，`/api/wiki/lint` 走 30s 超时

**Lint 健康检查的作用**：手动触发的 Wiki 质量扫描，检测：
- 矛盾（contradiction）：同一主题在不同页面中存在冲突描述
- 过时（stale）：页面内容与当前实际不符
- 孤儿页（orphan）：未被任何其他页面引用的孤立页面
- 缺失页（missing_page）：被其他页面引用但实际不存在的页面
- 缺失交叉引用（missing_cross_reference）：相关页面间缺少互相链接

### 2.3 模型档位（AiService.java + RoutingLlmProvider.java）

`LlmProvider` 接口定义了三种调用方式：
- `chat(systemPrompt, userMessage)` — 默认模型（无 tier 路由，走 activeProvider 的默认模型）
- `chatForTier(..., "simple")` — 便宜模型，对应 `deepseek-v4-flash`
- `chatForTier(..., "strong")` — 强模型，对应 `deepseek-v4-pro`

---

## 三、变更方案

### 3.1 Wiki 查询进度增强

#### 3.1.1 后端 — 扩展 ProgressCallback（WikiQueryService.java）

将 `ProgressCallback` 接口从单方法扩展为多方法，支持推送结构化数据：

```java
@FunctionalInterface
public interface ProgressCallback {
    void onProgress(String stage, String message);
    
    // 新增默认方法（可选实现）
    default void onData(String type, Object data) {
        // 推送结构化数据，如检索到的页面列表、内容片段等
    }
}
```

在 `query()` 方法各阶段增加详细数据推送：

- **"读取索引"阶段后**：不额外推数据
- **"定位页面"阶段后**：调用 `notifyData("relevantPages", pageNames)` 推送页面名称列表，以及 `usedLocalRetrieval` 标记
- **"读取内容"阶段中**：对每个已读取的页面，调用 `notifyData("pageContent", Map.of("pageName", name, "snippet", content.substring(0, min(200, content.length()))))` 推送页面内容片段
- **"补充资源"阶段后**：推送 `notifyData("extraSources", Map.of("clips", clipList, "knowledge", knowledgeList))` 包含每个条目的标题和摘要片段
- **"生成答案"阶段**：在调用 AI 前后增加推送，推送所有输入数据的汇总信息
- **"完成"阶段**：推送最终答案中"大模型知识补充"部分（由 AiService.synthesizeAnswer 返回时标记）

#### 3.1.2 后端 — 扩展 SSE 端点（WikiQueryController.java）

在 `queryStream` 的 callback 中，对 `onData` 回调也通过 SSE 推送：

```java
WikiQueryService.ProgressCallback callback = new WikiQueryService.ProgressCallback() {
    @Override
    public void onProgress(String stage, String message) {
        // 现有逻辑
    }
    @Override
    public void onData(String type, Object data) {
        try {
            SseEventBuilder event = SseEmitter.event()
                    .name("data")
                    .data(Map.of("type", type, "data", data));
            emitter.send(event);
        } catch (Exception e) {
            log.warn("[WikiQuery] Failed to send data event: {}", e.getMessage());
        }
    }
};
```

#### 3.1.3 前端 — 增强进度展示区（wiki.html）

在加载区下方增加详细数据展示面板：

```html
<div class="loading" id="queryLoading" style="display: none;">
    <div class="spinner"></div>
    <div id="progress-stage" style="font-weight: 600; margin-bottom: 4px;">准备查询...</div>
    <div id="progress-message" style="font-size: 0.85rem; color: var(--fg-secondary);"></div>
    <!-- 新增：详细数据面板 -->
    <div id="progress-detail" style="margin-top: 12px; max-height: 300px; overflow-y: auto; 
         border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; display: none;">
    </div>
</div>
```

在 JS 中增加 `progress-detail` 面板的更新逻辑：

```javascript
// 在 SSE progress 事件中
eventSource.addEventListener('progress', (e) => {
    // 现有逻辑不变
});

// 新增：监听 data 事件
eventSource.addEventListener('data', (e) => {
    try {
        const data = JSON.parse(e.data);
        const detailEl = document.getElementById('progress-detail');
        detailEl.style.display = 'block';
        
        if (data.type === 'relevantPages') {
            // 展示检索到的页面列表
            const pages = data.data || [];
            detailEl.innerHTML = '<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 6px;">检索到的页面：</div>'
                + pages.map(p => '<span class="page-tag" style="font-size: 0.8rem;">' + escapeHtml(p) + '</span>').join('');
        } else if (data.type === 'pageContent') {
            // 追加页面内容片段
            const item = data.data;
            detailEl.innerHTML += '<div style="margin-top: 6px; padding: 6px; background: var(--bg-secondary); border-radius: 4px; font-size: 0.8rem;">'
                + '<strong>' + escapeHtml(item.pageName) + '</strong><br>'
                + '<span style="color: var(--fg-secondary);">' + escapeHtml(item.snippet) + '</span></div>';
        } else if (data.type === 'extraSources') {
            // 展示剪藏/知识条目
            const es = data.data;
            let html = '<div style="font-weight: 600; font-size: 0.85rem; margin-top: 8px; margin-bottom: 6px;">额外来源：</div>';
            if (es.clips) es.clips.forEach(c => {
                html += '<div style="padding: 4px; font-size: 0.8rem;">📎 [剪藏] ' + escapeHtml(c.title) + ': ' + escapeHtml(c.snippet || '') + '</div>';
            });
            if (es.knowledge) es.knowledge.forEach(k => {
                html += '<div style="padding: 4px; font-size: 0.8rem;">📖 [知识] ' + escapeHtml(k.title) + ': ' + escapeHtml(k.snippet || '') + '</div>';
            });
            detailEl.innerHTML += html;
        }
    } catch (err) {
        // ignore
    }
});
```

#### 3.1.4 前端 — 结果区增加"大模型知识补充"展示

在 `query` 接口的 complete 事件中，从 `result` 中提取 `knowledgeSupplement` 字段，在结果卡下方增加展示区域：

```html
<!-- 在 resultCard 中增加 -->
<div class="card" id="knowledgeSupplementCard" style="display: none; margin-top: 16px;">
    <h2>大模型知识补充</h2>
    <div class="markdown-body" id="knowledgeSupplementBody"></div>
</div>
```

```javascript
// 在 renderQueryResult 中
if (data.knowledgeSupplement) {
    document.getElementById('knowledgeSupplementCard').style.display = 'block';
    document.getElementById('knowledgeSupplementBody').innerHTML = renderMarkdown(data.knowledgeSupplement);
}
```

后端需要在 `WikiQueryService.query()` 的 result 中增加 `knowledgeSupplement` 字段：
- 在 `synthesizeAnswer` 之后，调用 `AiService.generateKnowledgeSupplement(question, pageContents, answer)` 方法
- 该方法使用 prompt 让大模型回答"除了 Wiki 中已有的内容，还有哪些相关知识？"，生成补充内容

### 3.2 Lint 健康检查 504 修复

#### 3.2.1 后端 — WikiLintService 增加进度回调

参考 WikiQueryService 的模式，增加带 `ProgressCallback` 的 lint 重载方法：

```java
public Map<String, Object> lint(ProgressCallback callback) {
    // 在 lint 各阶段调用 notify(callback, stage, message)
    // 1. "读取页面" → "正在读取所有 Wiki 页面..."
    // 2. "加载缓存" → "正在加载上次 lint 缓存..."
    // 3. "比对变更" → "正在比对 N 个页面的变更..."
    // 4. "AI 检测" → "正在调用大模型检测 N 个变更页面..."
    // 5. "生成报告" → "正在生成 lint 报告..."
    // 6. "完成" / "失败"
}
```

#### 3.2.2 后端 — WikiLintController 增加 SSE 端点

```java
@GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter lintStream() {
    // 5 分钟超时
    SseEmitter emitter = new SseEmitter(300_000L);
    new Thread(() -> {
        try {
            WikiLintService.ProgressCallback callback = (stage, message) -> {
                emitter.send(SseEmitter.event().name("progress").data(Map.of("stage", stage, "message", message)));
            };
            Map<String, Object> result = wikiLintService.lint(callback);
            emitter.send(SseEmitter.event().name("complete").data(result));
            emitter.complete();
        } catch (Exception e) {
            try { emitter.send(SseEmitter.event().name("error").data(Map.of("message", e.getMessage()))); } catch (Exception ignored) {}
            emitter.completeWithError(e);
        }
    }).start();
    return emitter;
}
```

#### 3.2.3 前端 — 改造 Lint 按钮使用 SSE（wiki.html）

将 `runLint()` 函数从 `fetchJson` 改为 `EventSource`：

```javascript
async function runLint() {
    runLintBtn.disabled = true;
    showLoading('lintLoading');
    document.getElementById('lintResultCard').style.display = 'none';
    // 增加进度展示
    document.getElementById('lintLoading').innerHTML = `
        <div class="spinner"></div>
        <div id="lint-progress-stage" style="font-weight: 600; margin-bottom: 4px;">准备扫描...</div>
        <div id="lint-progress-message" style="font-size: 0.85rem; color: var(--fg-secondary);"></div>
    `;
    
    const eventSource = new EventSource(API_BASE + '/api/wiki/lint/stream');
    
    eventSource.addEventListener('progress', (e) => {
        try {
            const data = JSON.parse(e.data);
            document.getElementById('lint-progress-stage').textContent = data.stage || '';
            document.getElementById('lint-progress-message').textContent = data.message || '';
        } catch (err) {}
    });
    
    eventSource.addEventListener('complete', (e) => {
        eventSource.close();
        // 处理结果
    });
    
    eventSource.addEventListener('error', (e) => {
        eventSource.close();
        // 处理错误
    });
}
```

#### 3.2.4 Electron 代理 — 豁免 lint 超时（main.js）

第 924-925 行，将 `/api/wiki/lint` 加入豁免列表：

```javascript
const isAiStream = urlPath.startsWith('/api/ai/chat/stream');
const isWikiQuery = urlPath.startsWith('/api/wiki/query');
const isWikiLint = urlPath.startsWith('/api/wiki/lint');
const noTimeout = isAiStream || isWikiQuery || isWikiLint;
```

### 3.3 模型档位使用明细

#### 后端代码变更：AiService 中所有 `chat()` 调用逐步迁移为 `chatForTier`

当前调用分布：

| 方法 | 当前调用 | 建议档位 | 说明 |
|------|---------|---------|------|
| `processClipContent()` | `chat()` | `"simple"` | 碎片内容处理，简单任务 |
| `analyzeContent()` | `chat()` | `"simple"` | 内容分析 |
| `generateSummary()` | `chat()` | `"simple"` | 生成摘要 |
| `generateTags()` | `chat()` | `"simple"` | 生成标签 |
| `smartOrganize()` | `chat()` | `"simple"` | 智能整理 |
| `generateDivergentSummary()` | `chat()` | `"simple"` | 发散性总结 |
| `organizeContentForKnowledgeBase()` | `chat()` | `"simple"` | 知识库整理 |
| `generateSynonyms()` | `chat()` | `"simple"` | 同义词生成 |
| `extractKnowledgePoints()` | `chat()` | `"simple"` | 知识点提取 |
| `batchExtractEntitiesAndConcepts()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 | 批量实体/概念提取 |
| `generateEntityPage()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 |
| `generateConceptPage()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 |
| `generateSourcePage()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 |
| `detectContradiction()` | `chatForTier(..., "strong")` | `"strong"` 保持不变 |
| `locateRelevantPages()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 |
| `synthesizeAnswer()` | `chatForTier(..., "strong")` | `"strong"` 保持不变 |
| `lintWikiPages()` | `chatForTier(..., "simple")` | `"simple"` 保持不变 |
| `parsePasswordInfo()` | `chat()` | `"simple"` | 密码解析 |
| `synthesizeKnowledgeContent()` | `chat()` | `"simple"` | 知识内容综合 |
| `identifyIntent()` | `chat()` | `"simple"` | 意图识别 |
| `extractFields()` | `chat()` | `"simple"` | 字段提取 |

**变更**：将 `chat()` 改为 `chatForTier(..., "simple")`，确保所有调用都走 tier 路由。

**不需要改动**：`detectContradiction` 和 `synthesizeAnswer` 已使用 `"strong"`，保持不变。

---

## 四、依赖与风险

- **Wiki 查询进度增强**：进度回调扩展不影响现有同步查询 API，向后兼容
- **Lint SSE 端点**：新增端点，不影响原有同步 `POST /api/wiki/lint` 接口
- **Electron 代理修改**：只新增豁免，不影响现有代理逻辑
- **chat() 迁移**：`chat()` 和 `chatForTier(..., "simple")` 在 RoutingLlmProvider 中走不同路径，迁移后确保 `simple` 档位映射到正确的模型名

---

## 五、验证步骤

1. **Wiki 查询进度**：打开 wiki.html → 输入问题 → 点击查询 → 观察思维链展示区是否显示检索到的页面名称、内容片段、额外来源等详细信息
2. **Lint 健康检查**：点击"运行健康检查" → 观察是否显示实时进度 → 确认不再出现 504 错误 → 查看 lint-report.md 内容
3. **模型档位**：在后端日志中搜索 `[LLM] Routing tier=` 确认各请求的 tier 参数正确