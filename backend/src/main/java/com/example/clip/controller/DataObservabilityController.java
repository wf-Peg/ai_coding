package com.example.clip.controller;

import com.example.clip.index.ActionEvent;
import com.example.clip.index.ActionEventService;
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.HabitProfile;
import com.example.clip.index.HabitProfileService;
import com.example.clip.index.Workspace;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceMembership;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.ExceptionLogService;
import com.example.clip.service.FileStorageService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/data")
@CrossOrigin(origins = "*")
public class DataObservabilityController {
    private final AppConfigService appConfigService;
    private final FileStorageService fileStorageService;
    private final ExceptionLogService exceptionLogService;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public DataObservabilityController(AppConfigService appConfigService, FileStorageService fileStorageService,
                                       ExceptionLogService exceptionLogService) {
        this.appConfigService = appConfigService;
        this.fileStorageService = fileStorageService;
        this.exceptionLogService = exceptionLogService;
    }

    @GetMapping("/overview")
    public ResponseEntity<Map<String, Object>> overview() {
        Path indexDir = indexDir();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("indexDirectory", indexDir.toString());
        result.put("contentIndex", fileInfo(indexDir.resolve("content-index.json"), "array"));
        result.put("relationIndex", fileInfo(indexDir.resolve("relation-index.json"), "array"));
        result.put("projects", fileInfo(indexDir.resolve("projects.json"), "array"));
        result.put("memberships", fileInfo(indexDir.resolve("project-memberships.json"), "array"));
        result.put("actionEvents", fileInfo(indexDir.resolve("action-events.jsonl"), "jsonl"));
        result.put("observedAt", LocalDateTime.now());
        return ResponseEntity.ok(result);
    }

    @GetMapping("/habits")
    public ResponseEntity<Map<String, Object>> habits() {
        ActionEventService eventService = new ActionEventService(indexDir().resolve("action-events.jsonl"));
        List<ActionEvent> events = eventService.readAll();
        HabitProfile profile = new HabitProfileService().aggregate(events);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("eventCount", events.size());
        result.put("skippedLineCount", eventService.skippedLineCount());
        result.put("categories", sorted(profile.categories()));
        result.put("tags", sorted(profile.tags()));
        result.put("directories", sorted(profile.directories()));
        result.put("actions", sorted(profile.actions()));
        result.put("recentEvents", events.stream().sorted(Comparator.comparing(ActionEvent::createdAt,
                        Comparator.nullsLast(Comparator.reverseOrder()))).limit(12).toList());
        return ResponseEntity.ok(result);
    }

    @GetMapping("/insights")
    public ResponseEntity<Map<String, Object>> insights() {
        List<ActionEvent> events = new ActionEventService(indexDir().resolve("action-events.jsonl")).readAll();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("eventCount", events.size());
        result.put("activeDays", events.stream().filter(event -> event.createdAt() != null)
                .map(event -> event.createdAt().toLocalDate()).distinct().count());
        result.put("latestEventAt", events.stream().map(ActionEvent::createdAt).filter(value -> value != null)
                .max(LocalDateTime::compareTo).orElse(null));
        result.put("message", events.isEmpty() ? "开始使用后，这里会逐步形成你的整理习惯。" : "这些统计只用于本地整理建议，不会自动修改你的内容。");
        return ResponseEntity.ok(result);
    }

    @GetMapping("/trends")
    public ResponseEntity<Map<String, Object>> trends() {
        List<ActionEvent> events = new ActionEventService(indexDir().resolve("action-events.jsonl")).readAll();
        LocalDate now = LocalDate.now();
        LocalDate weekAgo = now.minusDays(7);
        LocalDate monthAgo = now.minusDays(30);

        Map<String, Long> typeDistribution = new LinkedHashMap<>();
        Map<String, Long> dailyCount7d = new LinkedHashMap<>();
        Map<String, Long> dailyCount30d = new LinkedHashMap<>();
        List<String> sources = new ArrayList<>();

        for (ActionEvent event : events) {
            if (event.createdAt() == null) continue;
            LocalDate day = event.createdAt().toLocalDate();
            typeDistribution.merge(event.type(), 1L, Long::sum);
            if (!day.isBefore(weekAgo)) {
                dailyCount7d.merge(day.toString(), 1L, Long::sum);
            }
            if (!day.isBefore(monthAgo)) {
                dailyCount30d.merge(day.toString(), 1L, Long::sum);
            }
            if (event.source() != null && !event.source().isBlank()) {
                sources.add(event.source());
            }
        }

        Map<String, Long> sourceDistribution = new LinkedHashMap<>();
        for (String s : sources) {
            sourceDistribution.merge(s, 1L, Long::sum);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("eventCount", events.size());
        result.put("count7d", dailyCount7d.values().stream().mapToLong(Long::longValue).sum());
        result.put("count30d", dailyCount30d.values().stream().mapToLong(Long::longValue).sum());
        result.put("typeDistribution", sorted(typeDistribution));
        result.put("dailyCount7d", fillMissingDays(dailyCount7d, weekAgo, now));
        result.put("dailyCount30d", fillMissingDays(dailyCount30d, monthAgo, now));
        result.put("sourceDistribution", sorted(sourceDistribution));
        return ResponseEntity.ok(result);
    }

    @GetMapping("/workspace-stats")
    public ResponseEntity<Map<String, Object>> workspaceStats() {
        Path indexDir = indexDir();
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            WorkspaceIndexService wsService = new WorkspaceIndexService(indexDir);
            List<Workspace> workspaces = wsService.readAll();
            result.put("workspaceCount", workspaces.size());

            long activeCount = workspaces.stream().filter(w -> "active".equals(w.status())).count();
            long archivedCount = workspaces.stream().filter(w -> "archived".equals(w.status())).count();
            result.put("activeCount", activeCount);
            result.put("archivedCount", archivedCount);

            // 统计所有成员关系的来源分布
            Path membershipPath = indexDir.resolve("workspace-memberships.json");
            List<WorkspaceMembership> allMembers = readMemberships(membershipPath);
            Map<String, Long> sourceDist = new LinkedHashMap<>();
            for (WorkspaceMembership m : allMembers) {
                sourceDist.merge(m.source(), 1L, Long::sum);
            }
            result.put("membershipSourceDistribution", sorted(sourceDist));

            // 统计所有工作台的规则/排除数量
            Path rulesPath = indexDir.resolve("workspace-rules.json");
            Path exclusionsPath = indexDir.resolve("workspace-exclusions.json");
            result.put("totalRules", countLines(rulesPath));
            result.put("totalExclusions", countLines(exclusionsPath));

            result.put("observedAt", LocalDateTime.now());
        } catch (Exception e) {
            result.put("workspaceCount", 0);
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/prune")
    public ResponseEntity<Map<String, Object>> pruneEvents(
            @RequestParam(defaultValue = "90") int days) {
        ActionEventService eventService = new ActionEventService(indexDir().resolve("action-events.jsonl"));
        LocalDateTime cutoff = LocalDateTime.now().minusDays(days);
        int before = eventService.readAll().size();
        eventService.pruneBefore(cutoff);
        int after = eventService.readAll().size();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("removed", before - after);
        result.put("remaining", after);
        result.put("cutoff", cutoff.toString());
        result.put("message", "已清理 " + (before - after) + " 条 " + days + " 天前的事件");
        return ResponseEntity.ok(result);
    }

    @GetMapping("/export-diagnosis")
    public ResponseEntity<Map<String, Object>> exportDiagnosis() {
        Path indexDir = indexDir();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exportedAt", LocalDateTime.now());
        result.put("indexDirectory", indexDir.toString());
        result.put("files", List.of(
                diagFileInfo("content-index.json", "array"),
                diagFileInfo("relation-index.json", "array"),
                diagFileInfo("projects.json", "array"),
                diagFileInfo("project-memberships.json", "array"),
                diagFileInfo("workspace.json", "array"),
                diagFileInfo("workspace-memberships.json", "array"),
                diagFileInfo("workspace-rules.json", "array"),
                diagFileInfo("workspace-exclusions.json", "array"),
                diagFileInfo("workspace-columns.json", "array"),
                diagFileInfo("action-events.jsonl", "jsonl")));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/rebuild")
    public ResponseEntity<Map<String, Object>> rebuild() {
        ContentIndexService indexService = new ContentIndexService(indexDir().resolve("content-index.json"));
        indexService.rebuildFromStorage(fileStorageService);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("count", indexService.readAll().size());
        result.put("message", "内容索引已重建");
        return ResponseEntity.ok(result);
    }

    // ===== 异常日志 API =====

    /**
     * 查询异常日志（分页 + 筛选）
     */
    @GetMapping("/exception-logs")
    public ResponseEntity<Map<String, Object>> queryExceptionLogs(
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String level,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(exceptionLogService.queryLogs(date, source, level, page, size));
    }

    /**
     * 获取异常日志统计信息
     */
    @GetMapping("/exception-logs/stats")
    public ResponseEntity<Map<String, Object>> exceptionLogStats() {
        return ResponseEntity.ok(exceptionLogService.getStats());
    }

    /**
     * 接收前端/Electron 上报的异常
     */
    @PostMapping("/exception-logs")
    public ResponseEntity<Map<String, Object>> reportExceptionLog(@RequestBody Map<String, String> body) {
        String source = body.getOrDefault("source", "frontend");
        String sourceDetail = body.getOrDefault("sourceDetail", "");
        String message = body.getOrDefault("message", "");
        String stackTrace = body.getOrDefault("stackTrace", "");
        String level = body.getOrDefault("level", "ERROR");
        String thread = body.getOrDefault("thread", "");
        String requestUri = body.getOrDefault("requestUri", "");
        exceptionLogService.record(source, sourceDetail, message, stackTrace, level, thread, requestUri);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("message", "异常已记录");
        return ResponseEntity.ok(result);
    }

    /**
     * 清理异常日志
     */
    @DeleteMapping("/exception-logs")
    public ResponseEntity<Map<String, Object>> pruneExceptionLogs(
            @RequestParam(defaultValue = "90") int days) {
        return ResponseEntity.ok(exceptionLogService.pruneLogs(days));
    }

    private Path indexDir() {
        return Path.of(appConfigService.getConfigDirPath(), "index");
    }

    private Map<String, Object> fileInfo(Path path, String format) {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("exists", Files.exists(path));
        info.put("format", format);
        info.put("count", count(path, format));
        try {
            info.put("updatedAt", Files.exists(path)
                    ? Files.getLastModifiedTime(path).toInstant().atZone(ZoneId.systemDefault()).toLocalDateTime()
                    : null);
            info.put("sizeBytes", Files.exists(path) ? Files.size(path) : 0);
        } catch (IOException error) {
            info.put("updatedAt", null);
            info.put("sizeBytes", 0);
        }
        return info;
    }

    private Map<String, Object> diagFileInfo(String name, String format) {
        Path path = indexDir().resolve(name);
        Map<String, Object> info = fileInfo(path, format);
        info.put("name", name);
        info.put("path", path.toString());
        return info;
    }

    private int count(Path path, String format) {
        if (!Files.exists(path)) return 0;
        try {
            if ("jsonl".equals(format)) {
                try (var lines = Files.lines(path)) {
                    return (int) lines.filter(line -> !line.isBlank()).count();
                }
            }
            List<?> values = objectMapper.readValue(path.toFile(), new TypeReference<List<Object>>() {});
            return values.size();
        } catch (IOException error) {
            return 0;
        }
    }

    private long countLines(Path path) {
        if (!Files.exists(path)) return 0;
        try {
            return objectMapper.readValue(path.toFile(), new TypeReference<List<?>>() {}).size();
        } catch (IOException error) {
            return 0;
        }
    }

    private Map<String, Long> sorted(Map<String, Long> values) {
        Map<String, Long> result = new LinkedHashMap<>();
        values.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(8).forEach(entry -> result.put(entry.getKey(), entry.getValue()));
        return result;
    }

    private List<WorkspaceMembership> readMemberships(Path path) {
        if (!Files.exists(path)) return List.of();
        try {
            List<WorkspaceMembership> values = objectMapper.readValue(path.toFile(), new TypeReference<List<WorkspaceMembership>>() {});
            return values == null ? List.of() : values;
        } catch (IOException error) {
            return List.of();
        }
    }

    private Map<String, Long> fillMissingDays(Map<String, Long> daily, LocalDate start, LocalDate end) {
        Map<String, Long> result = new LinkedHashMap<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            result.put(d.toString(), daily.getOrDefault(d.toString(), 0L));
        }
        return result;
    }
}