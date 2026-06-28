package com.example.clip.service;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.io.IOException;

/**
 * 文档解析服务
 * <p>
 * 负责将上传的文档文件（PDF、DOCX、TXT、MD、CSV）解析为纯文本内容。
 * 使用 Apache PDFBox 解析 PDF，Apache POI 解析 DOCX，原生方式解析纯文本文件。
 * 解析结果会限制在 50000 字符以内，超长内容会被截断。
 * </p>
 */
@Service
public class DocumentParseService {

    private static final Logger logger = LoggerFactory.getLogger(DocumentParseService.class);

    /** 解析结果的最大字符数限制 */
    private static final int MAX_TEXT_LENGTH = 50000;

    /**
     * 解析文档文件，提取纯文本内容
     * <p>
     * 根据文件扩展名自动选择解析器：.pdf 用 PDFBox，.docx 用 POI，
     * .txt/.md/.csv 用 UTF-8 读取。解析结果前会附加源文件路径信息。
     * </p>
     *
     * @param fileBytes      文件字节数组
     * @param fileName       文件名（用于判断文件类型）
     * @param sourceFilePath 源文件在服务器上的存储路径
     * @return 提取的纯文本内容，如果解析失败则返回错误描述
     */
    public String parseDocument(byte[] fileBytes, String fileName, String sourceFilePath) {
        if (fileName == null || fileName.isEmpty()) {
            return "[文档解析失败] 文件名为空";
        }

        // 统一转为小写进行扩展名匹配，避免大小写问题
        String lowerName = fileName.toLowerCase();

        try {
            String parsedText;
            if (lowerName.endsWith(".pdf")) {
                parsedText = parsePdf(fileBytes);
            } else if (lowerName.endsWith(".docx")) {
                parsedText = parseDocx(fileBytes);
            } else if (lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".csv")) {
                parsedText = parseTxt(fileBytes);
            } else {
                return "[文档解析失败] 不支持的文件格式: " + fileName + "。支持 PDF、DOCX、TXT 格式。";
            }

            // 在解析结果前附加源文件路径，方便后续追溯
            String sourceFileInfo = "源文件路径: " + sourceFilePath + "\n\n";
            return sourceFileInfo + parsedText;
        } catch (Exception e) {
            logger.error("[DocParse] Parse failed for {}: {}", fileName, e.getMessage(), e);
            return "[文档解析失败] " + e.getMessage();
        }
    }

    /**
     * 解析文档文件（兼容旧方法，不传递源文件路径）
     *
     * @param fileBytes 文件字节数组
     * @param fileName  文件名
     * @return 提取的纯文本内容
     */
    public String parseDocument(byte[] fileBytes, String fileName) {
        return parseDocument(fileBytes, fileName, "");
    }

    /**
     * 解析 PDF 文件
     * <p>
     * 使用 PDFBox 加载 PDF 并提取文本，按位置排序以保证阅读顺序。
     * 解析后会将多余空白字符合并为单个空格，并对超长内容截断。
     * </p>
     *
     * @param fileBytes PDF 文件的字节数组
     * @return 提取的纯文本
     * @throws IOException 读取 PDF 时可能抛出的 IO 异常
     */
    private String parsePdf(byte[] fileBytes) throws IOException {
        // try-with-resources 确保 PDDocument 被正确关闭
        try (PDDocument document = Loader.loadPDF(fileBytes)) {
            PDFTextStripper stripper = new PDFTextStripper();
            // 按位置排序，保证文本提取顺序与视觉阅读顺序一致
            stripper.setSortByPosition(true);
            String text = stripper.getText(document);

            // 合并多余空白字符
            text = text.replaceAll("\\s+", " ").trim();

            // 截断超长内容，避免 AI 处理时 token 超限
            if (text.length() > MAX_TEXT_LENGTH) {
                text = text.substring(0, MAX_TEXT_LENGTH) + "\n\n[内容过长，已截断]";
            }

            return text;
        }
    }

    /**
     * 解析 DOCX 文件
     * <p>
     * 使用 Apache POI 读取 DOCX，提取段落文本和表格内容。
     * 表格数据以 Tab 分隔单元格，每行以换行分隔。
     * </p>
     *
     * @param fileBytes DOCX 文件的字节数组
     * @return 提取的纯文本
     * @throws IOException 读取 DOCX 时可能抛出的 IO 异常
     */
    private String parseDocx(byte[] fileBytes) throws IOException {
        // try-with-resources 确保 XWPFDocument 被正确关闭
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(fileBytes))) {
            StringBuilder sb = new StringBuilder();

            // 提取段落文本
            for (XWPFParagraph paragraph : document.getParagraphs()) {
                String text = paragraph.getText().trim();
                if (!text.isEmpty()) {
                    sb.append(text).append("\n");
                }
            }

            // 提取表格中的文本，单元格之间用 Tab 分隔
            document.getTables().forEach(table -> {
                table.getRows().forEach(row -> {
                    row.getTableCells().forEach(cell -> {
                        String text = cell.getText().trim();
                        if (!text.isEmpty()) {
                            sb.append(text).append("\t");
                        }
                    });
                    sb.append("\n");
                });
            });

            // 合并多余空白字符
            String text = sb.toString().replaceAll("\\s+", " ").trim();

            if (text.length() > MAX_TEXT_LENGTH) {
                text = text.substring(0, MAX_TEXT_LENGTH) + "\n\n[内容过长，已截断]";
            }

            return text;
        }
    }

    /**
     * 解析纯文本文件（TXT、MD、CSV 等）
     *
     * @param fileBytes 文本文件的字节数组
     * @return 提取的纯文本（UTF-8 解码）
     * @throws IOException 读取时可能抛出的 IO 异常
     */
    private String parseTxt(byte[] fileBytes) throws IOException {
        // 使用 UTF-8 编码解码字节数组
        String text = new String(fileBytes, "UTF-8").trim();

        if (text.length() > MAX_TEXT_LENGTH) {
            text = text.substring(0, MAX_TEXT_LENGTH) + "\n\n[内容过长，已截断]";
        }

        return text;
    }
}