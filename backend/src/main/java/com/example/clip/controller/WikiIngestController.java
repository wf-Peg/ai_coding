package com.example.clip.controller;

import com.example.clip.config.WikiConfig;
import com.example.clip.service.wiki.VaultWatchService;
import com.example.clip.service.wiki.WikiIngestJobService;
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
 *   <li>{@code POST /api/wiki/ingest/trigger} — 手动触发批量入库（drain 队列全部），异步返回 jobId</li>
 *   <li>{@code POST /api/wiki/ingest/trigger-batch} — 触发指定文件列表入库（请求体可选 filePaths），异步返回 jobId</li>
 *   <li>{@code POST /api/wiki/ingest/quick} — 快速入库（粘贴文本/URL），异步返回 jobId</li>
 *   <li>{@code GET  /api/wiki/ingest/jobs/{jobId}} — 轮询入库任务状态与统计</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/wiki/ingest")
@CrossOrigin(origins = "*")
public class WikiIngestController {

    private static final Logger log = LoggerFactory.getLogger(WikiIngestController.class);

    private final VaultWatchService vaultWatchService;
    private final WikiConfig wikiConfig;
    private final WikiIngestJobService ingestJobService;

    /**
     * 构造器注入。
     *
     * @param vaultWatchService  Vault 监视服务
     * @param wikiConfig         Wiki 配置
     * @param ingestJobService   入库异步任务服务
     */
    public WikiIngestController(VaultWatchService vaultWatchService,
                                WikiConfig wikiConfig,
                                WikiIngestJobService ingestJobService) {
        this.vaultWatchService = vaultWatchService;
        this.wikiConfig = wikiConfig;
        this.ingestJobService = ingestJobService;
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
     * 手动触发批量入库：排空当前队列中的所有文件并提交异步任务。
     * <p>
     * 立即返回 jobId（HTTP 202），实际入库在后台 worker 串行执行，
     * 通过 {@code GET /api/wiki/ingest/jobs/{jobId}} 轮询进度。
     * 若队列为空，返回 400 错误。
     * </p>
     *
     * @return {@code {status:"queued", jobId, queueSize}}
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
        String jobId = ingestJobService.submit(drained, "manual-trigger");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "queued");
        result.put("jobId", jobId);
        result.put("queueSize", drained.size());
        result.put("message", "Ingest queued (" + drained.size()
                + " file(s)), poll GET /api/wiki/ingest/jobs/" + jobId);
        return ResponseEntity.accepted().body(result);
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
        String jobId = ingestJobService.submit(files, "trigger-batch");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "queued");
        result.put("jobId", jobId);
        result.put("queueSize", files.size());
        result.put("message", "Ingest queued (" + files.size()
                + " file(s)), poll GET /api/wiki/ingest/jobs/" + jobId);
        return ResponseEntity.accepted().body(result);
    }

    /**
     * 快速入库：粘贴文本 / 提交 URL → 生成 source 页 → 提交异步编译任务。
     * <p>
     * 对标 KaaS 借鉴项 5.4（多来源直进 Wiki 编译管道）。
     * 请求体中 {@code content} 为原始文本，{@code url} 为来源地址（可选），
     * {@code title} 为文件名（可选，默认取时间戳）。
     * 写入 source 页后立即提交单文件编译任务并返回 jobId（HTTP 202），
     * 复用增量编译去重（同一内容二次提交会自动跳过 AI 重编），
     * 进度通过 {@code GET /api/wiki/ingest/jobs/{jobId}} 轮询。
     * source 页的已处理标记由后台任务完成后写入，避免排队期间
     * 后端重启导致未编译文件被误标记。
     * </p>
     *
     * @param body 请求体 {@code {content, url?, title?}}
     * @return {@code {status:"queued", jobId, sourceFile}}
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
            // 1. 生成 source 页文件（带 frontmatter：source URL + title）——同步快路径
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

            // 2. 提交异步编译任务（单文件），立即返回 jobId
            String jobId = ingestJobService.submit(List.of(sourceFile), "quick");
            result.put("status", "queued");
            result.put("jobId", jobId);
            result.put("sourceFile", sourceFile.toString());
            result.put("message", "Quick ingest queued, poll GET /api/wiki/ingest/jobs/" + jobId);
            return ResponseEntity.accepted().body(result);
        } catch (IOException e) {
            log.error("[Wiki] Quick-ingest failed: {}", e.getMessage(), e);
            result.put("status", "error");
            result.put("message", "Quick ingest failed: " + e.getMessage());
            return ResponseEntity.ok(result);
        }
    }

    /**
     * 查询入库任务状态。
     * <p>
     * 返回 job 状态机（queued/running/completed/failed）与完成后统计。
     * 后端重启后内存 job 表清空，返回 404。
     * </p>
     *
     * @param jobId 入库任务 ID
     * @return job 状态视图；不存在返回 404
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<Map<String, Object>> getJobStatus(@PathVariable String jobId) {
        Map<String, Object> job = ingestJobService.getJob(jobId);
        if (job == null) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("status", "not_found");
            err.put("message", "Ingest job not found: " + jobId + " (may have expired or backend restarted)");
            return ResponseEntity.status(404).body(err);
        }
        return ResponseEntity.ok(job);
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
