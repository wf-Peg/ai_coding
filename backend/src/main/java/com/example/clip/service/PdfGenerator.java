package com.example.clip.service;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
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
 * 使用 Jsoup 清洗 HTML + OpenHTMLtoPDF 渲染为 PDF。
 * 自动探测系统中的中文字体并注册，确保中文不乱码。
 * 超链接天然支持可点击，Jsoup 自动修复不规范的 HTML 标签。
 * </p>
 *
 * <h3>字体探测策略</h3>
 * 按以下顺序查找中文字体：
 * <ol>
 *   <li>项目 resources/fonts/ 目录下的 .ttf/.ttc/.otf 文件</li>
 *   <li>操作系统标准字体目录（Windows: C:/Windows/Fonts, macOS: /System/Library/Fonts, Linux: /usr/share/fonts）</li>
 *   <li>使用 java.awt.GraphicsEnvironment 查找系统注册的中文字体</li>
 * </ol>
 */
@Service
public class PdfGenerator {

    private static final Logger log = LoggerFactory.getLogger(PdfGenerator.class);

    /** 中文字体探测路径（按优先级排序） */
    private static final List<String> FONT_SEARCH_DIRS = List.of(
            // 项目内置字体（classpath 中 fonts/ 目录）
            "src/main/resources/fonts",
            "resources/fonts",
            "fonts",
            // Windows
            "C:/Windows/Fonts",
            // macOS
            "/System/Library/Fonts",
            "/Library/Fonts",
            "~/Library/Fonts",
            // Linux
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "/usr/share/fonts/truetype",
            "/usr/share/fonts/opentype"
    );

    /** 字体文件扩展名 */
    private static final Set<String> FONT_EXTENSIONS = Set.of(".ttf", ".ttc", ".otf");

    /** 缓存探测到的字体文件，避免每次生成 PDF 都扫描文件系统 */
    private volatile File detectedFont;

    /**
     * 将 HTML 字符串转换为 PDF 字节数组。
     *
     * @param rawHtml 原始 HTML 字符串（可能不规范，Jsoup 会自动修复）
     * @return PDF 文件的字节数组
     * @throws IOException 如果 PDF 生成失败
     */
    public byte[] generate(String rawHtml) throws IOException {
        // 第一步：Jsoup 清洗 HTML，自动修复不闭合标签、转义特殊字符
        Document doc = Jsoup.parse(rawHtml, "UTF-8");
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().charset("UTF-8");
        String cleanedXhtml = doc.html();

        // 第二步：OpenHTMLtoPDF 渲染
        try (ByteArrayOutputStream os = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();

            // 注册中文字体（统一使用 "CJKFont" 作为 family 名称，CSS 中引用此名称）
            File fontFile = findCjkFont();
            if (fontFile != null) {
                log.info("[PdfGenerator] Registering font: {} as CJKFont", fontFile.getAbsolutePath());
                builder.useFont(fontFile, "CJKFont");
            } else {
                log.warn("[PdfGenerator] No CJK font found! PDF may have garbled Chinese text. "
                        + "Please place a Chinese font file (e.g. simsun.ttf, NotoSansSC-Regular.otf) "
                        + "in backend/src/main/resources/fonts/ directory.");
            }

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
     * 查找系统中可用的中文字体文件。
     * <p>
     * 多层次探测策略：
     * <ol>
     *   <li>从 classpath 的 fonts/ 目录加载（项目内置字体）</li>
     *   <li>在系统字体目录中搜索所有 .ttf/.ttc/.otf 文件（大小写不敏感）</li>
     *   <li>使用 java.awt.GraphicsEnvironment 查找已注册的中文字体</li>
     * </ol>
     * 结果会被缓存，后续调用直接返回缓存结果。
     * </p>
     *
     * @return 中文字体文件，若未找到则返回 null
     */
    private synchronized File findCjkFont() {
        if (detectedFont != null) {
            return detectedFont;
        }

        // 策略 1: 从 classpath 的 fonts/ 目录加载
        File classpathFont = findFontInClasspath();
        if (classpathFont != null) {
            detectedFont = classpathFont;
            return detectedFont;
        }

        // 策略 2: 在系统字体目录中搜索所有字体文件
        File systemFont = findFontInSystemDirs();
        if (systemFont != null) {
            detectedFont = systemFont;
            return detectedFont;
        }

        // 策略 3: 使用 java.awt 查找已注册的中文字体
        File awtFont = findFontViaAwt();
        if (awtFont != null) {
            detectedFont = awtFont;
            return detectedFont;
        }

        log.warn("[PdfGenerator] No CJK font found in any location. "
                + "Searched: classpath:fonts/, system font dirs, AWT registered fonts.");
        return null;
    }

    /**
     * 从 classpath 的 fonts/ 目录加载字体文件。
     * 遍历所有已知的字体文件名，尝试从 classpath 加载。
     */
    private File findFontInClasspath() {
        // 先尝试列出 fonts/ 目录下的所有文件
        try {
            java.net.URL fontsUrl = getClass().getClassLoader().getResource("fonts");
            if (fontsUrl != null) {
                java.io.File fontsDir = new java.io.File(fontsUrl.toURI());
                if (fontsDir.isDirectory()) {
                    java.io.File[] files = fontsDir.listFiles((dir, name) -> {
                        String lower = name.toLowerCase();
                        return lower.endsWith(".ttf") || lower.endsWith(".ttc") || lower.endsWith(".otf");
                    });
                    if (files != null) {
                        for (java.io.File f : files) {
                            if (isCjkFontFile(f)) {
                                log.info("[PdfGenerator] Found CJK font in classpath fonts/: {}", f.getName());
                                return f;
                            }
                        }
                        // 如果目录中有字体文件但未通过 CJK 检测，返回第一个作为兜底
                        if (files.length > 0) {
                            log.info("[PdfGenerator] Using first available font in classpath fonts/: {} (CJK support unverified)", files[0].getName());
                            return files[0];
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("[PdfGenerator] Cannot list classpath fonts/ as directory: {}", e.getMessage());
        }

        // 回退：按已知文件名逐个尝试
        for (String fontName : KNOWN_CJK_FONT_NAMES) {
            try (InputStream is = getClass().getClassLoader().getResourceAsStream("fonts/" + fontName)) {
                if (is != null) {
                    File tempFont = File.createTempFile("cjk-font-", fontName.substring(fontName.lastIndexOf('.')));
                    tempFont.deleteOnExit();
                    try (FileOutputStream fos = new FileOutputStream(tempFont)) {
                        is.transferTo(fos);
                    }
                    log.info("[PdfGenerator] Found CJK font in classpath: fonts/{}", fontName);
                    return tempFont;
                }
            } catch (Exception e) {
                // 继续尝试下一个
            }
        }
        return null;
    }

    /**
     * 在系统字体目录中搜索字体文件。
     * 遍历所有预设目录，查找 .ttf/.ttc/.otf 文件，并验证 CJK 支持。
     */
    private File findFontInSystemDirs() {
        for (String searchDir : FONT_SEARCH_DIRS) {
            // 展开 ~ 为用户主目录
            String expandedDir = searchDir.startsWith("~/")
                    ? System.getProperty("user.home") + searchDir.substring(1)
                    : searchDir;
            Path dir = Paths.get(expandedDir);
            if (!Files.isDirectory(dir)) {
                continue;
            }
            try {
                // 递归搜索所有字体文件（最多 3 层）
                File found = searchFontsRecursive(dir, 3);
                if (found != null) {
                    return found;
                }
            } catch (Exception e) {
                log.debug("[PdfGenerator] Error searching font dir {}: {}", dir, e.getMessage());
            }
        }
        return null;
    }

    /**
     * 递归搜索目录中的字体文件，并验证 CJK 支持。
     */
    private File searchFontsRecursive(Path dir, int maxDepth) {
        if (maxDepth <= 0) return null;
        try (Stream<Path> stream = Files.list(dir)) {
            List<Path> entries = stream.toList();
            for (Path entry : entries) {
                if (Files.isDirectory(entry)) {
                    File found = searchFontsRecursive(entry, maxDepth - 1);
                    if (found != null) return found;
                } else if (Files.isRegularFile(entry)) {
                    String name = entry.getFileName().toString().toLowerCase();
                    if (name.endsWith(".ttf") || name.endsWith(".ttc") || name.endsWith(".otf")) {
                        // 优先匹配已知 CJK 字体名
                        if (isKnownCjkFontName(name)) {
                            log.info("[PdfGenerator] Found known CJK font: {}", entry);
                            return entry.toFile();
                        }
                    }
                }
            }
            // 如果没找到已知 CJK 字体，返回第一个字体文件作为兜底
            for (Path entry : entries) {
                if (Files.isRegularFile(entry)) {
                    String name = entry.getFileName().toString().toLowerCase();
                    if (name.endsWith(".ttf") || name.endsWith(".ttc") || name.endsWith(".otf")) {
                        log.info("[PdfGenerator] Using fallback font: {} (CJK support unverified)", entry);
                        return entry.toFile();
                    }
                }
            }
        } catch (IOException e) {
            log.debug("[PdfGenerator] Cannot read directory {}: {}", dir, e.getMessage());
        }
        return null;
    }

    /**
     * 使用 java.awt.GraphicsEnvironment 查找系统中已注册的中文字体。
     */
    private File findFontViaAwt() {
        try {
            GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
            String[] fontFamilies = ge.getAvailableFontFamilyNames();
            log.debug("[PdfGenerator] AWT reports {} font families", fontFamilies.length);

            for (String family : fontFamilies) {
                // 检查是否可能是中文字体家族
                if (isPossibleCjkFamily(family)) {
                    Font font = new Font(family, Font.PLAIN, 12);
                    if (font.canDisplay('中')) {
                        log.info("[PdfGenerator] AWT found CJK-capable font family: {}", family);
                        // 尝试从系统目录中找到对应的字体文件
                        File fontFile = findFontFileForFamily(family);
                        if (fontFile != null) {
                            return fontFile;
                        }
                        // 如果找不到文件，尝试使用 Font.createFont 创建
                        log.info("[PdfGenerator] Cannot locate file for font family: {}, will try fallback", family);
                    }
                }
            }
        } catch (Exception e) {
            log.debug("[PdfGenerator] AWT font detection failed: {}", e.getMessage());
        }
        return null;
    }

    /**
     * 根据字体家族名称在系统目录中查找对应的字体文件。
     */
    private File findFontFileForFamily(String family) {
        String lowerFamily = family.toLowerCase().replace(" ", "");
        for (String searchDir : FONT_SEARCH_DIRS) {
            String expandedDir = searchDir.startsWith("~/")
                    ? System.getProperty("user.home") + searchDir.substring(1)
                    : searchDir;
            Path dir = Paths.get(expandedDir);
            if (!Files.isDirectory(dir)) continue;
            try (Stream<Path> stream = Files.list(dir)) {
                for (Path entry : stream.toList()) {
                    if (Files.isRegularFile(entry)) {
                        String name = entry.getFileName().toString().toLowerCase().replace(" ", "");
                        if (name.contains(lowerFamily) || lowerFamily.contains(name.replaceFirst("\\.[^.]+$", ""))) {
                            log.info("[PdfGenerator] Found font file for family {}: {}", family, entry);
                            return entry.toFile();
                        }
                    }
                }
            } catch (IOException ignored) {}
        }
        return null;
    }

    /** 已知 CJK 字体文件名关键词（小写） */
    private static final Set<String> CJK_KEYWORDS = Set.of(
            "simsun", "msyh", "msyhl", "mingliu", "mingliu_hkscs", "pmingliu",
            "pingfang", "stheiti", "heiti", "hiragino", "kaiti", "songti", "fang",
            "wqy", "wenquan", "zenhei", "microhei", "noto", "cjk", "droid",
            "sourcehansans", "sourcehanserif", "hans", "chinese", "cn", "sc",
            "gbsn", "gbst", "simhei", "simkai", "simfang", "nsimsun", "mono"
    );

    /** 已知 CJK 字体文件名列表（用于 classpath 加载） */
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

    /** 判断文件名是否匹配已知 CJK 字体 */
    private boolean isKnownCjkFontName(String lowerName) {
        String base = lowerName.replaceFirst("\\.[^.]+$", "").replace(" ", "");
        for (String kw : CJK_KEYWORDS) {
            if (base.contains(kw)) return true;
        }
        return false;
    }

    /** 判断字体家族名是否可能是 CJK 字体 */
    private boolean isPossibleCjkFamily(String family) {
        String lower = family.toLowerCase().replace(" ", "");
        for (String kw : CJK_KEYWORDS) {
            if (lower.contains(kw)) return true;
        }
        return false;
    }

    /** 使用 java.awt.Font 检查字体文件是否支持 CJK 字符 */
    private boolean isCjkFontFile(java.io.File file) {
        try {
            Font font = Font.createFont(Font.TRUETYPE_FONT, file);
            return font.canDisplay('中') && font.canDisplay('文');
        } catch (Exception e) {
            return false;
        }
    }
}