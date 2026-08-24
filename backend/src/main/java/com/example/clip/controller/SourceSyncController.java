package com.example.clip.controller;

import com.example.clip.service.sync.SourceSyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Web Clipper 源文件同步 REST 控制器。
 * <p>
 * 提供手动触发同步和查看同步状态的 HTTP 接口。浏览器、前端页面或外部调度器
 * 均可调用。同步任务本身也由 {@link SourceSyncService} 内部调度器周期性执行，
 * 此控制器主要供人工干预和状态查询。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code POST /api/sync/trigger} — 手动触发一次 sources/ 目录扫描同步</li>
 *   <li>{@code GET  /api/sync/status}  — 查询当前同步状态（已同步数、待同步数等）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/sync")
@CrossOrigin(origins = "*")
public class SourceSyncController {

    private static final Logger log = LoggerFactory.getLogger(SourceSyncController.class);

    private final SourceSyncService sourceSyncService;

    /**
     * 构造器注入。
     *
     * @param sourceSyncService 源文件同步服务
     */
    @Autowired
    public SourceSyncController(SourceSyncService sourceSyncService) {
        this.sourceSyncService = sourceSyncService;
    }

    /**
     * 手动触发一次源文件同步扫描。
     * <p>
     * 立即扫描 sources/ 目录，将未同步的 .md 文件解析入库。返回同步统计信息。
     * </p>
     *
     * @return 同步结果 Map，包含 syncedCount/skippedCount/totalScanned/message
     */
    @PostMapping("/trigger")
    public ResponseEntity<Map<String, Object>> triggerSync() {
        log.info("[Sync] Manual sync triggered");
        Map<String, Object> result = sourceSyncService.syncSources();
        return ResponseEntity.ok(result);
    }

    /**
     * 查询当前同步状态。
     * <p>
     * 返回已同步文件数、待同步文件数、最近同步时间戳和 sources 目录路径。
     * </p>
     *
     * @return 状态 Map，包含 syncedCount/pendingCount/lastSyncTime/sourcesDir
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(sourceSyncService.getStatus());
    }
}
