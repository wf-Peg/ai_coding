package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.example.clip.dto.WikiExtractionResult;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import jakarta.annotation.PreDestroy;
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
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
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
 *   <li><b>并发页面生成</b>：每个页面（实体/概念/源页）都要独立调用一次 LLM，
 *       且页面之间互不依赖，故第 3~5 步被折叠为"页面任务"并交给受控线程池并行执行
 *       （并发度见 {@code wiki.ingest-concurrency}）。同一页面的多次更新会合并为一条
 *       串行链，保证"先建后更"的顺序与串行版本完全一致，避免并发写同一文件互相覆盖</li>
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

    /** 页面并发键分隔符：pageType + 分隔符 + pageName（NUL 不会出现在页面名中） */
    private static final String PAGE_KEY_SEPARATOR = "\u0000";

    /** 并发度下限（1 = 完全串行）与上限（防止配置误填打爆 LLM 限流） */
    private static final int MIN_CONCURRENCY = 1;
    private static final int MAX_CONCURRENCY = 16;

    private final AiService aiService;
    private final WikiPageService wikiPageService;
    private final WikiIndexService wikiIndexService;
    private final ObsidianExportFormatter obsidianExportFormatter;
    private final WikiConfig wikiConfig;
    private final VaultWatchService vaultWatchService;
    private final MocGeneratorService mocGeneratorService;
    private final CompiledCorpusRegistry compiledCorpusRegistry;

    /** 生效的页面生成并发度（来自 {@code wiki.ingest-concurrency}，夹在 [1, 16] 内） */
    private final int pageGenConcurrency;

    /**
     * 页面生成线程池（受控并发）。
     * <p>
     * 实体/概念/源页面的 LLM 生成互相独立，串行执行是"添加剪藏慢"的主要来源，
     * 故此池用于并行生成页面。使用有界队列 + {@link ThreadPoolExecutor.CallerRunsPolicy}
     * 做背压：队列满时由提交线程自己执行，既不丢任务也不会无限堆积请求。
     * </p>
     */
    private final ExecutorService pageGenExecutor;

    /**
     * 当前 ingest 批次的输入字符数累计（粗略估算，用于 token 消耗近似）。
     * <p>
     * 由于现有 AiService 方法不返回 token 信息，采用字符数 / 4 的粗略估算。
     * 在 {@link #ingestBatch} 开头重置，抽取阶段直接累加；页面生成阶段由各并发任务
     * 在 {@link PageUpdateOutcome} 中带回，等所有任务结束后在提交线程上统一累加，
     * 因此这些字段只在 wiki-ingest-worker 单线程上被写，不参与并发竞争。
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
     * @param compiledCorpusRegistry  增量编译注册表（内容 checksum 去重）
     */
    public BatchIngestService(AiService aiService,
                              WikiPageService wikiPageService,
                              WikiIndexService wikiIndexService,
                              ObsidianExportFormatter obsidianExportFormatter,
                              WikiConfig wikiConfig,
                              VaultWatchService vaultWatchService,
                              MocGeneratorService mocGeneratorService,
                              CompiledCorpusRegistry compiledCorpusRegistry) {
        this.aiService = aiService;
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.obsidianExportFormatter = obsidianExportFormatter;
        this.wikiConfig = wikiConfig;
        this.vaultWatchService = vaultWatchService;
        this.mocGeneratorService = mocGeneratorService;
        this.compiledCorpusRegistry = compiledCorpusRegistry;

        int configured = wikiConfig.getIngestConcurrency();
        int effective = Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, configured));
        if (effective != configured) {
            log.warn("[Wiki] ingest-concurrency={} out of range, clamped to {}", configured, effective);
        }
        this.pageGenConcurrency = effective;
        this.pageGenExecutor = new ThreadPoolExecutor(
                effective, effective,
                60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(effective * 4),
                r -> {
                    Thread t = new Thread(r, "wiki-page-gen-worker");
                    t.setDaemon(true);
                    return t;
                },
                new ThreadPoolExecutor.CallerRunsPolicy());
        log.info("[Wiki] Page generation concurrency = {}", effective);
    }

    /**
     * 容器销毁时关闭页面生成线程池，避免线程泄漏。
     */
    @PreDestroy
    public void shutdown() {
        pageGenExecutor.shutdown();
        log.info("[Wiki] Page generation executor shut down");
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

        // 增量编译：确保已编译注册表已加载，并重置本次跳过统计
        if (!compiledCorpusRegistry.isLoaded()) {
            compiledCorpusRegistry.load();
        }
        compiledCorpusRegistry.resetDedupSkipped();

        // 重置 token 估算累计
        currentIngestInputChars = 0;
        currentIngestOutputChars = 0;

        int skipped = 0;
        int processedCount = 0;

        // 页面生成阶段的统计与 token 估算：并发任务各自记录在 PageUpdateOutcome 中，
        // 任务结束后在此汇总，避免多线程写同一份可变状态
        PageUpdateOutcome total = new PageUpdateOutcome();

        try {
            // 1. 读取所有源文件内容（增量编译：先按内容校验和去重，命中已编译的直接跳过）
            Map<Path, String> contentByFile = new LinkedHashMap<>();
            for (Path file : sourceFiles) {
                String content = readSourceFile(file);
                String hash = compiledCorpusRegistry.checksum(content);
                if (compiledCorpusRegistry.isCompiled(hash)) {
                    log.info("[Wiki] Content unchanged (hash={}), skipping re-compile for {}",
                            hash, file);
                    compiledCorpusRegistry.incrementDedupSkipped();
                    skipped++;
                    continue;
                }
                contentByFile.put(file, content);
            }

            // 若全部命中增量跳过，直接收尾返回（不调用 LLM）
            if (contentByFile.isEmpty()) {
                for (Path file : sourceFiles) {
                    try {
                        vaultWatchService.markAsProcessed(file);
                    } catch (Exception e) {
                        log.warn("[Wiki] Failed to mark file as processed [{}]: {}", file, e.getMessage());
                    }
                }
                // 增量跳过也刷新最近 ingest 时间戳，避免超时误触发
                vaultWatchService.markIngestTriggered();
                stats.put("status", "success");
                stats.put("sourceCount", processedCount);
                stats.put("pagesUpdated", 0);
                stats.put("newEntities", 0);
                stats.put("newConcepts", 0);
                stats.put("contradictions", 0);
                stats.put("skipped", skipped);
                stats.put("dedupSkipped", skipped);
                stats.put("tokenEstimate", 0);
                stats.put("inputChars", 0);
                stats.put("outputChars", 0);
                stats.put("message", "All " + skipped + " sources unchanged, skipped re-compile (incremental)");
                log.info("[Wiki] All sources unchanged, incremental ingest skipped {} file(s)", skipped);
                return stats;
            }

            List<Path> activeFiles = new ArrayList<>(contentByFile.keySet());
            List<String> contents = new ArrayList<>(contentByFile.values());
            List<String> sourceUrls = new ArrayList<>(activeFiles.size());
            List<String> sourceFileNames = new ArrayList<>(activeFiles.size());
            for (Path file : activeFiles) {
                sourceUrls.add(parseSourceUrl(contentByFile.get(file)));
                sourceFileNames.add(file.getFileName().toString());
            }

            // 2. 批量抽取实体与概念（一次 LLM 调用）
            List<WikiExtractionResult> extractions = aiService.batchExtractEntitiesAndConcepts(contents);
            log.info("[Wiki] Batch extraction returned {} results for {} sources",
                    extractions.size(), activeFiles.size());

            // 批量抽取阶段 token 估算：输入 = 所有源文件内容长度之和
            // 输出 = 粗略估算每个 extraction 结果约 200 字符
            currentIngestInputChars += contents.stream().mapToLong(String::length).sum();
            currentIngestOutputChars += (long) extractions.size() * 200;

            // 3. 按抽取结果收集页面生成任务
            //    每个实体/概念/源页面都要独立调用一次 LLM，这些页面相互独立，故统一收集
            //    后交给线程池并发执行；按「页面键」分组保证同一页面的多次更新仍按源顺序串行
            Map<String, List<PageTask>> taskChains = new LinkedHashMap<>();
            for (WikiExtractionResult result : extractions) {
                int idx = result.getIndex();
                if (idx < 0 || idx >= activeFiles.size()) {
                    log.warn("[Wiki] Extraction result index {} out of range, skipping", idx);
                    continue;
                }
                String sourceContent = contents.get(idx);
                String sourceUrl = sourceUrls.get(idx);
                String sourceFileName = sourceFileNames.get(idx);
                String sourceSummary = result.getSummary() != null ? result.getSummary() : "";

                // 3a. 实体
                for (String entityName : safeList(result.getEntities())) {
                    addPageTask(taskChains, "entity", entityName,
                            sourceSummary, sourceUrl, sourceFileName, sourceContent);
                }

                // 3b. 概念
                for (String conceptName : safeList(result.getConcepts())) {
                    addPageTask(taskChains, "concept", conceptName,
                            sourceSummary, sourceUrl, sourceFileName, sourceContent);
                }

                // 3c. 源页面
                addSourcePageTask(taskChains, sourceFileName, sourceUrl, sourceContent);

                processedCount++;
            }

            // 4. 并发生成所有页面（并发度为 1 或只有一个页面时自动退化为串行）
            total.merge(runPageTasks(taskChains));
            currentIngestInputChars += total.inputChars;
            currentIngestOutputChars += total.outputChars;
            skipped += total.skippedCount;

            // 5. 更新日志
            wikiIndexService.appendLog("ingest",
                    "Batch ingest: " + activeFiles.size() + " sources, " + total.updatedCount + " pages updated");

            // 6. 标记所有源文件为已处理，并登记本次实际编译的内容校验和
            for (Path file : activeFiles) {
                try {
                    vaultWatchService.markAsProcessed(file);
                    String hash = compiledCorpusRegistry.checksum(contentByFile.get(file));
                    compiledCorpusRegistry.markCompiled(hash);
                } catch (Exception e) {
                    log.warn("[Wiki] Failed to mark file as processed [{}]: {}", file, e.getMessage());
                }
            }
            // 增量编译：已编译注册表落盘
            compiledCorpusRegistry.persist();

            // 7. 生成所有 MOC 索引页（失败不影响 ingest 结果）
            try {
                mocGeneratorService.generateAllMocs();
            } catch (Exception e) {
                log.warn("[Wiki] MOC generation failed after ingest: {}", e.getMessage(), e);
            }

            // 8. 标记 ingest 已触发，更新超时判断时间戳
            vaultWatchService.markIngestTriggered();

            stats.put("status", "success");
            stats.put("sourceCount", processedCount);
            stats.put("pagesUpdated", total.updatedCount);
            stats.put("newEntities", total.newEntities);
            stats.put("newConcepts", total.newConcepts);
            stats.put("contradictions", total.contradictionCount);
            stats.put("skipped", skipped);
            stats.put("dedupSkipped", compiledCorpusRegistry.getDedupSkipped());
            // token 消耗估算：粗略按 4 字符 ≈ 1 token
            stats.put("tokenEstimate", (currentIngestInputChars + currentIngestOutputChars) / 4);
            stats.put("inputChars", currentIngestInputChars);
            stats.put("outputChars", currentIngestOutputChars);
            stats.put("message", "Ingested " + processedCount + " sources: "
                    + total.updatedCount + " pages updated, "
                    + total.newEntities + " new entities, "
                    + total.newConcepts + " new concepts, "
                    + total.contradictionCount + " contradictions, "
                    + skipped + " skipped");
            log.info("[Wiki] Batch ingest complete: {}", stats.get("message"));
            return stats;
        } catch (Exception e) {
            log.error("[Wiki] Batch ingest failed: {}", e.getMessage(), e);
            stats.put("status", "error");
            stats.put("sourceCount", processedCount);
            stats.put("pagesUpdated", total.updatedCount);
            stats.put("newEntities", total.newEntities);
            stats.put("newConcepts", total.newConcepts);
            stats.put("contradictions", total.contradictionCount);
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
            outcome.skippedCount = 1;
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
                    outcome.contradictionCount = 1;
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
            if ("entity".equals(pageType)) {
                outcome.newEntities = 1;
            } else {
                outcome.newConcepts = 1;
            }
        }
        outcome.updatedCount = 1;

        // 更新索引
        wikiIndexService.updateIndex(pageType, pageName, sourceSummary, LocalDate.now().toString());

        // token 估算：页面生成阶段输入 = sourceSummary + existingContent，输出 = pageBody
        // （只写入本任务私有的 outcome，由提交线程在任务结束后统一汇总，避免并发写共享状态）
        outcome.inputChars = sourceSummary.length()
                + (existingContent != null ? existingContent.length() : 0);
        outcome.outputChars = pageBody != null ? pageBody.length() : 0;

        return outcome;
    }

    /**
     * 生成源页面。
     *
     * @param sourceContent  源原始内容
     * @param sourceUrl      源 URL
     * @param sourceFileName 源文件名
     * @return 处理结果（updatedCount=1，并携带本页的 token 估算字符数）
     */
    private PageUpdateOutcome generateSourcePage(String sourceContent, String sourceUrl, String sourceFileName) {
        PageUpdateOutcome outcome = new PageUpdateOutcome();
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

        outcome.updatedCount = 1;
        // token 估算：来源页生成输入 = sourceContent，输出 = pageBody
        outcome.inputChars = sourceContent != null ? sourceContent.length() : 0;
        outcome.outputChars = pageBody != null ? pageBody.length() : 0;
        return outcome;
    }

    /**
     * 收集一个实体/概念页面生成任务。
     * <p>
     * 名称经 trim 后非空才入队（与 {@link #processPage} 的空名提前返回语义一致）；
     * 任务按其「页面键」（类型 + 名称）归入同一条串行链，保证同一页面的多次更新
     * 仍严格按源顺序执行。
     * </p>
     *
     * @param taskChains     页面键 → 串行任务链
     * @param pageType       页面类型（entity / concept）
     * @param pageName       页面名称（未 trim）
     * @param sourceSummary  来源摘要
     * @param sourceUrl      来源 URL
     * @param sourceFileName 来源文件名
     * @param sourceContent  来源原始内容
     */
    private void addPageTask(Map<String, List<PageTask>> taskChains, String pageType, String pageName,
                             String sourceSummary, String sourceUrl, String sourceFileName, String sourceContent) {
        if (pageName == null || pageName.trim().isEmpty()) {
            return;
        }
        String trimmed = pageName.trim();
        taskChains.computeIfAbsent(pageType + PAGE_KEY_SEPARATOR + trimmed, k -> new ArrayList<>())
                .add(new PageTask(pageType, trimmed, sourceSummary, sourceUrl, sourceFileName, sourceContent, false));
    }

    /**
     * 收集一个源页面生成任务（页面名由文件名清理得出，同名文件会归入同一条串行链）。
     *
     * @param taskChains     页面键 → 串行任务链
     * @param sourceFileName 来源文件名
     * @param sourceUrl      来源 URL
     * @param sourceContent  来源原始内容
     */
    private void addSourcePageTask(Map<String, List<PageTask>> taskChains, String sourceFileName,
                                   String sourceUrl, String sourceContent) {
        String pageName = sanitizePageName(sourceFileName);
        taskChains.computeIfAbsent("source" + PAGE_KEY_SEPARATOR + pageName, k -> new ArrayList<>())
                .add(new PageTask("source", pageName, "", sourceUrl, sourceFileName, sourceContent, true));
    }

    /**
     * 执行所有页面生成任务链。
     * <p>
     * 并发度为 1（配置为串行）或只有一条链时直接在当前线程串行执行，不引入线程切换开销；
     * 否则提交到 {@link #pageGenExecutor} 并行执行（不同页面并行、同一页面内的多次更新串行），
     * 并在此阻塞等待全部完成后再汇总统计，保证对外可见的结果与串行版本一致。
     * </p>
     *
     * @param taskChains 页面键 → 串行任务链
     * @return 汇总后的处理结果
     */
    private PageUpdateOutcome runPageTasks(Map<String, List<PageTask>> taskChains) {
        PageUpdateOutcome total = new PageUpdateOutcome();
        if (taskChains.isEmpty()) {
            return total;
        }
        List<List<PageTask>> chains = new ArrayList<>(taskChains.values());
        if (pageGenConcurrency <= 1 || chains.size() == 1) {
            for (List<PageTask> chain : chains) {
                total.merge(runPageTaskChain(chain));
            }
            return total;
        }

        log.info("[Wiki] Generating {} page(s) with concurrency {}", chains.size(), pageGenConcurrency);
        List<Future<PageUpdateOutcome>> futures = new ArrayList<>(chains.size());
        for (List<PageTask> chain : chains) {
            futures.add(pageGenExecutor.submit(() -> runPageTaskChain(chain)));
        }
        for (Future<PageUpdateOutcome> future : futures) {
            try {
                total.merge(future.get());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("[Wiki] Page generation interrupted, remaining pages may be incomplete");
                break;
            } catch (ExecutionException e) {
                Throwable cause = e.getCause() != null ? e.getCause() : e;
                log.error("[Wiki] Page generation task failed: {}", cause.getMessage(), cause);
            }
        }
        return total;
    }

    /**
     * 串行执行一条任务链（同一页面的多次更新），单个任务失败只记录日志、不影响后续任务。
     *
     * @param chain 同一页面的任务链（按源顺序）
     * @return 该链的处理结果汇总
     */
    private PageUpdateOutcome runPageTaskChain(List<PageTask> chain) {
        PageUpdateOutcome chainOutcome = new PageUpdateOutcome();
        for (PageTask task : chain) {
            try {
                PageUpdateOutcome outcome = task.sourcePage()
                        ? generateSourcePage(task.sourceContent(), task.sourceUrl(), task.sourceFileName())
                        : processPage(task.pageType(), task.pageName(), task.sourceSummary(),
                                task.sourceUrl(), task.sourceFileName(), task.sourceContent());
                chainOutcome.merge(outcome);
            } catch (Exception e) {
                if (task.sourcePage()) {
                    log.error("[Wiki] Failed to generate source page for '{}': {}",
                            task.sourceFileName(), e.getMessage(), e);
                } else {
                    log.error("[Wiki] Failed to process {} '{}': {}",
                            task.pageType(), task.pageName(), e.getMessage(), e);
                }
            }
        }
        return chainOutcome;
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
     * 单个页面生成任务：一条实体 / 概念 / 源页面的生成请求及其上下文。
     * <p>
     * 任务为不可变记录，可安全地跨线程传递；同一条链上的多个任务代表同一页面
     * 被多个源先后命中，需按源顺序串行执行。
     * </p>
     *
     * @param pageType       页面类型（entity / concept / source）
     * @param pageName       页面名称（已 trim / 已清理）
     * @param sourceSummary  来源摘要
     * @param sourceUrl      来源 URL
     * @param sourceFileName 来源文件名
     * @param sourceContent  来源原始内容
     * @param sourcePage     是否为源页面任务（true 时走 {@link #generateSourcePage}）
     */
    private record PageTask(String pageType, String pageName, String sourceSummary,
                            String sourceUrl, String sourceFileName, String sourceContent,
                            boolean sourcePage) {
    }

    /**
     * 页面处理结果内部 DTO（并发安全的关键：每个任务只写自己私有的实例）。
     * <p>
     * 串行版本依赖直接累加实例字段统计，并发后改为每个任务 / 每条链返回一份结果，
     * 由提交线程串行 {@link #merge} 汇总，从而完全不共享可变状态。
     * </p>
     */
    private static class PageUpdateOutcome {
        /** 成功创建或更新的页面数 */
        int updatedCount = 0;
        /** 其中新建的实体页面数 */
        int newEntities = 0;
        /** 其中新建的概念页面数 */
        int newConcepts = 0;
        /** 检出矛盾的页面数 */
        int contradictionCount = 0;
        /** 因手工编辑保护而跳过 AI 更新的页面数 */
        int skippedCount = 0;
        /** 本部分产生的 token 估算输入字符数 */
        long inputChars = 0;
        /** 本部分产生的 token 估算输出字符数 */
        long outputChars = 0;

        /**
         * 合并另一个结果（调用方保证单线程汇总，故无需同步）。
         *
         * @param other 待合并结果，可为 null
         */
        void merge(PageUpdateOutcome other) {
            if (other == null) {
                return;
            }
            updatedCount += other.updatedCount;
            newEntities += other.newEntities;
            newConcepts += other.newConcepts;
            contradictionCount += other.contradictionCount;
            skippedCount += other.skippedCount;
            inputChars += other.inputChars;
            outputChars += other.outputChars;
        }
    }
}
