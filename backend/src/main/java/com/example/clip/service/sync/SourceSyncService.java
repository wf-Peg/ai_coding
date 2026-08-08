package com.example.clip.service.sync;

import com.example.clip.config.WikiConfig;
import com.example.clip.model.ClipContent;
import com.example.clip.service.FileStorageService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Web Clipper 源文件同步服务。
 * <p>
 * 周期性扫描 Vault 的 {@code sources/} 目录，将 Obsidian Web Clipper 浏览器插件
 * 写入的 Markdown 文件解析为 {@link ClipContent} 并入库。已同步文件名持久化到
 * {@code {vaultPath}/{wikiDirName}/.synced-files}（与 {@code .processed-files}
 * 独立），避免重复入库。
 * </p>
 *
 * <h3>关键流程</h3>
 * <ol>
 *   <li>{@link #init()} 启动时加载已同步文件列表，若 {@link WikiConfig#isSyncEnabled()}
 *       为 true，启动周期扫描调度器</li>
 *   <li>{@link #syncSources()} 扫描 sources/ 目录的 .md 文件，对每个未同步文件：
 *     <ul>
 *       <li>读取文件内容（UTF-8）</li>
 *       <li>调用 {@link WebClipperFrontmatterParser#toClipContent} 解析 frontmatter</li>
 *       <li>设置 content 为指向原文的 Obsidian wiki 链接</li>
 *       <li>设置 sourceFilePath 为 {@code sources/{文件名}}</li>
 *       <li>调用 {@link FileStorageService#saveClip} 入库</li>
 *       <li>加入 syncedFiles 集合并持久化</li>
 *     </ul>
 *   </li>
 *   <li>{@link #destroy()} 关闭调度器</li>
 * </ol>
 *
 * <h3>降级策略</h3>
 * <ul>
 *   <li>frontmatter 解析失败时仍会创建剪藏（用文件名作为标题），不中断同步</li>
 *   <li>单个文件处理异常只记录日志，继续处理下一个</li>
 * </ul>
 */
@Service
public class SourceSyncService {

    private static final Logger log = LoggerFactory.getLogger(SourceSyncService.class);

    /** 同步状态持久化文件名 */
    private static final String SYNCED_FILES_NAME = ".synced-files";

    /** 默认同步间隔（秒），仅在配置缺失时使用 */
    private static final long SYNC_INTERVAL_SECONDS = 60L;

    private final WebClipperFrontmatterParser parser;
    private final FileStorageService fileStorageService;
    private final WikiConfig wikiConfig;

    /** 已同步文件名集合（线程安全，持久化到 .synced-files） */
    private final Set<String> syncedFiles = Collections.synchronizedSet(new HashSet<>());

    /** 周期扫描调度器 */
    private ScheduledExecutorService scheduler;

    /** 最近一次同步完成的时间戳（毫秒） */
    private volatile long lastSyncTime = 0;

    /**
     * 构造器注入。
     *
     * @param parser            Web Clipper frontmatter 解析器
     * @param fileStorageService 文件存储服务
     * @param wikiConfig        Wiki 配置
     */
    public SourceSyncService(WebClipperFrontmatterParser parser,
                             FileStorageService fileStorageService,
                             WikiConfig wikiConfig) {
        this.parser = parser;
        this.fileStorageService = fileStorageService;
        this.wikiConfig = wikiConfig;
    }

    /**
     * 启动后初始化：确保目录存在，加载已同步文件列表，若启用同步则启动周期扫描。
     */
    @PostConstruct
    public void init() {
        ensureDirectories();
        loadSyncedFiles();
        if (wikiConfig.isSyncEnabled()) {
            startScheduler();
        } else {
            log.info("[Sync] Source sync disabled (wiki.sync-enabled=false)");
        }
    }

    /**
     * 容器销毁时关闭调度器，避免线程泄漏。
     */
    @PreDestroy
    public void destroy() {
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdown();
            log.info("[Sync] Source sync scheduler shut down");
        }
    }

    /**
     * 启动周期性扫描 sources/ 目录的任务。
     */
    private void startScheduler() {
        if (scheduler != null && !scheduler.isShutdown()) {
            log.info("[Sync] Source sync scheduler already running");
            return;
        }
        long intervalSeconds = wikiConfig.getSyncIntervalSeconds() > 0
                ? wikiConfig.getSyncIntervalSeconds()
                : SYNC_INTERVAL_SECONDS;
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "source-sync");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleAtFixedRate(
                this::syncSources,
                intervalSeconds,
                intervalSeconds,
                TimeUnit.SECONDS);
        log.info("[Sync] Source sync scheduler started, scanning every {}s", intervalSeconds);
    }

    /**
     * 执行一次同步扫描。
     * <p>
     * 扫描 sources/ 目录下所有 .md 文件，对未同步的文件解析 frontmatter 并入库，
     * 已同步的文件跳过。返回包含统计信息的 Map。
     * </p>
     *
     * @return 同步结果 Map，包含 syncedCount/skippedCount/totalScanned/message；
     *         异常时返回 {status:"error", message:...}
     */
    public Map<String, Object> syncSources() {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Path sourcesDir = getSourcesDir();
            ensureSourceDir(sourcesDir);
            if (!Files.exists(sourcesDir) || !Files.isDirectory(sourcesDir)) {
                result.put("syncedCount", 0);
                result.put("skippedCount", 0);
                result.put("totalScanned", 0);
                result.put("message", "sources directory not found: " + sourcesDir);
                lastSyncTime = System.currentTimeMillis();
                return result;
            }

            List<Path> files = listMarkdownFiles(sourcesDir);
            int syncedCount = 0;
            int skippedCount = 0;
            for (Path file : files) {
                String fileName = file.getFileName().toString();
                if (isSynced(file)) {
                    skippedCount++;
                    continue;
                }
                try {
                    String content = Files.readString(file, StandardCharsets.UTF_8);
                    ClipContent clip = parser.toClipContent(content, fileName);
                    // content 保留 wiki-link 引用（用于 Obsidian 集成）
                    clip.setContent(buildWikiLink(fileName, clip.getTitle()));
                    // bodyContent 存储实际正文（不含 frontmatter），用于前端展示和 AI 分析
                    String bodyContent = parser.extractBodyContent(content);
                    if (bodyContent != null && !bodyContent.isBlank()) {
                        clip.setBodyContent(bodyContent);
                    } else if (clip.getSummary() != null && !clip.getSummary().isBlank()) {
                        clip.setBodyContent(clip.getSummary());
                    }
                    clip.setSourceFilePath("sources/" + fileName);
                    fileStorageService.saveClip(clip);
                    markAsSynced(fileName);
                    syncedCount++;
                    log.info("[Sync] Synced source file: {}", fileName);
                } catch (Exception e) {
                    log.error("[Sync] Failed to sync source file [{}]: {}", fileName, e.getMessage());
                }
            }
            lastSyncTime = System.currentTimeMillis();
            result.put("syncedCount", syncedCount);
            result.put("skippedCount", skippedCount);
            result.put("totalScanned", files.size());
            result.put("message", "sync completed: " + syncedCount + " synced, " + skippedCount + " skipped");
            return result;
        } catch (Exception e) {
            log.error("[Sync] Failed to sync sources: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "sync failed: " + e.getMessage());
            return result;
        }
    }

    /**
     * 判断文件是否已同步过。
     *
     * @param file 文件路径
     * @return true 表示文件名已在 syncedFiles 集合中
     */
    public boolean isSynced(Path file) {
        if (file == null) {
            return false;
        }
        String fileName = file.getFileName().toString();
        return syncedFiles.contains(fileName);
    }

    /**
     * 将文件标记为已同步：加入内存集合并持久化。
     *
     * @param fileName 文件名
     */
    public void markAsSynced(String fileName) {
        boolean added = syncedFiles.add(fileName);
        if (added) {
            persistSyncedFile(fileName);
        }
    }

    /**
     * 返回当前同步状态。
     *
     * @return Map 包含 syncedCount/pendingCount/lastSyncTime/sourcesDir
     */
    public Map<String, Object> getStatus() {
        Map<String, Object> status = new LinkedHashMap<>();
        int syncedCount = syncedFiles.size();
        Path sourcesDir = getSourcesDir();
        int totalFiles = 0;
        if (Files.exists(sourcesDir) && Files.isDirectory(sourcesDir)) {
            totalFiles = listMarkdownFiles(sourcesDir).size();
        }
        int pendingCount = Math.max(0, totalFiles - syncedCount);
        status.put("syncedCount", syncedCount);
        status.put("pendingCount", pendingCount);
        status.put("lastSyncTime", lastSyncTime);
        status.put("sourcesDir", sourcesDir.toString());
        return status;
    }

    /**
     * 从磁盘加载已同步文件名集合。
     * <p>
     * 读取 {@code {vaultPath}/{wikiDirName}/.synced-files}（每行一个文件名）。
     * 文件不存在时视为空集合。
     * </p>
     */
    private void loadSyncedFiles() {
        Path store = getSyncedFilesPath();
        if (!Files.exists(store)) {
            log.info("[Sync] No synced files store found at {}", store);
            return;
        }
        try (Stream<String> lines = Files.lines(store, StandardCharsets.UTF_8)) {
            lines.filter(line -> !line.trim().isEmpty())
                    .forEach(syncedFiles::add);
            log.info("[Sync] Loaded {} synced file(s) from {}", syncedFiles.size(), store);
        } catch (IOException e) {
            log.error("[Sync] Failed to load synced files: {}", e.getMessage());
        }
    }

    /**
     * 将单个已同步文件名追加写入持久化文件。
     *
     * @param fileName 文件名
     */
    private void persistSyncedFile(String fileName) {
        try {
            Path store = getSyncedFilesPath();
            Path parent = store.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            Files.writeString(store, fileName + "\n",
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND);
        } catch (IOException e) {
            log.error("[Sync] Failed to persist synced file [{}]: {}", fileName, e.getMessage());
        }
    }

    /**
     * 确保 vault 下所有必需目录存在。
     * <p>
     * 包括 {@code sources/}（Web Clipper 写入目录）和 {@code wiki/}（持久化状态文件目录），
     * 在启动时和同步前自动创建，避免用户手动创建。
     * </p>
     */
    private void ensureDirectories() {
        ensureSourceDir(getSourcesDir());
        Path store = getSyncedFilesPath();
        Path parent = store.getParent();
        if (parent != null && !Files.exists(parent)) {
            try {
                Files.createDirectories(parent);
                log.info("[Sync] Created wiki directory: {}", parent);
            } catch (IOException e) {
                log.warn("[Sync] Failed to create wiki directory [{}]: {}", parent, e.getMessage());
            }
        }
    }

    /**
     * 确保 sources 目录存在，不存在则自动创建。
     *
     * @param sourcesDir sources 目录路径
     */
    private void ensureSourceDir(Path sourcesDir) {
        if (!Files.exists(sourcesDir)) {
            try {
                Files.createDirectories(sourcesDir);
                log.info("[Sync] Created sources directory: {}", sourcesDir);
            } catch (IOException e) {
                log.warn("[Sync] Failed to create sources directory [{}]: {}", sourcesDir, e.getMessage());
            }
        }
    }

    /**
     * 返回 .synced-files 持久化路径。
     *
     * @return {@code {vaultPath}/{wikiDirName}/.synced-files}
     */
    private Path getSyncedFilesPath() {
        return Paths.get(wikiConfig.getVaultPath())
                .resolve(wikiConfig.getWikiDirName())
                .resolve(SYNCED_FILES_NAME);
    }

    /**
     * 返回 sources 目录路径。
     *
     * @return {@code {vaultPath}/{sourcesDirName}}
     */
    private Path getSourcesDir() {
        return Paths.get(wikiConfig.getVaultPath()).resolve(wikiConfig.getSourcesDirName());
    }

    /**
     * 列出目录下所有 .md 文件（不递归）。
     *
     * @param dir 目标目录
     * @return .md 文件列表；目录不存在或读取失败时返回空列表
     */
    private List<Path> listMarkdownFiles(Path dir) {
        if (!Files.exists(dir) || !Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".md"))
                    .toList();
        } catch (IOException e) {
            log.error("[Sync] Failed to list markdown files in [{}]: {}", dir, e.getMessage());
            return List.of();
        }
    }

    /**
     * 构造指向源文件的 Obsidian wiki 链接。
     * <p>
     * 格式：{@code [[sources/{fileNameNoExt}|{title}]]}
     * </p>
     *
     * @param fileName 文件名（含 .md 扩展名）
     * @param title    显示标题
     * @return wiki 链接字符串
     */
    private String buildWikiLink(String fileName, String title) {
        String fileNameNoExt = stripMdExtension(fileName);
        return "[[sources/" + fileNameNoExt + "|" + title + "]]";
    }

    /**
     * 去除文件名的 .md 扩展名。
     *
     * @param fileName 文件名
     * @return 去扩展名后的名称
     */
    private String stripMdExtension(String fileName) {
        if (fileName == null || fileName.isEmpty()) {
            return "";
        }
        if (fileName.toLowerCase().endsWith(".md")) {
            return fileName.substring(0, fileName.length() - 3);
        }
        return fileName;
    }
}
