package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 单剪藏 Markdown 视图/导出服务（混合方案 B）。
 * <p>
 * JSON 仍是剪藏的权威存储，本服务负责把单条剪藏渲染为可读的 Markdown 视图
 * （YAML frontmatter + 章节结构），并按需落盘到知识库目录：
 * </p>
 * <ul>
 *   <li>{@link #buildMarkdown(ClipContent)}：返回 MD 字符串（预览/复制用），
 *       frontmatter 对齐智能剪藏预览形态（title/tags/type/status/created）。</li>
 *   <li>{@link #exportToVault(ClipContent, String)}：落盘到
 *       {@code {organizedStoragePath}/clips/{yyyy}/{MM}/{一级分类}/{yyMMdd}_{短id}.md}，
 *       与「整理归档」同一目录约定，导出物直接进知识库（Obsidian 可索引）。</li>
 * </ul>
 * 只生成视图/导出产物，不改 JSON 存储层与 workflowStatus。
 */
@Service
public class ClipMarkdownService {

    private static final Logger log = LoggerFactory.getLogger(ClipMarkdownService.class);

    /** 整理存储根目录（与组织归档同一知识库根），由配置注入 */
    private final Path organizedStoragePath;

    /**
     * 构造器注入整理存储根目录。
     *
     * @param organizedStoragePath 整理存储目录（默认 ./clip-organized）
     */
    public ClipMarkdownService(@Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.organizedStoragePath = Path.of(organizedStoragePath);
    }

    /**
     * 生成单剪藏 Markdown 视图。
     * <p>
     * 结构：YAML frontmatter（title/tags/type/status/created，有来源时附加 source）+
     * {@code # 标题} + 章节（原文/摘要/分析/发散总结/标签/我的思考）+
     * 来源链接。缺失字段的章节直接不输出，保持 MD 干净。
     * </p>
     *
     * @param clip 剪藏内容
     * @return Markdown 字符串（UTF-8）
     */
    public String buildMarkdown(ClipContent clip) {
        List<String> tags = clip.getTags() != null ? clip.getTags() : List.of();

        StringBuilder fm = new StringBuilder("---\n");
        fm.append("title: ").append(yamlScalar(clip.getTitle() != null && !clip.getTitle().isBlank()
                ? clip.getTitle() : "剪藏")).append("\n");
        if (!tags.isEmpty()) {
            StringBuilder flow = new StringBuilder("tags: [");
            for (int i = 0; i < tags.size(); i++) {
                if (i > 0) flow.append(", ");
                flow.append(yamlScalar(tags.get(i)));
            }
            flow.append("]\n");
            fm.append(flow);
        }
        fm.append("type: clip\n");
        fm.append("status: ").append(clip.getWorkflowStatus() != null && !clip.getWorkflowStatus().isBlank()
                ? clip.getWorkflowStatus() : "inbox").append("\n");
        if (clip.getCreatedAt() != null) {
            fm.append("created: ").append(yamlScalar(
                    clip.getCreatedAt().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")))).append("\n");
        }
        if (clip.getSourceUrl() != null && !clip.getSourceUrl().isBlank()) {
            fm.append("source: ").append(yamlScalar(clip.getSourceUrl())).append("\n");
        }
        fm.append("---\n\n");

        String title = clip.getTitle() != null && !clip.getTitle().isEmpty() ? clip.getTitle() : "剪藏";
        StringBuilder body = new StringBuilder();
        body.append("# ").append(title).append("\n\n");
        appendSection(body, "原文", clip.getContent());
        appendSection(body, "摘要", clip.getSummary());
        appendSection(body, "分析", clip.getAnalysis());
        appendSection(body, "发散总结", clip.getDivergentSummary());
        if (!tags.isEmpty()) {
            StringBuilder tagLine = new StringBuilder("## 标签\n\n");
            for (int i = 0; i < tags.size(); i++) {
                if (i > 0) tagLine.append(' ');
                tagLine.append('`').append(tags.get(i).trim()).append('`');
            }
            body.append(tagLine).append("\n\n");
        }
        appendSection(body, "我的思考", clip.getMyThoughts());
        if (clip.getSourceUrl() != null && !clip.getSourceUrl().isBlank()) {
            body.append("\n🔗 来源：[").append(clip.getSourceUrl()).append("](").append(clip.getSourceUrl()).append(")\n");
        }

        return fm.toString() + body.toString();
    }

    /**
     * 将 Markdown 视图落盘到知识库目录（与整理归档同一约定：
     * {@code clips/{yyyy}/{MM}/{一级分类目录}/{yyMMdd}_{短id}.md}）。
     * <p>
     * 已存在同名文件时直接覆盖（导出物 = 视图，内容随剪藏更新而变化）。
     * </p>
     *
     * @param clip     剪藏内容
     * @param markdown 已生成的 Markdown 文本
     * @return 相对知识库根目录的文件路径（如 {@code clips/2026/09/技术/20260916_3f2a9c01.md}）
     * @throws IOException 目录创建或文件写入失败
     */
    public String exportToVault(ClipContent clip, String markdown) throws IOException {
        LocalDate date = clip.getCreatedAt() != null ? clip.getCreatedAt().toLocalDate() : LocalDate.now();
        String categoryDir = sanitizeDirName(topCategoryLabel(clip.getCategory()));
        String shortId = shortIdOf(clip.getId());
        String dateStr = date.format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd"));

        Path dir = organizedStoragePath.resolve("clips")
                .resolve(String.valueOf(date.getYear()))
                .resolve(String.format("%02d", date.getMonthValue()))
                .resolve(categoryDir);
        Files.createDirectories(dir);
        Path file = dir.resolve(dateStr + "_" + shortId + ".md");
        Files.write(file, markdown.getBytes(StandardCharsets.UTF_8));
        log.info("[ClipMarkdown] export clip to vault: file={}, clipId={}", file, clip.getId());

        Path absRoot = organizedStoragePath.toAbsolutePath().normalize();
        return absRoot.relativize(file.toAbsolutePath().normalize()).toString();
    }

    /**
     * 按序追加章节；内容为空则跳过（保持 MD 干净）。
     */
    private void appendSection(StringBuilder sb, String heading, String content) {
        if (content == null || content.trim().isEmpty()) {
            return;
        }
        sb.append("## ").append(heading).append("\n\n").append(content.trim()).append("\n\n");
    }

    /**
     * YAML 标量安全输出：含冒号/井号/引号/前后空白/列表起始符时用双引号包裹。
     */
    private String yamlScalar(String value) {
        if (value == null) {
            return "\"\"";
        }
        String clean = value.trim();
        if (clean.isEmpty()) {
            return "\"\"";
        }
        boolean needQuote = clean.contains(":") || clean.contains("#") || clean.contains("\"")
                || clean.startsWith("[") || clean.startsWith("-") || clean.startsWith("{")
                || !clean.equals(value);
        if (needQuote) {
            return "\"" + clean.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        }
        return clean;
    }

    /**
     * 一级分类中文名（不含子分类，与整理归档目录命名一致）。
     * 复用 AiService.CATEGORY_TREE 静态树做值 → 顶层中文名映射。
     */
    private String topCategoryLabel(String category) {
        if (category == null || category.isEmpty()) {
            return "默认分类";
        }
        for (Map<String, Object> cat : AiService.CATEGORY_TREE) {
            String topValue = String.valueOf(cat.get("value"));
            String topLabel = String.valueOf(cat.get("label"));
            if (topValue.equals(category)) {
                return topLabel;
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (String.valueOf(child.get("value")).equals(category)) {
                        return topLabel;
                    }
                }
            }
        }
        return category;
    }

    /**
     * 净化目录名，移除文件系统不安全字符；空值回退 default。
     */
    private String sanitizeDirName(String name) {
        if (name == null || name.isEmpty()) {
            return "default";
        }
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
    }

    /**
     * 剪藏 id 的稳定短哈希（8 位 hex），与整理归档的文件名约定一致。
     */
    private String shortIdOf(Long id) {
        if (id == null) {
            return "0";
        }
        return String.format("%08x", id.hashCode());
    }
}