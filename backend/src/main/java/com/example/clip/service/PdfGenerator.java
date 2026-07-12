package com.example.clip.service;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

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
 *   <li>项目 resources/fonts/ 目录下的字体文件</li>
 *   <li>操作系统标准字体目录（Windows: C:/Windows/Fonts, macOS: /System/Library/Fonts, Linux: /usr/share/fonts）</li>
 *   <li>回退到系统默认 sans-serif（可能不支持中文）</li>
 * </ol>
 */
@Service
public class PdfGenerator {

    private static final Logger log = LoggerFactory.getLogger(PdfGenerator.class);

    /** 需要探测的中文字体文件名列表 */
    private static final List<String> CJK_FONT_NAMES = List.of(
            // Windows 常用中文字体
            "simsun.ttf", "simsun.ttc", "msyh.ttf", "msyh.ttc", "msyhl.ttf",
            // macOS 常用中文字体
            "PingFang.ttc", "PingFang.ttf", "STHeiti Light.ttc", "STHeiti Medium.ttc",
            "Hiragino Sans GB.ttc", "Hiragino Sans GB W3.ttc", "Hiragino Sans GB W6.ttc",
            // Linux 常用中文字体
            "wqy-zenhei.ttc", "wqy-microhei.ttc", "NotoSansCJK-Regular.ttc",
            "NotoSansSC-Regular.otf", "NotoSansSC-Regular.ttf",
            "DroidSansFallback.ttf", "DroidSansFallbackFull.ttf",
            // 通用名称
            "NotoSansSC-VariableFont_wght.ttf",
            "NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-VF.otf.ttc"
    );

    /** 中文字体探测路径 */
    private static final List<String> FONT_SEARCH_DIRS = List.of(
            // 项目内置字体
            "src/main/resources/fonts",
            "resources/fonts",
            "fonts",
            // Windows
            "C:/Windows/Fonts",
            // macOS
            "/System/Library/Fonts",
            "/Library/Fonts",
            // Linux
            "/usr/share/fonts/truetype",
            "/usr/share/fonts/opentype",
            "/usr/share/fonts",
            "/usr/local/share/fonts"
    );

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
                builder.useFont(fontFile, "CJKFont");
                log.debug("[PdfGenerator] Using font: {} → family: CJKFont", fontFile.getAbsolutePath());
            } else {
                log.warn("[PdfGenerator] No CJK font found, PDF may have garbled Chinese text");
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
     * 遍历所有预设的搜索目录和字体文件名，返回第一个找到的字体文件。
     * 结果会被缓存，后续调用直接返回缓存结果。
     * </p>
     *
     * @return 中文字体文件，若未找到则返回 null
     */
    private File findCjkFont() {
        if (detectedFont != null) {
            return detectedFont;
        }

        // 先尝试从 classpath 加载
        for (String fontName : CJK_FONT_NAMES) {
            try (InputStream is = getClass().getClassLoader().getResourceAsStream("fonts/" + fontName)) {
                if (is != null) {
                    // classpath 中的字体无法直接获取 File 对象，需要复制到临时文件
                    File tempFont = File.createTempFile("cjk-font-", ".tmp");
                    tempFont.deleteOnExit();
                    try (FileOutputStream fos = new FileOutputStream(tempFont)) {
                        is.transferTo(fos);
                    }
                    detectedFont = tempFont;
                    log.info("[PdfGenerator] Found CJK font in classpath: fonts/{}", fontName);
                    return detectedFont;
                }
            } catch (Exception e) {
                // 继续尝试下一个
            }
        }

        // 遍历系统字体目录
        for (String searchDir : FONT_SEARCH_DIRS) {
            Path dir = Paths.get(searchDir);
            if (!Files.isDirectory(dir)) {
                continue;
            }
            for (String fontName : CJK_FONT_NAMES) {
                Path fontPath = dir.resolve(fontName);
                if (Files.isRegularFile(fontPath)) {
                    detectedFont = fontPath.toFile();
                    log.info("[PdfGenerator] Found CJK font: {}", fontPath);
                    return detectedFont;
                }
            }
            // 递归搜索一级子目录（Linux 字体通常在子目录中）
            try {
                Files.list(dir).filter(Files::isDirectory).forEach(subDir -> {
                    for (String fontName : CJK_FONT_NAMES) {
                        Path fontPath = subDir.resolve(fontName);
                        if (Files.isRegularFile(fontPath)) {
                            detectedFont = fontPath.toFile();
                            log.info("[PdfGenerator] Found CJK font: {}", fontPath);
                        }
                    }
                });
            } catch (IOException ignored) {
                // 目录不可读，跳过
            }
            if (detectedFont != null) {
                return detectedFont;
            }
        }

        log.warn("[PdfGenerator] No CJK font found. Searched dirs: {}; fonts: {}",
                FONT_SEARCH_DIRS, CJK_FONT_NAMES);
        return null;
    }
}