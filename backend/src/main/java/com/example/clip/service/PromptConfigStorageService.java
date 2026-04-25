package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Prompt配置持久化服务
 */
@Service
public class PromptConfigStorageService {

    private static final Logger log = LoggerFactory.getLogger(PromptConfigStorageService.class);
    private static final String CONFIG_FILE_NAME = "prompt-config.json";

    private final ObjectMapper objectMapper;

    public PromptConfigStorageService() {
        this.objectMapper = new ObjectMapper();
    }

    private Path getConfigFilePath() {
        String userHome = System.getProperty("user.home");
        Path configDir = Paths.get(userHome, ".clip-demo");
        if (!Files.exists(configDir)) {
            try {
                Files.createDirectories(configDir);
            } catch (IOException e) {
                log.error("Failed to create config directory: {}", e.getMessage());
                return Paths.get(CONFIG_FILE_NAME);
            }
        }
        return configDir.resolve(CONFIG_FILE_NAME);
    }

    public PromptConfig loadConfig() {
        Path configFilePath = getConfigFilePath();
        if (!Files.exists(configFilePath)) {
            return null;
        }
        try {
            return objectMapper.readValue(configFilePath.toFile(), PromptConfig.class);
        } catch (IOException e) {
            log.error("Failed to load prompt config: {}", e.getMessage());
            return null;
        }
    }

    public void saveConfig(PromptConfig config) {
        Path configFilePath = getConfigFilePath();
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
        } catch (IOException e) {
            log.error("Failed to save prompt config: {}", e.getMessage());
            throw new RuntimeException("Failed to save prompt config", e);
        }
    }
}
