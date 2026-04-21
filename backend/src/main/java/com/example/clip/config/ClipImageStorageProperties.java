package com.example.clip.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "clip.organized-storage")
@Data
public class ClipImageStorageProperties {
    private String path;
}
