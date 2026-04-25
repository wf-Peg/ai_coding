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

@Service
public class DocumentParseService {

    private static final Logger logger = LoggerFactory.getLogger(DocumentParseService.class);

    /**
     * 解析文档文件，提取纯文本
     * @param fileBytes 文件字节数组
     * @param fileName 文件名（用于判断文件类型）
     * @param sourceFilePath 源文件存储路径
     * @return 提取的纯文本内容
     */
    public String parseDocument(byte[] fileBytes, String fileName, String sourceFilePath) {
        if (fileName == null || fileName.isEmpty()) {
            return "[文档解析失败] 文件名为空";
        }

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
            
            // 添加源文件路径说明
            String sourceFileInfo = "源文件路径: " + sourceFilePath + "\n\n";
            return sourceFileInfo + parsedText;
        } catch (Exception e) {
            logger.error("[DocParse] Parse failed for {}: {}", fileName, e.getMessage(), e);
            return "[文档解析失败] " + e.getMessage();
        }
    }
    
    /**
     * 解析文档文件，提取纯文本（兼容旧方法）
     * @param fileBytes 文件字节数组
     * @param fileName 文件名（用于判断文件类型）
     * @return 提取的纯文本内容
     */
    public String parseDocument(byte[] fileBytes, String fileName) {
        return parseDocument(fileBytes, fileName, "");
    }

    /**
     * 解析 PDF 文件
     */
    private String parsePdf(byte[] fileBytes) throws IOException {
        try (PDDocument document = Loader.loadPDF(fileBytes)) {
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String text = stripper.getText(document);

            // Clean up
            text = text.replaceAll("\\s+", " ").trim();

            // Truncate if too long
            if (text.length() > 50000) {
                text = text.substring(0, 50000) + "\n\n[内容过长，已截断]";
            }

            return text;
        }
    }

    /**
     * 解析 DOCX 文件
     */
    private String parseDocx(byte[] fileBytes) throws IOException {
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(fileBytes))) {
            StringBuilder sb = new StringBuilder();

            for (XWPFParagraph paragraph : document.getParagraphs()) {
                String text = paragraph.getText().trim();
                if (!text.isEmpty()) {
                    sb.append(text).append("\n");
                }
            }

            // Also extract text from tables
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

            String text = sb.toString().replaceAll("\\s+", " ").trim();

            if (text.length() > 50000) {
                text = text.substring(0, 50000) + "\n\n[内容过长，已截断]";
            }

            return text;
        }
    }

    /**
     * 解析纯文本文件
     */
    private String parseTxt(byte[] fileBytes) throws IOException {
        String text = new String(fileBytes, "UTF-8").trim();

        if (text.length() > 50000) {
            text = text.substring(0, 50000) + "\n\n[内容过长，已截断]";
        }

        return text;
    }
}
