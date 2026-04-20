package com.example.clip.config;

import com.example.clip.utils.ImageUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import javax.annotation.PostConstruct;

/**
 * 图片工具配置类
 */
@Configuration
public class ImageUtilsConfig {

    @Value("${clip.storage.path:./clip-storage}")
    private String organizedStoragePath;

    /**
     * 初始化图片工具配置
     */
    @PostConstruct
    public void init() {
        // 设置图片存储路径
        ImageUtils.setBaseStoragePath(organizedStoragePath);
    }
}
