package com.example.clip.service.obsidian;

import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Obsidian 兼容的 Markdown 格式化服务。
 * <p>
 * 负责将归档内容格式化为 Obsidian 原生语法，包括：
 * <ul>
 *   <li>YAML frontmatter 生成（Obsidian properties）</li>
 *   <li>Obsidian 标准标签格式（{@code #tag}）</li>
 *   <li>Callout 语法包裹（{@code > [!type] title}）</li>
 *   <li>Obsidian 友好的文件名生成</li>
 * </ul>
 * </p>
 *
 * <p>
 * 所有格式化行为均可通过 {@link ObsidianExportConfig} 配置，包括
 * frontmatter 字段列表、Callout 类型映射、文件名日期格式。
 * </p>
 */
@Service
public class ObsidianExportFormatter {

    private final ObsidianExportConfig config;

    /**
     * 构造器注入配置。
     *
     * @param config Obsidian 导出配置
     */
    public ObsidianExportFormatter(ObsidianExportConfig config) {
        this.config = config;
    }

    /**
     * 生成 YAML frontmatter 块（向后兼容重载）。
     * <p>
     * 委托到 {@link #generateFrontmatter(LocalDate, List, String, List, List, String)}，
     * {@code aliases} 传 null，{@code type} 默认使用 {@code categoryName}。
     * 旧调用方无需修改即可正常工作。
     * </p>
     *
     * @param date         整理日期
     * @param tags         标签列表（将自动去重）
     * @param categoryName 分类中文名
     * @param sourceUrls   来源 URL 列表（可为空）
     * @return {@code ---\n...\n---\n\n} 格式的 YAML frontmatter 字符串
     */
    public String generateFrontmatter(LocalDate date, List<String> tags, String categoryName, List<String> sourceUrls) {
        return generateFrontmatter(date, tags, categoryName, sourceUrls, null, categoryName);
    }

    /**
     * 生成 YAML frontmatter 块（完整版，支持 aliases / updated / type 字段）。
     * <p>
     * 根据 {@link ObsidianExportConfig#getFrontmatterFields()} 中配置的字段顺序
     * 生成 frontmatter，仅输出配置中包含的字段。新增字段说明：
     * <ul>
     *   <li>{@code aliases}：Obsidian 别名列表，用于 wiki-link 容错
     *       （如页面名 "React" 可设 aliases: ["ReactJS", "React.js"]）</li>
     *   <li>{@code updated}：更新日期，Dataview 排序用</li>
     *   <li>{@code type}：页面类型（entity/concept/synthesis/source/moc），Dataview 查询用</li>
     * </ul>
     * </p>
     *
     * @param date         整理日期（同时用于 date 和 updated 字段）
     * @param tags         标签列表（将自动去重）
     * @param categoryName 分类中文名
     * @param sourceUrls   来源 URL 列表（可为空）
     * @param aliases      Obsidian 别名列表（可为 null 或空，则不输出 aliases 字段）
     * @param type         页面类型（可为 null 或空，则不输出 type 字段）
     * @return {@code ---\n...\n---\n\n} 格式的 YAML frontmatter 字符串
     */
    public String generateFrontmatter(LocalDate date, List<String> tags, String categoryName,
                                       List<String> sourceUrls, List<String> aliases, String type) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");

        // 标签去重（保持顺序）
        LinkedHashSet<String> uniqueTags = new LinkedHashSet<>();
        if (tags != null) {
            for (String tag : tags) {
                if (tag != null && !tag.trim().isEmpty()) {
                    uniqueTags.add(tag.trim());
                }
            }
        }

        // 来源 URL 过滤
        List<String> validUrls = sourceUrls != null
                ? sourceUrls.stream().filter(u -> u != null && !u.trim().isEmpty()).collect(Collectors.toList())
                : List.of();

        // 别名过滤
        List<String> validAliases = aliases != null
                ? aliases.stream().filter(a -> a != null && !a.trim().isEmpty()).map(String::trim).collect(Collectors.toList())
                : List.of();

        // 按配置的字段顺序输出
        for (String field : config.getFrontmatterFields()) {
            switch (field) {
                case "date":
                    sb.append("date: ").append(date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))).append("\n");
                    break;
                case "tags":
                    sb.append("tags:\n");
                    if (uniqueTags.isEmpty()) {
                        sb.append("  []\n");
                    } else {
                        for (String tag : uniqueTags) {
                            sb.append("  - ").append(tag).append("\n");
                        }
                    }
                    break;
                case "category":
                    sb.append("category: ").append(escapeYaml(categoryName)).append("\n");
                    break;
                case "source":
                    if (!validUrls.isEmpty()) {
                        sb.append("source:\n");
                        for (String url : validUrls) {
                            sb.append("  - ").append(escapeYaml(url)).append("\n");
                        }
                    }
                    break;
                case "aliases":
                    if (!validAliases.isEmpty()) {
                        sb.append("aliases:\n");
                        for (String alias : validAliases) {
                            sb.append("  - ").append(escapeYaml(alias)).append("\n");
                        }
                    }
                    break;
                case "updated":
                    sb.append("updated: ").append(date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))).append("\n");
                    break;
                case "type":
                    if (type != null && !type.isEmpty()) {
                        sb.append("type: ").append(escapeYaml(type)).append("\n");
                    }
                    break;
                default:
                    // 未识别的字段跳过
                    break;
            }
        }

        sb.append("---\n\n");
        return sb.toString();
    }

    /**
     * 生成单条剪藏的 YAML frontmatter 块（含 AI 提炼字段）。
     * <p>
     * 专用于「一剪藏一文件」落库，将剪藏的 AI 产出（摘要/发散/思考）写入
     * frontmatter，供 Obsidian Dataview 结构化检索。字段按
     * {@link ObsidianExportConfig#getClipFrontmatterFields()} 配置顺序输出，
     * 仅输出非空字段。
     * </p>
     *
     * @param date          采集/整理日期
     * @param tags          标签列表（自动去重）
     * @param categoryName  分类中文名
     * @param sourceUrl     来源 URL（可为空）
     * @param siteName      来源站点（可为空）
     * @param analysisStatus AI 分析状态（pending/ready/failed/empty，可为空）
     * @param summary       AI 摘要（可为空，空则不输出）
     * @param divergent     AI 发散总结（可为空，空则不输出）
     * @param thoughts      我的思考（可为空，空则不输出）
     * @return {@code ---\n...\n---\n\n} 格式的 YAML frontmatter 字符串
     */
    public String generateClipFrontmatter(LocalDate date, List<String> tags, String categoryName,
                                           String sourceUrl, String siteName, String analysisStatus,
                                           String summary, String divergent, String thoughts) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");

        // 标签去重（保持顺序）
        LinkedHashSet<String> uniqueTags = new LinkedHashSet<>();
        if (tags != null) {
            for (String tag : tags) {
                if (tag != null && !tag.trim().isEmpty()) {
                    uniqueTags.add(tag.trim());
                }
            }
        }

        for (String field : config.getClipFrontmatterFields()) {
            switch (field) {
                case "date":
                    sb.append("date: ").append(date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))).append("\n");
                    break;
                case "updated":
                    sb.append("updated: ").append(date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))).append("\n");
                    break;
                case "type":
                    sb.append("type: clip\n");
                    break;
                case "category":
                    sb.append("category: ").append(escapeYaml(categoryName)).append("\n");
                    break;
                case "tags":
                    sb.append("tags:\n");
                    if (uniqueTags.isEmpty()) {
                        sb.append("  []\n");
                    } else {
                        for (String tag : uniqueTags) {
                            sb.append("  - ").append(tag).append("\n");
                        }
                    }
                    break;
                case "source":
                    if (sourceUrl != null && !sourceUrl.trim().isEmpty()) {
                        sb.append("source:\n  - ").append(escapeYaml(sourceUrl)).append("\n");
                    }
                    break;
                case "site":
                    if (siteName != null && !siteName.trim().isEmpty()) {
                        sb.append("site: ").append(escapeYaml(siteName)).append("\n");
                    }
                    break;
                case "analysis_status":
                    if (analysisStatus != null && !analysisStatus.trim().isEmpty()) {
                        sb.append("analysis_status: ").append(escapeYaml(analysisStatus)).append("\n");
                    }
                    break;
                case "summary":
                    if (summary != null && !summary.trim().isEmpty()) {
                        sb.append("summary: \"").append(yamlEscapeValue(summary)).append("\"\n");
                    }
                    break;
                case "divergent":
                    if (divergent != null && !divergent.trim().isEmpty()) {
                        sb.append("divergent: \"").append(yamlEscapeValue(divergent)).append("\"\n");
                    }
                    break;
                case "thoughts":
                    if (thoughts != null && !thoughts.trim().isEmpty()) {
                        sb.append("thoughts: \"").append(yamlEscapeValue(thoughts)).append("\"\n");
                    }
                    break;
                default:
                    // 未识别的字段跳过
                    break;
            }
        }

        sb.append("---\n\n");
        return sb.toString();
    }

    /**
     * 将多行文本转义为 YAML 单行字符串值（去除换行、压缩空白、转义引号）。
     * <p>
     * 用于 summary/divergent/thoughts 等可能含换行的字段，确保 frontmatter 为合法单行 YAML。
     * </p>
     *
     * @param value 原始多行文本
     * @return 压缩后的单行 YAML 安全值
     */
    private String yamlEscapeValue(String value) {
        if (value == null) {
            return "";
        }
        // 去掉换行和多余空白，压缩为单行
        String singleLine = value.replaceAll("\\s+", " ").trim();
        return singleLine.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /**
     * 将标签列表格式化为 Obsidian 行内标签格式。
     *
     * @param tags 标签列表
     * @return {@code #tag1  #tag2  } 格式的字符串（每项 {@code #} 前缀，双空格分隔）
     */
    public String formatTagsInline(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String tag : tags) {
            if (tag != null && !tag.trim().isEmpty()) {
                sb.append("#").append(tag.trim()).append("  ");
            }
        }
        return sb.toString();
    }

    /**
     * 将内容包裹为 Obsidian Callout 语法。
     * <p>
     * 输出格式：
     * <pre>
     * &gt; [!type] title
     * &gt; 正文行1
     * &gt; 正文行2
     * </pre>
     * </p>
     *
     * @param title          Callout 标题
     * @param content        Callout 正文（可为多行）
     * @param calloutTypeKey Callout 类型键（如 {@code "analysis"}, {@code "thoughts"}），
     *                       从配置中映射为 Obsidian Callout 类型
     * @return Callout 格式的字符串
     */
    public String wrapCallout(String title, String content, String calloutTypeKey) {
        String calloutType = config.getCalloutTypes().getOrDefault(calloutTypeKey, "note");
        StringBuilder sb = new StringBuilder();
        sb.append("> [!").append(calloutType).append("] ").append(title).append("\n");

        if (content != null && !content.isEmpty()) {
            String[] lines = content.split("\n", -1);
            for (String line : lines) {
                sb.append("> ").append(line).append("\n");
            }
        }

        return sb.toString();
    }

    /**
     * 生成 Obsidian 友好的归档文件名。
     *
     * @param categoryName 分类中文名（一级分类名）
     * @param date         整理日期
     * @return {@code {分类中文名}_{日期}.md} 格式的文件名
     */
    public String generateFileName(String categoryName, LocalDate date) {
        String dateStr = date.format(DateTimeFormatter.ofPattern(config.getFileNameDateFormat()));
        return categoryName + "_" + dateStr + ".md";
    }

    /**
     * 简单的 YAML 值转义：包含特殊字符时用双引号包裹。
     *
     * @param value 原始值
     * @return 转义后的 YAML 安全值
     */
    private String escapeYaml(String value) {
        if (value == null) {
            return "\"\"";
        }
        // 包含冒号、井号、方括号等 YAML 特殊字符时用双引号包裹
        if (value.contains(":") || value.contains("#") || value.contains("[") || value.contains("]")
                || value.contains("\"") || value.startsWith(" ") || value.endsWith(" ")) {
            return "\"" + value.replace("\"", "\\\"") + "\"";
        }
        return value;
    }
}
