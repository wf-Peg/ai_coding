package com.example.clip.controller;

import com.example.clip.config.WikiConfig;
import com.example.clip.service.wiki.BatchIngestService;
import com.example.clip.service.wiki.VaultWatchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Wiki 入库 REST 控制器。
 * <p>
 * 提供查看队列状态和手动触发批量入库的 HTTP 接口。
 * 浏览器、前端页面或调度器均可调用。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code GET  /api/wiki/ingest/queue} — 查询当前队列状态</li>
 *   <li>{@code POST /api/wiki/ingest/trigger} — 手动触发批量入库（drain 队列全部）</li>
 *   <li>{@code POST /api/wiki/ingest/trigger-batch} — 触发指定文件列表入库（请求体可选 filePaths）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/wiki/ingest")
@CrossOrigin(origins = "*")
public class WikiIngestController {

    private static final Logger log = LoggerFactory.getLogger(WikiIngestController.class);

    private final BatchIngestService batchIngestService;
    private final VaultWatchService vaultWatchService;
    private final WikiConfig wikiConfig;

    /**
     * 构造器注入。
     *
     * @param batchIngestService 批量入库服务
     * @param vaultWatchService  Vault 监视服务
     * @param wikiConfig         Wiki 配置
     */
    public WikiIngestController(BatchIngestService batchIngestService,
                                VaultWatchService vaultWatchService,
                                WikiConfig wikiConfig) {
        this.batchIngestService = batchIngestService;
        this.vaultWatchService = vaultWatchService;
        this.wikiConfig = wikiConfig;
    }

    /**
     * 查询当前入库队列状态。
     * <p>
     * 返回队列大小、批量阈值和队列中所有文件名。
     * </p>
     *
     * @return {@code {queueSize, batchSize, queuedFiles}}
     */
    @GetMapping("/queue")
    public ResponseEntity<Map<String, Object>> getQueueStatus() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("queueSize", vaultWatchService.getQueueSize());
        result.put("batchSize", vaultWatchService.getBatchSize());
        result.put("queuedFiles", vaultWatchService.getQueuedFileNames());
        return ResponseEntity.ok(result);
    }

    /**
     * 手动触发批量入库：排空当前队列中的所有文件并处理。
     * <p>
     * 若队列为空，返回 400 错误。
     * </p>
     *
     * @return 入库统计 Map
     */
    @PostMapping("/trigger")
    public ResponseEntity<Map<String, Object>> triggerIngest() {
        List<Path> drained = vaultWatchService.drainQueue();
        if (drained.isEmpty()) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("status", "error");
            empty.put("message", "Queue is empty");
            return ResponseEntity.badRequest().body(empty);
        }
        log.info("[Wiki] Manual ingest triggered for {} files", drained.size());
        Map<String, Object> stats = batchIngestService.ingestBatch(drained);
        return ResponseEntity.ok(stats);
    }

    /**
     * 触发批量入库（别名）：可选地在请求体中传入文件路径列表。
     * <p>
     * 若请求体包含 {@code filePaths}（字符串数组），则处理这些路径；
     * 否则排空当前队列进行处理。
     * </p>
     *
     * @param body 请求体，可选 {@code filePaths} 字段
     * @return 入库统计 Map
     */
    @PostMapping("/trigger-batch")
    public ResponseEntity<Map<String, Object>> triggerBatch(@RequestBody(required = false) Map<String, Object> body) {
        List<Path> files = new ArrayList<>();

        if (body != null && body.containsKey("filePaths")) {
            Object raw = body.get("filePaths");
            if (raw instanceof List) {
                for (Object item : (List<?>) raw) {
                    if (item != null) {
                        String pathStr = item.toString().trim();
                        if (!pathStr.isEmpty()) {
                            files.add(Paths.get(pathStr));
                        }
                    }
                }
            }
        }

        if (files.isEmpty()) {
            files = vaultWatchService.drainQueue();
        }

        if (files.isEmpty()) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("status", "error");
            empty.put("message", "No files to ingest (queue empty, no filePaths in body)");
            return ResponseEntity.badRequest().body(empty);
        }

        log.info("[Wiki] trigger-batch invoked with {} file(s)", files.size());
        Map<String, Object> stats = batchIngestService.ingestBatch(files);
        return ResponseEntity.ok(stats);
    }

    /**
     * 快速入库：粘贴文本 / 提交 URL → 生成 source 页 → 复用批量编译管道。
     * <p>
     * 对标 KaaS 借鉴项 5.4（多来源直进 Wiki 编译管道）。
     * 请求体中 {@code content} 为原始文本，{@code url} 为来源地址（可选），
     * {@code title} 为文件名（可选，默认取时间戳）。
     * 写入 source 页后立即调用 {@link BatchIngestService#ingestBatch} 单文件编译，
     * 并复用增量编译去重（同一内容二次提交会自动跳过 AI 重编）。
     * </p>
     *
     * @param body 请求体 {@code {content, url?, title?}}
     * @return 入库统计 Map
     */
    @PostMapping("/quick")
    public ResponseEntity<Map<String, Object>> quickIngest(@RequestBody Map<String, Object> body) {
        Map<String, Object> result = new LinkedHashMap<>();
        String content = body != null ? (String) body.get("content") : null;
        String url = body != null ? (String) body.get("url") : null;
        String title = body != null ? (String) body.get("title") : null;

        if (content == null || content.trim().isEmpty()) {
            result.put("status", "error");
            result.put("message", "content is required (paste text or leave URL note)");
            return ResponseEntity.badRequest().body(result);
        }

        try {
            // 1. 生成 source 页文件（带 frontmatter：source URL + title）
            Path sourcesDir = Paths.get(wikiConfig.getVaultPath())
                    .resolve(wikiConfig.getSourcesDirName());
            if (!Files.exists(sourcesDir)) {
                Files.createDirectories(sourcesDir);
            }
            String safeTitle = sanitizeForFilename(title, LocalDateTime.now()
                    .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")));
            Path sourceFile = sourcesDir.resolve(safeTitle + ".md");
            // 避免覆盖已存在文件：追加序号
            int n = 1;
            while (Files.exists(sourceFile)) {
                sourceFile = sourcesDir.resolve(safeTitle + "-" + (n++) + ".md");
            }

            StringBuilder md = new StringBuilder();
            md.append("---\n");
            if (url != null && !url.trim().isEmpty()) {
                md.append("source: ").append(url.trim()).append("\n");
            }
            md.append("title: ").append(safeTitle).append("\n");
            md.append("date: ").append(LocalDateTime.now().toLocalDate()).append("\n");
            md.append("tag: wiki-quick\n");
            md.append("---\n\n");
            md.append(content.trim()).append("\n");
            Files.writeString(sourceFile, md.toString(), StandardCharsets.UTF_8);
            log.info("[Wiki] Quick-ingest wrote source file: {}", sourceFile);

            // 2. 复用批量编译管道（单文件）
            Map<String, Object> stats = batchIngestService.ingestBatch(List.of(sourceFile));

            // 3. 标记为已处理并补齐统计
            vaultWatchService.markAsProcessed(sourceFile);
            result.put("status", "success");
            result.put("sourceFile", sourceFile.toString());
            result.putAll(stats);
            return ResponseEntity.ok(result);
        } catch (IOException e) {
            log.error("[Wiki] Quick-ingest failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Quick ingest failed: " + e.getMessage());
            return ResponseEntity.ok(result);
        }
    }

    /**
     * 将标题清理为合法文件名片段。
     *
     * @param title   原始标题
     * @param fallback 标题为空时使用的默认值
     * @return 合法文件名
     */
    private String sanitizeForFilename(String title, String fallback) {
        if (title == null || title.trim().isEmpty()) {
            return fallback;
        }
        String t = title.trim().replaceAll("[\\\\/:*?\"<>|]", "_");
        if (t.length() > 60) {
            t = t.substring(0, 60);
        }
        return t;
    }
}
