package com.example.clip.controller;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.Project;
import com.example.clip.index.ProjectIndexService;
import com.example.clip.index.Workspace;
import com.example.clip.index.WorkspaceExclusion;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceRule;
import com.example.clip.service.AppConfigService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

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
            Path indexDir = indexDir();
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
            return serviceUnavailable("无法读取工作台索引数据");
        }
    }

    @GetMapping("/{workspaceId}/rules")
    public ResponseEntity<?> rules(@PathVariable String workspaceId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            return ResponseEntity.ok(new WorkspaceRuleServiceView(indexDir()).rules(workspaceId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/{workspaceId}/rules")
    public ResponseEntity<?> createRule(@PathVariable String workspaceId, @RequestBody RuleRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            validate(request);
            LocalDateTime now = LocalDateTime.now();
            WorkspaceRule rule = new WorkspaceRule(UUID.randomUUID().toString(), workspaceId, request.field(),
                    request.operator(), request.value(), request.enabled(), now, now);
            new WorkspaceRuleServiceView(indexDir()).saveRule(rule);
            return ResponseEntity.status(HttpStatus.CREATED).body(rule);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/{workspaceId}/rules/{ruleId}")
    public ResponseEntity<?> updateRule(@PathVariable String workspaceId, @PathVariable String ruleId,
                                        @RequestBody RuleRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            validate(request);
            WorkspaceRuleServiceView rules = new WorkspaceRuleServiceView(indexDir());
            WorkspaceRule existing = rules.rules(workspaceId).stream()
                    .filter(rule -> rule.id().equals(ruleId))
                    .findFirst()
                    .orElseThrow(() -> new WorkspaceNotFoundException("规则不存在"));
            WorkspaceRule updated = new WorkspaceRule(ruleId, workspaceId, request.field(), request.operator(),
                    request.value(), request.enabled(), existing.createdAt(), LocalDateTime.now());
            rules.saveRule(updated);
            return ResponseEntity.ok(updated);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @DeleteMapping("/{workspaceId}/rules/{ruleId}")
    public ResponseEntity<?> deleteRule(@PathVariable String workspaceId, @PathVariable String ruleId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            WorkspaceRuleServiceView rules = new WorkspaceRuleServiceView(indexDir());
            if (rules.rules(workspaceId).stream().noneMatch(rule -> rule.id().equals(ruleId))) {
                throw new WorkspaceNotFoundException("规则不存在");
            }
            rules.removeRule(ruleId);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/{workspaceId}/exclusions")
    public ResponseEntity<?> exclusions(@PathVariable String workspaceId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            return ResponseEntity.ok(new WorkspaceRuleServiceView(indexDir()).exclusions(workspaceId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/{workspaceId}/exclusions")
    public ResponseEntity<?> createExclusion(@PathVariable String workspaceId, @RequestBody ExclusionRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            if (request == null || request.contentId() == null || request.contentId().isBlank()) {
                throw new IllegalArgumentException("contentId 不能为空");
            }
            LocalDateTime now = LocalDateTime.now();
            WorkspaceExclusion exclusion = new WorkspaceExclusion(workspaceId, request.contentId(), request.reason(), now, now);
            new WorkspaceRuleServiceView(indexDir()).saveExclusion(exclusion);
            return ResponseEntity.status(HttpStatus.CREATED).body(exclusion);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @DeleteMapping("/{workspaceId}/exclusions/{contentId}")
    public ResponseEntity<?> deleteExclusion(@PathVariable String workspaceId, @PathVariable String contentId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            new WorkspaceRuleServiceView(indexDir()).removeExclusion(workspaceId, contentId);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/{workspaceId}/resolution")
    public ResponseEntity<?> resolution(@PathVariable String workspaceId) {
        try {
            Path indexDir = indexDir();
            WorkspaceResolutionView resolution = new WorkspaceResolutionView(
                    workspaceIndexService().resolveWorkspace(workspaceId,
                            new ContentIndexService(indexDir.resolve("content-index.json")).readAll(), List.of()));
            return ResponseEntity.ok(resolution.body());
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    private Path indexDir() {
        return Path.of(appConfigService.getConfigDirPath(), "index");
    }

    private WorkspaceIndexService workspaceIndexService() {
        return new WorkspaceIndexService(indexDir());
    }

    private void requireWorkspace(WorkspaceIndexService service, String workspaceId) {
        if (workspaceId == null || workspaceId.isBlank()) throw new IllegalArgumentException("workspaceId 不能为空");
        if (service.readAll().stream().noneMatch(workspace -> workspace.id().equals(workspaceId))) {
            throw new WorkspaceNotFoundException("工作台不存在");
        }
    }

    private void validate(RuleRequest request) {
        if (request == null) throw new IllegalArgumentException("请求不能为空");
        if (request.field() == null || !WorkspaceRule.FIELDS.contains(request.field())) {
            throw new IllegalArgumentException("rule.field 非法: " + request.field());
        }
        if (request.operator() == null || !WorkspaceRule.OPERATORS.contains(request.operator())) {
            throw new IllegalArgumentException("rule.operator 非法: " + request.operator());
        }
        if (request.value() == null || request.value().isBlank()) throw new IllegalArgumentException("rule.value 不能为空");
    }

    private ResponseEntity<Map<String, Object>> errorResponse(RuntimeException error) {
        if (error instanceof WorkspaceNotFoundException) return error(HttpStatus.NOT_FOUND, error.getMessage());
        if (error instanceof IllegalArgumentException) return error(HttpStatus.BAD_REQUEST, error.getMessage());
        return error(HttpStatus.SERVICE_UNAVAILABLE, "无法读写工作台索引数据");
    }

    private ResponseEntity<Map<String, Object>> serviceUnavailable(String message) {
        return error(HttpStatus.SERVICE_UNAVAILABLE, message);
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("status", "error", "message", message));
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
        return contains(ref.id(), query) || contains(ref.type(), query) || contains(ref.title(), query)
                || contains(ref.category(), query) || contains(ref.sourcePath(), query)
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

    public record RuleRequest(String field, String operator, String value, boolean enabled) {}

    public record ExclusionRequest(String contentId, String reason) {}

    private static final class WorkspaceRuleServiceView {
        private final com.example.clip.index.WorkspaceRuleService service;

        private WorkspaceRuleServiceView(Path indexDir) {
            this.service = new com.example.clip.index.WorkspaceRuleService(indexDir);
        }

        private List<WorkspaceRule> rules(String workspaceId) { return service.rules(workspaceId); }
        private void saveRule(WorkspaceRule rule) { service.saveRule(rule); }
        private void removeRule(String ruleId) { service.removeRule(ruleId); }
        private List<WorkspaceExclusion> exclusions(String workspaceId) { return service.exclusions(workspaceId); }
        private void saveExclusion(WorkspaceExclusion exclusion) { service.saveExclusion(exclusion); }
        private void removeExclusion(String workspaceId, String contentId) { service.removeExclusion(workspaceId, contentId); }
    }

    private record WorkspaceResolutionView(com.example.clip.index.WorkspaceResolution resolution) {
        private Map<String, Object> body() {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("contents", resolution.visible().stream().map(ref -> {
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
            }).toList());
            body.put("ruleMatchedCount", resolution.ruleMatchedCount());
            body.put("manualCount", resolution.manualCount());
            body.put("relationCount", resolution.relationCount());
            body.put("excludedCount", resolution.excludedCount());
            body.put("visibleCount", resolution.visibleCount());
            return body;
        }
    }

    private static final class WorkspaceNotFoundException extends RuntimeException {
        private WorkspaceNotFoundException(String message) { super(message); }
    }
}
