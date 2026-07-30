package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * MOC（Map of Content）索引页生成服务。
 * <p>
 * 为每个页面类型（entity/concept/synthesis/source）生成 MOC 索引页，按日期倒序
 * 列出该分类下所有 Wiki 页面的 wiki-link，并附带标签云。ingest 后可自动更新相关 MOC。
 * </p>
 *
 * <h3>MOC 文件结构</h3>
 * <pre>
 * ---
 * date: 2024-01-01
 * tags:
 *   - moc
 *   - entity
 * category: moc
 * ---
 *
 * # MOC: 实体
 *
 * &gt; [!info] Map of Content
 * &gt; 本页面是 实体 分类的内容索引，自动生成。
 *
 * ## 页面列表（按更新时间倒序）
 *
 * - [[PageName]] — summary (updated: 2024-01-01)
 *
 * ## 标签云
 *
 * #tag1 #tag2 #tag3
 * </pre>
 *
 * <h3>失败降级</h3>
 * <p>
 * 单个 MOC 生成失败不影响其他类型，异常被捕获并记录。ingest 后的 MOC 更新
 * 失败也不会影响 ingest 主流程结果。
 * </p>
 */
@Service
public class MocGeneratorService {

    private static final Logger log = LoggerFactory.getLogger(MocGeneratorService.class);

    /** frontmatter 中 updated 字段正则 */
    private static final Pattern UPDATED_PATTERN =
            Pattern.compile("(?m)^updated:\\s*(.+?)\\s*$");

    /** frontmatter 中 tags 列表条目行（如 "  - tag"） */
    private static final Pattern TAG_ENTRY_PATTERN =
            Pattern.compile("^\\s+-\\s+(.+?)\\s*$");

    /** 页面类型 → 中文显示名映射 */
    private static final Map<String, String> CATEGORY_DISPLAY_NAMES = new LinkedHashMap<>();

    static {
        CATEGORY_DISPLAY_NAMES.put("entity", "实体");
        CATEGORY_DISPLAY_NAMES.put("concept", "概念");
        CATEGORY_DISPLAY_NAMES.put("synthesis", "综述");
        CATEGORY_DISPLAY_NAMES.put("source", "来源");
    }

    private final WikiPageService wikiPageService;
    private final WikiIndexService wikiIndexService;
    private final WikiConfig wikiConfig;
    private final ObsidianExportFormatter obsidianExportFormatter;

    /**
     * 构造器注入。
     *
     * @param wikiPageService         Wiki 页面 CRUD
     * @param wikiIndexService        索引与日志维护
     * @param wikiConfig              Wiki 配置
     * @param obsidianExportFormatter Obsidian 格式化（frontmatter）
     */
    public MocGeneratorService(WikiPageService wikiPageService,
                               WikiIndexService wikiIndexService,
                               WikiConfig wikiConfig,
                               ObsidianExportFormatter obsidianExportFormatter) {
        this.wikiPageService = wikiPageService;
        this.wikiIndexService = wikiIndexService;
        this.wikiConfig = wikiConfig;
        this.obsidianExportFormatter = obsidianExportFormatter;
    }

    /**
     * 为指定页面类型生成 MOC 索引页。
     * <p>
     * 读取该类型所有页面，解析 frontmatter 中的 {@code updated} 和 {@code tags} 字段，
     * 按 updated 日期倒序排序后生成 MOC 内容，写入 {@code MOC_{CategoryDisplayName}.md}，
     * 最后追加日志。
     * </p>
     *
     * @param categoryName 页面类型（entity/concept/synthesis/source）
     */
    public void generateMoc(String categoryName) {
        try {
            String categoryDisplayName = CATEGORY_DISPLAY_NAMES.getOrDefault(categoryName, categoryName);

            // 1. 获取该类型所有页面
            List<Path> pages = wikiPageService.listPages(categoryName);

            // 2. 解析每个页面
            List<MocPageInfo> pageInfos = new ArrayList<>();
            Set<String> allTags = new LinkedHashSet<>();
            for (Path pagePath : pages) {
                String content = wikiPageService.readPage(pagePath);
                if (content == null) {
                    continue;
                }
                String pageName = extractPageName(pagePath);
                String updated = extractUpdatedDate(content);
                List<String> tags = extractTags(content);
                allTags.addAll(tags);
                String firstLineSummary = extractFirstLineSummary(content);
                pageInfos.add(new MocPageInfo(pageName, updated, tags, firstLineSummary));
            }

            // 3. 按 updated 日期倒序排序（null 排末尾）
            pageInfos.sort(Comparator.comparing(
                    (MocPageInfo p) -> p.updated == null ? "" : p.updated,
                    Comparator.reverseOrder()));

            // 4. 生成 frontmatter（tags 含 "moc" 和 categoryName；aliases 含 MOC 中文名和英文名，方便 wiki-link 容错）
            List<String> frontmatterTags = new ArrayList<>();
            frontmatterTags.add("moc");
            frontmatterTags.add(categoryName);
            String frontmatter = obsidianExportFormatter.generateFrontmatter(
                    LocalDate.now(), frontmatterTags, "moc", List.of(),
                    List.of("MOC_" + categoryDisplayName, categoryDisplayName), "moc");

            // 5. 生成 MOC 内容
            String mocContent = buildMocContent(frontmatter, categoryDisplayName, pageInfos, allTags);

            // 6. 写入文件
            Path mocPath = getMocPath(categoryDisplayName);
            Path parent = mocPath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            Files.writeString(mocPath, mocContent);
            log.info("[MOC] Generated MOC for {} ({} pages): {}", categoryDisplayName, pageInfos.size(), mocPath);

            // 7. 追加日志
            wikiIndexService.appendLog("moc", "Generated MOC for " + categoryDisplayName);
        } catch (Exception e) {
            log.error("[MOC] Failed to generate MOC for [{}]: {}", categoryName, e.getMessage(), e);
        }
    }

    /**
     * 为所有页面类型生成 MOC 索引页。
     * <p>
     * 遍历 {@link WikiConfig#getPageTypes()}，对每个类型调用 {@link #generateMoc}。
     * 单个类型失败不影响其他类型。
     * </p>
     */
    public void generateAllMocs() {
        for (String pageType : wikiConfig.getPageTypes()) {
            try {
                generateMoc(pageType);
            } catch (Exception e) {
                log.error("[MOC] Failed to generate MOC for [{}]: {}", pageType, e.getMessage(), e);
            }
        }
    }

    /**
     * 仅更新指定类型的 MOC 索引页（ingest 后调用）。
     * <p>
     * 对传入的每个页面类型调用 {@link #generateMoc}。单个类型失败不影响其他类型。
     * </p>
     *
     * @param pageTypes 需要更新的页面类型列表
     */
    public void updateMocsForTypes(List<String> pageTypes) {
        if (pageTypes == null || pageTypes.isEmpty()) {
            return;
        }
        for (String pageType : pageTypes) {
            try {
                generateMoc(pageType);
            } catch (Exception e) {
                log.error("[MOC] Failed to update MOC for [{}]: {}", pageType, e.getMessage(), e);
            }
        }
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 构建 MOC 文件完整内容。
     *
     * @param frontmatter           frontmatter 字符串
     * @param categoryDisplayName   分类显示名（如 "实体"）
     * @param pageInfos             页面信息列表（已排序）
     * @param allTags               所有页面标签集合
     * @return MOC 文件内容
     */
    private String buildMocContent(String frontmatter, String categoryDisplayName,
                                   List<MocPageInfo> pageInfos, Set<String> allTags) {
        StringBuilder sb = new StringBuilder();
        sb.append(frontmatter);
        sb.append("# MOC: ").append(categoryDisplayName).append("\n\n");
        sb.append("> [!info] Map of Content\n");
        sb.append("> 本页面是 ").append(categoryDisplayName).append(" 分类的内容索引，自动生成。\n\n");
        sb.append("## 页面列表（按更新时间倒序）\n\n");
        if (pageInfos.isEmpty()) {
            sb.append("_暂无页面_\n\n");
        } else {
            for (MocPageInfo info : pageInfos) {
                sb.append("- [[")
                        .append(info.pageName)
                        .append("]] — ")
                        .append(info.firstLineSummary)
                        .append(" (updated: ")
                        .append(info.updated != null ? info.updated : "unknown")
                        .append(")\n");
            }
            sb.append("\n");
        }
        sb.append("## 标签云\n\n");
        if (allTags.isEmpty()) {
            sb.append("_暂无标签_\n");
        } else {
            StringBuilder tagCloud = new StringBuilder();
            for (String tag : allTags) {
                tagCloud.append("#").append(tag).append(" ");
            }
            sb.append(tagCloud.toString().trim()).append("\n");
        }
        return sb.toString();
    }

    /**
     * 返回 MOC 文件路径：{@code {vaultPath}/{wikiDirName}/MOC_{CategoryDisplayName}.md}
     *
     * @param categoryDisplayName 分类显示名
     * @return MOC 文件路径
     */
    private Path getMocPath(String categoryDisplayName) {
        return Paths.get(wikiConfig.getVaultPath())
                .resolve(wikiConfig.getWikiDirName())
                .resolve("MOC_" + categoryDisplayName + ".md");
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
     * 从页面内容 frontmatter 中提取 tags 列表。
     * <p>
     * 简单解析：找到 {@code tags:} 行后，收集后续形如 {@code "  - tag"} 的条目行，
     * 直到遇到不匹配的行。
     * </p>
     *
     * @param content 页面内容
     * @return 标签列表；不存在时返回空列表
     */
    private List<String> extractTags(String content) {
        List<String> tags = new ArrayList<>();
        if (content == null || content.isEmpty()) {
            return tags;
        }
        String[] lines = content.split("\n", -1);
        boolean inTags = false;
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("tags:")) {
                inTags = true;
                continue;
            }
            if (inTags) {
                Matcher m = TAG_ENTRY_PATTERN.matcher(line);
                if (m.matches()) {
                    tags.add(m.group(1).trim());
                } else {
                    break;
                }
            }
        }
        return tags;
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
     * 提取页面正文的摘要（第一个非空行，去除标题标记）。
     * <p>
     * 跳过 frontmatter 块，取正文中第一个非空行，去除前导 {@code #} 标题标记。
     * </p>
     *
     * @param content 页面内容
     * @return 摘要字符串；无正文时返回空字符串
     */
    private String extractFirstLineSummary(String content) {
        if (content == null || content.isEmpty()) {
            return "";
        }
        String body = stripFrontmatter(content);
        for (String line : body.split("\n", -1)) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String summary = trimmed.replaceAll("^#+\\s*", "");
            if (!summary.isEmpty()) {
                return summary;
            }
        }
        return "";
    }

    /**
     * 剥离 frontmatter 块，返回正文内容。
     *
     * @param content 原始内容
     * @return 正文内容；无 frontmatter 时返回原内容
     */
    private String stripFrontmatter(String content) {
        if (!content.startsWith("---")) {
            return content;
        }
        int secondIdx = content.indexOf("---", 3);
        if (secondIdx < 0) {
            return content;
        }
        int bodyStart = secondIdx + 3;
        if (bodyStart < content.length()) {
            return content.substring(bodyStart);
        }
        return "";
    }

    /**
     * MOC 页面信息内部 DTO。
     */
    private static class MocPageInfo {
        final String pageName;
        final String updated;
        final List<String> tags;
        final String firstLineSummary;

        MocPageInfo(String pageName, String updated, List<String> tags, String firstLineSummary) {
            this.pageName = pageName;
            this.updated = updated;
            this.tags = tags;
            this.firstLineSummary = firstLineSummary;
        }
    }
}
