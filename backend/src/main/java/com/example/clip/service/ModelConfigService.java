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
 * <p>
 * 负责 AI 模型配置（API Key、Base URL、模型名称等）的 JSON 文件持久化读写。
 * 配置文件存储于用户配置目录下的 model-config.json 文件中。
 * 使用 volatile 缓存配置对象，减少文件 IO 次数。
 * </p>
 */
@Service
public class ModelConfigService {

    private static final Logger log = LoggerFactory.getLogger(ModelConfigService.class);
    /** 模型配置文件名 */
    private static final String CONFIG_FILE_NAME = "model-config.json";

    /** JSON 序列化/反序列化工具 */
    private final ObjectMapper objectMapper;
    /**
     * 缓存的模型配置对象，使用 volatile 保证多线程可见性。
     * 缓存失效时（如 null）会自动从文件重新加载。
     */
    private volatile ModelConfig cachedConfig;

    public ModelConfigService() {
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 获取配置文件路径
     * <p>
     * 优先使用 clip-storage 目录（与 FileStorageService 保持一致），
     * 若目录不存在则自动创建，若创建失败则回退到当前工作目录。
     * </p>
     *
     * @return 配置文件的完整路径
     */
    private Path getConfigFilePath() {
        String userHome = System.getProperty("user.home", ".");
        Path configDir = Paths.get(userHome, ".cut-shelter", "config");
        if (!Files.exists(configDir)) {
            try {
                Files.createDirectories(configDir);
            } catch (IOException e) {
                log.warn("Failed to create application config directory: {}", e.getMessage());
                return Paths.get(CONFIG_FILE_NAME);
            }
        }
        return configDir.resolve(CONFIG_FILE_NAME);
    }

    /**
     * 获取模型配置（优先使用缓存）
     * <p>
     * 如果缓存中有配置对象则直接返回，否则从文件加载。
     * 这避免了每次调用都读取文件，提高了性能。
     * </p>
     *
     * @return 当前模型配置，若从未保存过则返回默认配置
     */
    public ModelConfig getConfig() {
        if (cachedConfig != null) {
            return cachedConfig;
        }
        return loadConfig();
    }

    /**
     * 强制从文件重新加载配置
     * <p>
     * 无论缓存中是否存在，都从配置文件重新读取并更新缓存。
     * 如果配置文件不存在，则创建默认配置并缓存。
     * </p>
     *
     * @return 从文件加载的配置对象，若文件不存在或读取失败则返回默认配置
     */
    public ModelConfig loadConfig() {
        Path configFilePath = getConfigFilePath();
        if (!Files.exists(configFilePath)) {
            // 配置文件不存在时，使用默认空配置
            cachedConfig = new ModelConfig();
            return cachedConfig;
        }
        try {
            cachedConfig = objectMapper.readValue(configFilePath.toFile(), ModelConfig.class);
            return cachedConfig;
        } catch (IOException e) {
            log.error("Failed to load model config: {}", e.getMessage());
            // 读取失败时使用默认配置，避免返回 null
            cachedConfig = new ModelConfig();
            return cachedConfig;
        }
    }

    /**
     * 保存模型配置并刷新缓存
     * <p>
     * 将配置对象序列化为 JSON 写入文件，同时更新内存缓存。
     * 配置不能为 null，否则抛出异常。
     * </p>
     *
     * @param config 要保存的模型配置对象
     * @return 保存后的配置对象（与入参相同）
     * @throws IllegalArgumentException 如果 config 为 null
     * @throws RuntimeException          如果文件写入失败
     */
    public ModelConfig saveConfig(ModelConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("模型配置不能为空");
        }
        Path configFilePath = getConfigFilePath();
        try {
            // 使用 pretty printer 格式化输出，便于人工阅读和编辑
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
            // 写入成功后更新缓存
            cachedConfig = config;
            return config;
        } catch (IOException e) {
            log.error("Failed to save model config: {}", e.getMessage());
            throw new RuntimeException("Failed to save model config", e);
        }
    }
}
