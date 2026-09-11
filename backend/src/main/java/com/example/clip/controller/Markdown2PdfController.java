package com.example.clip.controller;

import com.example.clip.service.PdfGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Markdown 转 PDF REST API 控制器。
 * <p>
 * 前端传入 Markdown 正文及内嵌图片（Mermaid 等转出的 base64 dataURL），
 * 后端复用 {@link PdfGenerator}（flexmark → OpenHTMLtoPDF）生成 PDF 二进制流返回。
 * </p>
 */
@RestController
@RequestMapping("/api/editor")
@CrossOrigin(origins = "*")
public class Markdown2PdfController {

    private static final Logger log = LoggerFactory.getLogger(Markdown2PdfController.class);
    private static final String PDF_CONTENT_TYPE = "application/pdf";

    private final PdfGenerator pdfGenerator;

    public Markdown2PdfController(PdfGenerator pdfGenerator) {
        this.pdfGenerator = pdfGenerator;
    }

    /**
     * 导出 Markdown 为 PDF 文档。
     *
     * @param body 请求体：{ markdown: "Markdown 字符串", images: {name: dataURL}, filename: "可选" }
     * @return .pdf 二进制流
     */
    @PostMapping("/export-pdf")
    public ResponseEntity<?> exportPdf(@RequestBody Map<String, Object> body) {
        try {
            String markdown = (String) body.get("markdown");
            if (markdown == null || markdown.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Markdown 内容不能为空"));
            }

            @SuppressWarnings("unchecked")
            Map<String, String> images = (Map<String, String>) body.get("images");

            byte[] pdfBytes = pdfGenerator.generateFromMarkdown(markdown, images);

            String filename = (String) body.getOrDefault("filename", "导出文档.pdf");
            String safe = filename.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (!safe.toLowerCase().endsWith(".pdf")) {
                safe = safe + ".pdf";
            }

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + URLEncoder.encode(safe, StandardCharsets.UTF_8))
                    .contentType(MediaType.parseMediaType(PDF_CONTENT_TYPE))
                    .body(pdfBytes);
        } catch (Exception e) {
            log.error("[Markdown2Pdf] export failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "PDF 导出失败: " + e.getMessage()));
        }
    }
}