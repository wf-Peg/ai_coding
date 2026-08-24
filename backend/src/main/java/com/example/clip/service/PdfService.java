package com.example.clip.service;

import com.example.clip.core.ModelConfig;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import javax.imageio.ImageIO;

import org.apache.pdfbox.rendering.PDFRenderer;

/**
 * PDF 处理服务
 * <p>
 * 基于 Apache PDFBox 2.0.27 提供 PDF 文件的合并、拆分与文本提取能力。
 * <ul>
 *   <li>合并：使用 {@link PDFMergerUtility} 将多个 PDF 顺序拼接为一个文件</li>
 *   <li>拆分：支持按页逐张拆分或按页码范围（如 "1-3,5,7-9"）拆分，结果打包为 ZIP</li>
 *   <li>文本提取：使用 {@link PDFTextStripper} 提取纯文本，超长内容自动截断</li>
 * </ul>
 * 所有 {@link PDDocument} 实例均通过 try-with-resources 管理，确保资源被正确释放。
 * </p>
 */
@Service
public class PdfService {

    private static final Logger logger = LoggerFactory.getLogger(PdfService.class);

    /** 文本提取结果的最大字符数限制 */
    private static final int MAX_TEXT_LENGTH = 50000;

    /** AI 视觉 OCR 单页文本过少阈值（字符数） */
    private static final int AI_OCR_MIN_TEXT_LENGTH = 15;

    /** AI 视觉 OCR 默认模型 */
    private static final String DEFAULT_OCR_MODEL = "qwen-vl-plus";

    /** AI 视觉 OCR 默认 API 地址（OpenAI 兼容格式：DashScope 兼容模式） */
    private static final String DEFAULT_OCR_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

    /** AI 视觉 OCR 渲染 DPI */
    private static final int AI_OCR_DPI = 150;

    /** AI 视觉 OCR 图片最大边长 */
    private static final int AI_OCR_MAX_EDGE = 1600;

    /** 模型配置服务：用于获取 DashScope API Key（AI 视觉 OCR 用） */
    @Autowired(required = false)
    private ModelConfigService modelConfigService;

    /** DashScope yml 默认配置（用户未配置 API Key 时回退） */
    @Autowired(required = false)
    private com.example.clip.core.DashScopeConfig dashScopeConfig;

    /**
     * 加载 PDF 文件，将解析失败转为 IllegalArgumentException（400 错误）
     *
     * @param file 上传的 PDF 文件
     * @return 加载完成的 PDDocument（调用方负责关闭）
     * @throws IllegalArgumentException 文件不是有效 PDF 或已加密时抛出
     * @throws IOException             其他 I/O 错误
     */
    private PDDocument loadPdf(MultipartFile file) throws IOException {
        try {
            return PDDocument.load(file.getInputStream());
        } catch (InvalidPasswordException e) {
            throw new IllegalArgumentException("PDF 已加密，请先解密: " + file.getOriginalFilename(), e);
        } catch (IOException e) {
            throw new IllegalArgumentException("文件不是有效PDF: " + file.getOriginalFilename(), e);
        }
    }

    /**
     * 合并多个 PDF 文件
     * <p>
     * 使用 {@link PDFMergerUtility} 将传入的多个 PDF 顺序合并为一个 PDF。
     * 第一个文件作为目标文档，后续文件依次 append 进目标文档。
     * 所有 {@link PDDocument} 实例均通过 try-with-resources 关闭。
     * </p>
     *
     * @param files 待合并的 PDF 文件数组
     * @return 合并后的 PDF 字节数组
     * @throws IllegalArgumentException 文件数少于 2 个时抛出
     * @throws IOException             读取或写入 PDF 时抛出
     */
    public byte[] mergePdfs(MultipartFile[] files) throws IOException {
        if (files == null || files.length < 2) {
            throw new IllegalArgumentException("至少需要 2 个 PDF 文件");
        }

        logger.info("[PdfService] 开始合并 {} 个 PDF 文件", files.length);

        PDFMergerUtility merger = new PDFMergerUtility();
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        // 第一个文件作为目标文档，其余文件依次追加进目标文档
        try (PDDocument dest = loadPdf(files[0])) {
            for (int i = 1; i < files.length; i++) {
                // try-with-resources 确保每个源文档被正确关闭
                try (PDDocument source = loadPdf(files[i])) {
                    merger.appendDocument(dest, source);
                }
            }
            dest.save(out);
        }

        logger.info("[PdfService] PDF 合并完成，输出 {} 字节", out.size());
        return out.toByteArray();
    }

    /**
     * 拆分 PDF 文件
     * <p>
     * 支持两种拆分模式：
     * <ul>
     *   <li>{@code mode="each"}：将每一页拆分为独立 PDF，共 N 个文件</li>
     *   <li>提供 {@code ranges}（如 "1-3,5,7-9"）：按每个范围拆分为独立 PDF</li>
     * </ul>
     * 拆分结果打包为 ZIP 返回，文件名依次为 split_1.pdf、split_2.pdf ...
     * </p>
     *
     * @param file   待拆分的 PDF 文件
     * @param ranges 页码范围字符串，例如 "1-3,5,7-9"；为空时需配合 mode="each"
     * @param mode   拆分模式，目前支持 "each"（逐页拆分）
     * @return 包含所有拆分 PDF 的 ZIP 字节数组
     * @throws IllegalArgumentException ranges 无效或未指定拆分方式时抛出
     * @throws IOException              读取或写入 PDF 时抛出
     */
    public byte[] splitPdf(MultipartFile file, String ranges, String mode) throws IOException {
        logger.info("[PdfService] 拆分 PDF，mode={}, ranges={}", mode, ranges);

        try (PDDocument document = loadPdf(file);
             ByteArrayOutputStream zipOut = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(zipOut)) {

            int totalPages = document.getNumberOfPages();
            List<int[]> splitRanges = new ArrayList<>();

            if ("each".equals(mode)) {
                // 逐页拆分：每一页生成一个独立 PDF
                for (int i = 1; i <= totalPages; i++) {
                    splitRanges.add(new int[]{i, i});
                }
            } else if (ranges != null && !ranges.trim().isEmpty()) {
                // 按页码范围拆分
                splitRanges = parseRanges(ranges, totalPages);
            } else {
                throw new IllegalArgumentException("页码范围无效: " + ranges);
            }

            // 为每个范围创建独立 PDF 并写入 ZIP
            int index = 1;
            for (int[] range : splitRanges) {
                try (PDDocument splitDoc = new PDDocument()) {
                    for (int p = range[0]; p <= range[1]; p++) {
                        splitDoc.importPage(document.getPage(p - 1));
                    }
                    ByteArrayOutputStream pdfOut = new ByteArrayOutputStream();
                    splitDoc.save(pdfOut);

                    ZipEntry entry = new ZipEntry("split_" + index + ".pdf");
                    zos.putNextEntry(entry);
                    zos.write(pdfOut.toByteArray());
                    zos.closeEntry();
                    index++;
                }
            }

            zos.finish();
            logger.info("[PdfService] PDF 拆分完成，生成 {} 个文件", splitRanges.size());
            return zipOut.toByteArray();
        }
    }

    /**
     * 提取 PDF 文本内容
     * <p>
     * 使用 {@link PDFTextStripper} 提取 PDF 中的文本，按位置排序以保证阅读顺序。
     * 提取结果超过 {@value #MAX_TEXT_LENGTH} 字符时自动截断，并标记 truncated=true。
     * </p>
     *
     * @param file 待提取文本的 PDF 文件
     * @return 包含 text（文本）、pages（页数）、truncated（是否截断）的 Map
     * @throws IOException 读取或解析 PDF 时抛出
     */
    public Map<String, Object> extractText(MultipartFile file) throws IOException {
        logger.info("[PdfService] 提取 PDF 文本: {}", file.getOriginalFilename());

        // try-with-resources 确保 PDDocument 被正确关闭
        try (PDDocument document = loadPdf(file)) {
            PDFTextStripper stripper = new PDFTextStripper();
            // 按位置排序，保证文本提取顺序与视觉阅读顺序一致
            stripper.setSortByPosition(true);
            String text = stripper.getText(document);
            int pages = document.getNumberOfPages();

            boolean truncated = false;
            if (text.length() > MAX_TEXT_LENGTH) {
                text = text.substring(0, MAX_TEXT_LENGTH);
                truncated = true;
            }

            Map<String, Object> result = new HashMap<>();
            result.put("text", text);
            result.put("pages", pages);
            result.put("truncated", truncated);

            logger.info("[PdfService] 文本提取完成，页数={}, 截断={}", pages, truncated);
            return result;
        }
    }

    /**
     * PDF OCR 识别：将 PDF 渲染为图片后调用 OCR 引擎识别文字
     * <p>
     * 使用 PDFBox 的 PDFRenderer 将每页渲染为 BufferedImage，
     * 然后通过 Tess4J（Tesseract OCR）或预留的 AI 视觉模型接口进行文字识别。
     * </p>
     *
     * @param filePath 本地 PDF 文件路径
     * @return 包含识别结果和逐页文本的 Map
     * @throws IOException 读取或解析 PDF 失败时抛出
     */
    public Map<String, Object> ocrPdf(String filePath) throws IOException {
        logger.info("[PdfService] OCR 识别 PDF: {}", filePath);

        File pdfFile = new File(filePath);
        if (!pdfFile.exists()) {
            throw new IllegalArgumentException("文件不存在: " + filePath);
        }

        // 读取用户配置：OCR 开关、触发阈值、视觉模型（未配置时使用默认值）
        ModelConfig mc = modelConfigService != null ? modelConfigService.getConfig() : null;
        boolean aiEnabled = mc == null || mc.isPdfOcrEnabled();
        int minTextLength = (mc != null && mc.getPdfOcrMinTextLength() > 0)
            ? mc.getPdfOcrMinTextLength() : AI_OCR_MIN_TEXT_LENGTH;
        String ocrModel = (mc != null && mc.getPdfOcrModel() != null && !mc.getPdfOcrModel().isBlank())
            ? mc.getPdfOcrModel().trim() : DEFAULT_OCR_MODEL;

        // API Key 优先级：PDF OCR 专用 Key（部分 Key 不支持视觉模型）→ 全局 DashScope Key → yml 默认
        String apiKey = null;
        if (mc != null && mc.getPdfOcrApiKey() != null && !mc.getPdfOcrApiKey().isBlank()) {
            apiKey = mc.getPdfOcrApiKey().trim();
        } else if (mc != null && mc.getDashscopeApiKey() != null && !mc.getDashscopeApiKey().isBlank()) {
            apiKey = mc.getDashscopeApiKey().trim();
        }
        if (apiKey == null || apiKey.isBlank()) {
            apiKey = dashScopeConfig != null ? dashScopeConfig.getApiKey() : null;
        }
        if (apiKey != null && apiKey.startsWith("${")) apiKey = null;

        // 视觉模型 API 地址（OpenAI 兼容格式）：用户配置优先，为空时默认 DashScope 兼容模式
        String baseUrl = (mc != null && mc.getPdfOcrBaseUrl() != null && !mc.getPdfOcrBaseUrl().isBlank())
            ? mc.getPdfOcrBaseUrl().trim() : DEFAULT_OCR_BASE_URL;

        try (PDDocument document = PDDocument.load(pdfFile)) {
            PDFRenderer renderer = new PDFRenderer(document);
            int totalPages = document.getNumberOfPages();

            List<Map<String, Object>> pageResults = new ArrayList<>();
            StringBuilder fullText = new StringBuilder();
            int aiOcrPages = 0;

            for (int i = 0; i < totalPages; i++) {
                // 第一层：PDFTextStripper 直接提取文本（文字版 PDF 秒出结果）
                PDFTextStripper stripper = new PDFTextStripper();
                stripper.setStartPage(i + 1);
                stripper.setEndPage(i + 1);
                stripper.setSortByPosition(true);
                String pageText = stripper.getText(document);

                // 第二层：文本过少（扫描版/图片型 PDF）且启用 AI → 渲染为图片交给视觉模型 OCR
                boolean textTooShort = pageText == null || pageText.trim().length() < minTextLength;
                if (aiEnabled && textTooShort) {
                    String aiText = aiOcrPage(renderer, i, ocrModel, apiKey, baseUrl);
                    if (aiText != null && !aiText.isBlank()) {
                        pageText = aiText;
                        aiOcrPages++;
                    }
                }

                Map<String, Object> pageResult = new HashMap<>();
                pageResult.put("pageNumber", i + 1);
                pageResult.put("text", pageText == null ? "" : pageText);
                pageResults.add(pageResult);

                if (pageText != null && fullText.length() < MAX_TEXT_LENGTH) {
                    fullText.append(pageText).append("\n");
                }
            }

            String resultText = fullText.length() > MAX_TEXT_LENGTH
                ? fullText.substring(0, MAX_TEXT_LENGTH)
                : fullText.toString();

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("text", resultText);
            result.put("pages", pageResults);
            result.put("aiOcrPages", aiOcrPages);
            result.put("metadata", Map.of(
                "pageCount", totalPages,
                "fileSize", pdfFile.length()
            ));

            logger.info("[PdfService] OCR 识别完成，页数={}, AI OCR 页数={}", totalPages, aiOcrPages);
            return result;
        }
    }

    /**
     * AI 视觉 OCR：将 PDF 单页渲染为图片，调用 OpenAI 兼容格式的视觉模型识别文字。
     * <p>
     * 用于扫描版/图片型 PDF（PDFTextStripper 提取不到文字的场景）。
     * 通过 OpenAI 兼容的 /chat/completions 接口调用，支持 DashScope 兼容模式、
     * DeepSeek、自定义中转站等任意支持视觉能力的模型服务。
     * 未配置 API Key 或调用失败时返回 null，由调用方保持文本提取结果。
     * </p>
     *
     * @param renderer  PDFRenderer（页面渲染器）
     * @param pageIndex 页索引（从 0 开始）
     * @param model     视觉模型名称（如 qwen-vl-plus、gpt-4o、gemini-2.0-flash 等）
     * @param apiKey    API Key（已按优先级解析，可能为 null）
     * @param baseUrl   OpenAI 兼容 API 地址（末尾不含 /chat/completions）
     * @return 识别出的文本，失败或未配置时返回 null
     */
    private String aiOcrPage(PDFRenderer renderer, int pageIndex, String model, String apiKey, String baseUrl) {
        try {
            if (apiKey == null || apiKey.isBlank()) {
                logger.warn("[PdfService] 未配置视觉模型 API Key，跳过 AI OCR 第 {} 页", pageIndex + 1);
                return null;
            }

            logger.info("[PdfService] AI OCR 调用第 {} 页（model={}）", pageIndex + 1, model);

            // 渲染当前页为图片并压缩尺寸（控制请求体积）
            BufferedImage pageImage = renderer.renderImageWithDPI(pageIndex, AI_OCR_DPI);
            pageImage = scaleImage(pageImage, AI_OCR_MAX_EDGE);
            String base64 = imageToBase64Png(pageImage);
            if (base64.length() > 4_500_000) {
                logger.warn("[PdfService] AI OCR 图片过大已跳过第 {} 页", pageIndex + 1);
                return null;
            }

            // OpenAI 兼容请求体：messages[0].content 为 text + image_url 数组
            Map<String, Object> textPart = new LinkedHashMap<>();
            textPart.put("type", "text");
            textPart.put("text", "请识别这张图片中的所有文字，按原文输出，不要添加任何解释、注释或格式符号。");

            Map<String, Object> imageUrlPart = new LinkedHashMap<>();
            imageUrlPart.put("url", "data:image/png;base64," + base64);
            Map<String, Object> imagePart = new LinkedHashMap<>();
            imagePart.put("type", "image_url");
            imagePart.put("image_url", imageUrlPart);

            Map<String, Object> userMsg = new LinkedHashMap<>();
            userMsg.put("role", "user");
            userMsg.put("content", Arrays.asList(textPart, imagePart));

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", model != null && !model.isBlank() ? model : DEFAULT_OCR_MODEL);
            requestBody.put("messages", Arrays.asList(userMsg));
            requestBody.put("temperature", 0);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);

            String url = baseUrl.replaceAll("/+$", "") + "/chat/completions";
            RestTemplate restTemplate = new RestTemplate();
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);

            String text = extractTextFromContent(response.getBody());
            return (text == null || text.isBlank()) ? null : text.trim();
        } catch (Exception e) {
            logger.warn("[PdfService] AI OCR 第 {} 页失败: {}", pageIndex + 1, e.getMessage());
            return null;
        }
    }

    /**
     * 从 OpenAI 兼容的 chat/completions 响应中提取文本。
     * <p>
     * content 可能为字符串，也可能为分段数组（如 [{"type":"text","text":"..."}]），
     * 部分模型（推理类）content 可能为 null，此时返回 null。
     * </p>
     *
     * @param body chat/completions 响应体
     * @return 识别文本，无法解析时返回 null
     */
    @SuppressWarnings("unchecked")
    private String extractTextFromContent(Map<String, Object> body) {
        if (body == null) return null;
        Object choicesObj = body.get("choices");
        if (!(choicesObj instanceof List) || ((List<?>) choicesObj).isEmpty()) return null;
        Object choiceObj = ((List<?>) choicesObj).get(0);
        if (!(choiceObj instanceof Map)) return null;
        Object messageObj = ((Map<?, ?>) choiceObj).get("message");
        if (!(messageObj instanceof Map)) return null;
        Object content = ((Map<?, ?>) messageObj).get("content");
        if (content instanceof String) {
            return ((String) content).trim();
        }
        if (content instanceof List) {
            StringBuilder sb = new StringBuilder();
            for (Object part : (List<?>) content) {
                if (part instanceof Map && ((Map<?, ?>) part).get("text") != null) {
                    sb.append(((Map<?, ?>) part).get("text"));
                }
            }
            return sb.toString().trim();
        }
        return null;
    }

    /**
     * 等比缩放图片，控制最长边不超过 maxEdge 像素。
     */
    private BufferedImage scaleImage(BufferedImage src, int maxEdge) {
        int w = src.getWidth();
        int h = src.getHeight();
        int max = Math.max(w, h);
        if (max <= maxEdge) return src;
        double ratio = (double) maxEdge / max;
        int nw = Math.max(1, (int) (w * ratio));
        int nh = Math.max(1, (int) (h * ratio));
        BufferedImage scaled = new BufferedImage(nw, nh, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = scaled.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, nw, nh, null);
        g.dispose();
        return scaled;
    }

    /**
     * 将 BufferedImage 编码为 PNG Base64 字符串。
     */
    private String imageToBase64Png(BufferedImage image) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    /**
     * 解析页码范围字符串
     * <p>
     * 支持的格式：
     * <ul>
     *   <li>单页：{@code "5"}</li>
     *   <li>连续范围：{@code "1-3"}</li>
     * </ul>
     * 多个范围以逗号分隔，例如 "1-3,5,7-9"。
     * 页码从 1 开始，必须落在 [1, totalPages] 区间内，且范围的起始页不大于结束页。
     * </p>
     *
     * @param ranges     页码范围字符串
     * @param totalPages PDF 总页数
     * @return 解析后的范围列表，每个元素为 {起始页, 结束页}
     * @throws IllegalArgumentException 格式错误或页码越界时抛出
     */
    private List<int[]> parseRanges(String ranges, int totalPages) {
        List<int[]> result = new ArrayList<>();
        String[] parts = ranges.split(",");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            int start;
            int end;
            if (trimmed.contains("-")) {
                String[] bounds = trimmed.split("-");
                if (bounds.length != 2) {
                    throw new IllegalArgumentException("页码范围无效: " + ranges);
                }
                try {
                    start = Integer.parseInt(bounds[0].trim());
                    end = Integer.parseInt(bounds[1].trim());
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("页码范围无效: " + ranges);
                }
            } else {
                try {
                    start = Integer.parseInt(trimmed);
                    end = start;
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("页码范围无效: " + ranges);
                }
            }

            // 校验页码合法性：1 ≤ start ≤ end ≤ totalPages
            if (start < 1 || end > totalPages || start > end) {
                throw new IllegalArgumentException("页码范围无效: " + ranges);
            }
            result.add(new int[]{start, end});
        }

        if (result.isEmpty()) {
            throw new IllegalArgumentException("页码范围无效: " + ranges);
        }
        return result;
    }
}
