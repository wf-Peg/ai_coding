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

    private final WikiConfig config;
    private final WikiPageService pageService;

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
     * 若条目已存在则更新该行，否则在对应 section 末尾追加；同时刷新顶部统计信息。
     * </p>
     *
     * @param pageType     页面类型
     * @param pageName     页面名称（不含扩展名）
     * @param summary      页面摘要
     * @param updatedDate  更新日期字符串（yyyy-MM-dd）
     */
    public void updateIndex(String pageType, String pageName, String summary, String updatedDate) {
        try {
            Path indexPath = getIndexPath();
            Path parent = indexPath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }

            String existing = pageService.readPage(indexPath);
            if (existing == null || existing.isEmpty()) {
                existing = "# Wiki Index\n\n";
            }

            String sectionTitle = TYPE_TO_SECTION.getOrDefault(pageType, capitalize(pageType));
            String newEntry = "- [[" + pageName + "]] — " + summary + " (updated: " + updatedDate + ")";

            String updated = rebuildIndex(existing, sectionTitle, pageName, newEntry);
            pageService.updatePage(indexPath, updated);
            log.info("[Wiki] Updated index for [{}/{}]", pageType, pageName);
        } catch (IOException e) {
            log.error("[Wiki] Failed to update index [{}/{}]: {}", pageType, pageName, e.getMessage());
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
