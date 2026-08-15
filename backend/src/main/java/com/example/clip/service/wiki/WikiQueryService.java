package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.model.Knowledge;
import com.example.clip.service.KnowledgeService;
import com.example.clip.service.SearchService;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Wiki 综合查询服务 —— 两步查询流程的核心。
 * <p>
 * 通过 "index 定位 → 页面综合" 的两步策略，在保证答案质量的同时尽量节省 Token：
 * </p>
 *
 * <h3>查询流程</h3>
 * <ol>
 *   <li><b>读取索引</b>：通过 {@link WikiIndexService#getIndexPath()} 读取 wiki/index.md 内容</li>
 *   <li><b>定位相关页面</b>：调用 {@link AiService#locateRelevantPages}（便宜模型）
 *       从 index 中挑选最多 5 个与问题相关的页面名</li>
 *   <li><b>读取相关页面</b>：仅读取上一步返回的页面（非全量扫描），
 *       按 entity → concept → synthesis → source 顺序查找存在页面</li>
 *   <li><b>综合答案</b>：调用 {@link AiService#synthesizeAnswer}（强模型）综合生成 Markdown 答案，
 *       答案中包含 [[Wiki-Link]] 引用</li>
 *   <li><b>Token 估算</b>：粗略估算输入/输出 Token 消耗（字符数 / 4）</li>
 * </ol>
 *
 * <h3>归档流程</h3>
 * <p>
 * 调用 {@link #archiveAsSynthesis} 将一次查询的答案归档为 synthesis 类型页面，
 * 复用 {@link ObsidianExportFormatter} 生成 frontmatter，并更新 index.md 与 log.md。
 * </p>
 *
 * <h3>失败降级</h3>
 * <p>
 * 所有 AI 调用失败时返回有意义的降级结果（status=error + message），不抛异常中断流程。
 * 本服务不依赖 {@code BatchIngestService}，保持低耦合。
 * </p>
 */
@Service
public class WikiQueryService {

    private static final Logger log = LoggerFactory.getLogger(WikiQueryService.class);

    /** 归档摘要截取长度 */
    private static final int ARCHIVE_SUMMARY_MAX_LEN = 50;

    /** 页面查找顺序：entity → concept → synthesis → source */
    private static final List<String> PAGE_TYPE_LOOKUP_ORDER =
            List.of("entity", "concept", "synthesis", "source");

    private final AiService aiService;
    private final WikiPageService wikiPageService;
    private final WikiIndexService wikiIndexService;
    private final ObsidianExportFormatter obsidianExportFormatter;
    private final WikiConfig wikiConfig;
    private final SearchService searchService;
    private final KnowledgeService knowledgeService;
    private final WikiLocalRetriever wikiLocalRetriever;

    /**
     * 构造器注入。
     *
     * @param aiService               AI 服务（index 定位 + 答案综合）
     * @param wikiPageService         Wiki 页面 CRUD
     * @param wikiIndexService        索引与日志维护
     * @param obsidianExportFormatter Obsidian 格式化（frontmatter）
     * @param wikiConfig              Wiki 配置
     * @param searchService           剪藏检索（多数据源查询用）
     * @param knowledgeService        知识条目检索（多数据源查询用）
     * @param wikiLocalRetriever      本地拆词检索器（阶段 1 前置层）
     */
    public WikiQueryService(AiService aiService,
                            WikiPageService wikiPageService,
                            WikiIndexService wikiIndexService,
                            ObsidianExportFormatter obsidianExportFormatter,
                            WikiConfig wikiConfig,
                            SearchService searchService,
                            KnowledgeService knowledgeService,
                            WikiLocalRetriever wikiLocalRetriever) {
        this.aiService = aiService;
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.obsidianExportFormatter = obsidianExportFormatter;
        this.wikiConfig = wikiConfig;
        this.searchService = searchService;
        this.knowledgeService = knowledgeService;
        this.wikiLocalRetriever = wikiLocalRetriever;
    }

    /**
     * 执行 Wiki 综合查询（使用配置默认的多数据源开关）。
     *
     * @param question 用户问题
     * @return 查询结果 Map：status / answer / relevantPages / tokenEstimate / message
     */
    public Map<String, Object> query(String question) {
        return query(question,
                wikiConfig != null && wikiConfig.isQueryIncludeClips(),
                wikiConfig != null && wikiConfig.isQueryIncludeKnowledge());
    }

    /**
     * 执行 Wiki 综合查询。
     * <p>
     * 两步流程：index 定位（本地拆词优先，LLM 兜底）→ 仅读取相关页面 →
     * 可选纳入剪藏/知识 → 综合生成答案 → 估算 Token 消耗。
     * 失败时降级返回 {@code {status: "error", message: ...}}。
     * </p>
     *
     * @param question         用户问题
     * @param includeClips     是否纳入应用内剪藏内容
     * @param includeKnowledge 是否纳入知识条目内容
     * @return 查询结果 Map：status / answer / relevantPages / tokenEstimate / message
     */
    public Map<String, Object> query(String question, boolean includeClips, boolean includeKnowledge) {
        return query(question, includeClips, includeKnowledge, null);
    }

    /**
     * 执行 Wiki 综合查询（带进度回调）。
     * <p>
     * 与 {@link #query(String, boolean, boolean)} 语义一致，但在查询的各个阶段
     * （读取索引、定位页面、读取内容、补充资源、生成答案）通过 {@link ProgressCallback}
     * 向前端推送实时进度，便于展示"思维链"式的执行过程。
     * </p>
     *
     * @param question         用户问题
     * @param includeClips     是否纳入应用内剪藏内容
     * @param includeKnowledge 是否纳入知识条目内容
     * @param callback         进度回调；可为 null（此时不推送）
     * @return 查询结果 Map：status / answer / relevantPages / tokenEstimate / message
     */
    public Map<String, Object> query(String question, boolean includeClips, boolean includeKnowledge,
                                     ProgressCallback callback) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (question == null || question.trim().isEmpty()) {
            result.put("status", "error");
            result.put("message", "Question must not be empty");
            return result;
        }

        // 确保 Wiki 目录结构存在
        wikiPageService.initWikiStructure();

        try {
            // 1. 读取 index.md
            notify(callback, "读取索引", "正在读取 Wiki 索引文件...");
            Path indexPath = wikiIndexService.getIndexPath();
            String indexContent = wikiPageService.readPage(indexPath);
            if (indexContent == null || indexContent.trim().isEmpty()) {
                indexContent = "# Wiki Index\n\n(empty)";
            }

            // 2. 定位相关页面：本地拆词检索优先，未命中降级 LLM
            notify(callback, "定位页面", "正在定位相关页面（本地检索优先）...");
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
                    notify(callback, "定位页面", "本地检索未命中，正在调用大模型挑选相关页面...");
                    relevantPageNames = aiService.locateRelevantPages(question, indexContent);
                }
            } else {
                notify(callback, "定位页面", "正在调用大模型挑选相关页面...");
                relevantPageNames = aiService.locateRelevantPages(question, indexContent);
            }
            log.info("[WikiQuery] Located {} relevant pages for question", relevantPageNames.size());

            // 3. 仅读取相关页面内容（非全量扫描）
            notify(callback, "读取内容", "正在读取 " + relevantPageNames.size() + " 个相关页面内容...");
            Map<String, String> pageContents = new LinkedHashMap<>();
            for (String pageName : relevantPageNames) {
                if (pageName == null || pageName.trim().isEmpty()) {
                    continue;
                }
                String trimmedName = pageName.trim();
                Path pagePath = locatePagePath(trimmedName);
                if (pagePath == null) {
                    log.warn("[WikiQuery] Page '{}' not found in any type directory, skipping", trimmedName);
                    continue;
                }
                String content = wikiPageService.readPage(pagePath);
                if (content != null) {
                    pageContents.put(trimmedName, content);
                }
            }

            // 3.5 可选：纳入应用内剪藏与知识条目
            int clipCount = 0;
            int knowledgeCount = 0;
            if (includeClips || includeKnowledge) {
                notify(callback, "补充资源", "正在纳入剪藏/知识条目...");
                int extraTopK = wikiConfig != null ? wikiConfig.getQueryExtraTopK() : 5;
                int extraMaxChars = wikiConfig != null ? wikiConfig.getQueryExtraMaxChars() : 800;
                // 提取问题关键词，用于兜底搜索
                List<String> keywords = extractKeywords(question);
                if (includeClips) {
                    try {
                        List<ClipContent> clips = searchService.search(question, extraTopK);
                        // 若标准搜索无结果，尝试关键词拆词搜索
                        if (clips.isEmpty() && !keywords.isEmpty()) {
                            clips = searchClipsByKeywords(keywords, extraTopK);
                        }
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
                        // 若标准搜索无结果，尝试关键词拆词搜索
                        if (knowledges.isEmpty() && !keywords.isEmpty()) {
                            knowledges = searchKnowledgeByKeywords(keywords);
                        }
                        int taken = 0;
                        for (Knowledge k : knowledges) {
                            if (taken >= extraTopK) {
                                break;
                            }
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

            // 4. 调用强模型综合答案
            notify(callback, "生成答案", "大模型正在综合 " + pageContents.size() + " 份内容生成答案...");
            String answer = aiService.synthesizeAnswer(question, pageContents);

            // 5. 估算 Token 消耗（粗略：字符数 / 4）
            int inputLen = question.length() + indexContent.length()
                    + pageContents.values().stream().mapToInt(String::length).sum();
            int tokenEstimate = estimateTokens(buildInputForEstimate(question, indexContent, pageContents), answer);

            result.put("status", "success");
            result.put("answer", answer != null ? answer : "");
            result.put("relevantPages", pageContents.keySet());
            result.put("tokenEstimate", tokenEstimate);
            result.put("inputChars", inputLen);
            result.put("outputChars", answer != null ? answer.length() : 0);
            result.put("usedLocalRetrieval", usedLocalRetrieval);
            Map<String, Object> extraSources = new LinkedHashMap<>();
            extraSources.put("clips", clipCount);
            extraSources.put("knowledge", knowledgeCount);
            result.put("extraSources", extraSources);
            result.put("message", "Query completed: " + pageContents.size() + " pages used");
            notify(callback, "完成", "查询完成");
            return result;
        } catch (Exception e) {
            log.error("[WikiQuery] Query failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Query failed: " + e.getMessage());
            notify(callback, "失败", "查询失败：" + e.getMessage());
            return result;
        }
    }

    /**
     * 进度回调接口 —— 供{@link #query(String, boolean, boolean, ProgressCallback)}
     * 在查询各阶段向前端推送实时进度。
     */
    @FunctionalInterface
    public interface ProgressCallback {
        /**
         * 查询进入新阶段时回调。
         *
         * @param stage   阶段名（如"读取索引"、"生成答案"）
         * @param message 阶段说明文字
         */
        void onProgress(String stage, String message);
    }

    /**
     * 触发进度回调（回调为 null 时静默跳过）。
     *
     * @param callback 进度回调
     * @param stage    阶段名
     * @param message  阶段说明文字
     */
    private void notify(ProgressCallback callback, String stage, String message) {
        if (callback != null) {
            try {
                callback.onProgress(stage, message);
            } catch (Exception e) {
                log.warn("[WikiQuery] Progress callback failed: {}", e.getMessage());
            }
        }
    }

    /**
     * 将一次查询的答案归档为 synthesis 类型页面。
     * <p>
     * 生成 frontmatter（tags: synthesis, query-archive；category: synthesis），
     * 写入 synthesis 目录下，并更新 index.md 与 log.md。
     * </p>
     *
     * @param title  综述页标题
     * @param answer 答案内容（Markdown）
     * @return 归档结果 Map：status / pageName / message
     */
    public Map<String, Object> archiveAsSynthesis(String title, String answer) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (title == null || title.trim().isEmpty()) {
            result.put("status", "error");
            result.put("message", "Title must not be empty");
            return result;
        }
        if (answer == null) {
            answer = "";
        }

        try {
            wikiPageService.initWikiStructure();

            String name = sanitizeName(title);
            String frontmatter = obsidianExportFormatter.generateFrontmatter(
                    LocalDate.now(),
                    List.of("synthesis", "query-archive"),
                    "synthesis",
                    List.of(),
                    List.of(title),
                    "synthesis");
            String fullContent = frontmatter + answer;

            wikiPageService.createPage("synthesis", name, fullContent);

            // 更新 index（摘要截取前 50 字）
            String summary = "归档查询：" + truncate(answer.replaceAll("[\\s\\n]+", " ").trim(), ARCHIVE_SUMMARY_MAX_LEN);
            wikiIndexService.updateIndex("synthesis", name, summary, LocalDate.now().toString());

            // 追加日志
            wikiIndexService.appendLog("query-archive", title);

            result.put("status", "success");
            result.put("pageName", name);
            result.put("message", "Archived as synthesis page: " + name);
            log.info("[WikiQuery] Archived synthesis page: {}", name);
            return result;
        } catch (Exception e) {
            log.error("[WikiQuery] Archive failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Archive failed: " + e.getMessage());
            return result;
        }
    }

    /**
     * 在 entity / concept / synthesis / source 四种类型目录中依次查找存在的页面，
     * 返回首个命中的页面路径。
     *
     * @param pageName 页面名（不含扩展名）
     * @return 命中的页面路径；未找到时返回 null
     */
    private Path locatePagePath(String pageName) {
        for (String pageType : PAGE_TYPE_LOOKUP_ORDER) {
            try {
                if (wikiPageService.pageExists(pageType, pageName)) {
                    return wikiPageService.getPagePath(pageType, pageName);
                }
            } catch (Exception e) {
                log.warn("[WikiQuery] Failed to check page [{}/{}]: {}", pageType, pageName, e.getMessage());
            }
        }
        return null;
    }

    /**
     * 构建剪藏/知识条目的上下文摘要：压缩空白并截断到 maxChars 字符。
     *
     * @param text     原始内容
     * @param maxChars 最大字符数
     * @return 截断后的摘要；text 为 null 时返回空字符串
     */
    private String buildExtraSnippet(String text, int maxChars) {
        if (text == null) {
            return "";
        }
        String cleaned = text.replaceAll("\\s+", " ").trim();
        if (cleaned.length() <= maxChars) {
            return cleaned;
        }
        return cleaned.substring(0, maxChars) + "...";
    }

    /**
     * 粗略估算 Token 消耗：输入与输出字符数之和 / 4。
     *
     * @param input  输入字符串
     * @param output 输出字符串
     * @return 估算的 Token 数
     */
    private int estimateTokens(String input, String output) {
        int inputLen = input != null ? input.length() : 0;
        int outputLen = output != null ? output.length() : 0;
        return (inputLen + outputLen) / 4;
    }

    /**
     * 拼接查询的输入字符串（仅用于 Token 估算）。
     *
     * @param question     用户问题
     * @param indexContent 索引内容
     * @param pageContents 页面内容映射
     * @return 拼接后的字符串
     */
    private String buildInputForEstimate(String question, String indexContent, Map<String, String> pageContents) {
        StringBuilder sb = new StringBuilder();
        sb.append(question != null ? question : "");
        sb.append(indexContent != null ? indexContent : "");
        if (pageContents != null) {
            for (String content : pageContents.values()) {
                sb.append(content != null ? content : "");
            }
        }
        return sb.toString();
    }

    /**
     * 将标题清理为合法的文件名（去除 Obsidian wiki-link 非法字符）。
     * <p>
     * 参考 {@code BatchIngestService.sanitizePageName} 的实现，去除扩展名并替换非法字符为下划线。
     * </p>
     *
     * @param title 原始标题
     * @return 合法的页面名
     */
    private String sanitizeName(String title) {
        if (title == null || title.isEmpty()) {
            return "untitled";
        }
        String name = title.trim();
        // 去除扩展名
        int dotIdx = name.lastIndexOf('.');
        if (dotIdx > 0) {
            name = name.substring(0, dotIdx);
        }
        // 替换 Obsidian wiki-link / 文件名非法字符
        return name.replaceAll("[#|^\\[\\]\\\\/]", "_");
    }

    /**
     * 截取字符串前 maxLen 个字符，超出时追加省略号。
     *
     * @param s      原始字符串
     * @param maxLen 最大长度
     * @return 截取后的字符串
     */
    private String truncate(String s, int maxLen) {
        if (s == null || s.length() <= maxLen) {
            return s != null ? s : "";
        }
        return s.substring(0, maxLen) + "...";
    }

    /**
     * 从问题中提取有意义的搜索关键词。
     * <p>
     * 过滤掉常见的中文停用词、疑问词、标点符号等，保留有实际含义的词语。
     * 用于自然语言问题的关键词拆词搜索兜底。
     * </p>
     *
     * @param question 用户问题
     * @return 关键词列表（至少 2 个字符，且过滤停用词）
     */
    private List<String> extractKeywords(String question) {
        if (question == null || question.trim().isEmpty()) {
            return List.of();
        }
        // 中文/英文停用词集合
        Set<String> stopWords = Set.of(
                "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
                "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
                "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
                "什么", "怎么", "如何", "为什么", "哪个", "哪些", "谁", "何时", "何地",
                "怎样", "多少", "是否", "能", "可以", "应该", "需要", "请", "帮",
                "the", "a", "an", "is", "are", "was", "were", "be", "been",
                "have", "has", "had", "do", "does", "did", "will", "would",
                "can", "could", "should", "may", "might", "shall", "this",
                "that", "these", "those", "what", "how", "why", "which",
                "who", "when", "where", "and", "or", "but", "not", "to",
                "in", "on", "at", "for", "with", "by", "of", "it", "its",
                "主要", "区别", "差异", "不同", "比较", "对比",
                "介绍", "说明", "定义", "概念", "原理", "基础"
        );

        // 去除标点符号，按空白字符分割
        String cleaned = question.replaceAll("[\\p{P}\\p{S}？。，、！：；\"\"''（）【】《》‘’“”…·]", " ");
        String[] parts = cleaned.split("\\s+");
        return Arrays.stream(parts)
                .map(String::trim)
                .filter(s -> s.length() >= 2)          // 至少 2 个字符
                .filter(s -> !stopWords.contains(s.toLowerCase()))  // 过滤停用词
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * 按关键词搜索剪藏内容（兜底搜索）。
     * <p>
     * 对每个关键词在剪藏的标题、摘要、正文中做模糊匹配，合并去重后返回。
     * </p>
     *
     * @param keywords 关键词列表
     * @param topK     最大返回数量
     * @return 匹配的剪藏内容列表
     */
    private List<ClipContent> searchClipsByKeywords(List<String> keywords, int topK) {
        List<ClipContent> allClips = searchService.getAllClips();
        if (allClips == null || allClips.isEmpty()) {
            return List.of();
        }
        Set<Long> seenIds = new java.util.HashSet<>();
        List<ClipContent> results = new ArrayList<>();
        for (String keyword : keywords) {
            String kw = keyword.toLowerCase();
            for (ClipContent clip : allClips) {
                if (seenIds.contains(clip.getId())) {
                    continue;
                }
                if (matchesKeyword(clip, kw)) {
                    seenIds.add(clip.getId());
                    results.add(clip);
                    if (results.size() >= topK) {
                        return results;
                    }
                }
            }
        }
        return results;
    }

    /**
     * 按关键词搜索知识条目（兜底搜索）。
     * <p>
     * 对每个关键词在知识的标题、摘要、正文中做模糊匹配，合并去重后返回。
     * </p>
     *
     * @param keywords 关键词列表
     * @return 匹配的知识条目列表
     */
    private List<Knowledge> searchKnowledgeByKeywords(List<String> keywords) {
        List<Knowledge> allKnowledge = knowledgeService.getAllKnowledge();
        if (allKnowledge == null || allKnowledge.isEmpty()) {
            return List.of();
        }
        Set<Long> seenIds = new java.util.HashSet<>();
        List<Knowledge> results = new ArrayList<>();
        for (String keyword : keywords) {
            String kw = keyword.toLowerCase();
            for (Knowledge k : allKnowledge) {
                if (seenIds.contains(k.getId())) {
                    continue;
                }
                boolean match = (k.getTitle() != null && k.getTitle().toLowerCase().contains(kw))
                        || (k.getSummary() != null && k.getSummary().toLowerCase().contains(kw))
                        || (k.getContent() != null && k.getContent().toLowerCase().contains(kw));
                if (match) {
                    seenIds.add(k.getId());
                    results.add(k);
                }
            }
        }
        return results;
    }

    /**
     * 判断剪藏内容是否匹配某个关键词。
     * <p>
     * 匹配字段：标题、摘要、正文、分析、标签。
     * </p>
     *
     * @param clip 剪藏内容
     * @param kw   关键词（小写）
     * @return true 表示匹配
     */
    private boolean matchesKeyword(ClipContent clip, String kw) {
        if (clip.getTitle() != null && clip.getTitle().toLowerCase().contains(kw)) return true;
        if (clip.getSummary() != null && clip.getSummary().toLowerCase().contains(kw)) return true;
        if (clip.getContent() != null && clip.getContent().toLowerCase().contains(kw)) return true;
        if (clip.getAnalysis() != null && clip.getAnalysis().toLowerCase().contains(kw)) return true;
        if (clip.getTags() != null) {
            for (String tag : clip.getTags()) {
                if (tag.toLowerCase().contains(kw)) return true;
            }
        }
        return false;
    }
}
