package com.example.clip.config;

import com.example.clip.service.AppConfigService;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * LLM Wiki 配置项。
 * <p>
 * 通过 {@code @ConfigurationProperties(prefix = "wiki")} 从
 * {@code application.yml} 读取配置，控制 Wiki Vault 的路径、批量入库窗口、
 * 增量 lint 缓存开关以及抽取/合成阶段使用的模型。所有字段均有默认值，
 * 未配置时使用默认值。
 * </p>
 *
 * <p>
 * <strong>vault 路径自动解析</strong>：如果 {@code vault-path} 配置为相对路径
 * （默认 {@code ./obsidian-vault}），则在初始化时以 {@link AppConfigService}
 * 的 {@code storagePath} 为基准自动解析为绝对路径，确保所有服务使用统一的
 * vault 路径，消除 JVM 工作目录依赖导致的不一致问题。
 * </p>
 *
 * <h3>配置示例</h3>
 * <pre>
 * wiki:
 *   vault-path: ./obsidian-vault
 *   wiki-dir-name: wiki
 *   sources-dir-name: sources
 *   batch-size: 5
 *   batch-timeout-minutes: 30
 *   lint-cache-enabled: true
 *   extraction-model: deepseek
 *   synthesis-model: dashscope
 *   page-types: [entity, concept, synthesis, source]
 *   sync-enabled: true
 *   sync-interval-seconds: 60
 * </pre>
 */
@Component
@ConfigurationProperties(prefix = "wiki")
@DependsOn("appConfigService")
public class WikiConfig {

    private static final Logger log = LoggerFactory.getLogger(WikiConfig.class);

    @Autowired
    private AppConfigService appConfigService;

    /** Obsidian Vault 根路径 */
    private String vaultPath = "./obsidian-vault";

    /** Vault 内 Wiki 目录名 */
    private String wikiDirName = "wiki";

    /** Vault 内 sources 目录名（待入库的原始 Markdown） */
    private String sourcesDirName = "sources";

    /** 批量入库窗口大小 */
    private int batchSize = 5;

    /** 批量入库触发超时（分钟） */
    private int batchTimeoutMinutes = 30;

    /** 是否启用增量 lint 缓存 */
    private boolean lintCacheEnabled = true;

    /** 抽取阶段使用的模型标识 */
    private String extractionModel = "deepseek";

    /** 合成阶段使用的模型标识 */
    private String synthesisModel = "dashscope";

    /** 支持的页面类型列表 */
    private List<String> pageTypes = new ArrayList<>(List.of("entity", "concept", "synthesis", "source"));

    /** 是否启用 Web Clipper 源文件同步（自动扫描 sources/ 目录并入库） */
    private boolean syncEnabled = true;

    /** Web Clipper 源文件同步扫描间隔（秒） */
    private int syncIntervalSeconds = 60;

    /**
     * 初始化时解析 vault 路径。
     * <p>
     * 如果 {@code vaultPath} 是相对路径（默认 {@code ./obsidian-vault}），
     * 则以 {@link AppConfigService} 的 {@code storagePath} 为基准解析为绝对路径。
     * 如果已经是绝对路径，则直接使用。
     * </p>
     */
    @PostConstruct
    public void resolveVaultPath() {
        Path path = Paths.get(vaultPath);
        if (path.isAbsolute()) {
            log.info("[Wiki] Vault path is absolute: {}", vaultPath);
            return;
        }
        String storagePath = appConfigService.getConfig().getStoragePath();
        if (storagePath != null && !storagePath.isEmpty()) {
            Path resolved = Paths.get(storagePath).resolve(vaultPath).normalize();
            log.info("[Wiki] Resolved vault path: {} → {}", vaultPath, resolved);
            this.vaultPath = resolved.toString();
        } else {
            log.warn("[Wiki] storagePath is empty, using raw vault path: {}", vaultPath);
        }
    }

    public String getVaultPath() {
        return vaultPath;
    }

    public void setVaultPath(String vaultPath) {
        this.vaultPath = vaultPath;
    }

    public String getWikiDirName() {
        return wikiDirName;
    }

    public void setWikiDirName(String wikiDirName) {
        this.wikiDirName = wikiDirName;
    }

    public String getSourcesDirName() {
        return sourcesDirName;
    }

    public void setSourcesDirName(String sourcesDirName) {
        this.sourcesDirName = sourcesDirName;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public int getBatchTimeoutMinutes() {
        return batchTimeoutMinutes;
    }

    public void setBatchTimeoutMinutes(int batchTimeoutMinutes) {
        this.batchTimeoutMinutes = batchTimeoutMinutes;
    }

    public boolean isLintCacheEnabled() {
        return lintCacheEnabled;
    }

    public void setLintCacheEnabled(boolean lintCacheEnabled) {
        this.lintCacheEnabled = lintCacheEnabled;
    }

    public String getExtractionModel() {
        return extractionModel;
    }

    public void setExtractionModel(String extractionModel) {
        this.extractionModel = extractionModel;
    }

    public String getSynthesisModel() {
        return synthesisModel;
    }

    public void setSynthesisModel(String synthesisModel) {
        this.synthesisModel = synthesisModel;
    }

    public List<String> getPageTypes() {
        return pageTypes;
    }

    public void setPageTypes(List<String> pageTypes) {
        this.pageTypes = pageTypes;
    }

    public boolean isSyncEnabled() {
        return syncEnabled;
    }

    public void setSyncEnabled(boolean syncEnabled) {
        this.syncEnabled = syncEnabled;
    }

    public int getSyncIntervalSeconds() {
        return syncIntervalSeconds;
    }

    public void setSyncIntervalSeconds(int syncIntervalSeconds) {
        this.syncIntervalSeconds = syncIntervalSeconds;
    }
}
