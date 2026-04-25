package com.example.clip.service;

import com.example.clip.config.GitConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Git配置持久化服务
 * 负责Git配置的保存和加载
 */
@Service
public class GitConfigStorageService {

    private static final Logger log = LoggerFactory.getLogger(GitConfigStorageService.class);
    private static final String CONFIG_FILE_NAME = "git-config.json";

    private final ObjectMapper objectMapper;

    public GitConfigStorageService() {
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 获取配置文件路径
     * @return 配置文件路径
     */
    private Path getConfigFilePath() {
        // 使用用户目录下的配置文件
        String userHome = System.getProperty("user.home");
        Path configDir = Paths.get(userHome, ".clip-demo");
        
        // 确保目录存在
        if (!Files.exists(configDir)) {
            try {
                Files.createDirectories(configDir);
            } catch (IOException e) {
                log.error("Failed to create config directory: {}", e.getMessage());
                // 回退到当前目录
                return Paths.get(CONFIG_FILE_NAME);
            }
        }
        
        return configDir.resolve(CONFIG_FILE_NAME);
    }

    /**
     * 保存Git配置
     * @param config Git配置
     */
    public void saveConfig(GitConfig config) {
        Path configFilePath = getConfigFilePath();
        
        try {
            // 备份现有配置
            backupConfig(configFilePath);
            
            // 保存新配置
            objectMapper.writeValue(configFilePath.toFile(), config);
            log.info("Git config saved to: {}", configFilePath);
        } catch (IOException e) {
            log.error("Failed to save git config: {}", e.getMessage());
            throw new RuntimeException("Failed to save git config", e);
        }
    }

    /**
     * 加载Git配置
     * @return Git配置，返回null表示无配置
     */
    public GitConfig loadConfig() {
        Path configFilePath = getConfigFilePath();
        
        if (!Files.exists(configFilePath)) {
            log.info("Git config file not found: {}", configFilePath);
            return null;
        }
        
        try {
            GitConfig config = objectMapper.readValue(configFilePath.toFile(), GitConfig.class);
            log.info("Git config loaded from: {}", configFilePath);
            return config;
        } catch (IOException e) {
            log.error("Failed to load git config: {}", e.getMessage());
            // 尝试恢复备份
            return restoreBackup(configFilePath);
        }
    }

    /**
     * 备份配置文件
     * @param configFilePath 配置文件路径
     */
    private void backupConfig(Path configFilePath) {
        if (!Files.exists(configFilePath)) {
            return;
        }
        
        try {
            Path backupPath = Paths.get(configFilePath.toString() + ".bak");
            Files.copy(configFilePath, backupPath);
            log.info("Git config backed up to: {}", backupPath);
        } catch (IOException e) {
            log.warn("Failed to backup git config: {}", e.getMessage());
        }
    }

    /**
     * 恢复备份配置
     * @param configFilePath 配置文件路径
     * @return 恢复的配置，失败返回null
     */
    private GitConfig restoreBackup(Path configFilePath) {
        Path backupPath = Paths.get(configFilePath.toString() + ".bak");
        
        if (!Files.exists(backupPath)) {
            return null;
        }
        
        try {
            GitConfig config = objectMapper.readValue(backupPath.toFile(), GitConfig.class);
            log.info("Git config restored from backup: {}", backupPath);
            return config;
        } catch (IOException e) {
            log.error("Failed to restore git config backup: {}", e.getMessage());
            return null;
        }
    }
}
