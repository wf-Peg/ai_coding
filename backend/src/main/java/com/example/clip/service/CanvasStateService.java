package com.example.clip.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 无限画布·后端状态持久化服务。
 * <p>
 * 把用户「手动画布层」（canvas_node / canvas_edge / canvas_layout / canvas_group /
 * canvas_group_member）以全量快照 JSON 的形式存到 {@code clip.storage.path/graph/canvas-state.json}。
 * 符合项目「文件为真、库为缓存」风格；不做字段级合并（合并/ last-write-wins 归 Electron 端）。
 * </p>
 */
@Service
public class CanvasStateService {

    private static final Logger log = LoggerFactory.getLogger(CanvasStateService.class);
    private static final String FILE_NAME = "canvas-state.json";
    private static final String DEFAULT_SNAPSHOT_VERSION = "1";

    private final ObjectMapper objectMapper;
    private final Path graphDir;

    public CanvasStateService(FileStorageService storageService) {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        // LocalDateTime 以 ISO 字符串落盘（而非 [y,m,d,...] 数组），避免下游原生 new Date(数组) 解析失败
        this.objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        this.graphDir = storageService.getStoragePath().resolve("graph");
    }

    /** 快照文件路径：{clip.storage.path}/graph/canvas-state.json */
    public Path getPath() {
        return graphDir.resolve(FILE_NAME);
    }

    /**
     * 读取画布状态快照。文件不存在时返回空的默认快照。
     *
     * @return { nodes:[], edges:[], layout:{}, groups:[], updatedAt:null, version:1 }
     */
    public Map<String, Object> readState() {
        Path path = getPath();
        if (!Files.exists(path)) {
            return defaultSnapshot();
        }
        try {
            String json = Files.readString(path, StandardCharsets.UTF_8);
            Map<String, Object> data = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            if (data == null) {
                return defaultSnapshot();
            }
            // 保证关键字段存在，便于前端/Electron 消费
            data.putIfAbsent("nodes", java.util.Collections.emptyList());
            data.putIfAbsent("edges", java.util.Collections.emptyList());
            data.putIfAbsent("layout", java.util.Collections.emptyMap());
            data.putIfAbsent("groups", java.util.Collections.emptyList());
            data.putIfAbsent("updatedAt", null);
            data.putIfAbsent("version", DEFAULT_SNAPSHOT_VERSION);
            return data;
        } catch (IOException e) {
            log.error("[CanvasStateService] 读取画布快照失败: {}", path, e);
            return defaultSnapshot();
        }
    }

    /**
     * 写入画布状态快照（全量覆盖，原子写）。
     */
    public void writeState(Map<String, Object> snapshot) {
        try {
            if (!Files.exists(graphDir)) {
                Files.createDirectories(graphDir);
            }
            Path path = getPath();
            // 显式 UTF-8 序列化，避免依赖 JVM 默认编码
            String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(snapshot);
            // 原子写：先写临时文件，再 move 替换，防止写中断损坏原文件
            Path tmpPath = path.resolveSibling(path.getFileName() + ".tmp");
            Files.writeString(tmpPath, json, StandardCharsets.UTF_8);
            try {
                Files.move(tmpPath, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                // 文件系统不支持原子移动时退化为普通替换
                Files.move(tmpPath, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("[CanvasStateService] 写入画布快照失败", e);
        }
    }

    private Map<String, Object> defaultSnapshot() {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("nodes", java.util.Collections.emptyList());
        snapshot.put("edges", java.util.Collections.emptyList());
        snapshot.put("layout", java.util.Collections.emptyMap());
        snapshot.put("groups", java.util.Collections.emptyList());
        snapshot.put("updatedAt", null);
        snapshot.put("version", DEFAULT_SNAPSHOT_VERSION);
        return snapshot;
    }
}