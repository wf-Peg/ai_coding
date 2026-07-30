package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.example.clip.dto.WikiExtractionResult;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Wiki 批量入库服务 —— LLM Wiki 功能的核心引擎。
 * <p>
 * 接收一批源文件（Markdown），通过以下流程将其转化为结构化的 Wiki 页面：
 * </p>
 *
 * <h3>入库流程</h3>
 * <ol>
 *   <li><b>读取源文件</b>：读取每个源文件内容，解析 frontmatter 提取 source URL 和 title</li>
 *   <li><b>批量抽取</b>：一次 LLM 调用抽取所有源的实体、概念和摘要（节省 Token）</li>
 *   <li><b>处理实体</b>：为每个实体生成/更新页面，检测矛盾，保护手工编辑</li>
 *   <li><b>处理概念</b>：为每个概念生成/更新页面，逻辑同实体</li>
 *   <li><b>生成源页面</b>：为每个源文件生成一个源页面</li>
 *   <li><b>更新索引与日志</b>：更新 index.md 和 log.md</li>
 *   <li><b>标记已处理</b>：通过 VaultWatchService 标记文件为已处理</li>
 *   <li><b>返回统计</b>：返回包含本次入库详情的统计 Map</li>
 * </ol>
 *
 * <h3>关键策略</h3>
 * <ul>
 *   <li><b>Token 节省</b>：抽取阶段使用便宜模型批量调用；合成阶段使用强模型逐页生成</li>
 *   <li><b>手工编辑保护</b>：检测 manual-edited frontmatter 标记，跳过自动更新，仅追加来源引用</li>
 *   <li><b>矛盾检测</b>：新内容与已有页面冲突时，在页面中追加 &gt; [!warning] 矛盾标注 callout</li>
 *   <li><b>优雅降级</b>：单个源/页面处理失败不影响其他，异常被捕获并记录</li>
 * </ul>
 */
@Service
public class BatchIngestService {

    private static final Logger log = LoggerFactory.getLogger(BatchIngestService.class);

    /** frontmatter 中 source/url 字段匹配 */
    private static final Pattern SOURCE_URL_PATTERN =
            Pattern.compile("(?m)^source:\\s*(.+?)\\s*$|^url:\\s*(.+?)\\s*$");

    /** frontmatter 中 title 字段匹配 */
    private static final Pattern TITLE_PATTERN =
            Pattern.compile("(?m)^title:\\s*(.+?)\\s*$");

    private final AiService aiService;
    private final WikiPageService wikiPageService;
    private final WikiIndexService wikiIndexService;
    private final ObsidianExportFormatter obsidianExportFormatter;
    private final WikiConfig wikiConfig;
    private final VaultWatchService vaultWatchService;
    private final MocGeneratorService mocGeneratorService;

    /**
     * 当前 ingest 批次的输入字符数累计（粗略估算，用于 token 消耗近似）。
     * <p>
     * 由于现有 AiService 方法不返回 token 信息，采用字符数 / 4 的粗略估算。
     * 在 {@link #ingestBatch} 开头重置，在 {@link #processPage} 和
     * {@link #generateSourcePage} 中累加。
     * </p>
     */
    private long currentIngestInputChars = 0;

    /** 当前 ingest 批次的输出字符数累计（粗略估算） */
    private long currentIngestOutputChars = 0;

    /**
     * 构造器注入。
     *
     * @param aiService               AI 服务（抽取 + 页面生成 + 矛盾检测）
     * @param wikiPageService         Wiki 页面 CRUD
     * @param wikiIndexService        索引与日志维护
     * @param obsidianExportFormatter Obsidian 格式化（frontmatter / callout）
     * @param wikiConfig              Wiki 配置
     * @param vaultWatchService       Vault 监视服务（用于标记文件已处理）
     * @param mocGeneratorService     MOC 索引页生成服务
     */
    public BatchIngestService(AiService aiService,
                              WikiPageService wikiPageService,
                              WikiIndexService wikiIndexService,
                              ObsidianExportFormatter obsidianExportFormatter,
                              WikiConfig wikiConfig,
                              VaultWatchService vaultWatchService,
                              MocGeneratorService mocGeneratorService) {
        this.aiService = aiService;
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.obsidianExportFormatter = obsidianExportFormatter;
        this.wikiConfig = wikiConfig;
        this.vaultWatchService = vaultWatchService;
        this.mocGeneratorService = mocGeneratorService;
    }

    /**
     * 批量入库主流程。
     * <p>
     * 接收一批源文件路径，按 Wiki 流程处理为实体/概念/源页面，并返回统计信息。
     * 单个源处理失败不会中断整体流程。
     * </p>
     *
     * @param sourceFiles 源文件路径列表
     * @return 统计 Map：status / sourceCount / pagesUpdated / newEntities / newConcepts /
     *         contradictions / skipped / message
     */
    public Map<String, Object> ingestBatch(List<Path> sourceFiles) {
        Map<String, Object> stats = new LinkedHashMap<>();
        if (sourceFiles == null || sourceFiles.isEmpty()) {
            stats.put("status", "error");
            stats.put("sourceCount", 0);
            stats.put("pagesUpdated", 0);
            stats.put("newEntities", 0);
            stats.put("newConcepts", 0);
            stats.put("contradictions", 0);
            stats.put("skipped", 0);
            stats.put("message", "No source files provided");
            return stats;
        }

        // 确保 Wiki 目录结构存在
        wikiPageService.initWikiStructure();

        // 重置 token 估算累计
        currentIngestInputChars = 0;
        currentIngestOutputChars = 0;

        int pagesUpdated = 0;
        int newEntities = 0;
        int newConcepts = 0;
        int contradictions = 0;
        int skipped = 0;
        int processedCount = 0;

        try {
            // 1. 读取所有源文件内容
            List<String> contents = new ArrayList<>();
            List<String> sourceUrls = new ArrayList<>();
            List<String> sourceFileNames = new ArrayList<>();
            for (Path file : sourceFiles) {
                String content = readSourceFile(file);
                contents.add(content);
                sourceUrls.add(parseSourceUrl(content));
                sourceFileNames.add(file.getFileName().toString());
            }

            // 2. 批量抽取实体与概念（一次 LLM 调用）
            List<WikiExtractionResult> extractions = aiService.batchExtractEntitiesAndConcepts(contents);
            log.info("[Wiki] Batch extraction returned {} results for {} sources",
                    extractions.size(), sourceFiles.size());

            // 批量抽取阶段 token 估算：输入 = 所有源文件内容长度之和
            // 输出 = 粗略估算每个 extraction 结果约 200 字符
            currentIngestInputChars += contents.stream().mapToLong(String::length).sum();
            currentIngestOutputChars += (long) extractions.size() * 200;

            // 3. 处理每个抽取结果
            for (WikiExtractionResult result : extractions) {
                int idx = result.getIndex();
                if (idx < 0 || idx >= sourceFiles.size()) {
                    log.warn("[Wiki] Extraction result index {} out of range, skipping", idx);
                    continue;
                }
                String sourceContent = contents.get(idx);
                String sourceUrl = sourceUrls.get(idx);
                String sourceFileName = sourceFileNames.get(idx);
                String sourceSummary = result.getSummary() != null ? result.getSummary() : "";

                // 3a. 处理实体
                for (String entityName : safeList(result.getEntities())) {
                    try {
                        PageUpdateOutcome outcome = processPage(
                                "entity", entityName, sourceSummary, sourceUrl, sourceFileName, sourceContent);
                        if (outcome.updated) pagesUpdated++;
                        if (outcome.created) newEntities++;
                        if (outcome.contradiction) contradictions++;
                        if (outcome.skipped) skipped++;
                    } catch (Exception e) {
                        log.error("[Wiki] Failed to process entity '{}': {}", entityName, e.getMessage(), e);
                    }
                }

                // 3b. 处理概念
                for (String conceptName : safeList(result.getConcepts())) {
                    try {
                        PageUpdateOutcome outcome = processPage(
                                "concept", conceptName, sourceSummary, sourceUrl, sourceFileName, sourceContent);
                        if (outcome.updated) pagesUpdated++;
                        if (outcome.created) newConcepts++;
                        if (outcome.contradiction) contradictions++;
                        if (outcome.skipped) skipped++;
                    } catch (Exception e) {
                        log.error("[Wiki] Failed to process concept '{}': {}", conceptName, e.getMessage(), e);
                    }
                }

                // 3c. 生成源页面
                try {
                    generateSourcePage(sourceContent, sourceUrl, sourceFileName);
                    pagesUpdated++;
                } catch (Exception e) {
                    log.error("[Wiki] Failed to generate source page for '{}': {}", sourceFileName, e.getMessage(), e);
                }

                processedCount++;
            }

            // 4. 更新日志
            wikiIndexService.appendLog("ingest",
                    "Batch ingest: " + sourceFiles.size() + " sources, " + pagesUpdated + " pages updated");

            // 5. 标记所有源文件为已处理
            for (Path file : sourceFiles) {
                try {
                    vaultWatchService.markAsProcessed(file);
                } catch (Exception e) {
                    log.warn("[Wiki] Failed to mark file as processed [{}]: {}", file, e.getMessage());
                }
            }

            // 6. 生成所有 MOC 索引页（失败不影响 ingest 结果）
            try {
                mocGeneratorService.generateAllMocs();
            } catch (Exception e) {
                log.warn("[Wiki] MOC generation failed after ingest: {}", e.getMessage(), e);
            }

            // 7. 标记 ingest 已触发，更新超时判断时间戳
            vaultWatchService.markIngestTriggered();

            stats.put("status", "success");
            stats.put("sourceCount", processedCount);
            stats.put("pagesUpdated", pagesUpdated);
            stats.put("newEntities", newEntities);
            stats.put("newConcepts", newConcepts);
            stats.put("contradictions", contradictions);
            stats.put("skipped", skipped);
            // token 消耗估算：粗略按 4 字符 ≈ 1 token
            stats.put("tokenEstimate", (currentIngestInputChars + currentIngestOutputChars) / 4);
            stats.put("inputChars", currentIngestInputChars);
            stats.put("outputChars", currentIngestOutputChars);
            stats.put("message", "Ingested " + processedCount + " sources: "
                    + pagesUpdated + " pages updated, "
                    + newEntities + " new entities, "
                    + newConcepts + " new concepts, "
                    + contradictions + " contradictions, "
                    + skipped + " skipped");
            log.info("[Wiki] Batch ingest complete: {}", stats.get("message"));
            return stats;
        } catch (Exception e) {
            log.error("[Wiki] Batch ingest failed: {}", e.getMessage(), e);
            stats.put("status", "error");
            stats.put("sourceCount", processedCount);
            stats.put("pagesUpdated", pagesUpdated);
            stats.put("newEntities", newEntities);
            stats.put("newConcepts", newConcepts);
            stats.put("contradictions", contradictions);
            stats.put("skipped", skipped);
            // 失败时也返回已累计的 token 估算
            stats.put("tokenEstimate", (currentIngestInputChars + currentIngestOutputChars) / 4);
            stats.put("inputChars", currentIngestInputChars);
            stats.put("outputChars", currentIngestOutputChars);
            stats.put("message", "Ingest failed: " + e.getMessage());
            return stats;
        }
    }

    /**
     * 处理单个实体/概念页面：读取已有页面 → 检测手工编辑 → 生成/更新 → 检测矛盾。
     *
     * @param pageType      页面类型（entity / concept）
     * @param pageName      页面名称
     * @param sourceSummary 来源摘要
     * @param sourceUrl     来源 URL
     * @param sourceFileName 来源文件名
     * @param sourceContent  来源原始内容
     * @return 处理结果
     */
    private PageUpdateOutcome processPage(String pageType, String pageName, String sourceSummary,
                                          String sourceUrl, String sourceFileName, String sourceContent) {
        PageUpdateOutcome outcome = new PageUpdateOutcome();
        if (pageName == null || pageName.trim().isEmpty()) {
            return outcome;
        }
        pageName = pageName.trim();

        Path pagePath = wikiPageService.getPagePath(pageType, pageName);
        boolean exists = wikiPageService.pageExists(pageType, pageName);
        String existingContent = exists ? wikiPageService.readPage(pagePath) : null;

        String pageBody;
        boolean manualEdited = exists && wikiPageService.isManualEdited(pagePath);

        if (manualEdited) {
            // 手工编辑保护：跳过 AI 自动更新，仅追加来源引用
            log.info("[Wiki] Page [{}/{}] is manual-edited, skipping AI update", pageType, pageName);
            pageBody = appendManualEditedSection(existingContent, sourceFileName, sourceSummary);
            outcome.skipped = true;
        } else {
            // 调用 AI 生成/更新页面
            if ("entity".equals(pageType)) {
                pageBody = aiService.generateEntityPage(pageName, sourceSummary, existingContent);
            } else {
                pageBody = aiService.generateConceptPage(pageName, sourceSummary, existingContent);
            }
            if (pageBody == null || pageBody.trim().isEmpty()) {
                pageBody = existingContent != null ? existingContent : "# " + pageName + "\n\n";
            }

            // 矛盾检测（仅对已存在且非手工编辑的页面）
            if (exists && existingContent != null && !existingContent.trim().isEmpty()) {
                String contradiction = aiService.detectContradiction(sourceSummary, existingContent);
                if (contradiction != null && !contradiction.trim().isEmpty()) {
                    pageBody = appendContradictionCallout(pageBody, contradiction);
                    outcome.contradiction = true;
                    log.info("[Wiki] Contradiction detected for [{}/{}]: {}",
                            pageType, pageName, contradiction);
                }
            }
        }

        // 组装 frontmatter（aliases 设为页面名本身，方便 wiki-link 容错；type 为页面类型，供 Dataview 查询）
        List<String> tags = List.of(pageName);
        List<String> sourceUrls = sourceUrl != null && !sourceUrl.isEmpty()
                ? List.of(sourceUrl) : List.of();
        String frontmatter = obsidianExportFormatter.generateFrontmatter(
                LocalDate.now(), tags, pageType, sourceUrls, List.of(pageName), pageType);

        String fullContent = frontmatter + pageBody;

        // 创建或更新页面
        if (exists) {
            wikiPageService.updatePage(pagePath, fullContent);
        } else {
            wikiPageService.createPage(pageType, pageName, fullContent);
            outcome.created = true;
        }
        outcome.updated = true;

        // 更新索引
        wikiIndexService.updateIndex(pageType, pageName, sourceSummary, LocalDate.now().toString());

        // token 估算：页面生成阶段输入 = sourceSummary + existingContent，输出 = pageBody
        currentIngestInputChars += sourceSummary.length()
                + (existingContent != null ? existingContent.length() : 0);
        currentIngestOutputChars += pageBody != null ? pageBody.length() : 0;

        return outcome;
    }

    /**
     * 生成源页面。
     *
     * @param sourceContent  源原始内容
     * @param sourceUrl      源 URL
     * @param sourceFileName 源文件名
     */
    private void generateSourcePage(String sourceContent, String sourceUrl, String sourceFileName) {
        String pageName = sanitizePageName(sourceFileName);
        String pageBody = aiService.generateSourcePage(sourceContent, sourceUrl);
        if (pageBody == null || pageBody.trim().isEmpty()) {
            pageBody = "# Source: " + sourceFileName + "\n\n";
            if (sourceUrl != null && !sourceUrl.isEmpty()) {
                pageBody += "Source URL: " + sourceUrl + "\n\n";
            }
        }

        List<String> tags = List.of("source");
        List<String> sourceUrls = sourceUrl != null && !sourceUrl.isEmpty()
                ? List.of(sourceUrl) : List.of();
        String frontmatter = obsidianExportFormatter.generateFrontmatter(
                LocalDate.now(), tags, "source", sourceUrls, List.of(), "source");
        String fullContent = frontmatter + pageBody;

        if (wikiPageService.pageExists("source", pageName)) {
            wikiPageService.updatePage(wikiPageService.getPagePath("source", pageName), fullContent);
        } else {
            wikiPageService.createPage("source", pageName, fullContent);
        }
        wikiIndexService.updateIndex("source", pageName,
                sourceUrl != null ? sourceUrl : sourceFileName,
                LocalDate.now().toString());

        // token 估算：来源页生成输入 = sourceContent，输出 = pageBody
        currentIngestInputChars += sourceContent != null ? sourceContent.length() : 0;
        currentIngestOutputChars += pageBody != null ? pageBody.length() : 0;
    }

    /**
     * 追加矛盾标注 callout 到页面内容末尾。
     * <p>
     * 格式：
     * <pre>
     * &gt; [!warning] 矛盾标注
     * &gt; {contradictionDesc}
     * </pre>
     * </p>
     *
     * @param pageContent        原页面内容
     * @param contradictionDesc  矛盾描述
     * @return 追加 callout 后的页面内容
     */
    private String appendContradictionCallout(String pageContent, String contradictionDesc) {
        StringBuilder sb = new StringBuilder(pageContent);
        if (!pageContent.endsWith("\n")) {
            sb.append("\n");
        }
        sb.append("\n");
        sb.append("> [!warning] 矛盾标注\n");
        for (String line : contradictionDesc.split("\n", -1)) {
            sb.append("> ").append(line).append("\n");
        }
        sb.append("\n");
        return sb.toString();
    }

    /**
     * 为手工编辑的页面追加"最近来源"区块。
     * <p>
     * 格式：
     * <pre>
     * ## 最近来源
     * - [[sources/{sourceFileName}]] — {sourceSummary}
     * </pre>
     * </p>
     *
     * @param existingContent 已有页面内容
     * @param sourceFileName  来源文件名
     * @param sourceSummary   来源摘要
     * @return 追加后的内容
     */
    private String appendManualEditedSection(String existingContent, String sourceFileName, String sourceSummary) {
        if (existingContent == null) {
            existingContent = "";
        }
        StringBuilder sb = new StringBuilder(existingContent);
        if (!existingContent.endsWith("\n")) {
            sb.append("\n");
        }
        sb.append("\n## 最近来源\n");
        sb.append("- [[sources/").append(sourceFileName).append("]] — ")
                .append(sourceSummary != null ? sourceSummary : "").append("\n");
        return sb.toString();
    }

    /**
     * 读取源文件内容，失败时返回空字符串。
     *
     * @param file 文件路径
     * @return 文件内容字符串
     */
    private String readSourceFile(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            log.error("[Wiki] Failed to read source file [{}]: {}", file, e.getMessage());
            return "";
        }
    }

    /**
     * 从内容 frontmatter 中解析 source URL（source: 或 url: 字段）。
     *
     * @param content 文件内容
     * @return source URL 字符串；未找到时返回空字符串
     */
    private String parseSourceUrl(String content) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        Matcher m = SOURCE_URL_PATTERN.matcher(content);
        if (m.find()) {
            // group 1 来自 source:，group 2 来自 url:
            String val = m.group(1) != null ? m.group(1) : m.group(2);
            return val != null ? val.trim() : "";
        }
        return "";
    }

    /**
     * 从内容 frontmatter 中解析 title 字段值。
     *
     * @param content 文件内容
     * @return title 字符串；未找到时返回空字符串
     */
    @SuppressWarnings("unused")
    private String parseSourceTitle(String content) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        Matcher m = TITLE_PATTERN.matcher(content);
        if (m.find()) {
            return m.group(1) != null ? m.group(1).trim() : "";
        }
        return "";
    }

    /**
     * 将文件名清理为合法的页面名（去除扩展名和非法字符）。
     *
     * @param fileName 原始文件名
     * @return 合法的页面名
     */
    private String sanitizePageName(String fileName) {
        if (fileName == null || fileName.isEmpty()) {
            return "untitled";
        }
        // 去除扩展名
        int dotIdx = fileName.lastIndexOf('.');
        if (dotIdx > 0) {
            fileName = fileName.substring(0, dotIdx);
        }
        // 替换 Obsidian wiki-link 中非法字符
        return fileName.replaceAll("[#|^\\[\\]\\\\/]", "_");
    }

    /**
     * 安全获取字符串列表，null 转为空列表。
     *
     * @param list 原始列表
     * @return 非 null 列表
     */
    private List<String> safeList(List<String> list) {
        return list != null ? list : List.of();
    }

    /**
     * 页面处理结果内部 DTO。
     */
    private static class PageUpdateOutcome {
        boolean updated = false;
        boolean created = false;
        boolean contradiction = false;
        boolean skipped = false;
    }
}
