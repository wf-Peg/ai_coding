# Wiki 查询链路重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Wiki 查询链路：落地模型档位路由（simple/strong 两档）、本地拆词检索前置层（省阶段 1 LLM 调用）、查询多数据源开关（可纳入剪藏/知识）。

**Architecture:** 三块相互独立的后端增强 + 两块前端配置。模型档位通过 `LlmProvider` 新增默认方法 `chatForTier` 实现（现有 provider 零改动），`RoutingLlmProvider` 覆盖后按 `ModelConfig.simpleTierProvider/strongTierProvider` 路由。本地检索新增 `WikiLocalRetriever`（零依赖拆词 + index 条目打分），在 `WikiQueryService.query` 中作为 `locateRelevantPages` 的前置层，未命中自动降级 LLM。多数据源通过 `WikiQueryService` 注入 `SearchService`/`KnowledgeService` 检索剪藏/知识并拼入上下文，`synthesizeAnswer` 无需改动。

**Tech Stack:** Java 17 / Spring Boot / Jackson / 原生 JS（无构建步骤）/ Maven

**Spec:** [`.trae/specs/wiki-query-refactor/spec.md`](../../.trae/specs/wiki-query-refactor/spec.md)

---

### Task 1: ModelConfig + AppConfig 增加档位字段

**Files:**
- Modify: `backend/src/main/java/com/example/clip/core/ModelConfig.java`
- Modify: `backend/src/main/java/com/example/clip/config/AppConfig.java`

- [ ] **Step 1: ModelConfig 增加两个档位字段**

在 `ModelConfig.java` 的 `pdfOcrMinTextLength` 字段后追加：

```java
    // 任务档位路由：simple=便宜模型（结构化/定位/抽取），strong=强模型（综合/矛盾判断）
    private String simpleTierProvider = "deepseek";
    private String strongTierProvider = "dashscope";
```

并为两个字段生成 getter/setter（与现有字段一致的 JavaBean 风格，IDE 生成或手写）：

```java
    public String getSimpleTierProvider() {
        return simpleTierProvider;
    }

    public void setSimpleTierProvider(String simpleTierProvider) {
        this.simpleTierProvider = simpleTierProvider;
    }

    public String getStrongTierProvider() {
        return strongTierProvider;
    }

    public void setStrongTierProvider(String strongTierProvider) {
        this.strongTierProvider = strongTierProvider;
    }
```

- [ ] **Step 2: AppConfig 增加同名两个字段 + getter/setter**

在 `AppConfig.java` 中找到 PDF OCR 字段（`pdfOcrMinTextLength` 附近），追加：

```java
    private String simpleTierProvider = "deepseek";
    private String strongTierProvider = "dashscope";
```

并为它们生成 getter/setter（`getSimpleTierProvider` / `setSimpleTierProvider` / `getStrongTierProvider` / `setStrongTierProvider`）。

- [ ] **Step 3: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS，无编译错误

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/example/clip/core/ModelConfig.java backend/src/main/java/com/example/clip/config/AppConfig.java
git commit -m "feat(model): add simple/strong tier provider config fields"
```

---

### Task 2: AppConfigService 同步档位字段到 ModelConfig

**Files:**
- Modify: `backend/src/main/java/com/example/clip/service/AppConfigService.java:211-235`

- [ ] **Step 1: syncToModelConfig 追加两个字段同步**

在 `AppConfigService.syncToModelConfig(AppConfig config)` 方法中，`mc.setCustomModel(config.getCustomModel());` 之后追加：

```java
            // 任务档位路由
            mc.setSimpleTierProvider(config.getSimpleTierProvider() != null
                    ? config.getSimpleTierProvider() : "deepseek");
            mc.setStrongTierProvider(config.getStrongTierProvider() != null
                    ? config.getStrongTierProvider() : "dashscope");
```

- [ ] **Step 2: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/example/clip/service/AppConfigService.java
git commit -m "feat(model): sync tier provider fields in AppConfigService"
```

---

### Task 3: LlmProvider 接口 + RoutingLlmProvider 档位路由

**Files:**
- Modify: `backend/src/main/java/com/example/clip/core/LlmProvider.java`
- Modify: `backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java`

- [ ] **Step 1: LlmProvider 新增默认方法 chatForTier**

在 `LlmProvider.java` 的 `chat(...)` 方法之后、`streamChat(...)` 之前插入：

```java
    /**
     * 按任务档位调用 LLM。
     * <p>
     * 默认实现忽略档位直接调用 {@link #chat(String, String)}；
     * 路由实现（如 RoutingLlmProvider）根据档位选择对应模型。
     * </p>
     *
     * @param systemPrompt 系统提示词
     * @param userMessage  用户消息
     * @param tier         任务档位："simple"（便宜模型）或 "strong"（强模型）
     * @return 模型生成的文本回复
     */
    default String chatForTier(String systemPrompt, String userMessage, String tier) {
        return chat(systemPrompt, userMessage);
    }
```

- [ ] **Step 2: RoutingLlmProvider 新增 getProviderByTier 并覆盖 chatForTier**

在 `RoutingLlmProvider.java` 中 `getActiveProvider()` 方法之后新增：

```java
    /**
     * 根据任务档位解析 provider key，返回对应 provider（不存在/不可用时回退 activeProvider 链路）。
     */
    private LlmProvider getProviderByTier(String tier) {
        ModelConfig config = modelConfigService.getConfig();
        if (config != null) {
            String providerKey = null;
            if ("simple".equalsIgnoreCase(tier)) {
                providerKey = config.getSimpleTierProvider();
            } else if ("strong".equalsIgnoreCase(tier)) {
                providerKey = config.getStrongTierProvider();
            }
            LlmProvider provider = resolveProvider(providerKey);
            if (provider != null) {
                return provider;
            }
        }
        return getActiveProvider();
    }

    private LlmProvider resolveProvider(String providerKey) {
        if (providerKey == null || providerKey.isEmpty()) {
            return null;
        }
        switch (providerKey.toLowerCase()) {
            case "custom":
                return customProvider;
            case "deepseek":
                return deepSeekProvider;
            case "dashscope":
                return dashScopeProvider;
            default:
                return null;
        }
    }

    @Override
    public String chatForTier(String systemPrompt, String userMessage, String tier) {
        LlmProvider provider = getProviderByTier(tier);
        logger.debug("[LLM] Routing tier={} to {}", tier, provider.getProviderName());
        return chatWithFallback(provider, systemPrompt, userMessage);
    }
```

注意：`chatWithFallback` 的降级链（`getFallbackProvider`）保持不变——档位 provider 不可用时先走该 provider 的 fallback 链，链中断才回退 `getActiveProvider()`。这与现有行为一致，仅新增档位选择入口。

- [ ] **Step 3: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 4: 运行现有路由测试确认不回归**

Run: `cd backend; mvn test -q -Dtest=RoutingLlmProviderTest,RoutingLlmProviderCustomTest`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/example/clip/core/LlmProvider.java backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java
git commit -m "feat(llm): add tier-based model routing"
```

---

### Task 4: AiService 的 8 个 Wiki 方法标注档位

**Files:**
- Modify: `backend/src/main/java/com/example/clip/core/AiService.java`

- [ ] **Step 1: 8 处 chat 调用改为 chatForTier 并标注档位**

逐处替换（行号为当前文件行号）：

| 位置 | 原文 | 改为 | 档位 |
|---|---|---|---|
| L739 | `String response = llmProvider.chat(systemPrompt, userMessage.toString());` | `llmProvider.chatForTier(systemPrompt, userMessage.toString(), "simple")` | simple |
| L778 | `return llmProvider.chat(systemPrompt, userMessage.toString());` | `return llmProvider.chatForTier(systemPrompt, userMessage.toString(), "simple");` | simple |
| L811 | `return llmProvider.chat(systemPrompt, userMessage.toString());` | `return llmProvider.chatForTier(systemPrompt, userMessage.toString(), "simple");` | simple |
| L834 | `return llmProvider.chat(systemPrompt, userMessage.toString());` | `return llmProvider.chatForTier(systemPrompt, userMessage.toString(), "simple");` | simple |
| L865 | `String response = llmProvider.chat(systemPrompt, userMessage.toString());` | `String response = llmProvider.chatForTier(systemPrompt, userMessage.toString(), "strong");` | strong |
| L902 | `String response = llmProvider.chat(systemPrompt, userMessage);` | `String response = llmProvider.chatForTier(systemPrompt, userMessage, "simple");` | simple |
| L944 | `return llmProvider.chat(systemPrompt, userMessage.toString());` | `return llmProvider.chatForTier(systemPrompt, userMessage.toString(), "strong");` | strong |
| L988 | `String response = llmProvider.chat(systemPrompt, userMessage.toString());` | `String response = llmProvider.chatForTier(systemPrompt, userMessage.toString(), "simple");` | simple |

- [ ] **Step 2: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/example/clip/core/AiService.java
git commit -m "feat(wiki): mark wiki AI methods with task tiers"
```

---

### Task 5: WikiConfig 新增配置 + WikiLocalRetriever 新增

**Files:**
- Modify: `backend/src/main/java/com/example/clip/config/WikiConfig.java`
- Create: `backend/src/main/java/com/example/clip/service/wiki/WikiLocalRetriever.java`

- [ ] **Step 1: WikiConfig 追加 7 个配置字段 + getter/setter**

在 `WikiConfig.java` 现有字段后追加（含 R2 本地检索与 R3 多数据源两组）：

```java
    // ---- R2 本地拆词检索 ----
    private boolean queryLocalRetrievalEnabled = true;
    private int queryLocalRetrievalTopK = 5;
    private int queryLocalRetrievalMinHits = 2;

    // ---- R3 查询多数据源 ----
    private boolean queryIncludeClips = false;
    private boolean queryIncludeKnowledge = false;
    private int queryExtraTopK = 5;
    private int queryExtraMaxChars = 800;
```

并为全部 7 个字段生成 getter/setter（与现有字段一致的 JavaBean 风格）。

- [ ] **Step 2: 创建 WikiLocalRetriever**

新建 `backend/src/main/java/com/example/clip/service/wiki/WikiLocalRetriever.java`：

```java
package com.example.clip.service.wiki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 本地拆词检索器：对 wiki/index.md 条目做关键词打分，替代/前置 LLM 定位。
 * <p>
 * 零依赖实现：英文按空白拆词，中文连续 CJK 段按 2-gram 切分。
 * 打分规则：question 的每个 token 在（页面名 + 摘要）中命中即计 1 分；
 * 达标条件：命中 token 数 ≥ minHits；按命中数倒序取 Top K。
 * </p>
 */
@Component
public class WikiLocalRetriever {

    private static final Logger log = LoggerFactory.getLogger(WikiLocalRetriever.class);
    private static final Pattern INDEX_ENTRY = Pattern.compile("^- \\[\\[(.+?)\\]\\] — (.+?) \\(updated: .+?\\)$", Pattern.MULTILINE);
    private static final Pattern CJK_SEGMENT = Pattern.compile("[\\u4e00-\\u9fa5]+");

    /** 拆词：英文按空白拆分并小写；中文连续 CJK 段按 2-gram 切分。 */
    public List<String> tokenize(String text) {
        Set<String> tokens = new LinkedHashSet<>();
        if (text == null || text.trim().isEmpty()) {
            return new ArrayList<>(tokens);
        }
        String normalized = text.toLowerCase();
        for (String seg : normalized.split("[\\s\\p{Punct}]+")) {
            if (seg.isEmpty()) continue;
            Matcher cjkMatcher = CJK_SEGMENT.matcher(seg);
            int lastEnd = 0;
            while (cjkMatcher.find()) {
                if (cjkMatcher.start() > lastEnd) {
                    tokens.add(seg.substring(lastEnd, cjkMatcher.start()));
                }
                String cjk = cjkMatcher.group();
                if (cjk.length() >= 2) {
                    for (int i = 0; i + 2 <= cjk.length(); i++) {
                        tokens.add(cjk.substring(i, i + 2));
                    }
                }
                lastEnd = cjkMatcher.end();
            }
            if (lastEnd < seg.length()) {
                tokens.add(seg.substring(lastEnd));
            }
        }
        return new ArrayList<>(tokens);
    }

    /**
     * 对 index.md 条目打分检索。
     *
     * @param question    用户问题
     * @param indexContent wiki/index.md 全文
     * @param topK        最多返回条数
     * @param minHits     达标最小命中 token 数
     * @return 达标（≥ minHits）页面名列表，按命中数倒序；未达标返回空列表
     */
    public List<String> retrieve(String question, String indexContent, int topK, int minHits) {
        List<String> queryTokens = tokenize(question);
        if (queryTokens.isEmpty() || indexContent == null || indexContent.isEmpty()) {
            return List.of();
        }
        List<ScoredEntry> scored = new ArrayList<>();
        Matcher matcher = INDEX_ENTRY.matcher(indexContent);
        while (matcher.find()) {
            String pageName = matcher.group(1);
            String summary = matcher.group(2);
            String haystack = (pageName + " " + summary).toLowerCase();
            int hits = 0;
            for (String token : queryTokens) {
                if (token.length() < 2) continue;
                if (haystack.contains(token)) {
                    hits++;
                }
            }
            if (hits > 0) {
                scored.add(new ScoredEntry(pageName, hits));
            }
        }
        scored.sort(Comparator.comparingInt(ScoredEntry::hits).reversed());
        List<String> result = new ArrayList<>();
        for (ScoredEntry entry : scored) {
            if (entry.hits() < minHits) break;
            result.add(entry.pageName());
            if (result.size() >= topK) break;
        }
        if (!result.isEmpty()) {
            log.debug("[WikiLocalRetriever] Retrieved {} pages (minHits={}, topK={})",
                    result.size(), minHits, topK);
        }
        return result;
    }

    private record ScoredEntry(String pageName, int hits) {}
}
```

- [ ] **Step 3: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/example/clip/config/WikiConfig.java backend/src/main/java/com/example/clip/service/wiki/WikiLocalRetriever.java
git commit -m "feat(wiki): add local token retrieval pre-layer"
```

---

### Task 6: WikiQueryService 集成本地检索 + 多数据源

**Files:**
- Modify: `backend/src/main/java/com/example/clip/service/wiki/WikiQueryService.java`

- [ ] **Step 1: 注入新依赖**

在 `WikiQueryService` 的类字段区（现有 `WikiConfig wikiConfig` 之后）追加：

```java
    private final SearchService searchService;
    private final KnowledgeService knowledgeService;
    private final WikiLocalRetriever wikiLocalRetriever;
```

并更新构造器签名（在现有参数末尾追加三个参数并赋值）：
- `SearchService searchService` → `this.searchService = searchService;`
- `KnowledgeService knowledgeService` → `this.knowledgeService = knowledgeService;`
- `WikiLocalRetriever wikiLocalRetriever` → `this.wikiLocalRetriever = wikiLocalRetriever;`

新增 import：`com.example.clip.service.SearchService`、`com.example.clip.service.KnowledgeService`。

- [ ] **Step 2: query 签名增加两个可选参数**

将 `public Map<String, Object> query(String question)` 改为：

```java
    public Map<String, Object> query(String question, boolean includeClips, boolean includeKnowledge) {
```

并保留一个兼容入口（供未传参数的调用方）：

```java
    public Map<String, Object> query(String question) {
        WikiConfig config = wikiConfig;
        return query(question,
                config != null && config.isQueryIncludeClips(),
                config != null && config.isQueryIncludeKnowledge());
    }
```

- [ ] **Step 3: 阶段 2 替换为"本地检索优先 + LLM 兜底"**

将 query 主流程中的：

```java
            // 2. 调用便宜模型定位相关页面
            List<String> relevantPageNames = aiService.locateRelevantPages(question, indexContent);
            log.info("[WikiQuery] Located {} relevant pages for question", relevantPageNames.size());
```

替换为：

```java
            // 2. 定位相关页面：本地拆词检索优先，未命中降级 LLM
            List<String> relevantPageNames;
            boolean usedLocalRetrieval = false;
            if (wikiConfig != null && wikiConfig.isQueryLocalRetrievalEnabled()) {
                List<String> localPages = wikiLocalRetriever.retrieve(question, indexContent,
                        wikiConfig.getQueryLocalRetrievalTopK(),
                        wikiConfig.getQueryLocalRetrievalMinHits());
                if (!localPages.isEmpty()) {
                    relevantPageNames = localPages;
                    usedLocalRetrieval = true;
                    log.info("[WikiQuery] Local retrieval located {} pages (skip LLM stage-1)", localPages.size());
                } else {
                    relevantPageNames = aiService.locateRelevantPages(question, indexContent);
                }
            } else {
                relevantPageNames = aiService.locateRelevantPages(question, indexContent);
            }
            log.info("[WikiQuery] Located {} relevant pages for question", relevantPageNames.size());
```

- [ ] **Step 4: 阶段 3.5 纳入剪藏/知识**

在读取 wiki 页面内容的循环之后（`pageContents` 填充完成后）、`synthesizeAnswer` 调用之前插入：

```java
            // 3.5 可选：纳入应用内剪藏与知识条目
            int clipCount = 0;
            int knowledgeCount = 0;
            if (includeClips || includeKnowledge) {
                int extraTopK = wikiConfig != null ? wikiConfig.getQueryExtraTopK() : 5;
                int extraMaxChars = wikiConfig != null ? wikiConfig.getQueryExtraMaxChars() : 800;
                if (includeClips) {
                    try {
                        List<ClipContent> clips = searchService.search(question, extraTopK);
                        for (ClipContent clip : clips) {
                            String title = clip.getTitle() != null ? clip.getTitle() : ("clip-" + clip.getId());
                            String snippet = buildExtraSnippet(clip.getSummary(), extraMaxChars);
                            if (snippet == null || snippet.isEmpty()) {
                                snippet = buildExtraSnippet(clip.getContent(), extraMaxChars);
                            }
                            pageContents.put("[剪藏] " + title, snippet);
                            clipCount++;
                        }
                    } catch (Exception e) {
                        log.warn("[WikiQuery] Clip search failed: {}", e.getMessage());
                    }
                }
                if (includeKnowledge) {
                    try {
                        List<Knowledge> knowledges = knowledgeService.searchKnowledge(question, null);
                        int taken = 0;
                        for (Knowledge k : knowledges) {
                            if (taken >= extraTopK) break;
                            String title = k.getTitle() != null ? k.getTitle() : ("knowledge-" + k.getId());
                            String snippet = buildExtraSnippet(k.getSummary(), extraMaxChars);
                            if (snippet == null || snippet.isEmpty()) {
                                snippet = buildExtraSnippet(k.getContent(), extraMaxChars);
                            }
                            pageContents.put("[知识] " + title, snippet);
                            knowledgeCount++;
                            taken++;
                        }
                    } catch (Exception e) {
                        log.warn("[WikiQuery] Knowledge search failed: {}", e.getMessage());
                    }
                }
                log.info("[WikiQuery] Extra sources: {} clips, {} knowledges included", clipCount, knowledgeCount);
            }
```

并新增私有辅助方法（放在 `estimateTokens` 附近）：

```java
    private String buildExtraSnippet(String text, int maxChars) {
        if (text == null) return "";
        String cleaned = text.replaceAll("\\s+", " ").trim();
        if (cleaned.length() <= maxChars) return cleaned;
        return cleaned.substring(0, maxChars) + "...";
    }
```

新增 import：`com.example.clip.model.ClipContent`、`com.example.clip.model.Knowledge`、`java.util.List`（若未引入）。

- [ ] **Step 5: 返回结构增加 usedLocalRetrieval 与 extraSources**

在 query 的 result.put 区块，`result.put("message", ...)` 之前追加：

```java
            result.put("usedLocalRetrieval", usedLocalRetrieval);
            Map<String, Object> extraSources = new LinkedHashMap<>();
            extraSources.put("clips", clipCount);
            extraSources.put("knowledge", knowledgeCount);
            result.put("extraSources", extraSources);
```

- [ ] **Step 6: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS（若 KnowledgeService/SearchService 有未解析 import 或构造器冲突，按编译错误修正）

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/com/example/clip/service/wiki/WikiQueryService.java
git commit -m "feat(wiki): local retrieval pre-layer and multi-source query"
```

---

### Task 7: WikiQueryController 透传请求参数

**Files:**
- Modify: `backend/src/main/java/com/example/clip/controller/WikiQueryController.java:73-79`

- [ ] **Step 1: query 接口解析 includeClips / includeKnowledge**

将 `query` 方法体改为：

```java
    @PostMapping("/query")
    public ResponseEntity<Map<String, Object>> query(@RequestBody Map<String, Object> body) {
        String question = body != null ? (String) body.get("question") : null;
        log.info("[WikiQuery] Query request received");
        boolean includeClips = body != null && Boolean.TRUE.equals(body.get("includeClips"));
        boolean includeKnowledge = body != null && Boolean.TRUE.equals(body.get("includeKnowledge"));
        Map<String, Object> result = wikiQueryService.query(question, includeClips, includeKnowledge);
        return ResponseEntity.ok(result);
    }
```

- [ ] **Step 2: 编译验证**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/example/clip/controller/WikiQueryController.java
git commit -m "feat(wiki): pass includeClips/includeKnowledge to query"
```

---

### Task 8: 前端设置页 — 档位下拉

**Files:**
- Modify: `frontend/settings.html`
- Modify: `frontend/js/settings.js`

- [ ] **Step 1: settings.html 在"当前使用模型"下拉之后新增档位区**

在 `</div>`（activeProvider 的 form-group 结束）之后、`presetGroup` 之前插入：

```html
                    <div class="form-group">
                        <label class="form-label">简单任务模型（定位 / 抽取 / 扫描）</label>
                        <select id="simpleTierProvider">
                            <option value="dashscope">阿里云 DashScope</option>
                            <option value="deepseek">DeepSeek</option>
                            <option value="custom">自定义 OpenAI 兼容</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">强任务模型（答案综合 / 矛盾判断）</label>
                        <select id="strongTierProvider">
                            <option value="dashscope">阿里云 DashScope</option>
                            <option value="deepseek">DeepSeek</option>
                            <option value="custom">自定义 OpenAI 兼容</option>
                        </select>
                    </div>
```

- [ ] **Step 2: settings.js loadConfig 填充两个下拉**

在 `loadConfig()` 的 `document.getElementById('activeProvider').value = ...` 之后追加：

```js
    document.getElementById('simpleTierProvider').value = config.simpleTierProvider || 'deepseek';
    document.getElementById('strongTierProvider').value = config.strongTierProvider || 'dashscope';
```

- [ ] **Step 3: settings.js saveConfig 保存两个下拉**

在 `saveConfig()` 收集字段的对象字面量中（`activeProvider` 附近）追加两个字段：

```js
    simpleTierProvider: document.getElementById('simpleTierProvider').value || 'deepseek',
    strongTierProvider: document.getElementById('strongTierProvider').value || 'dashscope',
```

- [ ] **Step 4: 手动验证（可选）**

启动后端 + Electron，打开设置页，确认两个下拉显示默认值（simple=DeepSeek、strong=阿里云 DashScope），保存后重开仍保持。

- [ ] **Step 5: Commit**

```bash
git add frontend/settings.html frontend/js/settings.js
git commit -m "feat(settings): add simple/strong tier model selectors"
```

---

### Task 9: 前端 wiki.html — 多数据源开关

**Files:**
- Modify: `frontend/wiki.html`

- [ ] **Step 1: 查询输入卡片加两个 checkbox**

在查询输入卡片中（`clearQueryBtn` 按钮附近）追加：

```html
                    <div style="display:flex;gap:16px;margin-top:8px;">
                        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--fg-muted);">
                            <input type="checkbox" id="includeClipsCheck"> 纳入剪藏
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--fg-muted);">
                            <input type="checkbox" id="includeKnowledgeCheck"> 纳入知识
                        </label>
                    </div>
```

- [ ] **Step 2: 查询请求体携带两个开关**

将 queryBtn 的请求体改为：

```js
                    body: JSON.stringify({
                        question: question,
                        includeClips: document.getElementById('includeClipsCheck').checked,
                        includeKnowledge: document.getElementById('includeKnowledgeCheck').checked
                    })
```

- [ ] **Step 3: 渲染 extraSources 与检索方式标注**

在 `renderQueryResult(data)` 的 metaItems 数组末尾追加两项（条件渲染，不存在时隐藏）：

```js
            if (data.usedLocalRetrieval === true) {
                metaItems.push({ label: '定位方式', value: '本地检索' });
            }
            if (data.extraSources) {
                const es = data.extraSources;
                const parts = [];
                if (es.clips > 0) parts.push('剪藏 ' + es.clips + ' 条');
                if (es.knowledge > 0) parts.push('知识 ' + es.knowledge + ' 条');
                if (parts.length > 0) metaItems.push({ label: '纳入来源', value: parts.join('、') });
            }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/wiki.html
git commit -m "feat(wiki): add multi-source toggles in query UI"
```

---

### Task 10: 全量编译 + 测试回归验证

**Files:**
- 无（验证任务）

- [ ] **Step 1: 全量编译**

Run: `cd backend; mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 2: 运行核心相关测试**

Run: `cd backend; mvn test -q -Dtest=RoutingLlmProviderTest,RoutingLlmProviderCustomTest,ModelConfigTest,ClipControllerTest`
Expected: 全部通过（如果 ClipControllerTest 依赖旧行为，检查是否因 `getAllClips` 无关改动失败）

- [ ] **Step 3: 对照 spec 自评（Self-Review）**

- [ ] R1：`LlmProvider.chatForTier` 已加默认方法；`RoutingLlmProvider` 已覆盖；`AiService` 8 处已标注档位
- [ ] R2：`WikiLocalRetriever` 已创建；`WikiQueryService` 本地优先 + LLM 兜底已集成；配置开关已加
- [ ] R3：`WikiQueryService.query` 三参签名 + 兼容重载；`WikiQueryController` 透传；`SearchService`/`KnowledgeService` 已注入
- [ ] 前端：settings 两个档位下拉 + wiki.html 两个 checkbox + extraSources 渲染
- [ ] 默认配置下行为与重构前一致（档位默认值 + 开关默认值）

- [ ] **Step 4: Commit（若上述步骤有补充修改）**

```bash
git add -A
git commit -m "fix: regression fixes from self-review"
```

---

## 自评结论（Self-Review）

**Spec 覆盖：**
- 动机 A（模型路由）→ Task 1/2/3/4/8 ✅
- 动机 B（本地检索）→ Task 5/6 ✅
- 动机 C（多数据源）→ Task 5/6/7/9 ✅
- 验收 1（档位路由）→ Task 3/4 + Task 8 前端 ✅
- 验收 2（本地命中跳过 LLM / 抽象问题降级）→ Task 6 Step 3 ✅
- 验收 3（多数据源拼入 + extraSources + 关闭无变化）→ Task 6 Step 4/5 ✅
- 验收 4（前端持久化）→ Task 8/9 ✅
- 验收 5（编译 + 测试回归）→ Task 10 ✅

**类型一致性：**
- `chatForTier(String, String, String)` 在 Task 3 定义、Task 4 调用，签名一致 ✅
- `retrieve(String, String, int, int)` 返回 `List<String>`，Task 6 使用一致 ✅
- `query(String, boolean, boolean)` 在 Task 6 定义、Task 7 调用，兼容重载保留 ✅
- 配置 getter 名 `isQueryLocalRetrievalEnabled() / isQueryIncludeClips() / isQueryIncludeKnowledge() / getQueryLocalRetrievalTopK() / getQueryLocalRetrievalMinHits() / getQueryExtraTopK() / getQueryExtraMaxChars()` 与字段命名一致（boolean 自动生成 is 前缀）✅
