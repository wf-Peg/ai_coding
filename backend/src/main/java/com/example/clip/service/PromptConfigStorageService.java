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
 * Prompt 配置持久化服务
 * <p>
 * 负责 Prompt 配置（系统提示词）的 JSON 文件持久化读写。
 * 配置文件存储于用户主目录下的 .cut-shelter/config/prompt-config.json 文件中。
 * 如果文件不存在，PromptConfigService 会使用内置的默认 Prompt。
 * </p>
 */
@Service
public class PromptConfigStorageService {

    private static final Logger log = LoggerFactory.getLogger(PromptConfigStorageService.class);
    /** Prompt 配置文件名 */
    private static final String CONFIG_FILE_NAME = "prompt-config.json";

    /** JSON 序列化/反序列化工具 */
    private final ObjectMapper objectMapper;

    public PromptConfigStorageService() {
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
        String userHome = System.getProperty("user.home");
        Path configDir = Paths.get(userHome, ".cut-shelter", "config");
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
     * 加载 Prompt 配置
     * <p>
     * 从配置文件读取 PromptConfig 对象。如果配置文件不存在，
     * 返回 null，由上层 {@link PromptConfigService} 使用默认配置。
     * </p>
     *
     * @return PromptConfig 对象；若文件不存在或读取失败则返回 null
     */
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

    /**
     * 保存 Prompt 配置
     * <p>
     * 将 PromptConfig 对象序列化为 JSON 并写入配置文件。
     * 使用 pretty printer 格式化输出，便于人工阅读和编辑。
     * </p>
     *
     * @param config 要保存的 PromptConfig 对象
     * @throws RuntimeException 如果文件写入失败
     */
    public void saveConfig(PromptConfig config) {
        Path configFilePath = getConfigFilePath();
        try {
            // 使用 pretty printer 格式化输出，便于人工阅读和编辑
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
        } catch (IOException e) {
            log.error("Failed to save prompt config: {}", e.getMessage());
            throw new RuntimeException("Failed to save prompt config", e);
        }
    }
}
