package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Wiki 按需 Lint 服务。
 * <p>
 * 手动触发的 Wiki 健康检查服务（非定时）：扫描所有 wiki 页面，调用 AI 检测问题
 * （矛盾/过时/孤儿页/缺失页/缺失交叉引用），生成 lint-report.md，支持增量缓存
 * 跳过未变更页面以节省 Token。
 * </p>
 *
 * <h3>工作流程</h3>
 * <ol>
 *   <li>读取所有 wiki 页面（{@link WikiPageService#listAllPages()}）</li>
 *   <li>解析每个页面 frontmatter 中的 {@code updated} 字段作为内容指纹</li>
 *   <li>加载上次 lint 缓存（{@code .lint-cache.json}），仅对缓存中不存在或 updated 不同的页面调用 AI</li>
 *   <li>合并：未变更页面使用缓存结果，变更页面调用 AI 获取新结果</li>
 *   <li>生成 lint-report.md，保存到 {@code {vaultPath}/{wikiDirName}/lint-report.md}</li>
 *   <li>更新缓存（{@code .lint-cache.json}）</li>
 *   <li>追加日志（{@link WikiIndexService#appendLog}）</li>
 * </ol>
 *
 * <h3>失败降级</h3>
 * <p>
 * AI 调用失败时返回空结果列表，不中断 lint 流程。本服务独立于
 * {@code BatchIngestService} 和 {@code WikiQueryService}，保持低耦合。
 * </p>
 */
@Service
public class WikiLintService {

    private static final Logger log = LoggerFactory.getLogger(WikiLintService.class);

    /** 报告时间戳格式：yyyy-MM-dd HH:mm */
    private static final DateTimeFormatter REPORT_TIME_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    /** frontmatter 中 updated 字段正则 */
    private static final Pattern UPDATED_PATTERN =
            Pattern.compile("(?m)^updated:\\s*(.+?)\\s*$");

    /** 问题类型 → 中文标签映射 */
    private static final Map<String, String> TYPE_LABELS = new LinkedHashMap<>();

    /** 问题类型 → 报告 section 标题映射 */
    private static final List<String> ISSUE_TYPE_ORDER = new ArrayList<>();

    static {
        TYPE_LABELS.put("contradiction", "矛盾");
        TYPE_LABELS.put("stale", "过时");
        TYPE_LABELS.put("orphan", "孤儿页");
        TYPE_LABELS.put("missing_page", "缺失页");
        TYPE_LABELS.put("missing_cross_reference", "缺失交叉引用");

        ISSUE_TYPE_ORDER.add("contradiction");
        ISSUE_TYPE_ORDER.add("stale");
        ISSUE_TYPE_ORDER.add("orphan");
        ISSUE_TYPE_ORDER.add("missing_page");
        ISSUE_TYPE_ORDER.add("missing_cross_reference");
    }

    private final AiService aiService;
    private final WikiPageService wikiPageService;
    private final WikiIndexService wikiIndexService;
    private final WikiConfig wikiConfig;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * 构造器注入。
     *
     * @param aiService        AI 服务（lint 检测）
     * @param wikiPageService  Wiki 页面 CRUD
     * @param wikiIndexService 索引与日志维护
     * @param wikiConfig       Wiki 配置
     */
    public WikiLintService(AiService aiService,
                           WikiPageService wikiPageService,
                           WikiIndexService wikiIndexService,
                           WikiConfig wikiConfig) {
        this.aiService = aiService;
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.wikiConfig = wikiConfig;
    }

    /**
     * Lint 报告路径：{@code {vaultPath}/{wikiDirName}/lint-report.md}
     *
     * @return 报告文件路径
     */
    private Path getLintReportPath() {
        return Paths.get(wikiConfig.getVaultPath())
                .resolve(wikiConfig.getWikiDirName())
                .resolve("lint-report.md");
    }

    /**
     * Lint 缓存路径：{@code {vaultPath}/{wikiDirName}/.lint-cache.json}
     *
     * @return 缓存文件路径
     */
    private Path getLintCachePath() {
        return Paths.get(wikiConfig.getVaultPath())
                .resolve(wikiConfig.getWikiDirName())
                .resolve(".lint-cache.json");
    }

    /**
     * 执行 Wiki 健康检查（lint）。
     * <p>
     * 增量策略：仅对自上次 lint 以来 updated 字段变化的页面调用 AI，
     * 未变更页面复用缓存结果。最终合并所有问题并生成 lint-report.md。
     * </p>
     *
     * @return 结果 Map：status / totalPages / pagesScanned / pagesSkipped / issues / issueCount / message
     */
    public Map<String, Object> lint() {
        return lint(null);
    }

    /**
     * 执行 Wiki 健康检查（lint），带进度回调。
     * <p>
     * 与 {@link #lint()} 语义一致，但通过 {@link ProgressCallback} 在各阶段
     * （读取页面、加载缓存、比对变更、AI 检测、生成报告、完成/失败）推送实时进度。
     * </p>
     *
     * @param callback 进度回调；可为 null（此时不推送）
     * @return 结果 Map：status / totalPages / pagesScanned / pagesSkipped / issues / issueCount / message
     */
    public Map<String, Object> lint(ProgressCallback callback) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 确保 Wiki 目录结构存在
            wikiPageService.initWikiStructure();

            // 1. 读取所有 wiki 页面
            notify(callback, "读取页面", "正在读取所有 Wiki 页面...");
            List<Path> allPages = wikiPageService.listAllPages();
            int totalPages = allPages.size();

            // 2. 加载缓存
            notify(callback, "加载缓存", "正在加载上次 lint 缓存...");
            Map<String, Object> cache = loadLintCache();
            Map<String, String> cachedHashes = extractPageHashes(cache);
            List<Map<String, Object>> cachedResults = extractResults(cache);

            // 3. 区分变更/未变更页面
            notify(callback, "比对变更", "正在比对 " + totalPages + " 个页面的变更...");
            Map<String, String> changedPages = new LinkedHashMap<>();  // pageName -> content
            Map<String, String> newHashes = new LinkedHashMap<>();      // pageName -> updated
            List<String> changedPageNames = new ArrayList<>();

            for (Path pagePath : allPages) {
                String pageName = extractPageName(pagePath);
                String content = wikiPageService.readPage(pagePath);
                if (content == null) {
                    continue;
                }
                String updated = extractUpdatedDate(content);
                newHashes.put(pageName, updated != null ? updated : "");

                // 增量判断：缓存中不存在或 updated 不同 → 视为变更
                boolean changed = !wikiConfig.isLintCacheEnabled()
                        || !cachedHashes.containsKey(pageName)
                        || !equalsNullable(cachedHashes.get(pageName), updated);
                if (changed) {
                    changedPages.put(pageName, content);
                    changedPageNames.add(pageName);
                }
            }

            int pagesScanned = changedPages.size();
            int pagesSkipped = totalPages - pagesScanned;

            log.info("[WikiLint] Total pages: {}, changed: {}, skipped: {}",
                    totalPages, pagesScanned, pagesSkipped);

            // 4. 调用 AI 检测变更页面（失败降级返回空列表）
            notify(callback, "AI 检测", "正在调用大模型检测 " + pagesScanned + " 个变更页面...");
            List<Map<String, Object>> newIssues = aiService.lintWikiPages(changedPages);

            // 5. 合并结果：未变更页面使用缓存结果中相关的问题 + 变更页面的新结果
            //    缓存结果中过滤掉涉及已重新扫描页面的问题，避免重复
            List<Map<String, Object>> mergedIssues = new ArrayList<>();
            for (Map<String, Object> issue : cachedResults) {
                if (!involvesChangedPages(issue, changedPageNames)) {
                    mergedIssues.add(issue);
                }
            }
            mergedIssues.addAll(newIssues);

            int totalIssues = mergedIssues.size();

            // 6. 生成并保存 lint-report.md
            notify(callback, "生成报告", "正在生成 lint 报告...");
            String report = generateReport(mergedIssues, totalPages, pagesScanned);
            saveReport(report);

            // 6.1 将 lint-report.md 纳入 index（暂归 synthesis 类别以便在 index 中可见）
            try {
                wikiIndexService.updateIndex("synthesis", "lint-report",
                        "Lint 报告: " + totalIssues + " 个问题", LocalDate.now().toString());
            } catch (Exception e) {
                log.warn("[WikiLint] Failed to update index for lint-report: {}", e.getMessage());
            }

            // 7. 更新缓存
            Map<String, Object> newCache = new LinkedHashMap<>();
            newCache.put("pageHashes", newHashes);
            newCache.put("results", mergedIssues);
            saveLintCache(newCache);

            // 8. 追加日志
            wikiIndexService.appendLog("lint", "Lint: " + totalIssues + " issues found");

            result.put("status", "success");
            result.put("totalPages", totalPages);
            result.put("pagesScanned", pagesScanned);
            result.put("pagesSkipped", pagesSkipped);
            result.put("issues", mergedIssues);
            result.put("issueCount", totalIssues);
            result.put("message", "Lint completed: scanned " + pagesScanned + " pages, found " + totalIssues + " issues");
            log.info("[WikiLint] Lint completed: {} issues found", totalIssues);
            notify(callback, "完成", "Lint 完成，共发现 " + totalIssues + " 个问题");
            return result;
        } catch (Exception e) {
            log.error("[WikiLint] Lint failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Lint failed: " + e.getMessage());
            notify(callback, "失败", "Lint 失败：" + e.getMessage());
            return result;
        }
    }

    /**
     * 进度回调接口 —— 供 {@link #lint(ProgressCallback)} 在各阶段推送实时进度。
     */
    @FunctionalInterface
    public interface ProgressCallback {
        /**
         * Lint 进入新阶段时回调。
         *
         * @param stage   阶段名（如"读取页面"、"AI 检测"）
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
                log.warn("[WikiLint] Progress callback failed: {}", e.getMessage());
            }
        }
    }

    /**
     * 读取 lint-report.md 内容。
     *
     * @return {@code {content, exists}}；文件不存在时 {@code exists=false, content=""}
     */
    public Map<String, Object> readReport() {
        Map<String, Object> result = new LinkedHashMap<>();
        Path reportPath = getLintReportPath();
        if (!Files.exists(reportPath)) {
            result.put("content", "");
            result.put("exists", false);
            return result;
        }
        try {
            String content = Files.readString(reportPath);
            result.put("content", content != null ? content : "");
            result.put("exists", true);
        } catch (IOException e) {
            log.error("[WikiLint] Failed to read lint-report.md: {}", e.getMessage(), e);
            result.put("content", "");
            result.put("exists", false);
            result.put("error", e.getMessage());
        }
        return result;
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 生成 lint-report.md 内容。
     *
     * @param issues      问题列表
     * @param totalPages  总页面数
     * @param pagesScanned 实际扫描页面数
     * @return Markdown 报告字符串
     */
    private String generateReport(List<Map<String, Object>> issues, int totalPages, int pagesScanned) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Wiki Lint Report\n\n");
        sb.append("> Generated: ").append(LocalDateTime.now().format(REPORT_TIME_FORMATTER)).append("\n");
        sb.append("> Pages scanned: ").append(pagesScanned).append(" | Issues found: ")
                .append(issues != null ? issues.size() : 0).append("\n\n");

        if (issues == null || issues.isEmpty()) {
            sb.append("_No issues detected._\n");
            return sb.toString();
        }

        // 按类型分组
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> issue : issues) {
            String type = getStringField(issue, "type");
            grouped.computeIfAbsent(type, k -> new ArrayList<>()).add(issue);
        }

        // 按 ISSUE_TYPE_ORDER 顺序输出
        for (String type : ISSUE_TYPE_ORDER) {
            List<Map<String, Object>> typeIssues = grouped.get(type);
            if (typeIssues == null || typeIssues.isEmpty()) {
                continue;
            }
            String label = TYPE_LABELS.getOrDefault(type, type);
            sb.append("## ").append(label).append("\n\n");
            for (Map<String, Object> issue : typeIssues) {
                List<String> pages = getStringListField(issue, "pages");
                String description = getStringField(issue, "description");
                if (pages.isEmpty()) {
                    sb.append("- ").append(description != null ? description : "").append("\n\n");
                } else if (pages.size() == 1) {
                    sb.append("- **[[").append(pages.get(0)).append("]]**: ")
                            .append(description != null ? description : "").append("\n\n");
                } else {
                    sb.append("- **");
                    for (int i = 0; i < pages.size(); i++) {
                        if (i > 0) {
                            sb.append(" vs ");
                        }
                        sb.append("[[").append(pages.get(i)).append("]]");
                    }
                    sb.append("**: ").append(description != null ? description : "").append("\n\n");
                }
            }
        }

        // 输出未知类型
        for (Map.Entry<String, List<Map<String, Object>>> entry : grouped.entrySet()) {
            if (ISSUE_TYPE_ORDER.contains(entry.getKey())) {
                continue;
            }
            sb.append("## ").append(entry.getKey()).append("\n\n");
            for (Map<String, Object> issue : entry.getValue()) {
                String description = getStringField(issue, "description");
                sb.append("- ").append(description != null ? description : "").append("\n\n");
            }
        }

        return sb.toString();
    }

    /**
     * 保存 lint-report.md 到磁盘。
     *
     * @param report 报告内容
     * @throws IOException 写入失败时抛出
     */
    private void saveReport(String report) throws IOException {
        Path reportPath = getLintReportPath();
        Path parent = reportPath.getParent();
        if (parent != null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }
        Files.writeString(reportPath, report);
        log.info("[WikiLint] Saved lint-report.md to {}", reportPath);
    }

    /**
     * 加载 lint 缓存。
     * <p>
     * 缓存格式：{@code {"pageHashes": {"PageName": "updated_date"}, "results": [...]}}
     * </p>
     *
     * @return 缓存 Map；文件不存在或解析失败时返回空 Map
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> loadLintCache() {
        Path cachePath = getLintCachePath();
        if (!Files.exists(cachePath)) {
            return new LinkedHashMap<>();
        }
        try {
            String content = Files.readString(cachePath);
            if (content == null || content.trim().isEmpty()) {
                return new LinkedHashMap<>();
            }
            Map<String, Object> cache = objectMapper.readValue(content,
                    new TypeReference<Map<String, Object>>() {});
            return cache != null ? cache : new LinkedHashMap<>();
        } catch (Exception e) {
            log.warn("[WikiLint] Failed to load lint cache, starting fresh: {}", e.getMessage());
            return new LinkedHashMap<>();
        }
    }

    /**
     * 保存 lint 缓存到磁盘。
     *
     * @param cache 缓存 Map
     */
    private void saveLintCache(Map<String, Object> cache) {
        Path cachePath = getLintCachePath();
        Path parent = cachePath.getParent();
        try {
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(cache);
            Files.writeString(cachePath, json);
            log.info("[WikiLint] Saved lint cache to {}", cachePath);
        } catch (Exception e) {
            log.error("[WikiLint] Failed to save lint cache: {}", e.getMessage(), e);
        }
    }

    /**
     * 从缓存中提取 pageHashes 映射。
     *
     * @param cache 缓存 Map
     * @return 页面名 → updated 字符串映射；不存在时返回空 Map
     */
    @SuppressWarnings("unchecked")
    private Map<String, String> extractPageHashes(Map<String, Object> cache) {
        Object raw = cache.get("pageHashes");
        if (raw instanceof Map) {
            Map<String, String> result = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) raw).entrySet()) {
                result.put(entry.getKey(), entry.getValue() != null ? entry.getValue().toString() : "");
            }
            return result;
        }
        return new LinkedHashMap<>();
    }

    /**
     * 从缓存中提取 results 列表。
     *
     * @param cache 缓存 Map
     * @return 问题列表；不存在时返回空列表
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> extractResults(Map<String, Object> cache) {
        Object raw = cache.get("results");
        if (raw instanceof List) {
            List<Map<String, Object>> result = new ArrayList<>();
            for (Object item : (List<Object>) raw) {
                if (item instanceof Map) {
                    result.add((Map<String, Object>) item);
                }
            }
            return result;
        }
        return new ArrayList<>();
    }

    /**
     * 判断某个问题是否涉及已重新扫描的页面。
     *
     * @param issue             问题 Map
     * @param changedPageNames  变更页面名列表
     * @return true 表示问题涉及至少一个变更页面
     */
    private boolean involvesChangedPages(Map<String, Object> issue, List<String> changedPageNames) {
        if (changedPageNames.isEmpty()) {
            return false;
        }
        List<String> pages = getStringListField(issue, "pages");
        for (String page : pages) {
            if (changedPageNames.contains(page)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 从页面内容 frontmatter 中提取 updated 字段值。
     *
     * @param content 页面内容
     * @return updated 字段值；不存在时返回 null
     */
    private String extractUpdatedDate(String content) {
        if (content == null || content.isEmpty()) {
            return null;
        }
        Matcher matcher = UPDATED_PATTERN.matcher(content);
        if (matcher.find()) {
            return matcher.group(1).trim();
        }
        return null;
    }

    /**
     * 从文件路径提取页面名（去 .md 扩展名）。
     *
     * @param pagePath 页面文件路径
     * @return 页面名
     */
    private String extractPageName(Path pagePath) {
        String fileName = pagePath.getFileName().toString();
        if (fileName.endsWith(".md")) {
            fileName = fileName.substring(0, fileName.length() - 3);
        }
        return fileName;
    }

    /**
     * 安全获取 Map 中的字符串字段。
     *
     * @param map 目标 Map
     * @param key 字段名
     * @return 字符串值；不存在时返回 null
     */
    private String getStringField(Map<String, Object> map, String key) {
        if (map == null) {
            return null;
        }
        Object val = map.get(key);
        return val != null ? val.toString() : null;
    }

    /**
     * 安全获取 Map 中的字符串列表字段。
     *
     * @param map 目标 Map
     * @param key 字段名
     * @return 字符串列表；不存在或类型不匹配时返回空列表
     */
    @SuppressWarnings("unchecked")
    private List<String> getStringListField(Map<String, Object> map, String key) {
        if (map == null) {
            return List.of();
        }
        Object val = map.get(key);
        if (val instanceof List) {
            List<String> result = new ArrayList<>();
            for (Object item : (List<Object>) val) {
                if (item != null) {
                    result.add(item.toString());
                }
            }
            return result;
        }
        return List.of();
    }

    /**
     * 安全比较两个可空字符串是否相等。
     *
     * @param a 字符串 a
     * @param b 字符串 b
     * @return true 表示相等（包括都为 null）
     */
    private boolean equalsNullable(String a, String b) {
        if (a == null && b == null) {
            return true;
        }
        if (a == null || b == null) {
            return false;
        }
        return a.equals(b);
    }
}
