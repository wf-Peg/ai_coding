package com.example.clip.service;

import com.example.clip.config.AppConfig;
import com.example.clip.config.GitConfig;
import com.example.clip.core.ModelConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 应用统一配置持久化服务
 * <p>
 * 将所有应用级配置（AI 模型、邮件、Git、存储路径等）集中存储到
 * {@code ~/.cut-shelter/config/app-config.json} 用户主目录下。
 * 不同 exe 启动时读取同一份配置，确保配置互通。
 * 保存时同时同步到旧的 ModelConfigService 和 GitConfigStorageService，
 * 确保向后兼容。
 * </p>
 */
@Service
public class AppConfigService {

    private static final Logger log = LoggerFactory.getLogger(AppConfigService.class);

    private static final String CONFIG_DIR = ".cut-shelter";
    private static final String CONFIG_SUB_DIR = "config";
    private static final String CONFIG_FILE = "app-config.json";

    private final ObjectMapper objectMapper;
    private volatile AppConfig cachedConfig;

    @Autowired(required = false)
    private ModelConfigService modelConfigService;

    @Autowired(required = false)
    private GitConfigStorageService gitConfigStorageService;

    @Value("${clip.storage.path:./clip-storage}")
    private String storagePath;

    public AppConfigService() {
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 初始化时注入存储路径到默认配置，确保 GET 时能返回正确的路径值
     */
    @PostConstruct
    public void init() {
        loadConfig();
    }

    private Path getConfigDir() {
        // 统一使用 ~/.cut-shelter/config/ 目录，不同 exe 共享同一份配置
        String userHome = System.getProperty("user.home");
        if (userHome == null || userHome.isEmpty()) {
            userHome = ".";
        }
        Path dir = Paths.get(userHome, CONFIG_DIR, CONFIG_SUB_DIR);
        if (!Files.exists(dir)) {
            try {
                Files.createDirectories(dir);
            } catch (IOException e) {
                log.error("Failed to create config directory: {}", e.getMessage());
                return Paths.get(userHome, CONFIG_DIR);
            }
        }
        return dir;
    }

    /**
     * 旧路径：{clip.storage.path}/config/app-config.json（向后兼容迁移用）
     */
    private Path getOldConfigFilePath() {
        String sp = System.getProperty("clip.storage.path", storagePath);
        return Paths.get(sp, "config", CONFIG_FILE);
    }

    private Path getConfigFilePath() {
        return getConfigDir().resolve(CONFIG_FILE);
    }

    /**
     * 获取配置文件目录路径（~/.cut-shelter/config）
     *
     * @return 配置文件所在目录的绝对路径
     */
    public String getConfigDirPath() {
        return getConfigDir().toString();
    }

    /**
     * 获取配置文件完整路径（~/.cut-shelter/config/app-config.json）
     *
     * @return 配置文件的绝对路径
     */
    public String getConfigFileFullPath() {
        return getConfigFilePath().toString();
    }

    /**
     * 获取统一配置（优先使用缓存）
     *
     * @return AppConfig 对象
     */
    public AppConfig getConfig() {
        if (cachedConfig != null) {
            return fillStoragePaths(cachedConfig);
        }
        return loadConfig();
    }

    /**
     * 从文件加载配置并更新缓存
     *
     * @return AppConfig 对象
     */
    public synchronized AppConfig loadConfig() {
        Path configFilePath = getConfigFilePath();
        Path oldConfigFilePath = getOldConfigFilePath();
        AppConfig config;

        if (Files.exists(configFilePath)) {
            // 新路径存在：直接读取
            try {
                config = objectMapper.readValue(configFilePath.toFile(), AppConfig.class);
                log.debug("App config loaded from: {}", configFilePath);
            } catch (IOException e) {
                log.warn("Failed to load app config, using defaults: {}", e.getMessage());
                config = new AppConfig();
            }
        } else if (Files.exists(oldConfigFilePath)) {
            // 新路径不存在但旧路径存在：迁移到新路径
            try {
                config = objectMapper.readValue(oldConfigFilePath.toFile(), AppConfig.class);
                log.info("Migrating app config from old path: {} → {}", oldConfigFilePath, configFilePath);
                objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
                Files.delete(oldConfigFilePath);
                log.info("Migrated app config successfully");
            } catch (IOException e) {
                log.warn("Failed to migrate app config, using defaults: {}", e.getMessage());
                config = new AppConfig();
            }
        } else {
            // 都不存在：从旧的 model-config.json 和 git-config.json 迁移
            config = migrateFromLegacy();
            // 首次创建后立即保存到新路径
            if (config != null) {
                try {
                    objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
                    log.info("Created new app config at: {}", configFilePath);
                } catch (IOException e) {
                    log.warn("Failed to save initial app config: {}", e.getMessage());
                }
            }
        }

        config = fillStoragePaths(config);
        cachedConfig = config;
        // 启动时同步到 ModelConfigService，确保 AI Provider 读取到正确的 API Key
        syncToModelConfig(config);
        return config;
    }

    /**
     * 保存统一配置，同步更新内存缓存和下游服务
     *
     * @param config 新的配置
     * @return 保存后的配置
     */
    public synchronized AppConfig saveConfig(AppConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("配置不能为空");
        }

        // 保留未填写的存储路径为默认值
        config = fillStoragePaths(config);

        Path configFilePath = getConfigFilePath();
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(configFilePath.toFile(), config);
            cachedConfig = config;
            log.info("App config saved to: {}", configFilePath);
        } catch (IOException e) {
            log.error("Failed to save app config: {}", e.getMessage());
            throw new RuntimeException("Failed to save app config", e);
        }

        // 同步到下游服务（向后兼容）
        syncToModelConfig(config);
        syncToGitConfig(config);

        return config;
    }

    /**
     * 同步 AI 模型配置到 ModelConfigService
     */
    private void syncToModelConfig(AppConfig config) {
        if (modelConfigService == null) return;
        try {
            ModelConfig mc = new ModelConfig();
            mc.setActiveProvider(config.getActiveProvider());
            mc.setDashscopeApiKey(config.getDashscopeApiKey());
            mc.setDashscopeModel(config.getDashscopeModel());
            mc.setDeepseekApiKey(config.getDeepseekApiKey());
            mc.setDeepseekModel(config.getDeepseekModel());
            modelConfigService.saveConfig(mc);
            log.debug("Synced to ModelConfigService");
        } catch (Exception e) {
            log.warn("Failed to sync model config: {}", e.getMessage());
        }
    }

    /**
     * 同步 Git 配置到 GitConfigStorageService
     */
    private void syncToGitConfig(AppConfig config) {
        if (gitConfigStorageService == null) return;
        try {
            GitConfig gc = new GitConfig(
                    config.getGitRemoteUrl(),
                    config.getGitUsername(),
                    config.getGitPassword(),
                    config.getGitBranch()
            );
            gitConfigStorageService.saveConfig(gc);
            log.debug("Synced to GitConfigStorageService");
        } catch (Exception e) {
            log.warn("Failed to sync git config: {}", e.getMessage());
        }
    }

    /**
     * 从旧的配置文件（model-config.json + git-config.json）迁移数据到统一配置
     */
    private AppConfig migrateFromLegacy() {
        AppConfig config = new AppConfig();
        config = fillStoragePaths(config);

        // 迁移模型配置
        if (modelConfigService != null) {
            try {
                ModelConfig mc = modelConfigService.loadConfig();
                config.setActiveProvider(mc.getActiveProvider());
                config.setDashscopeApiKey(mc.getDashscopeApiKey());
                config.setDashscopeModel(mc.getDashscopeModel());
                config.setDeepseekApiKey(mc.getDeepseekApiKey());
                config.setDeepseekModel(mc.getDeepseekModel());
            } catch (Exception e) {
                log.debug("No legacy model config to migrate: {}", e.getMessage());
            }
        }

        // 迁移 Git 配置
        if (gitConfigStorageService != null) {
            try {
                GitConfig gc = gitConfigStorageService.loadConfig();
                if (gc != null) {
                    config.setGitRemoteUrl(gc.getRemoteUrl() != null ? gc.getRemoteUrl() : "");
                    config.setGitUsername(gc.getUsername() != null ? gc.getUsername() : "");
                    config.setGitPassword(gc.getPassword() != null ? gc.getPassword() : "");
                    config.setGitBranch(gc.getBranch() != null ? gc.getBranch() : "main");
                }
            } catch (Exception e) {
                log.debug("No legacy git config to migrate: {}", e.getMessage());
            }
        }

        return config;
    }

    /**
     * 填充存储路径（仅当为空时用 @Value 默认值反推父目录）
     * <p>
     * AppConfig.storagePath 存储的是 Clip_Bed 父目录，
     * 而 @Value 注入的是 clip.storage.path（实际 clip-storage 路径），
     * 因此需要反推父目录作为默认值。
     * </p>
     */
    private AppConfig fillStoragePaths(AppConfig config) {
        if (config == null) return config;
        if (config.getStoragePath() == null || config.getStoragePath().isEmpty()) {
            // @Value 注入的是实际路径如 D:/Data/Clip_Bed/clip-storage
            // 反推父目录 D:/Data/Clip_Bed 作为 basePath
            Path sp = Paths.get(storagePath);
            config.setStoragePath(sp.getParent() != null ? sp.getParent().toString() : storagePath);
        }
        return config;
    }

    /**
     * 获取整理存储路径（从 Clip_Bed 父目录派生）
     * <p>
     * 如 storagePath = D:/Data/Clip_Bed → D:/Data/Clip_Bed/clip-organized
     * </p>
     */
    public String getOrganizedPath() {
        String sp = getConfig().getStoragePath();
        return Paths.get(sp).resolve("clip-organized").toString();
    }

    /**
     * 获取周报存储路径（从 Clip_Bed 父目录派生）
     * <p>
     * 如 storagePath = D:/Data/Clip_Bed → D:/Data/Clip_Bed/weekly-report
     * </p>
     */
    public String getWeeklyReportPath() {
        String sp = getConfig().getStoragePath();
        return Paths.get(sp).resolve("weekly-report").toString();
    }

    /**
     * 将旧存储目录打包为 zip 归档，然后在新路径创建目录结构。
     * <p>
     * 归档文件保存在旧路径的父目录下，命名为 {dirname}-backup-{yyyyMMdd-HHmmss}.zip。
     * 归档不删除原文件，用户可以手动清理。
     * </p>
     *
     * @param oldPath 旧存储根路径
     * @param newPath 新存储根路径
     * @return 结果 map，包含 success/archivePath/archiveSize
     */
    public Map<String, Object> archiveAndMigrate(String oldPath, String newPath) {
        Map<String, Object> result = new LinkedHashMap<>();

        if (oldPath == null || oldPath.isEmpty()) {
            result.put("success", false);
            result.put("message", "旧路径为空，无需归档");
            return result;
        }
        if (newPath == null || newPath.isEmpty()) {
            result.put("success", false);
            result.put("message", "新路径为空，无法归档");
            return result;
        }

        Path oldBase = Paths.get(oldPath);
        if (!Files.exists(oldBase) || !Files.isDirectory(oldBase)) {
            result.put("success", false);
            result.put("message", "旧路径不存在或不是目录: " + oldPath);
            return result;
        }

        String timestamp = new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date());
        String dirName = oldBase.getFileName().toString();
        Path archivePath = oldBase.getParent().resolve(dirName + "-backup-" + timestamp + ".zip");

        try {
            // 1. 打包 clip-storage 子目录为 zip
            Path oldClipStorage = oldBase.resolve("clip-storage");
            long totalSize = 0;
            if (Files.exists(oldClipStorage)) {
                try (ZipOutputStream zos = new ZipOutputStream(
                        new BufferedOutputStream(Files.newOutputStream(archivePath)))) {
                    Files.walkFileTree(oldClipStorage, new SimpleFileVisitor<Path>() {
                        @Override
                        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                            if (attrs.isRegularFile()) {
                                String entryName = oldClipStorage.relativize(file).toString().replace('\\', '/');
                                zos.putNextEntry(new ZipEntry(entryName));
                                Files.copy(file, zos);
                                zos.closeEntry();
                            }
                            return FileVisitResult.CONTINUE;
                        }
                    });
                }
                totalSize = Files.size(archivePath);
            }

            // 2. 复制三个子目录到新路径
            String[] subDirs = {"clip-storage", "clip-organized", "weekly-report"};
            int copiedCount = 0;
            for (String sub : subDirs) {
                Path oldSub = oldBase.resolve(sub);
                Path newSub = Paths.get(newPath).resolve(sub);
                if (Files.exists(oldSub) && Files.isDirectory(oldSub)) {
                    int count = copyDirectory(oldSub, newSub);
                    copiedCount += count;
                    log.info("Copied {} files from {} to {}", count, oldSub, newSub);
                }
            }

            // 3. 确保新路径目录结构存在
            Files.createDirectories(Paths.get(newPath).resolve("clip-storage"));
            Files.createDirectories(Paths.get(newPath).resolve("clip-organized"));
            Files.createDirectories(Paths.get(newPath).resolve("weekly-report"));

            String sizeStr;
            if (totalSize == 0) {
                sizeStr = "0 B (无旧数据)";
            } else if (totalSize < 1024) {
                sizeStr = totalSize + " B";
            } else if (totalSize < 1024 * 1024) {
                sizeStr = String.format("%.1f KB", totalSize / 1024.0);
            } else {
                sizeStr = String.format("%.1f MB", totalSize / (1024.0 * 1024.0));
            }

            result.put("success", true);
            result.put("archivePath", archivePath.toString());
            result.put("archiveSize", sizeStr);
            result.put("copiedCount", copiedCount);
            result.put("message", "归档完成：" + archivePath.getFileName() + " (" + sizeStr + ")，已迁移 " + copiedCount + " 个文件");
            log.info("Archive: {} ({}), migrated {} files to {}", archivePath, sizeStr, copiedCount, newPath);

        } catch (IOException e) {
            log.error("Failed to archive/migrate storage: {}", e.getMessage(), e);
            result.put("success", false);
            result.put("message", "归档/迁移失败: " + e.getMessage());
            try { Files.deleteIfExists(archivePath); } catch (IOException ignored) {}
        }

        return result;
    }

    /**
     * 递归复制目录
     *
     * @return 复制的文件数量
     */
    private int copyDirectory(Path source, Path target) throws IOException {
        final int[] count = {0};
        Files.walkFileTree(source, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Files.createDirectories(target.resolve(source.relativize(dir)));
                return FileVisitResult.CONTINUE;
            }
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.copy(file, target.resolve(source.relativize(file)), StandardCopyOption.REPLACE_EXISTING);
                count[0]++;
                return FileVisitResult.CONTINUE;
            }
        });
        return count[0];
    }
}
