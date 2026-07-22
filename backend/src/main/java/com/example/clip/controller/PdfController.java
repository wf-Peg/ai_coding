package com.example.clip.controller;

import com.example.clip.service.PdfService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * PDF 处理 REST API 控制器
 * <p>
 * 提供常用的 PDF 文件处理能力，包括：
 * <ul>
 *   <li>合并：将多个 PDF 顺序拼接为一个文件</li>
 *   <li>拆分：按页或按页码范围拆分 PDF，结果打包为 ZIP</li>
 *   <li>文本提取：从 PDF 中提取纯文本内容</li>
 * </ul>
 * 所有接口均映射到 {@code /api/pdf} 路径下，并允许跨域访问。
 * </p>
 *
 * @see PdfService
 */
@RestController
@RequestMapping("/api/pdf")
@CrossOrigin(origins = "*")
public class PdfController {

    private static final Logger logger = LoggerFactory.getLogger(PdfController.class);

    /** 单个上传文件的最大大小（100MB） */
    private static final long MAX_FILE_SIZE = 100L * 1024 * 1024;

    /** PDF 处理核心服务 */
    private final PdfService pdfService;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param pdfService PDF 处理服务
     */
    public PdfController(PdfService pdfService) {
        this.pdfService = pdfService;
    }

    /**
     * 校验文件大小是否在允许范围内
     *
     * @param file 上传的文件
     * @throws IllegalArgumentException 文件超过 100MB 时抛出
     */
    private void validateFileSize(MultipartFile file) {
        if (file != null && file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("文件过大（超过100MB）: " + file.getOriginalFilename());
        }
    }

    /**
     * 合并多个 PDF 文件
     * <p>
     * POST /api/pdf/merge
     * <p>
     * 将上传的多个 PDF 文件按顺序合并为一个 PDF。至少需要 2 个文件。
     * 成功返回 application/pdf 二进制流，失败返回 JSON 错误信息。
     *
     * @param files 待合并的 PDF 文件数组（至少 2 个）
     * @return 合并后的 PDF 字节流；参数错误返回 400，处理失败返回 500
     */
    @PostMapping("/merge")
    public ResponseEntity<?> mergePdfs(@RequestParam("files") MultipartFile[] files) {
        logger.info("[PdfController] 合并 PDF 请求，文件数={}", files == null ? 0 : files.length);
        try {
            if (files != null) {
                for (MultipartFile f : files) validateFileSize(f);
            }
            byte[] merged = pdfService.mergePdfs(files);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.add(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"merged.pdf\"");
            return new ResponseEntity<>(merged, headers, HttpStatus.OK);
        } catch (IllegalArgumentException e) {
            logger.warn("[PdfController] 合并参数错误: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PdfController] 合并 PDF 失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "处理失败: " + e.getMessage()));
        }
    }

    /**
     * 拆分 PDF 文件
     * <p>
     * POST /api/pdf/split
     * <p>
     * 支持两种拆分方式：
     * <ul>
     *   <li>{@code mode="each"}：逐页拆分为独立 PDF</li>
     *   <li>{@code ranges="1-3,5,7-9"}：按页码范围拆分</li>
     * </ul>
     * 拆分结果打包为 ZIP 返回。成功返回 application/octet-stream 二进制流，
     * 失败返回 JSON 错误信息。
     *
     * @param file   待拆分的 PDF 文件
     * @param ranges 可选的页码范围字符串，例如 "1-3,5,7-9"
     * @param mode   可选的拆分模式，目前支持 "each"
     * @return 包含拆分 PDF 的 ZIP 字节流；参数错误返回 400，处理失败返回 500
     */
    @PostMapping("/split")
    public ResponseEntity<?> splitPdf(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "ranges", required = false) String ranges,
            @RequestParam(value = "mode", required = false) String mode) {
        logger.info("[PdfController] 拆分 PDF 请求，mode={}, ranges={}", mode, ranges);
        try {
            validateFileSize(file);
            byte[] zip = pdfService.splitPdf(file, ranges, mode);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType("application/zip"));
            headers.add(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"split.zip\"");
            return new ResponseEntity<>(zip, headers, HttpStatus.OK);
        } catch (IllegalArgumentException e) {
            logger.warn("[PdfController] 拆分参数错误: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PdfController] 拆分 PDF 失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "处理失败: " + e.getMessage()));
        }
    }

    /**
     * 提取 PDF 文本内容
     * <p>
     * POST /api/pdf/extract-text
     * <p>
     * 从上传的 PDF 中提取纯文本，返回包含文本、页数和是否截断的 JSON 对象。
     * 超过 50000 字符的内容会被截断，并标记 truncated=true。
     *
     * @param file 待提取文本的 PDF 文件
     * @return 包含 text、pages、truncated 字段的 JSON；参数错误返回 400，处理失败返回 500
     */
    @PostMapping("/extract-text")
    public ResponseEntity<Map<String, Object>> extractText(@RequestParam("file") MultipartFile file) {
        logger.info("[PdfController] 提取文本请求: {}", file.getOriginalFilename());
        try {
            validateFileSize(file);
            Map<String, Object> result = pdfService.extractText(file);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            logger.warn("[PdfController] 提取文本参数错误: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.<String, Object>of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PdfController] 提取文本失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.<String, Object>of("error", "处理失败: " + e.getMessage()));
        }
    }
}
