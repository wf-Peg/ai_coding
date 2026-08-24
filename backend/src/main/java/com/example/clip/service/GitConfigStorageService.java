package com.example.clip.service;

import com.example.clip.config.GitConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Git 配置持久化服务
 * <p>
 * 负责 Git 配置（远程仓库地址、用户名、分支等）的 JSON 文件持久化读写。
 * 配置文件存储于用户主目录下的 .cut-shelter/config/git-config.json 文件中。
 * 提供备份和恢复机制：保存时会自动备份旧配置，加载失败时会尝试从备份恢复。
 * </p>
 */
@Service
public class GitConfigStorageService {

    private static final Logger log = LoggerFactory.getLogger(GitConfigStorageService.class);
    /** Git 配置文件名 */
    private static final String CONFIG_FILE_NAME = "git-config.json";
    /** 备份文件扩展名 */
    private static final String BACKUP_EXTENSION = ".bak";

    /** JSON 序列化/反序列化工具 */
    private final ObjectMapper objectMapper;

    public GitConfigStorageService() {
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 获取配置文件路径
     * <p>
     * 配置文件存储在用户主目录下的 .cut-shelter/config 目录中。
     * 如果目录不存在则自动创建，如果创建失败则回退到当前工作目录。
     * </p>
     *
     * @return 配置文件的完整路径
     */
    private Path getConfigFilePath() {
        // 使用用户目录下的 .cut-shelter/config 目录存放配置
        String userHome = System.getProperty("user.home");
        Path configDir = Paths.get(userHome, ".cut-shelter", "config");

        // 确保目录存在
        if (!Files.exists(configDir)) {
            try {
                Files.createDirectories(configDir);
            } catch (IOException e) {
                log.error("Failed to create config directory: {}", e.getMessage());
                // 目录创建失败时回退到当前目录
                return Paths.get(CONFIG_FILE_NAME);
            }
        }

        return configDir.resolve(CONFIG_FILE_NAME);
    }

    /**
     * 保存 Git 配置
     * <p>
     * 在写入新配置前，会先备份现有配置文件（如果存在），
     * 然后使用 ObjectMapper 将配置对象序列化为 JSON 写入文件。
     * </p>
     *
     * @param config 要保存的 Git 配置对象
     * @throws RuntimeException 如果文件写入失败
     */
    public void saveConfig(GitConfig config) {
        Path configFilePath = getConfigFilePath();

        try {
            // 先备份现有配置，防止写入失败导致配置丢失
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
     * 加载 Git 配置
     * <p>
     * 从配置文件读取 Git 配置对象。如果配置文件不存在，
     * 返回 null 表示尚未配置。如果读取失败，尝试从备份文件恢复。
     * </p>
     *
     * @return Git 配置对象；若配置文件不存在则返回 null
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
            // 读取失败时尝试从备份文件恢复
            return restoreBackup(configFilePath);
        }
    }

    /**
     * 备份配置文件
     * <p>
     * 将当前配置文件复制为 .bak 后缀的备份文件。
     * 如果配置文件不存在则不执行任何操作。
     * </p>
     *
     * @param configFilePath 配置文件路径
     */
    private void backupConfig(Path configFilePath) {
        if (!Files.exists(configFilePath)) {
            return;
        }

        try {
            // 备份文件名为原文件名 + .bak
            Path backupPath = Paths.get(configFilePath.toString() + BACKUP_EXTENSION);
            Files.copy(configFilePath, backupPath);
            log.info("Git config backed up to: {}", backupPath);
        } catch (IOException e) {
            // 备份失败不应该影响主流程，仅记录警告
            log.warn("Failed to backup git config: {}", e.getMessage());
        }
    }

    /**
     * 从备份文件恢复配置
     * <p>
     * 当主配置文件读取失败时，尝试从 .bak 备份文件加载配置。
     * 如果备份文件也不存在或读取失败，返回 null。
     * </p>
     *
     * @param configFilePath 原始配置文件路径（用于推导备份文件路径）
     * @return 恢复的配置对象；若备份文件不存在或读取失败则返回 null
     */
    private GitConfig restoreBackup(Path configFilePath) {
        Path backupPath = Paths.get(configFilePath.toString() + BACKUP_EXTENSION);

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
