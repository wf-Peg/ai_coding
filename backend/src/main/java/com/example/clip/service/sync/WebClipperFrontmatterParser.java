package com.example.clip.service.sync;

import com.example.clip.model.ClipContent;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Obsidian Web Clipper frontmatter 解析器。
 * <p>
 * Obsidian Web Clipper 浏览器插件会将剪藏的网页以 Markdown 文件形式写入 Vault 的
 * sources 目录，文件头部带有 YAML frontmatter（{@code ---} 包裹），记录标题、来源
 * URL、作者、发布时间、标签等元数据。本类负责解析这些 frontmatter 字段并映射为
 * {@link ClipContent} 对象，供 {@link SourceSyncService} 入库使用。
 * </p>
 *
 * <h3>支持的 frontmatter 格式</h3>
 * <pre>
 * ---
 * title: React 入门指南
 * source: https://example.com/react-intro
 * author: 张三
 * published: 2026-07-30
 * created: 2026-07-30
 * tags:
 *   - React
 *   - Frontend
 * description: React 框架入门教程
 * ---
 * </pre>
 *
 * <h3>降级策略</h3>
 * <ul>
 *   <li>frontmatter 不存在或解析失败时，{@link #toClipContent} 会降级创建一条
 *       仅包含文件名（去扩展名）作为标题、空标签列表的剪藏记录</li>
 *   <li>tags 字段同时支持 YAML 列表（{@code - item}）和逗号分隔字符串</li>
 * </ul>
 */
@Service
public class WebClipperFrontmatterParser {

    /** frontmatter 起始/结束标记 */
    private static final String FRONTMATTER_DELIMITER = "---";

    /**
     * 解析 Markdown 文件内容中的 YAML frontmatter。
     * <p>
     * 检测文件开头是否以 {@code ---\n} 开头，找到第二个 {@code ---} 作为结束，
     * 逐行解析 {@code key: value} 格式。对 {@code tags} 字段特殊处理：
     * 如果其下一行以 {@code "  - "} 开头，则收集为列表。
     * </p>
     *
     * @param fileContent 文件内容
     * @return frontmatter 字段 Map；解析失败返回空 Map
     */
    public Map<String, Object> parse(String fileContent) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (fileContent == null || fileContent.isEmpty()) {
            return result;
        }
        // 检测文件开头是否以 ---\n 开头
        String frontmatterStart = FRONTMATTER_DELIMITER + "\n";
        if (!fileContent.startsWith(frontmatterStart)) {
            return result;
        }
        // 跳过起始 ---\n 后查找结束 ---
        int startIdx = frontmatterStart.length();
        int endIdx = fileContent.indexOf("\n" + FRONTMATTER_DELIMITER, startIdx);
        if (endIdx < 0) {
            return result;
        }
        String body = fileContent.substring(startIdx, endIdx);
        String[] lines = body.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (line == null || line.trim().isEmpty()) {
                continue;
            }
            // 跳过形如 "  - item" 的列表项（由前一个 key 收集）
            if (line.startsWith("  - ") || line.startsWith("- ")) {
                continue;
            }
            int colonIdx = line.indexOf(':');
            if (colonIdx <= 0) {
                continue;
            }
            String key = line.substring(0, colonIdx).trim();
            String value = line.substring(colonIdx + 1).trim();
            // 对 tags 字段特殊处理：可能紧跟列表项
            if ("tags".equals(key)) {
                if (value.isEmpty()) {
                    // 检查下一行是否以 "  - " 开头
                    List<String> tags = new ArrayList<>();
                    int j = i + 1;
                    while (j < lines.length) {
                        String nextLine = lines[j];
                        if (nextLine != null && nextLine.startsWith("  - ")) {
                            String tag = nextLine.substring(4).trim();
                            if (!tag.isEmpty()) {
                                tags.add(tag);
                            }
                            j++;
                        } else {
                            break;
                        }
                    }
                    if (!tags.isEmpty()) {
                        result.put(key, tags);
                    } else {
                        result.put(key, "");
                    }
                } else {
                    result.put(key, value);
                }
            } else {
                result.put(key, value);
            }
        }
        return result;
    }

    /**
     * 将文件内容解析为 {@link ClipContent} 对象。
     * <p>
     * 字段映射规则：
     * <ul>
     *   <li>{@code title} → {@code title}（缺失时取 fileName 去扩展名）</li>
     *   <li>{@code source} → {@code sourceUrl}</li>
     *   <li>{@code author} → {@code siteName}</li>
     *   <li>{@code published} → {@code capturedAt}（缺失时取 {@code created}）</li>
     *   <li>{@code tags} → {@code tags}（调用 {@link #parseTags}）</li>
     *   <li>{@code description} → {@code summary}</li>
     * </ul>
     * 固定值：source="web-clipper"、type="text"、category="inbox"、workflowStatus="inbox"。
     * frontmatter 缺失时降级：title=fileName 去扩展名，tags=空列表。
     * </p>
     *
     * @param fileContent 文件内容
     * @param fileName    文件名（含扩展名）
     * @return 剪藏内容对象
     */
    public ClipContent toClipContent(String fileContent, String fileName) {
        ClipContent clip = new ClipContent();
        clip.setSource("web-clipper");
        clip.setType("text");
        clip.setCategory("inbox");
        clip.setWorkflowStatus("inbox");

        String fallbackTitle = stripExtension(fileName);
        Map<String, Object> frontmatter = parse(fileContent);
        if (frontmatter.isEmpty()) {
            // 降级：仅用文件名作为标题，空标签
            clip.setTitle(fallbackTitle);
            clip.setTags(new ArrayList<>());
            return clip;
        }

        // title
        Object titleVal = frontmatter.get("title");
        clip.setTitle((titleVal == null || titleVal.toString().isEmpty())
                ? fallbackTitle
                : titleVal.toString());

        // source → sourceUrl
        Object sourceVal = frontmatter.get("source");
        if (sourceVal != null && !sourceVal.toString().isEmpty()) {
            clip.setSourceUrl(sourceVal.toString());
        }

        // author → siteName
        Object authorVal = frontmatter.get("author");
        if (authorVal != null && !authorVal.toString().isEmpty()) {
            clip.setSiteName(authorVal.toString());
        }

        // published → capturedAt（缺失时取 created）
        Object publishedVal = frontmatter.get("published");
        if (publishedVal == null || publishedVal.toString().isEmpty()) {
            publishedVal = frontmatter.get("created");
        }
        if (publishedVal != null && !publishedVal.toString().isEmpty()) {
            clip.setCapturedAt(publishedVal.toString());
        }

        // tags
        Object tagsVal = frontmatter.get("tags");
        clip.setTags(parseTags(tagsVal));

        // description → summary
        Object descVal = frontmatter.get("description");
        if (descVal != null && !descVal.toString().isEmpty()) {
            clip.setSummary(descVal.toString());
        }

        return clip;
    }

    /**
     * 从 frontmatter 提取 title，缺失时返回 fileName 去扩展名。
     *
     * @param fileContent 文件内容
     * @param fileName    文件名（含扩展名）
     * @return 标题
     */
    public String extractTitle(String fileContent, String fileName) {
        Map<String, Object> frontmatter = parse(fileContent);
        Object titleVal = frontmatter.get("title");
        if (titleVal != null && !titleVal.toString().isEmpty()) {
            return titleVal.toString();
        }
        return stripExtension(fileName);
    }

    /**
     * 解析 tags 字段，兼容 YAML 列表和逗号分隔字符串。
     *
     * @param tagsValue tags 字段原始值（可能是 List 或 String）
     * @return 标签列表；空值返回空列表
     */
    public List<String> parseTags(Object tagsValue) {
        if (tagsValue == null) {
            return new ArrayList<>();
        }
        if (tagsValue instanceof List) {
            List<String> result = new ArrayList<>();
            for (Object item : (List<?>) tagsValue) {
                if (item != null) {
                    String s = item.toString().trim();
                    if (!s.isEmpty()) {
                        result.add(s);
                    }
                }
            }
            return result;
        }
        if (tagsValue instanceof String) {
            String s = ((String) tagsValue).trim();
            if (s.isEmpty()) {
                return new ArrayList<>();
            }
            String[] parts = s.split(",");
            List<String> result = new ArrayList<>();
            for (String part : parts) {
                String t = part.trim();
                if (!t.isEmpty()) {
                    result.add(t);
                }
            }
            return result;
        }
        return new ArrayList<>();
    }

    /**
     * 去除文件名的 .md 扩展名。
     *
     * @param fileName 文件名
     * @return 去扩展名后的名称
     */
    private String stripExtension(String fileName) {
        if (fileName == null || fileName.isEmpty()) {
            return "";
        }
        if (fileName.toLowerCase().endsWith(".md")) {
            return fileName.substring(0, fileName.length() - 3);
        }
        return fileName;
    }
}
