package com.example.clip.config;

import com.example.clip.utils.ImageUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import jakarta.annotation.PostConstruct;

/**
 * 图片工具配置类
 * 用于设置图片存储路径
 */
@Configuration
public class ImageUtilsConfig {

    /**
     * 整理存储路径
     */
    @Value("${clip.organized-storage.path:./clip-organized}")
    private String organizedStoragePath;

    /**
     * 初始化时设置图片存储路径
     */
    @PostConstruct
    public void init() {
        ImageUtils.setBaseStoragePath(organizedStoragePath);
    }
}
