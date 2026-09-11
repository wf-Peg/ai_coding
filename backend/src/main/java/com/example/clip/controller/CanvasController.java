package com.example.clip.controller;

import com.example.clip.service.CanvasStateService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 无限画布·状态同步 REST API 控制器。
 * <p>
 * 提供手动画布数据的后端读写：
 * <ul>
 *   <li>GET  /api/canvas  读取全量快照（画布节点/连线/坐标/分组）</li>
 *   <li>POST /api/canvas  覆盖写入全量快照（由 Electron 端组装，服务端不做字段级合并）</li>
 * </ul>
 * 不含语义关系（relation），relation 由本地文件扫描重建。
 * </p>
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CanvasController {

    private final CanvasStateService canvasStateService;

    public CanvasController(CanvasStateService canvasStateService) {
        this.canvasStateService = canvasStateService;
    }

    /** 读取画布状态全量快照。 */
    @GetMapping("/canvas")
    public ResponseEntity<Map<String, Object>> getCanvas() {
        return ResponseEntity.ok(canvasStateService.readState());
    }

    /**
     * 覆盖写入画布状态快照。
     *
     * @param snapshot 快照体，需含 updatedAt；Electron 侧组装 nodes/edges/layout/groups
     */
    @PostMapping("/canvas")
    public ResponseEntity<Map<String, Object>> postCanvas(@RequestBody Map<String, Object> snapshot) {
        Object updatedAt = snapshot == null ? null : snapshot.get("updatedAt");
        if (snapshot == null || updatedAt == null || String.valueOf(updatedAt).isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "updatedAt 不能为空"));
        }
        canvasStateService.writeState(snapshot);
        return ResponseEntity.ok(Map.of("status", "success", "updatedAt", String.valueOf(updatedAt)));
    }
}