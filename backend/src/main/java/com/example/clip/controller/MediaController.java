package com.example.clip.controller;

import com.example.clip.config.MediaStorageProperties;
import com.example.clip.service.ClipService;
import com.example.clip.utils.ImageUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 通用媒体 REST 控制器（MediaController）。
 * <p>
 * 提供跨模块复用的图片/附件能力（决策 D-H 通用 media 层）：
 * <ul>
 *   <li>图片上传（multipart；magic-byte 校验；大小上限）</li>
 *   <li>图片读取（相对路径；`?thumb=1` 256px 缩略图；路径穿越防护）</li>
 *   <li>孤儿媒体清理（按全库引用清单）</li>
 *   <li>doc-ai 附件下载（documents/ 独立目录）</li>
 * </ul>
 * 剪藏模块为首个消费者；Knowledge/Wiki 等模块后续直接复用本端点。
 * </p>
 *
 * @see ImageUtils
 * @see ClipService
 */
@RestController
@RequestMapping("/api/media")
@CrossOrigin(origins = "*")
public class MediaController {

    private static final Logger log = LoggerFactory.getLogger(MediaController.class);

    private final ImageUtils imageUtils;
    private final ClipService clipService;
    private final MediaStorageProperties mediaProps;

    public MediaController(ImageUtils imageUtils, ClipService clipService, MediaStorageProperties mediaProps) {
        this.imageUtils = imageUtils;
        this.clipService = clipService;
        this.mediaProps = mediaProps;
    }

    /**
     * 图片上传。
     * <p>
     * POST /api/media/upload（multipart，字段名 file）。
     * 校验大小上限与 magic-byte（jpg/png/gif/webp），UUID 命名存 media 根目录，
     * 返回相对路径、可访问 URL 与大小。
     * </p>
     *
     * @param file 上传的图片文件
     * @return {path, url, size}；非法文件返回 400
     */
    @PostMapping("/upload")
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("status", "error", "message", "文件为空"));
        }
        if (file.getSize() > mediaProps.getMaxSizeBytes()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", "图片超过大小上限 " + mediaProps.getMaxSizeMb() + "MB"));
        }
        try {
            byte[] data = file.getBytes();
            String relativePath = imageUtils.storeImage(data, file.getOriginalFilename());
            if (relativePath == null) {
                return ResponseEntity.badRequest().body(Map.of(
                        "status", "error",
                        "message", "不支持的图片格式（仅支持 jpg/png/gif/webp）"));
            }
            // media/2608/{uuid}.png → /api/media/2608/{uuid}.png
            String url = "/api/media/" + relativePath.substring("media/".length());
            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "path", relativePath,
                    "url", url,
                    "size", data.length));
        } catch (IOException e) {
            log.error("[Media] upload failed", e);
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", "上传失败: " + e.getMessage()));
        }
    }

    /**
     * 图片读取（含缩略图）。
     * <p>
     * GET /api/media/{yyMM}/{fileName}?thumb=1
     * 相对路径白名单校验 + normalize + 限定 media 根目录；非法/不存在返回 404。
     * </p>
     *
     * @param yyMM     月份分片（4 位数字）
     * @param fileName 文件名（UUID.ext）
     * @param thumb    是否返回 256px 缩略图
     * @return 图片字节流
     */
    @GetMapping("/{yyMM:[0-9]{4}}/{fileName}")
    public ResponseEntity<byte[]> serve(@PathVariable String yyMM,
                                        @PathVariable String fileName,
                                        @RequestParam(required = false, defaultValue = "false") boolean thumb) {
        String relativePath = "media/" + yyMM + "/" + fileName;
        byte[] data = imageUtils.readMedia(relativePath, thumb);
        if (data == null) {
            return ResponseEntity.notFound().build();
        }
        String ext = fileName.contains(".") ? fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : "";
        MediaType mediaType = guessMediaType(ext);
        return ResponseEntity.ok()
                .contentType(mediaType)
                .cacheControl(CacheControl.maxAge(30, TimeUnit.DAYS).cachePublic())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .body(data);
    }

    /**
     * 孤儿媒体清理。
     * <p>
     * POST /api/media/cleanup-orphans
     * 扫描 media/ 目录，删除未被任何剪藏 imagePaths 引用的文件，返回清理数量。
     * </p>
     *
     * @return {success, cleanedCount}
     */
    @PostMapping("/cleanup-orphans")
    public ResponseEntity<Map<String, Object>> cleanupOrphans() {
        int count = clipService.cleanupOrphanMedia();
        return ResponseEntity.ok(Map.of("success", true, "cleanedCount", count));
    }

    /**
     * doc-ai 附件下载。
     * <p>
     * GET /api/media/file/{fileName}（fileName = {uuid}.{ext}，走 documents/ 独立目录）
     * 文件名段白名单校验 + 限定 documents 根目录；非法/不存在返回 404。
     * </p>
     *
     * @param fileName 附件文件名（uuid.ext）
     * @return 文件字节流（Content-Disposition attachment）
     */
    @GetMapping("/file/{fileName}")
    public ResponseEntity<byte[]> downloadFile(@PathVariable String fileName) {
        if (fileName == null || !fileName.matches("^[\\w.-]+$")) {
            return ResponseEntity.badRequest().build();
        }
        byte[] data = imageUtils.readMedia("documents/" + fileName, false);
        if (data == null) {
            return ResponseEntity.notFound().build();
        }
        String ext = fileName.contains(".") ? fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase() : "";
        MediaType mediaType = guessMediaType(ext);
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .body(data);
    }

    /** 根据扩展名猜测 MediaType；未知返回 application/octet-stream */
    private MediaType guessMediaType(String ext) {
        return switch (ext) {
            case "jpg", "jpeg" -> MediaType.IMAGE_JPEG;
            case "png" -> MediaType.IMAGE_PNG;
            case "gif" -> MediaType.IMAGE_GIF;
            case "webp" -> MediaType.parseMediaType("image/webp");
            case "pdf" -> MediaType.APPLICATION_PDF;
            case "txt", "md" -> MediaType.TEXT_PLAIN;
            case "csv" -> MediaType.parseMediaType("text/csv");
            default -> MediaType.APPLICATION_OCTET_STREAM;
        };
    }
}
