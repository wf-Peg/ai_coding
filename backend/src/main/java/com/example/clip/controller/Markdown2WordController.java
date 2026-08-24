package com.example.clip.controller;

import com.example.clip.service.Markdown2WordService;
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
 * Markdown 转 Word (.docx) REST API 控制器。
 * <p>
 * 前端传入 Markdown 正文及内嵌图片（Mermaid 等转出的 base64 dataURL），
 * 后端生成原生 .docx 二进制流返回，供前端触发下载。
 * </p>
 */
@RestController
@RequestMapping("/api/editor")
@CrossOrigin(origins = "*")
public class Markdown2WordController {

    private static final Logger log = LoggerFactory.getLogger(Markdown2WordController.class);
    private static final String DOCX_CONTENT_TYPE =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    private final Markdown2WordService markdown2WordService;

    public Markdown2WordController(Markdown2WordService markdown2WordService) {
        this.markdown2WordService = markdown2WordService;
    }

    /**
     * 导出 Markdown 为 Word 文档。
     *
     * @param body 请求体：{ markdown: "Markdown 字符串", images: {name: dataURL}, filename: "可选" }
     * @return .docx 二进制流
     */
    @PostMapping("/export-word")
    public ResponseEntity<?> exportWord(@RequestBody Map<String, Object> body) {
        try {
            String markdown = (String) body.get("markdown");
            if (markdown == null || markdown.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Markdown 内容不能为空"));
            }

            @SuppressWarnings("unchecked")
            Map<String, String> images = (Map<String, String>) body.get("images");

            byte[] docxBytes = markdown2WordService.convertToDocx(markdown, images);

            String filename = (String) body.getOrDefault("filename", "导出文档.docx");
            String safe = filename.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (!safe.toLowerCase().endsWith(".docx")) {
                safe = safe + ".docx";
            }

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + URLEncoder.encode(safe, StandardCharsets.UTF_8))
                    .contentType(MediaType.parseMediaType(DOCX_CONTENT_TYPE))
                    .body(docxBytes);
        } catch (Exception e) {
            log.error("[Markdown2Word] export failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Word 导出失败: " + e.getMessage()));
        }
    }
}