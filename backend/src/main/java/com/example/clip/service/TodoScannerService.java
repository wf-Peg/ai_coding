package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * TODO 目录扫描服务
 * <p>
 * 启动时扫描 TODO 目录下的 feature-points.json，将剪藏和待办内容导入到
 * ClipService 和 TodoService，并写入 .imported 标记避免重复导入。
 * </p>
 *
 * <h3>扫描逻辑</h3>
 * <ol>
 *   <li>遍历 TODO 目录下的所有子目录</li>
 *   <li>读取 .imported 标记（JSON：{importedAt, featurePointIds}），
 *       仅导入尚未处理过的功能点（按 featurePoints[].id 幂等去重）</li>
 *   <li>解析 feature-points.json（字段约定见 product-dev-archive SKILL.md）</li>
 *   <li>按 featurePoints 定义，将 clips 写入 ClipService，todos 写入 TodoService</li>
 *   <li>导入成功后更新 .imported 标记</li>
 * </ol>
 *
 * <h3>feature-points.json 字段约定（与 SKILL.md 对齐）</h3>
 * <ul>
 *   <li>requirement：对象，含 title/summary/tags/phase/createdAt/completedAt</li>
 *   <li>clips[]：{title, contentFile, section, category, tags}</li>
 *   <li>todos[]：{title, priority, status}（status: todo/done）</li>
 *   <li>config：{clipCategory, todoCategory, autoTag}</li>
 * </ul>
 */
@Service
public class TodoScannerService {

    private static final Logger log = LoggerFactory.getLogger(TodoScannerService.class);

    private static final String FEATURE_POINTS_FILE = "feature-points.json";
    private static final String IMPORTED_MARKER = ".imported";
    private static final String PRODUCT_DEV_TAG = "product-dev";

    private final Path todoDir;
    private final ClipService clipService;
    private final TodoService todoService;
    private final ObjectMapper objectMapper;

    public TodoScannerService(
            ClipService clipService,
            TodoService todoService,
            @Value("${product-dev.todo-dir:./TODO}") String todoDirPath) {
        this.clipService = clipService;
        this.todoService = todoService;
        this.todoDir = Paths.get(todoDirPath).toAbsolutePath().normalize();
        this.objectMapper = new ObjectMapper();
        log.info("[TodoScannerService] TODO 目录: {}", this.todoDir);
    }

    /**
     * 扫描并导入所有待处理的 TODO 目录
     *
     * @return 导入结果摘要
     */
    public ScanResult scanAndImport() {
        int dirsScanned = 0;
        int dirsImported = 0;
        int dirsSkipped = 0;
        int clipsCreated = 0;
        int todosCreated = 0;
        List<String> errors = new ArrayList<>();

        if (!Files.exists(todoDir) || !Files.isDirectory(todoDir)) {
            log.info("[TodoScannerService] TODO 目录不存在，跳过扫描: {}", todoDir);
            return new ScanResult(0, 0, 0, 0, 0, List.of());
        }

        try {
            var subDirs = Files.list(todoDir)
                    .filter(Files::isDirectory)
                    .toList();

            for (Path subDir : subDirs) {
                dirsScanned++;
                String dirName = subDir.getFileName().toString();

                // 检查 feature-points.json 是否存在
                Path fpPath = subDir.resolve(FEATURE_POINTS_FILE);
                if (!Files.exists(fpPath)) {
                    log.debug("[TodoScannerService] 无 feature-points.json，跳过目录: {}", dirName);
                    dirsSkipped++;
                    continue;
                }

                try {
                    ImportMarker marker = ImportMarker.read(subDir.resolve(IMPORTED_MARKER), objectMapper);

                    // 解析 feature-points.json
                    String json = Files.readString(fpPath);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> fp = objectMapper.readValue(json, Map.class);

                    String version = str(fp.get("version"), "1.0");
                    RequirementMeta req = RequirementMeta.parse(fp.get("requirement"), dirName);
                    Map<String, Object> config = mapOf(fp.get("config"));

                    String clipCategory = str(config.get("clipCategory"), PRODUCT_DEV_TAG);
                    String todoCategory = str(config.get("todoCategory"), PRODUCT_DEV_TAG);
                    String autoTag = str(config.get("autoTag"), PRODUCT_DEV_TAG);

                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> featurePoints = (List<Map<String, Object>>) fp.get("featurePoints");
                    if (featurePoints == null || featurePoints.isEmpty()) {
                        log.warn("[TodoScannerService] featurePoints 为空，跳过: {}", dirName);
                        dirsSkipped++;
                        continue;
                    }

                    boolean dirChanged = false;
                    // 处理每个功能点（仅处理未导入过的 id）
                    for (Map<String, Object> point : featurePoints) {
                        String pointId = str(point.get("id"), "");
                        if (!pointId.isBlank() && marker.contains(pointId)) {
                            log.debug("[TodoScannerService] 功能点已导入，跳过: {} / {}", dirName, pointId);
                            continue;
                        }

                        String pointName = str(point.get("name"), "未命名");
                        String pointDescription = str(point.get("description"), "");

                        // 处理剪藏
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> clipDefs = (List<Map<String, Object>>) point.get("clips");
                        if (clipDefs != null) {
                            for (Map<String, Object> clipDef : clipDefs) {
                                String clipFile = str(clipDef.get("contentFile"), null);
                                String clipTitle = str(clipDef.get("title"), clipFile != null ? clipFile : pointName);
                                String clipCategoryValue = str(clipDef.get("category"), clipCategory);
                                String section = str(clipDef.get("section"), null);

                                // 读取剪藏文件内容（支持按章节截取）
                                String content = "";
                                if (clipFile != null && !clipFile.isBlank()) {
                                    Path clipPath = subDir.resolve(clipFile);
                                    if (Files.exists(clipPath)) {
                                        content = readSection(Files.readString(clipPath), section);
                                    } else {
                                        log.warn("[TodoScannerService] 剪藏文件不存在: {} / {}", dirName, clipFile);
                                    }
                                }

                                // 构建标签：autoTag + requirement.tags + clipDef.tags（去重）
                                List<String> tags = new ArrayList<>();
                                tags.add(autoTag);
                                tags.addAll(req.tags());
                                tags.addAll(strList(clipDef.get("tags")));
                                Set<String> dedup = new LinkedHashSet<>(tags);
                                tags = new ArrayList<>(dedup);

                                // 创建剪藏
                                ClipContent clip = new ClipContent(content, "text", "product-dev-archive", clipCategoryValue);
                                clip.setTitle(clipTitle);
                                clip.setTags(tags);
                                clip.setSummary(pointDescription);
                                clip.setWorkflowStatus("organized");

                                ClipContent saved = clipService.saveClip(clip);
                                if (saved != null) {
                                    clipsCreated++;
                                    log.info("[TodoScannerService] 剪藏已创建: {} ({}), id={}",
                                            clipTitle, dirName, saved.getId());
                                }
                            }
                        }

                        // 处理待办
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> todoDefs = (List<Map<String, Object>>) point.get("todos");
                        if (todoDefs != null) {
                            for (Map<String, Object> todoDef : todoDefs) {
                                String todoTitle = str(todoDef.get("title"), "未命名待办");
                                String todoPriority = str(todoDef.get("priority"), "medium");
                                String status = str(todoDef.get("status"), "todo");
                                boolean completed = "done".equalsIgnoreCase(status);

                                TodoContent todo = new TodoContent();
                                todo.setTitle(todoTitle);
                                todo.setPriority(todoPriority);
                                todo.setCategory(todoCategory);
                                todo.setCompleted(completed);

                                TodoContent saved = todoService.saveTodo(todo);
                                if (saved != null) {
                                    todosCreated++;
                                    log.info("[TodoScannerService] 待办已创建: {} ({}), id={}",
                                            todoTitle, dirName, saved.getId());
                                }
                            }
                        }

                        // 该功能点已处理（无论是否产出内容），记录 id 防重复
                        if (!pointId.isBlank()) {
                            marker.add(pointId);
                            dirChanged = true;
                        }
                    }

                    // 写入 .imported 标记
                    marker.importedAt(LocalDateTime.now().toString());
                    marker.write(subDir.resolve(IMPORTED_MARKER), objectMapper);
                    dirsImported++;
                    if (dirChanged) {
                        log.info("[TodoScannerService] 目录导入完成: {}", dirName);
                    } else {
                        log.info("[TodoScannerService] 目录已全部导入过，无需更新: {}", dirName);
                    }

                } catch (IOException e) {
                    String errMsg = "导入失败: " + dirName + " - " + e.getMessage();
                    log.error("[TodoScannerService] {}", errMsg, e);
                    errors.add(errMsg);
                } catch (RuntimeException e) {
                    String errMsg = "解析失败: " + dirName + " - " + e.getMessage();
                    log.error("[TodoScannerService] {}", errMsg, e);
                    errors.add(errMsg);
                }
            }
        } catch (IOException e) {
            log.error("[TodoScannerService] 扫描 TODO 目录失败", e);
            errors.add("扫描失败: " + e.getMessage());
        }

        ScanResult result = new ScanResult(dirsScanned, dirsImported, dirsSkipped,
                clipsCreated, todosCreated, errors);
        log.info("[TodoScannerService] 扫描完成: {}", result);
        return result;
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
