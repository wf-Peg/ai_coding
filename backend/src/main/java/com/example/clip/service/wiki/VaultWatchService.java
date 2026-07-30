package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Vault 源文件监视与入队服务。
 * <p>
 * 周期性扫描 Vault 的 sources 目录，发现新的 .md 文件后加入待入库队列。
 * BatchIngestService 通过 {@link #drainQueue()} 拉取一批文件进行处理，
 * 处理完成后调用 {@link #markAsProcessed(Path)} 标记文件已入库，避免重复处理。
 * </p>
 *
 * <h3>关键点</h3>
 * <ul>
 *   <li>使用 {@link ScheduledExecutorService} 每 60 秒扫描一次 sources 目录</li>
 *   <li>队列使用 {@link CopyOnWriteArrayList} 保证线程安全</li>
 *   <li>已处理文件名集合持久化到 {@code {vaultPath}/{wikiDirName}/.processed-files}，
 *       启动时通过 {@link #loadProcessedFiles()} 加载</li>
 *   <li>当队列大小达到 {@link WikiConfig#getBatchSize()} 时，
 *       {@link #shouldTriggerBatch()} 返回 true，提示触发批量入库</li>
 * </ul>
 * </p>
 */
@Service
public class VaultWatchService {

    private static final Logger log = LoggerFactory.getLogger(VaultWatchService.class);

    /** 扫描间隔（秒） */
    private static final long SCAN_INTERVAL_SECONDS = 60L;

    private final WikiConfig config;

    /** 待入库文件队列（线程安全） */
    private final CopyOnWriteArrayList<Path> queue = new CopyOnWriteArrayList<>();

    /** 已处理文件名集合（线程安全，持久化到 .processed-files） */
    private final Set<String> processedFiles = Collections.synchronizedSet(new HashSet<>());

    /** 周期扫描调度器 */
    private ScheduledExecutorService scheduler;

    /**
     * 最近一次 ingest 触发的时间戳（毫秒）。
     * <p>
     * 用于超时触发判断：当队列非空且距上次 ingest 超过
     * {@link WikiConfig#getBatchTimeoutMinutes()} 时，记录日志提示可触发。
     * 由 {@link #markIngestTriggered()} 在 ingest 完成后更新。
     * </p>
     */
    private volatile long lastIngestTime = System.currentTimeMillis();

    /**
     * 构造器注入。
     *
     * @param config Wiki 配置
     */
    public VaultWatchService(WikiConfig config) {
        this.config = config;
    }

    /**
     * 启动后初始化：加载已处理文件列表，并启动周期扫描。
     */
    @PostConstruct
    public void init() {
        loadProcessedFiles();
        startWatching();
    }

    /**
     * 容器销毁时关闭调度器，避免线程泄漏。
     */
    @PreDestroy
    public void destroy() {
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdown();
            log.info("[Wiki] Vault watch scheduler shut down");
        }
    }

    /**
     * 启动周期性扫描 sources 目录的任务。
     * <p>
     * 扫描完成后检查批量触发条件：
     * <ul>
     *   <li>队列大小 ≥ batchSize → 提示触发批量入库</li>
     *   <li>队列非空且距上次 ingest 超过 batchTimeoutMinutes → 提示超时触发</li>
     * </ul>
     * 由于不能直接注入 BatchIngestService（避免循环依赖），
     * 实际触发由 BatchIngestService 或外部 Controller/API 处理，
     * 这里仅记录日志提示。
     * </p>
     */
    public void startWatching() {
        if (scheduler != null && !scheduler.isShutdown()) {
            log.info("[Wiki] Vault watch already running");
            return;
        }
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "vault-watch");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleAtFixedRate(() -> {
            scanSources();
            checkBatchTrigger();
        }, SCAN_INTERVAL_SECONDS, SCAN_INTERVAL_SECONDS, TimeUnit.SECONDS);
        log.info("[Wiki] Vault watch started, scanning every {}s", SCAN_INTERVAL_SECONDS);
    }

    /**
     * 检查批量触发条件并记录日志。
     * <p>
     * 达到批量大小或超时阈值时记录提示日志，不直接调用 BatchIngestService
     * （避免循环依赖）。实际触发通过外部 API（POST /api/wiki/ingest/trigger）
     * 或外部 cron 任务处理。
     * </p>
     */
    private void checkBatchTrigger() {
        try {
            int queueSize = getQueueSize();
            if (queueSize <= 0) {
                return;
            }
            // 条件 1：队列达到批量大小
            if (shouldTriggerBatch()) {
                log.info("[Wiki] Batch trigger condition met (queue size: {}). "
                        + "Use POST /api/wiki/ingest/trigger to ingest.", queueSize);
                return;
            }
            // 条件 2：超时触发（队列非空且距上次 ingest 超过阈值）
            int timeoutMinutes = config.getBatchTimeoutMinutes();
            if (timeoutMinutes > 0) {
                long elapsed = System.currentTimeMillis() - lastIngestTime;
                if (elapsed > timeoutMinutes * 60_000L) {
                    log.info("[Wiki] Batch timeout trigger condition met (queue size: {}, "
                            + "elapsed: {}min > timeout: {}min). "
                            + "Use POST /api/wiki/ingest/trigger to ingest.",
                            queueSize, elapsed / 60_000L, timeoutMinutes);
                }
            }
        } catch (Exception e) {
            log.warn("[Wiki] Failed to check batch trigger: {}", e.getMessage());
        }
    }

    /**
     * 标记一次 ingest 已触发，更新最近 ingest 时间戳。
     * <p>
     * 由 BatchIngestService 在 ingest 完成后调用，用于超时触发判断。
     * </p>
     */
    public void markIngestTriggered() {
        lastIngestTime = System.currentTimeMillis();
    }

    /**
     * 扫描 sources 目录，发现新的（未处理且未入队）.md 文件加入队列。
     */
    public void scanSources() {
        try {
            Path sourcesDir = getSourcesDir();
            if (!Files.exists(sourcesDir) || !Files.isDirectory(sourcesDir)) {
                return;
            }
            List<Path> candidates = listMarkdownFiles(sourcesDir);
            int added = 0;
            for (Path file : candidates) {
                String fileName = file.getFileName().toString();
                if (isProcessed(file)) {
                    continue;
                }
                if (queue.stream().anyMatch(p -> p.getFileName().toString().equals(fileName))) {
                    continue;
                }
                queue.add(file);
                added++;
            }
            if (added > 0) {
                log.info("[Wiki] Scan found {} new source file(s); queue size={}", added, queue.size());
            }
        } catch (Exception e) {
            log.error("[Wiki] Failed to scan sources directory: {}", e.getMessage());
        }
    }

    /**
     * 返回当前队列大小。
     *
     * @return 队列大小
     */
    public int getQueueSize() {
        return queue.size();
    }

    /**
     * 返回配置的批量入库窗口大小。
     *
     * @return 批量大小
     */
    public int getBatchSize() {
        return config.getBatchSize();
    }

    /**
     * 返回当前队列中所有文件名列表。
     *
     * @return 文件名列表
     */
    public List<String> getQueuedFileNames() {
        List<String> names = new ArrayList<>();
        for (Path p : queue) {
            names.add(p.getFileName().toString());
        }
        return names;
    }

    /**
     * 排空队列：返回所有待处理文件并清空队列。由 BatchIngestService 调用。
     *
     * @return 被排空的文件列表
     */
    public List<Path> drainQueue() {
        List<Path> drained = new ArrayList<>(queue);
        queue.clear();
        return drained;
    }

    /**
     * 判断是否达到批量触发条件（队列大小 ≥ batchSize）。
     *
     * @return true 表示应触发批量入库
     */
    public boolean shouldTriggerBatch() {
        return queue.size() >= config.getBatchSize();
    }

    /**
     * 将文件标记为已处理：加入内存集合并持久化到 .processed-files。
     *
     * @param file 已处理的文件
     */
    public void markAsProcessed(Path file) {
        String fileName = file.getFileName().toString();
        boolean added = processedFiles.add(fileName);
        if (added) {
            persistProcessedFile(fileName);
        }
        // 同时从队列中移除（若存在）
        queue.removeIf(p -> p.getFileName().toString().equals(fileName));
    }

    /**
     * 判断文件是否已被处理过。
     *
     * @param file 文件
     * @return true 表示已处理
     */
    public boolean isProcessed(Path file) {
        String fileName = file.getFileName().toString();
        return processedFiles.contains(fileName);
    }

    /**
     * 从磁盘加载已处理文件名集合。
     * <p>
     * 读取 {@code {vaultPath}/{wikiDirName}/.processed-files}（每行一个文件名）。
     * 文件不存在时视为空集合。
     * </p>
     */
    public void loadProcessedFiles() {
        Path store = getProcessedFilesPath();
        if (!Files.exists(store)) {
            log.info("[Wiki] No processed files store found at {}", store);
            return;
        }
        try (Stream<String> lines = Files.lines(store)) {
            lines.filter(line -> !line.trim().isEmpty())
                    .forEach(processedFiles::add);
            log.info("[Wiki] Loaded {} processed file(s) from {}", processedFiles.size(), store);
        } catch (IOException e) {
            log.error("[Wiki] Failed to load processed files: {}", e.getMessage());
        }
    }

    /**
     * 返回 sources 目录路径。
     *
     * @return {@code {vaultPath}/{sourcesDirName}}
     */
    private Path getSourcesDir() {
        return Paths.get(config.getVaultPath()).resolve(config.getSourcesDirName());
    }

    /**
     * 返回 .processed-files 持久化路径。
     *
     * @return {@code {vaultPath}/{wikiDirName}/.processed-files}
     */
    private Path getProcessedFilesPath() {
        return Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve(".processed-files");
    }

    /**
     * 将单个已处理文件名追加写入持久化文件。
     *
     * @param fileName 文件名
     */
    private void persistProcessedFile(String fileName) {
        try {
            Path store = getProcessedFilesPath();
            Path parent = store.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            Files.writeString(store, fileName + "\n",
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.APPEND);
        } catch (IOException e) {
            log.error("[Wiki] Failed to persist processed file [{}]: {}", fileName, e.getMessage());
        }
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
            log.error("[Wiki] Failed to list markdown files in [{}]: {}", dir, e.getMessage());
            return List.of();
        }
    }
}
