package com.example.clip.utils;

import com.example.clip.config.ClipImageStorageProperties;
import com.example.clip.core.AiService;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * 图片处理工具类（ImageUtils）。
 * <p>
 * 负责剪藏图片的存储、路径生成、格式验证和大小校验。
 * 作为 Spring 管理的 {@link Component}，通过构造注入获取存储配置。
 * </p>
 *
 * <h3>图片存储路径规则</h3>
 * <pre>
 *   物理路径：{storage.path}/{categoryDir}/assets/file-YYYYMMddHHmmssSSS.ext
 *   相对路径：/api/clip/image/{category}/{fileName}
 * </pre>
 *
 * <h3>分类目录映射</h3>
 * <p>
 * 顶级分类（如 "work"）直接作为目录名，子分类（如 "work-company"）
 * 映射为 "work/公司事务" 格式，而未匹配的分类默认放入 "default" 目录。
 * 分类映射依赖 {@link AiService#CATEGORY_TREE} 静态常量。
 * </p>
 *
 * <h3>支持的图片格式</h3>
 * <p>jpg, jpeg, png, gif, webp</p>
 */
@Component
public class ImageUtils {

    private final ClipImageStorageProperties props;

    public ImageUtils(ClipImageStorageProperties props) {
        this.props = props;
    }


    /**
     * 验证图片文件是否为支持的格式。
     * <p>
     * 通过检查文件扩展名判断，支持 jpg、jpeg、png、gif、webp 五种格式。
     * 文件名比较时会转换为小写以忽略大小写差异。
     * </p>
     *
     * @param fileName 文件名（含扩展名）
     * @return true 表示是有效的图片格式，false 表示不支持或文件名为 null
     */
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
     * 将 Base64 解码后的图片数据存储到文件系统。
     * <p>
     * 执行步骤：
     * <ol>
     *   <li>根据原始文件名生成唯一文件名（含时间戳）</li>
     *   <li>根据分类和笔记名生成目录路径</li>
     *   <li>创建目录结构（如不存在）</li>
     *   <li>写入图片文件</li>
     *   <li>返回可访问的相对路径</li>
     * </ol>
     * </p>
     *
     * @param imageData        Base64 解码后的图片字节数组
     * @param originalFileName 原始文件名（含扩展名）
     * @param category         分类标识
     * @param noteFileName     笔记文件名（当前未在路径生成中使用，保留用于未来扩展）
     * @return 图片的相对路径，格式为 /api/clip/image/{category}/{fileName}
     * @throws IOException 文件写入失败时抛出
     */
    public String storeImage(byte[] imageData, String originalFileName, String category, String noteFileName) throws IOException {
        // 生成唯一的文件名
        String fileName = generateFileName(originalFileName);

        // 生成存储路径
        Path storagePath = generateStoragePath(category, noteFileName);

        // 创建目录结构
        if (!Files.exists(storagePath)) {
            Files.createDirectories(storagePath);
        }

        // 保存图片文件
        Path imagePath = storagePath.resolve(fileName);
        Files.write(imagePath, imageData);

        // 生成相对路径
        return generateRelativePath(category, noteFileName, fileName);
    }

    /**
     * 生成唯一的文件名。
     * <p>
     * 格式：{@code file-YYYYMMddHHmmssSSS.ext}，
     * 其中时间戳精确到毫秒以确保唯一性，扩展名从原始文件名中提取。
     * 如果原始文件名不含扩展名，默认使用 "png"。
     * </p>
     *
     * @param originalFileName 原始文件名（含扩展名）
     * @return 唯一文件名
     */
    private static String generateFileName(String originalFileName) {
        // 提取文件扩展名（仅取最后一段，且去除可能的路径分隔符，防止路径穿越）
        String extension = "png";
        if (originalFileName != null && originalFileName.contains(".")) {
            String rawExt = originalFileName.substring(originalFileName.lastIndexOf(".") + 1).toLowerCase();
            // 过滤扩展名中的路径分隔符与非法字符
            rawExt = rawExt.replaceAll("[\\\\/\\s]", "");
            if (!rawExt.isEmpty()) {
                extension = rawExt;
            }
        }

        // 使用线程安全的 DateTimeFormatter 生成时间戳
        String timestamp = DateTimeFormatter.ofPattern("yyyyMMddHHmmssSSS").format(LocalDateTime.now());

        return "file-" + timestamp + "." + extension;
    }

    /**
     * 生成图片的物理存储路径。
     * <p>
     * 格式：{@code {storage.path}/{categoryDir}/assets}
     * 其中 {@code categoryDir} 由 {@link #getCategoryDir(String)} 计算，
     * 会根据分类层级生成多级目录。
     * </p>
     *
     * @param category     分类标识
     * @param noteFileName 笔记文件名（当前未在路径中使用，保留用于未来扩展）
     * @return 物理存储路径
     */
    private Path generateStoragePath(String category, String noteFileName) {
        // 获取分类目录
        String categoryDir = getCategoryDir(category);

        // 构建完整路径：配置路径/clip-organized/{category}/assets
        return Paths.get(props.getPath(), categoryDir, "assets");
    }

    /**
     * 生成图片的可访问相对路径（URL 路径）。
     * <p>
     * 格式：{@code /api/clip/image/{category}/{fileName}}
     * 前端通过该路径可访问图片资源。
     * </p>
     * <p>
     * 注意：{@code noteFileName} 参数当前未在路径中使用，保留用于未来扩展。
     * </p>
     *
     * @param category     分类标识
     * @param noteFileName 笔记文件名（当前未使用）
     * @param fileName     图片文件名
     * @return 相对 URL 路径
     */
    private static String generateRelativePath(String category, String noteFileName, String fileName) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";
        return "/api/clip/image/" + sanitizeCategorySegment(cat) + "/" + fileName;
    }

    /**
     * 过滤分类路径段中的穿越与非法字符，防止 URL/文件系统路径逃逸。
     *
     * @param segment 原始分类路径段
     * @return 安全路径段
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
     * 将 category 值映射为目录路径。
     * <p>
     * 映射规则：
     * </p>
     * <ul>
     *   <li>顶级分类（如 "work"）：直接返回分类值本身</li>
     *   <li>子分类（如 "work-company"）：返回 "work/公司事务" 格式，
     *       其中 "work" 是父分类值，"公司事务" 是子分类的 label</li>
     *   <li>未匹配的分类：原样返回</li>
     *   <li>null 或空字符串：返回 "default"</li>
     * </ul>
     * <p>
     * 分类映射依赖 {@link AiService#CATEGORY_TREE} 静态常量，
     * 该常量定义了完整的分类层级树。
     * </p>
     *
     * @param category 分类值，如 "work"、"work-company" 等
     * @return 文件系统目录路径，如 "work"、"work/公司事务"、"default"
     */
    public static String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                return topValue;
            }

            // 注意：此处存在未经检查的类型转换，假设 CATEGORY_TREE 的结构正确
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
     * 验证图片数据大小是否在允许范围内。
     * <p>
     * 比较图片字节数组长度与最大允许大小，用于上传前的大小校验。
     * </p>
     *
     * @param imageData 图片字节数组
     * @param maxSize   最大允许大小（字节）
     * @return true 表示在大小限制内，false 表示超出限制
     */
    public static boolean isWithinSizeLimit(byte[] imageData, long maxSize) {
        return imageData.length <= maxSize;
    }
}
