package com.example.clip.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 剪藏图片存储配置属性（ClipImageStorageProperties）。
 * <p>
 * 通过 Spring Boot 的 {@link ConfigurationProperties} 机制，从配置文件
 * 中读取 {@code clip.organized-storage} 前缀的配置项，用于指定剪藏图片
 * 的文件系统存储路径。
 * </p>
 *
 * <h3>配置示例（application.yml）</h3>
 * <pre>
 * clip:
 *   organized-storage:
 *     path: /data/clip-images
 * </pre>
 *
 * <p>
 * 使用 Lombok {@code @Data} 注解自动生成 getter/setter/toString/equals/hashCode，
 * 同时保留手动声明的 getter/setter 以兼容某些框架的反射需求。
 * </p>
 */
@Component
@ConfigurationProperties(prefix = "clip.organized-storage")
@Data
public class ClipImageStorageProperties {

    /** 图片存储的根目录路径，从配置文件中注入 */
    private String path;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }
}
