package com.example.clip.controller;

import com.example.clip.index.ActionEvent;
import com.example.clip.index.ActionEventService;
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.HabitProfile;
import com.example.clip.index.HabitProfileService;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.FileStorageService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/data")
@CrossOrigin(origins = "*")
public class DataObservabilityController {
    private final AppConfigService appConfigService;
    private final FileStorageService fileStorageService;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public DataObservabilityController(AppConfigService appConfigService, FileStorageService fileStorageService) {
        this.appConfigService = appConfigService;
        this.fileStorageService = fileStorageService;
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
        List<ActionEvent> events = new ActionEventService(indexDir().resolve("action-events.jsonl")).readAll();
        HabitProfile profile = new HabitProfileService().aggregate(events);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("eventCount", events.size());
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

    private Map<String, Long> sorted(Map<String, Long> values) {
        Map<String, Long> result = new LinkedHashMap<>();
        values.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(8).forEach(entry -> result.put(entry.getKey(), entry.getValue()));
        return result;
    }
}
