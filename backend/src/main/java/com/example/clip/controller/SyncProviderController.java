package com.example.clip.controller;

import com.example.clip.service.sync.SyncProvider;
import com.example.clip.service.sync.SyncProviderRegistry;
import com.example.clip.service.sync.SyncResult;
import com.example.clip.service.sync.SyncStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 同步/备份方案 REST 控制器。
 * <p>
 * 以 {@code /api/sync-provider} 为前缀，为「同步状态」面板提供统一的方案元信息
 * 与操作入口。方案由 {@link SyncProviderRegistry} 动态发现，新增方案无需改本控制器逻辑。
 * <p>
 * <b>命名说明</b>：不使用 {@code /api/sync} 前缀，因其已被 Web Clipper 同步占用。
 * </p>
 *
 * @see SyncProvider
 * @see SyncProviderRegistry
 */
@RestController
@RequestMapping("/api/sync-provider")
@CrossOrigin(origins = "*")  // 允许所有来源的跨域请求，包括浏览器扩展
public class SyncProviderController {

    private static final Logger log = LoggerFactory.getLogger(SyncProviderController.class);

    /** 同步/备份方案注册表 */
    private final SyncProviderRegistry registry;

    public SyncProviderController(SyncProviderRegistry registry) {
        this.registry = registry;
    }

    /**
     * 获取全部可用同步/备份方案元信息。
     * <p>
     * GET /api/sync-provider/providers
     * 返回 {@code [{type, displayName, configured, ready}]}，供面板动态渲染「同步方案」区；
     * 未来新增方案会自动出现在数组中。
     * </p>
     *
     * @return 方案元信息列表
     */
    @GetMapping("/providers")
    public ResponseEntity<List<Map<String, Object>>> listProviders() {
        log.info("[API] /sync-provider/providers called");
        List<Map<String, Object>> result = new ArrayList<>();
        for (SyncProvider p : registry.list()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("type", p.getType());
            item.put("displayName", p.getDisplayName());
            item.put("configured", p.isConfigured());
            item.put("ready", p.isReady());
            result.add(item);
        }
        return ResponseEntity.ok(result);
    }

    /**
     * 获取指定同步方案的当前状态（面板数据来源）。
     * <p>
     * GET /api/sync-provider/{type}/status
     * </p>
     *
     * @param type 方案类型（如 "git"）
     * @return 方案状态快照
     */
    @GetMapping("/{type}/status")
    public ResponseEntity<?> getStatus(@PathVariable String type) {
        log.info("[API] /sync-provider/{}/status called", type);
        SyncProvider provider = registry.getByType(type);
        if (provider == null) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "message", "未知的同步方案: " + type));
        }
        return ResponseEntity.ok(provider.getStatus());
    }

    /**
     * 执行指定方案的一次同步。
     * <p>
     * POST /api/sync-provider/{type}/sync
     * 返回统一 {@code ok/steps/message}。
     * </p>
     *
     * @param type 方案类型（如 "git"）
     * @return 同步结果
     */
    @PostMapping("/{type}/sync")
    public ResponseEntity<?> sync(@PathVariable String type) {
        log.info("[API] /sync-provider/{}/sync called", type);
        SyncProvider provider = registry.getByType(type);
        if (provider == null) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "message", "未知的同步方案: " + type));
        }
        SyncResult result = provider.sync();
        return result.isOk() ? ResponseEntity.ok(result) : ResponseEntity.badRequest().body(result);
    }

    /**
     * 测试指定方案的连接/可用性。
     * <p>
     * POST /api/sync-provider/{type}/test-connection
     * </p>
     *
     * @param type 方案类型（如 "git"）
     * @return 测试结果
     */
    @PostMapping("/{type}/test-connection")
    public ResponseEntity<?> testConnection(@PathVariable String type) {
        log.info("[API] /sync-provider/{}/test-connection called", type);
        SyncProvider provider = registry.getByType(type);
        if (provider == null) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "message", "未知的同步方案: " + type));
        }
        SyncResult result = provider.testConnection();
        return result.isOk() ? ResponseEntity.ok(result) : ResponseEntity.badRequest().body(result);
    }
}