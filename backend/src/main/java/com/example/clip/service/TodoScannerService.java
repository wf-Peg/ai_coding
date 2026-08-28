package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * TODO 目录扫描服务 —— 已退役（保留占位以防历史引用）。
 * <p>
 * 本服务曾在启动时扫描 TODO 目录下 feature-points.json 的 v1 格式
 * （requirement/clips/todos/config），把剪藏与待办导入 ClipService / TodoService。
 * 该机制已被产品架构演进取代，正式退役：
 * </p>
 * <ul>
 *   <li>feature-points.json 现为 v2.0（requirement/featurePoints/knowledgePoints），
 *       由 {@link FeaturePointsService} 直读并经 GET /api/workspace/feature-points
 *       服务产品概览页，不再导入剪藏/待办；</li>
 *   <li>剪藏/待办落库走 REST API（MCP 桥 clip_add / todo_add / todo_set_status）；</li>
 *   <li>DSH 会话成果经 FeaturePointIterationService 落库为迭代记录。</li>
 * </ul>
 * {@link #scanAndImport()} 现为无操作（返回空结果）且无任何调用方，请勿再尝试恢复本扫描器。
 */
@Service
@Deprecated
public class TodoScannerService {

    private static final Logger log = LoggerFactory.getLogger(TodoScannerService.class);

    private static final String FEATURE_POINTS_FILE = "feature-points.json";
    private static final String IMPORTED_MARKER = ".imported";
    private static final String PRODUCT_DEV_TAG = "product-dev";

    private final Path todoDir;
    private final ClipService clipService;
    private final TodoService todoService;
    private final AppConfigService appConfigService;
    private final ObjectMapper objectMapper;

    /**
     * 构造函数（生产环境）：使用 application.yml 中配置的 product-dev.todo-dir 路径。
     * <p>
     * TODO 目录由配置项 {@code product-dev.todo-dir} 指定，默认值 {@code ./TODO}。
     * 该路径与 product-dev-archive skill 写入的 feature-points.json 目录一致，
     * 确保扫描服务能正确导入产品开发工作台的数据。
     * </p>
     */
    @Autowired
    public TodoScannerService(
            ClipService clipService,
            TodoService todoService,
            AppConfigService appConfigService,
            @Value("${product-dev.todo-dir:./TODO}") String todoDirPath) {
        this.clipService = clipService;
        this.todoService = todoService;
        this.appConfigService = appConfigService;
        this.todoDir = Paths.get(todoDirPath).toAbsolutePath().normalize();
        this.objectMapper = new ObjectMapper();
        log.info("[TodoScannerService] TODO 目录: {}（基于配置 product-dev.todo-dir: {}）", this.todoDir, todoDirPath);
    }

    /**
     * 构造函数（测试用）：直接指定 TODO 目录路径。
     * <p>
     * 仅用于单元测试，允许传入自定义的 TODO 根目录。
     * </p>
     */
    TodoScannerService(
            ClipService clipService,
            TodoService todoService,
            String todoDirPath) {
        this.clipService = clipService;
        this.todoService = todoService;
        this.appConfigService = null;
        this.todoDir = Paths.get(todoDirPath).toAbsolutePath().normalize();
        this.objectMapper = new ObjectMapper();
        log.info("[TodoScannerService] 测试构造 TODO 目录: {}", this.todoDir);
    }

    /**
     * 扫描并导入 TODO 目录（已退役，无操作）。
     * <p>
     * 历史实现已随产品架构演进移除：feature-points.json 改由
     * {@link FeaturePointsService} 直读服务产品概览，剪藏/待办走 REST API 落库。
     * 保留本法仅供潜在历史调用方兼容，恒返回空结果。
     *
     * @return 空导入结果摘要
     */
    public ScanResult scanAndImport() {
        log.info("[TodoScannerService] 扫描器已退役，不再扫描 TODO 目录");
        return new ScanResult(0, 0, 0, 0, 0, List.of());
    }

    // ---- 辅助方法 ----

    /** 从 md 内容中截取指定章节；section 为空时返回全文 */
    private String readSection(String fullContent, String section) {
        if (section == null || section.isBlank() || fullContent == null) {
            return fullContent;
        }
        String marker = section.trim();
        int idx = fullContent.indexOf(marker);
        if (idx < 0) {
            // 章节未找到时降级为全文
            log.warn("[TodoScannerService] 章节未找到，降级为全文: {}", marker);
            return fullContent;
        }
        int nextHeading = fullContent.indexOf("\n## ", idx + marker.length());
        if (nextHeading < 0) {
            return fullContent.substring(idx);
        }
        return fullContent.substring(idx, nextHeading);
    }

    private static String str(Object value, String defaultValue) {
        return value == null ? defaultValue : String.valueOf(value);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapOf(Object value) {
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }
        return Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<String> strList(Object value) {
        if (value instanceof List) {
            return (List<String>) value;
        }
        return List.of();
    }

    /** requirement 元信息（spec 中为对象，这里安全解析） */
    private record RequirementMeta(String title, String summary, List<String> tags, String phase) {
        static RequirementMeta parse(Object raw, String dirName) {
            Map<String, Object> map = mapOf(raw);
            String title = str(map.get("title"), dirName);
            String summary = str(map.get("summary"), "");
            String phase = str(map.get("phase"), "completed");
            List<String> tags = strList(map.get("tags"));
            return new RequirementMeta(title, summary, tags, phase);
        }
    }

    /** 导入标记：记录导入时间与已处理的功能点 id，用于增量导入 */
    private static class ImportMarker {
        private String importedAt;
        private final Set<String> featurePointIds;

        ImportMarker(String importedAt, Set<String> featurePointIds) {
            this.importedAt = importedAt;
            this.featurePointIds = featurePointIds == null ? new LinkedHashSet<>() : featurePointIds;
        }

        static ImportMarker read(Path markerPath, ObjectMapper objectMapper) {
            if (!Files.exists(markerPath)) {
                return new ImportMarker(null, new LinkedHashSet<>());
            }
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> map = objectMapper.readValue(markerPath.toFile(), Map.class);
                String importedAt = str(map.get("importedAt"), null);
                @SuppressWarnings("unchecked")
                List<String> ids = (List<String>) map.get("featurePointIds");
                return new ImportMarker(importedAt, ids == null ? new LinkedHashSet<>() : new LinkedHashSet<>(ids));
            } catch (IOException | RuntimeException e) {
                log.warn("[TodoScannerService] .imported 解析失败，视为全新导入: {} ({})", markerPath, e.getMessage());
                return new ImportMarker(null, new LinkedHashSet<>());
            }
        }

        boolean contains(String id) {
            return featurePointIds.contains(id);
        }

        void add(String id) {
            featurePointIds.add(id);
        }

        void importedAt(String value) {
            this.importedAt = value;
        }

        void write(Path markerPath, ObjectMapper objectMapper) throws IOException {
            Map<String, Object> map = Map.of(
                    "importedAt", importedAt == null ? LocalDateTime.now().toString() : importedAt,
                    "featurePointIds", new ArrayList<>(featurePointIds)
            );
            Files.createDirectories(markerPath.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(markerPath.toFile(), map);
        }
    }

    /**
     * 扫描结果
     */
    public record ScanResult(
            int dirsScanned,
            int dirsImported,
            int dirsSkipped,
            int clipsCreated,
            int todosCreated,
            List<String> errors
    ) {
        @Override
        public String toString() {
            return String.format("扫描=%d 导入=%d 跳过=%d 剪藏=%d 待办=%d 错误=%d",
                    dirsScanned, dirsImported, dirsSkipped, clipsCreated, todosCreated, errors.size());
        }
    }
}
