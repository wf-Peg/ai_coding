package com.example.clip.controller;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.Project;
import com.example.clip.index.ProjectIndexService;
import com.example.clip.service.AppConfigService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/workspace")
@CrossOrigin(origins = "*")
public class WorkspaceController {
    private static final List<String> CONTENT_TYPES = List.of("clip", "knowledge", "todo", "learning-plan");

    private final AppConfigService appConfigService;

    public WorkspaceController(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    @GetMapping("/overview")
    public ResponseEntity<Map<String, Object>> overview(
            @RequestParam(required = false) List<String> types,
            @RequestParam(required = false, defaultValue = "") String query) {
        try {
            Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
            Set<String> selectedTypes = normalizeTypes(types);
            String normalizedQuery = query.trim().toLowerCase(Locale.ROOT);
            List<Map<String, Object>> contents = new ContentIndexService(indexDir.resolve("content-index.json")).readAll().stream()
                    .filter(ref -> selectedTypes.isEmpty() || selectedTypes.contains(ref.type()))
                    .filter(ref -> matches(ref, normalizedQuery))
                    .map(this::contentSummary)
                    .toList();
            List<Map<String, Object>> projects = new ProjectIndexService(indexDir).readAll().stream()
                    .map(this::projectSummary)
                    .toList();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("contents", contents);
            result.put("count", contents.size());
            result.put("contentTypes", CONTENT_TYPES);
            result.put("projects", projects);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException error) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "error");
            result.put("message", "无法读取工作台索引数据");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(result);
        }
    }

    private Set<String> normalizeTypes(List<String> types) {
        if (types == null) return Set.of();
        Set<String> selected = new LinkedHashSet<>();
        for (String type : types) {
            if (type == null) continue;
            for (String value : type.split(",")) {
                String normalized = value.trim().toLowerCase(Locale.ROOT);
                if (CONTENT_TYPES.contains(normalized)) selected.add(normalized);
            }
        }
        return selected;
    }

    private boolean matches(ContentRef ref, String query) {
        if (query.isEmpty()) return true;
        return contains(ref.id(), query)
                || contains(ref.type(), query)
                || contains(ref.title(), query)
                || contains(ref.category(), query)
                || contains(ref.sourcePath(), query)
                || ref.tags().stream().anyMatch(tag -> contains(tag, query));
    }

    private boolean contains(String value, String query) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(query);
    }

    private Map<String, Object> contentSummary(ContentRef ref) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", ref.id());
        summary.put("type", ref.type());
        summary.put("sourceId", ref.sourceId());
        summary.put("title", ref.title());
        summary.put("category", ref.category());
        summary.put("tags", ref.tags());
        summary.put("sourcePath", ref.sourcePath());
        summary.put("createdAt", ref.createdAt());
        summary.put("updatedAt", ref.updatedAt());
        return summary;
    }

    private Map<String, Object> projectSummary(Project project) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", project.id());
        summary.put("name", project.name());
        summary.put("description", project.description());
        summary.put("color", project.color());
        summary.put("status", project.status());
        summary.put("createdAt", project.createdAt());
        summary.put("updatedAt", project.updatedAt());
        return summary;
    }
}
