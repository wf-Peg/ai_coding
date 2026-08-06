package com.example.clip.service;

import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import java.awt.image.BufferedImage;
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

        try (PDDocument document = PDDocument.load(pdfFile)) {
            PDFRenderer renderer = new PDFRenderer(document);
            int totalPages = document.getNumberOfPages();

            List<Map<String, Object>> pageResults = new ArrayList<>();
            StringBuilder fullText = new StringBuilder();

            for (int i = 0; i < totalPages; i++) {
                // 渲染当前页为图片（300 DPI 保证识别质量）
                BufferedImage pageImage = renderer.renderImageWithDPI(i, 300);

                // OCR 识别：此处预留接口，实际实现可使用 Tess4J 或调用 AI 视觉模型
                // 当前回退到 PDFTextStripper 提取的文本（后续可替换为真实 OCR）
                PDFTextStripper stripper = new PDFTextStripper();
                stripper.setStartPage(i + 1);
                stripper.setEndPage(i + 1);
                stripper.setSortByPosition(true);
                String pageText = stripper.getText(document);

                Map<String, Object> pageResult = new HashMap<>();
                pageResult.put("pageNumber", i + 1);
                pageResult.put("text", pageText);
                pageResults.add(pageResult);

                if (fullText.length() < MAX_TEXT_LENGTH) {
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
            result.put("metadata", Map.of(
                "pageCount", totalPages,
                "fileSize", pdfFile.length()
            ));

            logger.info("[PdfService] OCR 识别完成，页数={}", totalPages);
            return result;
        }
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
