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
     * 生成 YAML frontmatter 块。
     * <p>
     * 根据 {@link ObsidianExportConfig#getFrontmatterFields()} 中配置的字段顺序
     * 生成 frontmatter，仅输出配置中包含的字段。
     * </p>
     *
     * @param date         整理日期
     * @param tags         标签列表（将自动去重）
     * @param categoryName 分类中文名
     * @param sourceUrls   来源 URL 列表（可为空）
     * @return {@code ---\n...\n---\n\n} 格式的 YAML frontmatter 字符串
     */
    public String generateFrontmatter(LocalDate date, List<String> tags, String categoryName, List<String> sourceUrls) {
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
                default:
                    // 未识别的字段跳过
                    break;
            }
        }

        sb.append("---\n\n");
        return sb.toString();
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
