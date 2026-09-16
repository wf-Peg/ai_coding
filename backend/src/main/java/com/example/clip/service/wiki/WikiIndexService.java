package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Wiki 索引与日志服务。
 * <p>
 * 维护 {@code wiki/index.md}（页面索引，含统计信息和按类型分组的条目）
 * 和 {@code wiki/log.md}（追加写操作日志）。
 * </p>
 *
 * <h3>index.md 结构</h3>
 * <pre>
 * # Wiki Index
 *
 * &gt; Total pages: 12 | Entities: 5 | Concepts: 3 | Synthesis: 2 | Sources: 2
 * &gt; Last updated: 2024-01-01
 *
 * ## Entities
 * - [[pageName]] — summary (updated: 2024-01-01)
 *
 * ## Concepts
 * ...
 * </pre>
 *
 * <h3>log.md 结构</h3>
 * <pre>
 * # Wiki Log
 *
 * ## [2024-01-01 12:30] CREATE | Page Title
 * </pre>
 */
@Service
public class WikiIndexService {

    private static final Logger log = LoggerFactory.getLogger(WikiIndexService.class);

    /** 日志时间戳格式：yyyy-MM-dd HH:mm */
    private static final DateTimeFormatter LOG_TIME_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    /** 索引中更新日期格式：yyyy-MM-dd */
    private static final DateTimeFormatter INDEX_DATE_FORMATTER =
            DateTimeFormatter.ISO_LOCAL_DATE;

    /** 页面类型 → section 标题映射 */
    private static final Map<String, String> TYPE_TO_SECTION = new LinkedHashMap<>();

    /** 索引条目行匹配：- [[pageName]] — summary (updated: date) */
    private static final Pattern INDEX_ENTRY_PATTERN =
            Pattern.compile("^- \\[\\[(.+?)\\]\\] — (.+?) \\(updated: (.+?)\\)$");

    static {
        TYPE_TO_SECTION.put("entity", "Entities");
        TYPE_TO_SECTION.put("concept", "Concepts");
        TYPE_TO_SECTION.put("synthesis", "Synthesis");
        TYPE_TO_SECTION.put("source", "Sources");
    }

    /** index.md 防抖合并时间：批量入库的连续更新只落盘一次，避免每次 updateIndex 全量重写 index.md（万级写放大） */
    private static final long INDEX_FLUSH_DELAY_MS = 1500;

    private final WikiConfig config;
    private final WikiPageService pageService;

    /** 待落盘的索引更新队列（updateIndex 只入队，防抖合并后一次写盘） */
    private final LinkedBlockingQueue<IndexUpdate> pendingIndexUpdates = new LinkedBlockingQueue<>();
    private final ScheduledExecutorService indexFlusher =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "wiki-index-flusher");
                t.setDaemon(true);
                return t;
            });
    private final AtomicBoolean flushScheduled = new AtomicBoolean(false);

    /** 一次待落盘的索引更新：目标 section 标题 + 页面名 + 新条目行 */
    private record IndexUpdate(String sectionTitle, String pageName, String newEntry) {}

    /**
     * 构造器注入。
     *
     * @param config      Wiki 配置
     * @param pageService Wiki 页面服务
     */
    public WikiIndexService(WikiConfig config, WikiPageService pageService) {
        this.config = config;
        this.pageService = pageService;
    }

    /**
     * 更新 index.md 中指定页面的条目。
     * <p>
     * 幂等：若条目已存在则替换该行，否则在对应 section 末尾追加。
     * <b>写盘防抖</b>：更新先入队，延迟 {@value #INDEX_FLUSH_DELAY_MS}ms 合并后一次写入
     * （批量入库/连续归档时避免每次都全量重写 index.md，详见 {@link #flushIndex()}）。
     * </p>
     *
     * @param pageType    页面类型
     * @param pageName    页面名称（不含扩展名）
     * @param summary     页面摘要
     * @param updatedDate 更新日期字符串（yyyy-MM-dd）
     */
    public void updateIndex(String pageType, String pageName, String summary, String updatedDate) {
        try {
            Path indexPath = getIndexPath();
            Path parent = indexPath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }

            String sectionTitle = TYPE_TO_SECTION.getOrDefault(pageType, capitalize(pageType));
            String newEntry = "- [[" + pageName + "]] — " + summary + " (updated: " + updatedDate + ")";

            pendingIndexUpdates.add(new IndexUpdate(sectionTitle, pageName, newEntry));
            scheduleFlush();
            log.info("[Wiki] Index update queued for [{}/{}]", pageType, pageName);
        } catch (IOException e) {
            log.error("[Wiki] Failed to queue index update [{}/{}]: {}", pageType, pageName, e.getMessage());
        }
    }

    /**
     * 立即合并写出所有待落盘的索引更新（供测试/维护调用）。
     * <p>
     * 将队列中的多条更新按顺序 apply 到当前 index.md 内容后<b>一次</b>写盘；
     * 写盘失败时回队，避免丢失更新。
     * </p>
     */
    public synchronized void flushIndex() {
        flushScheduled.set(false);
        List<IndexUpdate> batch = new ArrayList<>();
        pendingIndexUpdates.drainTo(batch);
        if (batch.isEmpty()) {
            return;
        }
        try {
            String existing = pageService.readPage(getIndexPath());
            if (existing == null || existing.isEmpty()) {
                existing = "# Wiki Index\n\n";
            }
            for (IndexUpdate u : batch) {
                existing = rebuildIndex(existing, u.sectionTitle(), u.pageName(), u.newEntry());
            }
            pageService.updatePage(getIndexPath(), existing);
            log.info("[Wiki] Flushed {} index update(s) to index.md", batch.size());
        } catch (Exception e) {
            // 失败回队，保证不丢更新
            pendingIndexUpdates.addAll(batch);
            log.error("[Wiki] Flush index failed, requeued {} update(s): {}", batch.size(), e.getMessage(), e);
        }
    }

    private void scheduleFlush() {
        if (flushScheduled.compareAndSet(false, true)) {
            indexFlusher.schedule(this::flushIndex, INDEX_FLUSH_DELAY_MS, TimeUnit.MILLISECONDS);
        }
    }

    /**
     * 向 log.md 追加一条操作日志。
     * <p>
     * 格式：{@code ## [{yyyy-MM-dd HH:mm}] {operationType} | {title}\n}，
     * 追加写，从不修改已有内容。
     * </p>
     *
     * @param operationType 操作类型（如 CREATE / UPDATE / INGEST）
     * @param title         操作标题
     */
    public void appendLog(String operationType, String title) {
        try {
            Path logPath = getLogPath();
            Path parent = logPath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            if (!Files.exists(logPath)) {
                Files.writeString(logPath, "# Wiki Log\n\n");
            }
            String timestamp = LocalDateTime.now().format(LOG_TIME_FORMATTER);
            String entry = "## [" + timestamp + "] " + operationType + " | " + title + "\n";
            Files.writeString(logPath, entry, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            log.info("[Wiki] Appended log: {} | {}", operationType, title);
        } catch (IOException e) {
            log.error("[Wiki] Failed to append log [{} | {}]: {}", operationType, title, e.getMessage());
        }
    }

    /**
     * 返回 index.md 的路径。
     *
     * @return {@code {vaultPath}/{wikiDirName}/index.md}
     */
    public Path getIndexPath() {
        return Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve("index.md");
    }

    /**
     * 返回 log.md 的路径。
     *
     * @return {@code {vaultPath}/{wikiDirName}/log.md}
     */
    public Path getLogPath() {
        return Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve("log.md");
    }

    /**
     * 重建索引内容：更新或追加条目，并刷新顶部统计信息。
     *
     * @param existing     原索引内容
     * @param sectionTitle 目标 section 标题（如 Entities）
     * @param pageName     页面名称
     * @param newEntry     新条目行
     * @return 重建后的索引内容
     */
    private String rebuildIndex(String existing, String sectionTitle, String pageName, String newEntry) {
        // 1. 解析所有 section 的条目（保持顺序）
        Map<String, List<String>> sectionEntries = parseSections(existing);

        // 2. 在目标 section 中更新或追加条目
        List<String> entries = sectionEntries.computeIfAbsent(sectionTitle, k -> new ArrayList<>());
        boolean found = false;
        for (int i = 0; i < entries.size(); i++) {
            Matcher m = INDEX_ENTRY_PATTERN.matcher(entries.get(i).trim());
            if (m.matches() && m.group(1).equals(pageName)) {
                entries.set(i, newEntry);
                found = true;
                break;
            }
        }
        if (!found) {
            entries.add(newEntry);
        }

        // 3. 重新生成 index.md
        return renderIndex(sectionEntries);
    }

    /**
     * 解析现有索引，按 section 标题分组条目。
     *
     * @param content 现有索引内容
     * @return section 标题 → 条目行列表（保持顺序）
     */
    private Map<String, List<String>> parseSections(String content) {
        Map<String, List<String>> sections = new LinkedHashMap<>();
        // 确保所有已知 section 都存在
        for (String title : TYPE_TO_SECTION.values()) {
            sections.put(title, new ArrayList<>());
        }

        String currentSection = null;
        for (String line : content.split("\n", -1)) {
            String trimmed = line.trim();
            if (trimmed.startsWith("## ")) {
                currentSection = trimmed.substring(3).trim();
                sections.computeIfAbsent(currentSection, k -> new ArrayList<>());
            } else if (trimmed.startsWith("- [[") && currentSection != null) {
                sections.get(currentSection).add(line);
            }
        }
        return sections;
    }

    /**
     * 渲染索引内容：顶部统计 + 各 section 条目。
     *
     * @param sectionEntries section 标题 → 条目行列表
     * @return 完整的 index.md 内容
     */
    private String renderIndex(Map<String, List<String>> sectionEntries) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Wiki Index\n\n");

        // 顶部统计
        int total = sectionEntries.values().stream().mapToInt(List::size).sum();
        sb.append("> Total pages: ").append(total);
        for (Map.Entry<String, List<String>> e : sectionEntries.entrySet()) {
            sb.append(" | ").append(e.getKey()).append(": ").append(e.getValue().size());
        }
        sb.append("\n");
        sb.append("> Last updated: ").append(LocalDate.now().format(INDEX_DATE_FORMATTER));
        sb.append("\n\n");

        // 各 section
        for (Map.Entry<String, List<String>> e : sectionEntries.entrySet()) {
            sb.append("## ").append(e.getKey()).append("\n");
            for (String entry : e.getValue()) {
                sb.append(entry).append("\n");
            }
            sb.append("\n");
        }

        return sb.toString();
    }

    /**
     * 将字符串首字母大写。
     *
     * @param s 原始字符串
     * @return 首字母大写的字符串
     */
    private String capitalize(String s) {
        if (s == null || s.isEmpty()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
