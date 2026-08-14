package com.example.clip.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 通用媒体存储配置（MediaStorageProperties）。
 * <p>
 * 通过 Spring Boot 的 {@link ConfigurationProperties} 机制，从配置文件读取
 * {@code clip.media} 前缀的配置项，指定剪藏图片/附件的统一存储根目录
 * （跨模块复用：剪藏、知识、Wiki 等模块的图片统一走 media 层）。
 * </p>
 *
 * <h3>配置示例（application.yml）</h3>
 * <pre>
 * clip:
 *   media:
 *     path: D:/Data/Clip_Bed/clip-storage/media   # 可选；留空时默认 {clip.storage.path}/media
 *     max-size-mb: 10                              # 上传大小上限（MB），默认 10
 * </pre>
 *
 * <p>
 * {@code path} 留空时，{@link com.example.clip.utils.ImageUtils} 会回退到
 * {@code {clip.storage.path}/media}，保证与剪藏本体同根，便于生命周期管理。
 * </p>
 */
@Component
@ConfigurationProperties(prefix = "clip.media")
@Data
public class MediaStorageProperties {

    /** 媒体存储根目录路径；为空时默认 {clip.storage.path}/media */
    private String path = "";

    /** 单文件上传大小上限（MB），默认 10 */
    private long maxSizeMb = 10;

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public long getMaxSizeMb() {
        return maxSizeMb;
    }

    public void setMaxSizeMb(long maxSizeMb) {
        this.maxSizeMb = maxSizeMb;
    }

    /** 上传大小上限（字节） */
    public long getMaxSizeBytes() {
        return maxSizeMb * 1024 * 1024;
    }
}
