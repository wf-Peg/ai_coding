package com.example.clip.service;

import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Stream;

/**
 * PDF 生成器。
 * <p>
 * 支持两种输入：
 * <ul>
 *   <li>Markdown → flexmark 转 HTML → OpenHTMLtoPDF 渲染 PDF（推荐）</li>
 *   <li>HTML → Jsoup 清洗 → OpenHTMLtoPDF 渲染 PDF</li>
 * </ul>
 * </p>
 *
 * <h3>中文字体处理</h3>
 * 三大关键修复：
 * <ol>
 *   <li><b>禁用字体子集化</b> — OpenHTMLtoPDF 对 CJK 字体的子集化会静默失败，导致 PDF 中无字形。设置 subset=false 包含完整字体。</li>
 *   <li><b>注册字体实名</b> — 使用 java.awt.Font 获取字体真实 family 名称，同时注册 "CJKFont" 别名。</li>
 *   <li><b>三层探测</b> — classpath fonts/ → 系统字体目录 → java.awt.GraphicsEnvironment。</li>
 * </ol>
 */
@Service
public class PdfGenerator {

    private static final Logger log = LoggerFactory.getLogger(PdfGenerator.class);

    /** 系统字体搜索目录 */
    private static final List<String> FONT_SEARCH_DIRS = List.of(
            "src/main/resources/fonts", "resources/fonts", "fonts",
            "C:/Windows/Fonts",
            "/System/Library/Fonts", "/Library/Fonts", "~/Library/Fonts",
            "/usr/share/fonts", "/usr/local/share/fonts",
            "/usr/share/fonts/truetype", "/usr/share/fonts/opentype"
    );

    /** CJK 字体关键词 */
    private static final Set<String> CJK_KEYWORDS = Set.of(
            "simsun", "msyh", "msyhl", "mingliu", "pmingliu",
            "pingfang", "stheiti", "heiti", "hiragino", "kaiti", "songti",
            "wqy", "wenquan", "zenhei", "microhei", "noto", "cjk", "droid",
            "sourcehansans", "sourcehanserif", "hans", "chinese",
            "simhei", "simkai", "simfang", "nsimsun"
    );

    /** 已知 CJK 字体文件名（用于 classpath 加载） */
    private static final List<String> KNOWN_CJK_FONT_NAMES = List.of(
            "simsun.ttf", "simsun.ttc", "SimSun.ttf", "SimSun.ttc",
            "msyh.ttf", "msyh.ttc", "msyhl.ttf",
            "PingFang.ttc", "PingFang.ttf",
            "STHeiti Light.ttc", "STHeiti Medium.ttc",
            "Hiragino Sans GB.ttc", "Hiragino Sans GB W3.ttc", "Hiragino Sans GB W6.ttc",
            "wqy-zenhei.ttc", "wqy-microhei.ttc",
            "NotoSansCJK-Regular.ttc", "NotoSansSC-Regular.otf", "NotoSansSC-Regular.ttf",
            "NotoSansSC-VariableFont_wght.ttf", "NotoSansCJKsc-Regular.otf",
            "DroidSansFallback.ttf", "DroidSansFallbackFull.ttf"
    );

    /** 缓存探测到的字体 */
    private volatile File detectedFont;
    private volatile String detectedFontFamily;

    /** flexmark Markdown 解析器（线程安全） */
    private final Parser markdownParser;
    private final HtmlRenderer htmlRenderer;

    public PdfGenerator() {
        MutableDataSet options = new MutableDataSet();
        options.set(Parser.EXTENSIONS, List.of(
                com.vladsch.flexmark.ext.tables.TablesExtension.create(),
                com.vladsch.flexmark.ext.autolink.AutolinkExtension.create(),
                com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension.create(),
                com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension.create()
        ));
        this.markdownParser = Parser.builder(options).build();
        this.htmlRenderer = HtmlRenderer.builder(options).build();
    }

    // ==================== 公开 API ====================

    /**
     * 将 Markdown 转换为 PDF 字节数组。
     * <p>
     * 数据流：Markdown → flexmark → HTML → Jsoup 清洗 → OpenHTMLtoPDF → PDF bytes
     * </p>
     */
    public byte[] generateFromMarkdown(String markdown) throws IOException {
        // Step 1: Markdown → HTML
        String rawHtml = htmlRenderer.render(markdownParser.parse(markdown));

        // Step 2: 包装为完整 HTML 文档
        String fullHtml = wrapHtmlDocument(rawHtml);

        // Step 3: HTML → PDF
        return renderHtmlToPdf(fullHtml);
    }

    /**
     * 将 HTML 字符串转换为 PDF 字节数组。
     */
    public byte[] generate(String rawHtml) throws IOException {
        return renderHtmlToPdf(rawHtml);
    }

    // ==================== 核心渲染 ====================

    private byte[] renderHtmlToPdf(String html) throws IOException {
        // Jsoup 清洗 HTML
        Document doc = Jsoup.parse(html, "UTF-8");
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().charset("UTF-8");
        String cleanedXhtml = doc.html();

        try (ByteArrayOutputStream os = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();

            // 注册中文字体
            registerCjkFont(builder);

            builder.withHtmlContent(cleanedXhtml, null);
            builder.toStream(os);
            builder.run();

            return os.toByteArray();
        } catch (Exception e) {
            log.error("[PdfGenerator] PDF generation failed: {}", e.getMessage(), e);
            throw new IOException("PDF 生成失败: " + e.getMessage(), e);
        }
    }

    /**
     * 注册中文字体到 OpenHTMLtoPDF builder。
     * <p>
     * 关键修复：
     * <ul>
     *   <li>subset=false — 禁用字体子集化，CJK 字体子集化会静默失败导致无字形</li>
     *   <li>同时注册真实 family 名称和 "CJKFont" 别名，确保 CSS 总能匹配</li>
     *   <li>注册 400(normal) 和 700(bold) 两个字重</li>
     * </ul>
     */
    private void registerCjkFont(PdfRendererBuilder builder) {
        File fontFile = findCjkFont();
        if (fontFile == null) {
            log.warn("[PdfGenerator] No CJK font found! PDF will have garbled Chinese text.");
            return;
        }

        // 获取字体的真实 family 名称
        String realFamily = detectFontFamily(fontFile);
        if (realFamily == null || realFamily.isEmpty()) {
            realFamily = "CJKFont";
        }
        log.info("[PdfGenerator] Registering font: {} family='{}' (subset=false)", fontFile.getAbsolutePath(), realFamily);

        // 注册 normal weight (400) — 禁用子集化
        builder.useFont(fontFile, realFamily, 400, FontStyle.NORMAL, false);
        // 注册 bold weight (700) — 同一字体文件
        builder.useFont(fontFile, realFamily, 700, FontStyle.NORMAL, false);
        // 同时注册 "CJKFont" 别名，确保 CSS fallback 有效
        if (!"CJKFont".equals(realFamily)) {
            builder.useFont(fontFile, "CJKFont", 400, FontStyle.NORMAL, false);
            builder.useFont(fontFile, "CJKFont", 700, FontStyle.NORMAL, false);
        }
    }

    /**
     * 使用 java.awt.Font 获取字体文件的真实 family 名称。
     */
    private String detectFontFamily(File fontFile) {
        try {
            Font font = Font.createFont(Font.TRUETYPE_FONT, fontFile);
            String family = font.getFamily();
            log.debug("[PdfGenerator] Detected font family: {}", family);
            return family;
        } catch (Exception e) {
            log.debug("[PdfGenerator] Cannot detect font family: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 将 Markdown 渲染出的 HTML 片段包装为完整的 HTML 文档。
     */
    private String wrapHtmlDocument(String bodyHtml) {
        return "<!DOCTYPE html>\n"
                + "<html lang=\"zh-CN\">\n"
                + "<head>\n"
                + "<meta charset=\"UTF-8\">\n"
                + "<style>\n"
                + "  @page { size: A4; margin: 15mm; }\n"
                + "  body { font-family: 'CJKFont', 'SimSun', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; "
                + "         color: #2f3437; line-height: 1.7; font-size: 13px; }\n"
                + "  h1 { font-size: 24px; color: #2383e2; border-bottom: 2px solid #2383e2; padding-bottom: 8px; margin-bottom: 16px; }\n"
                + "  h2 { font-size: 18px; color: #2f3437; border-left: 3px solid #2383e2; padding-left: 8px; margin: 20px 0 10px; }\n"
                + "  h3 { font-size: 15px; margin: 14px 0 8px; }\n"
                + "  p { margin: 4px 0; }\n"
                + "  a { color: #2383e2; text-decoration: underline; }\n"
                + "  table { border-collapse: collapse; width: 100%; margin: 10px 0; }\n"
                + "  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }\n"
                + "  th { background: #f0f0f0; }\n"
                + "  ul, ol { margin: 4px 0; padding-left: 20px; }\n"
                + "  li { margin: 2px 0; }\n"
                + "  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 12px; }\n"
                + "  pre { background: #f7f7f5; padding: 12px; border-radius: 6px; overflow-x: auto; }\n"
                + "  blockquote { border-left: 3px solid #ddd; padding-left: 12px; color: #666; margin: 8px 0; }\n"
                + "  hr { border: none; border-top: 1px solid #e8e8e6; margin: 16px 0; }\n"
                + "  .meta { color: #888; font-size: 12px; margin-bottom: 16px; }\n"
                + "</style>\n"
                + "</head>\n"
                + "<body>\n"
                + bodyHtml
                + "\n</body>\n"
                + "</html>";
    }

    // ==================== 字体探测 ====================

    private synchronized File findCjkFont() {
        if (detectedFont != null) return detectedFont;

        // 策略 1: classpath fonts/
        File f = findFontInClasspath();
        if (f != null) { detectedFont = f; return f; }

        // 策略 2: 系统字体目录
        f = findFontInSystemDirs();
        if (f != null) { detectedFont = f; return f; }

        // 策略 3: java.awt.GraphicsEnvironment
        f = findFontViaAwt();
        if (f != null) { detectedFont = f; return f; }

        log.warn("[PdfGenerator] No CJK font found anywhere.");
        return null;
    }

    private File findFontInClasspath() {
        // 列出 fonts/ 目录下所有字体文件
        try {
            java.net.URL fontsUrl = getClass().getClassLoader().getResource("fonts");
            if (fontsUrl != null) {
                java.io.File fontsDir = new java.io.File(fontsUrl.toURI());
                if (fontsDir.isDirectory()) {
                    java.io.File[] files = fontsDir.listFiles((d, n) -> {
                        String l = n.toLowerCase();
                        return l.endsWith(".ttf") || l.endsWith(".ttc") || l.endsWith(".otf");
                    });
                    if (files != null) {
                        for (java.io.File file : files) {
                            if (isCjkFontFile(file)) {
                                log.info("[PdfGenerator] Found CJK font in classpath: {}", file.getName());
                                return file;
                            }
                        }
                        if (files.length > 0) {
                            log.info("[PdfGenerator] Using first font in classpath: {}", files[0].getName());
                            return files[0];
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        // 按已知文件名逐个尝试
        for (String name : KNOWN_CJK_FONT_NAMES) {
            try (InputStream is = getClass().getClassLoader().getResourceAsStream("fonts/" + name)) {
                if (is != null) {
                    File tmp = File.createTempFile("cjk-font-", name.substring(name.lastIndexOf('.')));
                    tmp.deleteOnExit();
                    try (FileOutputStream fos = new FileOutputStream(tmp)) { is.transferTo(fos); }
                    log.info("[PdfGenerator] Found CJK font in classpath: fonts/{}", name);
                    return tmp;
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    private File findFontInSystemDirs() {
        for (String dir : FONT_SEARCH_DIRS) {
            String expanded = dir.startsWith("~/") ? System.getProperty("user.home") + dir.substring(1) : dir;
            Path p = Paths.get(expanded);
            if (!Files.isDirectory(p)) continue;
            File f = searchFontsRecursive(p, 3);
            if (f != null) return f;
        }
        return null;
    }

    private File searchFontsRecursive(Path dir, int depth) {
        if (depth <= 0) return null;
        try (Stream<Path> s = Files.list(dir)) {
            List<Path> entries = s.toList();
            // 优先找已知 CJK 字体
            for (Path e : entries) {
                if (Files.isDirectory(e)) {
                    File f = searchFontsRecursive(e, depth - 1);
                    if (f != null) return f;
                } else if (Files.isRegularFile(e)) {
                    String n = e.getFileName().toString().toLowerCase();
                    if (n.endsWith(".ttf") || n.endsWith(".ttc") || n.endsWith(".otf")) {
                        if (isKnownCjkFontName(n)) {
                            log.info("[PdfGenerator] Found known CJK font: {}", e);
                            return e.toFile();
                        }
                    }
                }
            }
            // 兜底：返回第一个字体文件
            for (Path e : entries) {
                if (Files.isRegularFile(e)) {
                    String n = e.getFileName().toString().toLowerCase();
                    if (n.endsWith(".ttf") || n.endsWith(".ttc") || n.endsWith(".otf")) {
                        log.info("[PdfGenerator] Using fallback font: {}", e);
                        return e.toFile();
                    }
                }
            }
        } catch (IOException ignored) {}
        return null;
    }

    private File findFontViaAwt() {
        try {
            GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
            for (String family : ge.getAvailableFontFamilyNames()) {
                if (isPossibleCjkFamily(family)) {
                    Font font = new Font(family, Font.PLAIN, 12);
                    if (font.canDisplay('中')) {
                        log.info("[PdfGenerator] AWT found CJK font: {}", family);
                        File f = findFontFileForFamily(family);
                        if (f != null) return f;
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private File findFontFileForFamily(String family) {
        String lf = family.toLowerCase().replace(" ", "");
        for (String dir : FONT_SEARCH_DIRS) {
            String expanded = dir.startsWith("~/") ? System.getProperty("user.home") + dir.substring(1) : dir;
            Path p = Paths.get(expanded);
            if (!Files.isDirectory(p)) continue;
            try (Stream<Path> s = Files.list(p)) {
                for (Path e : s.toList()) {
                    if (Files.isRegularFile(e)) {
                        String n = e.getFileName().toString().toLowerCase().replace(" ", "");
                        if (n.contains(lf) || lf.contains(n.replaceFirst("\\.[^.]+$", ""))) {
                            return e.toFile();
                        }
                    }
                }
            } catch (IOException ignored) {}
        }
        return null;
    }

    private boolean isKnownCjkFontName(String lowerName) {
        String base = lowerName.replaceFirst("\\.[^.]+$", "").replace(" ", "");
        return CJK_KEYWORDS.stream().anyMatch(base::contains);
    }

    private boolean isPossibleCjkFamily(String family) {
        String l = family.toLowerCase().replace(" ", "");
        return CJK_KEYWORDS.stream().anyMatch(l::contains);
    }

    private boolean isCjkFontFile(java.io.File file) {
        try {
            Font font = Font.createFont(Font.TRUETYPE_FONT, file);
            return font.canDisplay('中') && font.canDisplay('文');
        } catch (Exception ignored) {
            return false;
        }
    }
}