package com.example.clip.service;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 邮件 Markdown 轻量渲染工具。
 * <p>
 * 用于把 AI 整理产物（Markdown）渲染成适合邮件阅读的简单 HTML。
 * 仅覆盖标题、无序/有序列表、加粗、行内代码与段落，不做完整 Markdown 渲染。
 * 所有文本先转义再插入标签，保证 HTML 安全。
 * </p>
 */
public final class EmailMarkdownUtil {

    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s*(.*)$");
    private static final Pattern UL_ITEM = Pattern.compile("^[-*]\\s+(.*)$");
    private static final Pattern OL_ITEM = Pattern.compile("^\\d+[.)、]\\s+(.*)$");

    private EmailMarkdownUtil() {
    }

    /** 转义 HTML 特殊字符（正文内容安全）。 */
    public static String escape(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** 转义 HTML 属性值中的特殊字符。 */
    public static String escapeAttr(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("\"", "&quot;").replace("'", "&#39;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * 去除 YAML frontmatter（doc 开头的 {@code --- ... ---} 块），返回正文。
     * 非 frontmatter 或解析失败时原样返回。
     */
    public static String stripFrontmatter(String md) {
        if (md == null) return "";
        String m = md.trim();
        if (m.startsWith("---")) {
            int end = m.indexOf("\n---", 3);
            if (end > 0) {
                return m.substring(end + 4).trim();
            }
        }
        return m;
    }

    /**
     * 轻量 Markdown → HTML。标题映射为 h2 ~ h5，支持无序/有序列表、加粗、行内代码、段落。
     *
     * @param md Markdown 文本
     * @return 仅含块级与行内标签的 HTML 片段
     */
    public static String mdToHtml(String md) {
        if (md == null || md.trim().isEmpty()) return "";
        String[] lines = (md + "\n").split("\n");
        StringBuilder sb = new StringBuilder();
        boolean inUl = false, inOl = false;

        for (String raw : lines) {
            String line = raw.replace("\r", "");
            String t = line.trim();

            if (t.isEmpty()) {
                closeLists(sb, inUl, inOl);
                inUl = false; inOl = false;
                continue;
            }

            Matcher mh = HEADING.matcher(t);
            if (mh.matches()) {
                closeLists(sb, inUl, inOl);
                inUl = false; inOl = false;
                int level = mh.group(1).length();
                int tag = Math.min(level + 1, 6);
                sb.append("<h").append(tag).append(">")
                        .append(inline(mh.group(2)))
                        .append("</h").append(tag).append(">");
                continue;
            }

            Matcher mu = UL_ITEM.matcher(t);
            if (mu.matches()) {
                if (inOl) { sb.append("</ol>"); inOl = false; }
                if (!inUl) { sb.append("<ul>"); inUl = true; }
                sb.append("<li>").append(inline(mu.group(1))).append("</li>");
                continue;
            }

            Matcher mo = OL_ITEM.matcher(t);
            if (mo.matches()) {
                if (inUl) { sb.append("</ul>"); inUl = false; }
                if (!inOl) { sb.append("<ol>"); inOl = true; }
                sb.append("<li>").append(inline(mo.group(1))).append("</li>");
                continue;
            }

            closeLists(sb, inUl, inOl);
            inUl = false; inOl = false;
            sb.append("<p>").append(inline(t)).append("</p>");
        }
        closeLists(sb, inUl, inOl);
        return sb.toString();
    }

    private static void closeLists(StringBuilder sb, boolean inUl, boolean inOl) {
        if (inUl) sb.append("</ul>");
        if (inOl) sb.append("</ol>");
    }

    /** 行内样式：加粗、行内代码。输入应为已转义文本。 */
    private static String inline(String escapedText) {
        if (escapedText == null) return "";
        String s = escapedText.replaceAll("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>");
        s = s.replaceAll("`([^`]+)`", "<code>$1</code>");
        return s;
    }
}