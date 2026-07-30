package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    /**
     * 构造器注入。
     *
     * @param aiService               AI 服务（index 定位 + 答案综合）
     * @param wikiPageService         Wiki 页面 CRUD
     * @param wikiIndexService        索引与日志维护
     * @param obsidianExportFormatter Obsidian 格式化（frontmatter）
     * @param wikiConfig              Wiki 配置
     */
    public WikiQueryService(AiService aiService,
                            WikiPageService wikiPageService,
                            WikiIndexService wikiIndexService,
                            ObsidianExportFormatter obsidianExportFormatter,
                            WikiConfig wikiConfig) {
        this.aiService = aiService;
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.obsidianExportFormatter = obsidianExportFormatter;
        this.wikiConfig = wikiConfig;
    }

    /**
     * 执行 Wiki 综合查询。
     * <p>
     * 两步流程：index 定位 → 仅读取相关页面 → 综合生成答案 → 估算 Token 消耗。
     * 失败时降级返回 {@code {status: "error", message: ...}}。
     * </p>
     *
     * @param question 用户问题
     * @return 查询结果 Map：status / answer / relevantPages / tokenEstimate / message
     */
    public Map<String, Object> query(String question) {
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
            Path indexPath = wikiIndexService.getIndexPath();
            String indexContent = wikiPageService.readPage(indexPath);
            if (indexContent == null || indexContent.trim().isEmpty()) {
                indexContent = "# Wiki Index\n\n(empty)";
            }

            // 2. 调用便宜模型定位相关页面
            List<String> relevantPageNames = aiService.locateRelevantPages(question, indexContent);
            log.info("[WikiQuery] Located {} relevant pages for question", relevantPageNames.size());

            // 3. 仅读取相关页面内容（非全量扫描）
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

            // 4. 调用强模型综合答案
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
            result.put("message", "Query completed: " + pageContents.size() + " pages used");
            return result;
        } catch (Exception e) {
            log.error("[WikiQuery] Query failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Query failed: " + e.getMessage());
            return result;
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
}
