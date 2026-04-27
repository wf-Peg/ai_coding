package com.example.clip.utils;

import com.example.clip.config.ClipImageStorageProperties;
import com.example.clip.core.AiService;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 图片处理工具类
 * 负责图片的存储和路径生成
 */
@Component
public class ImageUtils {

    private final ClipImageStorageProperties props;

    public ImageUtils(ClipImageStorageProperties props) {
        this.props = props;
    }


    /**
     * 验证图片文件类型
     *
     * @param fileName 文件名
     * @return 是否为有效的图片文件
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
     * 存储图片文件
     *
     * @param imageData        Base64编码的图片数据
     * @param originalFileName 原始文件名
     * @param category         分类
     * @param noteFileName     笔记文件名
     * @return 图片的相对路径
     * @throws IOException IO异常
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
     * 生成唯一的文件名
     * 格式：file-YYYYMMDDHHmmssSSS.ext
     *
     * @param originalFileName 原始文件名
     * @return 生成的文件名
     */
    private static String generateFileName(String originalFileName) {
        // 提取文件扩展名
        String extension = "png";
        if (originalFileName != null && originalFileName.contains(".")) {
            extension = originalFileName.substring(originalFileName.lastIndexOf(".") + 1).toLowerCase();
        }

        // 生成时间戳
        String timestamp = new SimpleDateFormat("yyyyMMddHHmmssSSS").format(new Date());

        return "file-" + timestamp + "." + extension;
    }

    /**
     * 生成存储路径
     * 格式：./clip-organized/{category}/assets
     *
     * @param category     分类
     * @param noteFileName 笔记文件名
     * @return 存储路径
     */
    private Path generateStoragePath(String category, String noteFileName) {
        // 获取分类目录
        String categoryDir = getCategoryDir(category);

        // 构建完整路径：配置路径/clip-organized/{category}/assets
        return Paths.get(props.getPath(), categoryDir, "assets");
    }

    /**
     * 生成相对路径
     * 格式：/api/clip/image/{category}/{fileName}
     * 格式：assets/file-YYYYMMDDHHmmssSSS.ext
     *
     * @param category     分类
     * @param noteFileName 笔记文件名
     * @param fileName     文件名
     * @return 相对路径
     */
    private static String generateRelativePath(String category, String noteFileName, String fileName) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";
        return "/api/clip/image/" + cat + "/" + fileName;
    }

    /**
     * 将category value映射为目录路径
     * 例如: "work-company" → "work/公司事务"
     * "work" → "work"
     * null/空 → "default"
     *
     * @param category 分类值
     * @return 目录路径
     */
    public static String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                return topValue;
            }

            List<Map<String, Object>> children = (List<Map<String, Object>>) topCat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(cat)) {
                        return topValue + "/" + child.get("label").toString();
                    }
                }
            }
        }

        return cat;
    }

    /**
     * 验证图片大小
     *
     * @param imageData 图片数据
     * @param maxSize   最大大小（字节）
     * @return 是否在大小限制内
     */
    public static boolean isWithinSizeLimit(byte[] imageData, long maxSize) {
        return imageData.length <= maxSize;
    }
}
