package com.example.clip.controller;

import com.example.clip.service.wiki.BatchIngestService;
import com.example.clip.service.wiki.VaultWatchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;
import java.nio.file.Paths;
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

    /**
     * 构造器注入。
     *
     * @param batchIngestService 批量入库服务
     * @param vaultWatchService  Vault 监视服务
     */
    public WikiIngestController(BatchIngestService batchIngestService,
                                VaultWatchService vaultWatchService) {
        this.batchIngestService = batchIngestService;
        this.vaultWatchService = vaultWatchService;
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
}
