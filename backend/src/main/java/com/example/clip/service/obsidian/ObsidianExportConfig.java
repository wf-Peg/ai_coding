package com.example.clip.service.obsidian;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Obsidian 导出格式配置项。
 * <p>
 * 通过 {@code @ConfigurationProperties(prefix = "obsidian.export")} 从
 * {@code application.yml} 读取配置，控制归档 Markdown 的 frontmatter 字段、
 * Callout 类型映射和文件名日期格式。所有字段均有默认值，未配置时使用默认值。
 * </p>
 *
 * <h3>配置示例</h3>
 * <pre>
 * obsidian:
 *   export:
 *     frontmatter-fields:
 *       - date
 *       - updated
 *       - type
 *       - tags
 *       - aliases
 *       - category
 *       - source
 *     callout-types:
 *       analysis: note
 *       thoughts: quote
 *     file-name-date-format: yyyy-MM-dd
 * </pre>
 */
@Component
@ConfigurationProperties(prefix = "obsidian.export")
public class ObsidianExportConfig {

    /**
     * frontmatter 中包含的字段列表，顺序即为输出顺序。
     * <p>
     * 默认包含 date / updated / type / tags / aliases / category / source，
     * 兼容 Obsidian properties 与 Dataview 查询。用户可通过配置文件自定义覆盖。
     * </p>
     */
    private List<String> frontmatterFields = new ArrayList<>(
            List.of("date", "updated", "type", "tags", "aliases", "category", "source"));

    /** Callout 类型映射，key 为逻辑键（analysis/thoughts），value 为 Obsidian Callout 类型 */
    private Map<String, String> calloutTypes = new HashMap<>(Map.of("analysis", "note", "thoughts", "quote"));

    /** 归档文件名中的日期格式 */
    private String fileNameDateFormat = "yyyy-MM-dd";

    /**
     * 单条剪藏文件的 frontmatter 字段列表，顺序即为输出顺序。
     * <p>
     * 在 {@link #frontmatterFields} 基础上额外支持 AI 提炼字段：
     * {@code summary}（摘要）、{@code analysis_status}（分析状态）、
     * {@code divergent}（发散总结）、{@code thoughts}（我的思考）、
     * {@code site}（来源站点）。用户可通过配置文件自定义覆盖。
     * </p>
     */
    private List<String> clipFrontmatterFields = new ArrayList<>(
            List.of("date", "updated", "type", "category", "tags", "source", "site",
                    "analysis_status", "summary", "divergent", "thoughts"));

    public List<String> getFrontmatterFields() {
        return frontmatterFields;
    }

    public void setFrontmatterFields(List<String> frontmatterFields) {
        this.frontmatterFields = frontmatterFields;
    }

    public Map<String, String> getCalloutTypes() {
        return calloutTypes;
    }

    public void setCalloutTypes(Map<String, String> calloutTypes) {
        this.calloutTypes = calloutTypes;
    }

    public List<String> getClipFrontmatterFields() {
        return clipFrontmatterFields;
    }

    public void setClipFrontmatterFields(List<String> clipFrontmatterFields) {
        this.clipFrontmatterFields = clipFrontmatterFields;
    }

    public String getFileNameDateFormat() {
        return fileNameDateFormat;
    }

    public void setFileNameDateFormat(String fileNameDateFormat) {
        this.fileNameDateFormat = fileNameDateFormat;
    }
}
