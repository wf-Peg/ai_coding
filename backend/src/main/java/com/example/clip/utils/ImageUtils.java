package com.example.clip.utils;

import com.example.clip.config.MediaStorageProperties;
import com.example.clip.core.AiService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 媒体处理工具类（ImageUtils）。
 * <p>
 * 负责剪藏/跨模块图片的存储、读取、格式验证（magic-byte）、缩略图生成。
 * 作为 Spring 管理的 {@link Component}，通过构造注入获取媒体存储配置。
 * </p>
 *
 * <h3>存储布局（与剪藏本体同根，跨模块统一 media 层）</h3>
 * <pre>
 *   {clip.storage.path}/
 *   ├── media/                         ← 图片（uuid 命名，按月分片，与分类/整理解耦）
 *   │   ├── 2608/{uuid}.png
 *   │   └── 2609/{uuid}.jpg
 *   ├── documents/                     ← doc-ai 源文件（独立目录）
 *   │   └── {uuid}.pdf
 *   └── {category}/...                 ← 剪藏 JSON（不变）
 * </pre>
 *
 * <h3>引用约定</h3>
 * <ul>
 *   <li>content 中存相对路径 {@code media/{yyMM}/{uuid}.{ext}}，渲染时按 API origin 重写</li>
 *   <li>{@code documents/{uuid}.{ext}} 为 doc-ai 附件相对路径（attachmentPath）</li>
 * </ul>
 */
@Component
public class ImageUtils {

    private static final Logger log = LoggerFactory.getLogger(ImageUtils.class);

    /** 媒体存储根目录路径（可从 clip.media.path 或 clip.storage.path 推导） */
    private final Path mediaRoot;
    /** 文档（doc-ai 源文件）存储根目录路径 */
    private final Path documentsRoot;
    /** 上传大小上限（字节） */
    private final long maxSizeBytes;

    /** 相对路径白名单：media/{yyMM}/{uuid}.{ext} 或 documents/{uuid}.{ext} */
    private static final Pattern MEDIA_RELATIVE_PATH =
            Pattern.compile("^(?:media/(?:\\d{4})/|documents/)[\\w.-]+\\.[A-Za-z0-9]{1,10}$");
    /** 文件名段白名单（防路径穿越） */
    private static final Pattern SAFE_FILE_NAME = Pattern.compile("^[\\w.-]+$");

    private static final DateTimeFormatter MONTH_FORMATTER = DateTimeFormatter.ofPattern("yyMM");

    public ImageUtils(MediaStorageProperties mediaProps,
                      @Value("${clip.storage.path:./clip-storage}") String clipStoragePath) {
        this.maxSizeBytes = mediaProps.getMaxSizeBytes();
        Path clipStorage = Paths.get(clipStoragePath);
        String configured = mediaProps.getPath();
        if (configured != null && !configured.isBlank()) {
            this.mediaRoot = Paths.get(configured);
        } else {
            this.mediaRoot = clipStorage.resolve("media");
        }
        this.documentsRoot = clipStorage.resolve("documents");
    }

    // ==================== 存储 ====================

    /**
     * 存储图片字节数组（magic-byte 校验 + UUID 命名 + 按月分片）。
     * <p>
     * 文件写入使用临时名 + rename，避免半写文件。成功返回相对路径
     * {@code media/{yyMM}/{uuid}.{ext}}。
     * </p>
     *
     * @param imageData        图片字节数组
     * @param originalFileName 原始文件名（仅用于日志/扩展名兜底）
     * @return 相对路径（media/{yyMM}/{uuid}.{ext}）；非法图片返回 null
     * @throws IOException 文件写入失败时抛出
     */
    public String storeImage(byte[] imageData, String originalFileName) throws IOException {
        String ext = detectImageType(imageData);
        if (ext == null) {
            log.warn("[ImageUtils] Reject image by magic-byte, original={}", originalFileName);
            return null;
        }
        return storeBytes(imageData, ext, mediaRoot);
    }

    /**
     * 存储文档（doc-ai 源文件）字节数组，与图片分离。
     *
     * @param fileData         文件字节数组
     * @param originalFileName 原始文件名（用于提取扩展名）
     * @return 相对路径（documents/{uuid}.{ext}）
     * @throws IOException 文件写入失败时抛出
     */
    public String storeDocument(byte[] fileData, String originalFileName) throws IOException {
        String ext = "bin";
        if (originalFileName != null && originalFileName.contains(".")) {
            String rawExt = originalFileName.substring(originalFileName.lastIndexOf('.') + 1)
                    .toLowerCase().replaceAll("[\\\\/\\s]", "");
            if (!rawExt.isEmpty() && rawExt.length() <= 10) {
                ext = rawExt;
            }
        }
        return storeBytes(fileData, ext, documentsRoot);
    }

    /**
     * 将字节数组写入指定根目录（uuid 命名 + 按月分片 + 临时名 rename）。
     *
     * @param data 文件字节数组
     * @param ext  扩展名（不含点）
     * @param root 目标根目录（mediaRoot / documentsRoot）
     * @return 相对路径，如 media/2608/{uuid}.png 或 documents/{uuid}.pdf
     * @throws IOException 文件写入失败时抛出
     */
    private String storeBytes(byte[] data, String ext, Path root) throws IOException {
        Path dir = root;
        if (root.equals(mediaRoot)) {
            dir = root.resolve(LocalDateTime.now().format(MONTH_FORMATTER));
        }
        Files.createDirectories(dir);

        String fileName = UUID.randomUUID().toString().replace("-", "") + "." + ext;
        Path target = dir.resolve(fileName);
        Path tmp = dir.resolve(fileName + ".tmp");
        Files.write(tmp, data);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);

        String month = LocalDateTime.now().format(MONTH_FORMATTER);
        String prefix = root.equals(mediaRoot) ? "media/" + month + "/" : "documents/";
        return prefix + fileName;
    }

    // ==================== 读取 ====================

    /**
     * 将相对路径解析为绝对路径（路径穿越防护）。
     * <p>
     * 校验规则：白名单正则 + normalize + 限定在 media/documents 根目录内。
     * 非法路径返回 null。
     * </p>
     *
     * @param relativePath 相对路径，如 media/2608/{uuid}.png
     * @return 解析后的绝对路径；非法/不存在返回 null
     */
    public Path resolveMediaFile(String relativePath) {
        if (relativePath == null || !MEDIA_RELATIVE_PATH.matcher(relativePath).matches()) {
            return null;
        }
        String rootName = relativePath.startsWith("media/") ? "media/" : "documents/";
        Path root = relativePath.startsWith("media/") ? mediaRoot : documentsRoot;
        Path resolved = root.resolve(relativePath.substring(rootName.length())).normalize();
        if (!resolved.startsWith(root.normalize())) {
            return null;
        }
        String fileName = resolved.getFileName() == null ? "" : resolved.getFileName().toString();
        if (!SAFE_FILE_NAME.matcher(fileName).matches()) {
            return null;
        }
        return Files.exists(resolved) ? resolved : null;
    }

    /**
     * 读取媒体文件字节数组（可生成缩略图）。
     *
     * @param relativePath 相对路径
     * @param thumb        是否返回 256px 缩略图（仅图片；失败时回退原图）
     * @return 文件字节数组；文件不存在/非法返回 null
     */
    public byte[] readMedia(String relativePath, boolean thumb) {
        try {
            Path file = resolveMediaFile(relativePath);
            if (file == null) {
                return null;
            }
            byte[] data = Files.readAllBytes(file);
            if (thumb) {
                byte[] thumbnail = generateThumbnail(data);
                if (thumbnail != null) {
                    return thumbnail;
                }
            }
            return data;
        } catch (IOException e) {
            log.warn("[ImageUtils] readMedia failed: {}", relativePath, e);
            return null;
        }
    }

    // ==================== 校验 ====================

    /**
     * 通过 magic-byte 检测图片类型，返回扩展名（jpg/png/gif/webp）；非图片返回 null。
     */
    public static String detectImageType(byte[] data) {
        if (data == null || data.length < 12) {
            return null;
        }
        // JPEG: FF D8 FF
        if ((data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
            return "jpg";
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if ((data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') {
            return "png";
        }
        // GIF: 47 49 46 38 ('GIF8')
        if (data[0] == 'G' && data[1] == 'I' && data[2] == 'F' && data[3] == '8') {
            return "gif";
        }
        // WEBP: RIFF....WEBP
        if (data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "webp";
        }
        return null;
    }

    /**
     * 校验图片字节是否合法（magic-byte）。
     *
     * @param data 图片字节数组
     * @return true 表示合法图片
     */
    public static boolean isValidImageData(byte[] data) {
        return detectImageType(data) != null;
    }

    /**
     * 兼容旧调用：按扩展名判断（不推荐，仅用于旧 base64 兼容解析的兜底提示）。
     */
    @Deprecated
    public static boolean isValidImageFile(String fileName) {
        if (fileName == null) {
            return false;
        }
        String extension = fileName.toLowerCase();
        return extension.endsWith(".jpg") || extension.endsWith(".jpeg") ||
                extension.endsWith(".png") || extension.endsWith(".gif") ||
                extension.endsWith(".webp");
    }

    /**
     * 兼容旧调用：大小校验。
     */
    @Deprecated
    public static boolean isWithinSizeLimit(byte[] imageData, long maxSize) {
        return imageData != null && imageData.length <= maxSize;
    }

    // ==================== 缩略图 ====================

    /**
     * 生成 256px 缩略图（ImageIO）。
     * <p>
     * 透明图（png/gif）保留 alpha 输出 PNG，其余输出 JPEG。
     * webp 因 JDK ImageIO 无原生编解码器，返回 null（调用方回退原图）。
     * </p>
     *
     * @param data 原始图片字节
     * @return 缩略图字节；生成失败返回 null
     */
    public byte[] generateThumbnail(byte[] data) {
        try {
            BufferedImage original = ImageIO.read(new ByteArrayInputStream(data));
            if (original == null) {
                return null;
            }
            int width = original.getWidth();
            int height = original.getHeight();
            if (width <= 0 || height <= 0) {
                return null;
            }
            int maxDim = 256;
            if (width <= maxDim && height <= maxDim) {
                return null; // 原图足够小，无需缩略
            }
            double scale = Math.min((double) maxDim / width, (double) maxDim / height);
            int newWidth = Math.max(1, (int) Math.round(width * scale));
            int newHeight = Math.max(1, (int) Math.round(height * scale));

            boolean hasAlpha = original.getColorModel().hasAlpha();
            BufferedImage thumb = new BufferedImage(newWidth, newHeight,
                    hasAlpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
            Graphics2D g = thumb.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.drawImage(original, 0, 0, newWidth, newHeight, null);
            g.dispose();

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(thumb, hasAlpha ? "png" : "jpg", out)) {
                return null;
            }
            return out.toByteArray();
        } catch (Exception e) {
            log.debug("[ImageUtils] thumbnail generation failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 将 category value 映射为目录路径（旧数据迁移定位用）。
     * <p>
     * 映射规则：一级分类（如 "work"）直接返回；二级分类（如 "work-company"）
     * 返回 "work/公司事务"；未匹配的分类原样返回（含穿越防护）。
     * </p>
     *
     * @param category 分类值
     * @return 文件系统目录路径
     */
    public static String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                return topValue;
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> children = (List<Map<String, Object>>) topCat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(cat)) {
                        return topValue + "/" + child.get("label").toString();
                    }
                }
            }
        }

        // 未匹配的分类：原样返回（含穿越防护）
        return sanitizeCategorySegment(cat);
    }

    /**
     * 过滤分类路径段中的穿越与非法字符。
     */
    private static String sanitizeCategorySegment(String segment) {
        if (segment == null || segment.isEmpty()) {
            return "default";
        }
        String safe = segment
                .replace('\\', '-')
                .replace('/', '-')
                .replace("..", "-")
                .replaceAll("[\\p{Cntrl}]", "-")
                .trim();
        return safe.isEmpty() ? "default" : safe;
    }

    /**
     * 获取媒体存储根目录（供清理等操作扫描）。
     */
    public Path getMediaRoot() {
        return mediaRoot;
    }

    /**
     * 获取文档存储根目录。
     */
    public Path getDocumentsRoot() {
        return documentsRoot;
    }
}
