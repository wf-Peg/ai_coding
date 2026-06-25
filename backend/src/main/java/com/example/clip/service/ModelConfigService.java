package com.example.clip.service;

import com.example.clip.core.ModelConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 模型配置服务
 * 负责模型配置的 JSON 文件持久化读写
 */
@Service
public class ModelConfigService {

    private static final Logger log = LoggerFactory.getLogger(ModelConfigService.class);
    private static final String CONFIG_FILE_NAME = "model-config.json";

    private final ObjectMapper objectMapper;
    private volatile ModelConfig cachedConfig;

    public ModelConfigService() {
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 获取配置文件路径（存放在应用数据目录下）
     */
    private Path getConfigFilePath() {
        // 优先使用 clip-storage 目录，与 FileStorageService 保持一致
        String storagePath = System.getProperty("clip.storage.path", "./clip-storage");
        Path configDir = Paths.get(storagePath);
        if (!Files.exists(configDir)) {
            try {
                Files.createDirectories(configDir);
            } catch (IOException e) {
                log.error("Failed to create storage directory: {}", e.getMessage());
                return Paths.get(CONFIG_FILE_NAME);
            }
        }
        return configDir.resolve(CONFIG_FILE_NAME);
    }

    /**
     * 加载模型配置，优先使用缓存
     */
    public ModelConfig getConfig() {
        if (cachedConfig != null) {
            return cachedConfig;
        }
        return loadConfig();
    }

    /**
     * 强制从文件重新加载配置
     */
    public ModelConfig loadConfig() {
        Path configFilePath = getConfigFilePath();
        if (!Files.exists(configFilePath)) {
            cachedConfig = new ModelConfig();
            return cachedConfig;
        }
        try {
            cachedConfig = objectMapper.readValue(configFilePath.toFile(), ModelConfig.class);
            return cachedConfig;
        } catch (IOException e) {
            log.error("Failed to load model config: {}", e.getMessage());
            cachedConfig = new ModelConfig();
            return cachedConfig;
        }
    }

    /**
     * 保存模型配置并刷新缓存
     */
    public ModelConfig saveConfig(ModelConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("模型配置不能为空");
        }
        Path configFilePath = getConfigFilePath();
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
            cachedConfig = config;
            return config;
        } catch (IOException e) {
            log.error("Failed to save model config: {}", e.getMessage());
            throw new RuntimeException("Failed to save model config", e);
        }
    }
}