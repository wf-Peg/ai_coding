package com.example.clip.utils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * 图片工具类
 * 处理图片的存储、验证等操作
 */
public class ImageUtils {

    private static final Logger logger = LoggerFactory.getLogger(ImageUtils.class);
    private static String baseStoragePath = "./clip-storage";

    /**
     * 设置基础存储路径
     * @param path 基础存储路径
     */
    public static void setBaseStoragePath(String path) {
        baseStoragePath = path;
    }

    /**
     * 验证图片文件类型
     * @param fileName 文件名
     * @return 是否为有效的图片文件
     */
    public static boolean isValidImageFile(String fileName) {
        if (fileName == null) {
            return false;
        }
        String[] validExtensions = {"jpg", "jpeg", "png", "gif", "webp", "bmp"};
        String extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.') + 1);
        for (String validExt : validExtensions) {
            if (validExt.equals(extension)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 验证图片大小
     * @param imageBytes 图片字节数组
     * @param maxSize 最大大小（字节）
     * @return 是否在大小限制内
     */
    public static boolean isWithinSizeLimit(byte[] imageBytes, int maxSize) {
        return imageBytes.length <= maxSize;
    }

    /**
     * 存储图片
     * @param imageBytes 图片字节数组
     * @param fileName 文件名
     * @param category 分类
     * @param noteFileName 笔记文件名
     * @return 图片相对路径
     */
    public static String storeImage(byte[] imageBytes, String fileName, String category, String noteFileName) {
        try {
            // 创建图片存储目录
            String dateStr = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            Path imageDir = Paths.get(baseStoragePath, "images", category, dateStr);
            Files.createDirectories(imageDir);

            // 生成图片文件名
            String timestamp = String.valueOf(System.currentTimeMillis());
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String imageFileName = noteFileName + "_" + timestamp + extension;

            // 存储图片
            Path imagePath = imageDir.resolve(imageFileName);
            try (FileOutputStream fos = new FileOutputStream(imagePath.toFile())) {
                fos.write(imageBytes);
            }

            // 返回相对路径
            return "./images/" + category + "/" + dateStr + "/" + imageFileName;
        } catch (IOException e) {
            logger.error("Failed to store image: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to store image", e);
        }
    }

    /**
     * 获取图片存储路径
     * @param relativePath 相对路径
     * @return 绝对路径
     */
    public static String getImagePath(String relativePath) {
        return Paths.get(baseStoragePath, relativePath.replace("./", "")).toString();
    }

    /**
     * 删除图片
     * @param relativePath 相对路径
     * @return 是否删除成功
     */
    public static boolean deleteImage(String relativePath) {
        try {
            Path imagePath = Paths.get(baseStoragePath, relativePath.replace("./", ""));
            return Files.deleteIfExists(imagePath);
        } catch (IOException e) {
            logger.error("Failed to delete image: {}", e.getMessage(), e);
            return false;
        }
    }
}
