package com.example.clip.controller;

import com.example.clip.index.ActionEventService;
import com.example.clip.index.BoardColumn;
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.HabitProfile;
import com.example.clip.index.HabitProfileService;
import com.example.clip.index.Project;
import com.example.clip.index.ProjectIndexService;
import com.example.clip.index.RuleExpression;
import com.example.clip.index.RuleExpressionUpdateRequest;
import com.example.clip.index.RuleGroup;
import com.example.clip.index.SuggestionCandidate;
import com.example.clip.index.Workspace;
import com.example.clip.index.WorkspaceExclusion;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceMembership;
import com.example.clip.index.WorkspaceResolution;
import com.example.clip.index.WorkspaceRule;
import com.example.clip.index.WorkspaceSuggestionService;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.UserActionEventRecorder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/workspace")
@CrossOrigin(origins = "*")
public class WorkspaceController {
    private static final Logger log = LoggerFactory.getLogger(WorkspaceController.class);
    private static final List<String> CONTENT_TYPES = List.of("clip", "knowledge", "todo", "learning-plan");

    private final AppConfigService appConfigService;

    @Autowired(required = false)
    private UserActionEventRecorder actionEventRecorder;

    public WorkspaceController(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    @GetMapping("/list")
    public ResponseEntity<?> list() {
        try {
            return ResponseEntity.ok(workspaceIndexService().readAll());
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PostMapping
    public ResponseEntity<?> createWorkspace(@RequestBody WorkspaceRequest workspaceRequest) {
        try {
            if (workspaceRequest == null || workspaceRequest.name() == null || workspaceRequest.name().isBlank()) {
                throw new IllegalArgumentException("workspace.name 不能为空");
            }
            String type = workspaceRequest.type() != null ? workspaceRequest.type() : "general";
            if (!Workspace.TYPES.contains(type)) {
                throw new IllegalArgumentException("workspace.type 非法: " + type);
            }
            LocalDateTime now = LocalDateTime.now();
            boolean matchAll = workspaceRequest.matchAll() != null && workspaceRequest.matchAll();
            Workspace workspace = new Workspace(UUID.randomUUID().toString(), workspaceRequest.name(),
                    workspaceRequest.description(), workspaceRequest.color(), type, "active", matchAll, false, 0, now, now);
            workspaceIndexService().saveWorkspace(workspace);
            return ResponseEntity.status(HttpStatus.CREATED).body(workspace);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/overview")
    public ResponseEntity<Map<String, Object>> overview(
            @RequestParam(required = false) String workspaceId,
            @RequestParam(required = false) List<String> types,
            @RequestParam(required = false, defaultValue = "") String query) {
        try {
            Path indexDir = indexDir();
            if (workspaceId != null && !workspaceId.isBlank()) {
                WorkspaceResolution resolution = workspaceIndexService().resolveWorkspace(workspaceId,
                        new ContentIndexService(indexDir.resolve("content-index.json")).readAll(), List.of());
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("contents", new WorkspaceResolutionView(resolution).body().get("contents"));
                result.put("count", resolution.visibleCount());
                result.put("scoped", true);
                result.put("workspaceId", workspaceId);
                result.put("contentTypes", CONTENT_TYPES);
                result.put("projects", List.of());
                result.put("workspaceSummary", workspaceSummaryOf(indexDir));
                return ResponseEntity.ok(result);
            }
            return ResponseEntity.ok(overviewAll(indexDir, types, query));
        } catch (IllegalStateException error) {
            return serviceUnavailable("无法读取工作台索引数据");
        }
    }

    private Map<String, Object> overviewAll(Path indexDir, List<String> types, String query) {
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
        result.put("workspaceSummary", workspaceSummaryOf(indexDir));
        return result;
    }

    private Map<String, Object> workspaceSummaryOf(Path indexDir) {
        List<Workspace> allWorkspaces = workspaceIndexService().readAll();
        long activeWorkspaces = allWorkspaces.stream().filter(w -> "active".equals(w.status())).count();
        long archivedWorkspaces = allWorkspaces.stream().filter(w -> "archived".equals(w.status())).count();
        Map<String, Object> workspaceSummary = new LinkedHashMap<>();
        workspaceSummary.put("total", allWorkspaces.size());
        workspaceSummary.put("active", activeWorkspaces);
        workspaceSummary.put("archived", archivedWorkspaces);
        workspaceSummary.put("types", allWorkspaces.stream()
                .map(Workspace::type).filter(t -> t != null)
                .collect(Collectors.groupingBy(t -> t, Collectors.counting())));
        return workspaceSummary;
    }

    // ── Board Column API ──

    @GetMapping("/{workspaceId}/columns")
    public ResponseEntity<?> columns(@PathVariable String workspaceId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            return ResponseEntity.ok(indexService.columns(workspaceId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PostMapping("/{workspaceId}/columns")
    public ResponseEntity<?> createColumn(@PathVariable String workspaceId, @RequestBody ColumnRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            if (request == null || request.name() == null || request.name().isBlank()) {
                throw new IllegalArgumentException("column.name 不能为空");
            }
            LocalDateTime now = LocalDateTime.now();
            List<BoardColumn> existing = indexService.columns(workspaceId);
            int maxPos = existing.stream().mapToInt(BoardColumn::position).max().orElse(-1);
            String key = request.key() != null ? request.key() : "col_" + (maxPos + 1);
            BoardColumn column = new BoardColumn(UUID.randomUUID().toString(), workspaceId, key,
                    request.name(), maxPos + 1, false, now, now);
            indexService.saveColumn(column);
            return ResponseEntity.status(HttpStatus.CREATED).body(column);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/{workspaceId}/columns/{columnId}")
    public ResponseEntity<?> updateColumn(@PathVariable String workspaceId, @PathVariable String columnId,
                                          @RequestBody ColumnRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            List<BoardColumn> existing = indexService.columns(workspaceId);
            BoardColumn col = existing.stream().filter(c -> c.id().equals(columnId))
                    .findFirst().orElseThrow(() -> new WorkspaceNotFoundException("看板列不存在"));
            if (request.name() == null || request.name().isBlank()) {
                throw new IllegalArgumentException("column.name 不能为空");
            }
            BoardColumn updated = new BoardColumn(columnId, workspaceId,
                    request.key() != null ? request.key() : col.key(),
                    request.name(), col.position(), col.isDefault(), col.createdAt(), LocalDateTime.now());
            indexService.saveColumn(updated);
            return ResponseEntity.ok(updated);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @DeleteMapping("/{workspaceId}/columns/{columnId}")
    public ResponseEntity<?> deleteColumn(@PathVariable String workspaceId, @PathVariable String columnId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            List<BoardColumn> existing = indexService.columns(workspaceId);
            BoardColumn col = existing.stream().filter(c -> c.id().equals(columnId))
                    .findFirst().orElseThrow(() -> new WorkspaceNotFoundException("看板列不存在"));
            if (col.isDefault()) {
                throw new IllegalArgumentException("默认看板列不能删除");
            }
            indexService.deleteColumn(columnId);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    // ── Move member ──

    @PutMapping("/{workspaceId}/members/{contentId}/move")
    public ResponseEntity<?> moveMember(@PathVariable String workspaceId, @PathVariable String contentId,
                                        @RequestBody MoveRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            if (request == null || request.boardColumnId() == null || request.boardColumnId().isBlank()) {
                throw new IllegalArgumentException("boardColumnId 不能为空");
            }
            indexService.moveMember(workspaceId, contentId, request.boardColumnId(), request.position());
            recordAction("board_column_changed", contentId, workspaceId, "drag", Map.of("boardColumnId", request.boardColumnId()));
            return ResponseEntity.ok().body(Map.of("status", "ok"));
        } catch (RuntimeException error) {
            return errorResponse(error);
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
            boolean negate = request.negate() != null && request.negate();
            WorkspaceRule rule = new WorkspaceRule(UUID.randomUUID().toString(), workspaceId, request.field(),
                    request.operator(), request.value(), request.enabled(), negate, now, now);
            new WorkspaceRuleServiceView(indexDir()).saveRule(rule, request.groupId());
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
                    request.value(), request.enabled(), request.negate() != null && request.negate(),
                    existing.createdAt(), LocalDateTime.now());
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

    @GetMapping("/{workspaceId}/rule-expression")
    public ResponseEntity<?> ruleExpression(@PathVariable String workspaceId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            RuleExpression expr = new WorkspaceRuleServiceView(indexDir()).getExpression(workspaceId);
            return ResponseEntity.ok(expr != null ? expr : RuleExpression.empty(workspaceId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/{workspaceId}/rule-expression")
    public ResponseEntity<?> updateRuleExpression(@PathVariable String workspaceId,
                                                  @RequestBody RuleExpressionUpdateRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            if (request == null) throw new IllegalArgumentException("请求不能为空");
            List<RuleGroup> groups = request.groups() == null ? List.of()
                    : request.groups().stream()
                        .map(g -> new RuleGroup(g.id(), RuleGroup.normalizeRelation(g.relation()), g.ruleIds()))
                        .toList();
            RuleExpression saved = new WorkspaceRuleServiceView(indexDir())
                    .saveExpression(new RuleExpression(workspaceId, request.relation(), groups));
            return ResponseEntity.ok(saved);
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

    /**
     * 新建规则分组。
     * <p>
     * POST /api/workspace/{workspaceId}/rule-expression/groups
     * <p>
     * 请求体可选：{@code {"relation":"OR"}}（组内关系，默认 OR）。
     * 返回更新后的完整表达式。
     *
     * @param workspaceId 工作台 ID
     * @param request     分组创建请求（可空）
     * @return 更新后的规则表达式（201）
     */
    @PostMapping("/{workspaceId}/rule-expression/groups")
    public ResponseEntity<?> addRuleGroup(@PathVariable String workspaceId,
                                          @RequestBody(required = false) GroupCreateRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            String relation = request == null ? null : request.relation();
            RuleExpression expr = new WorkspaceRuleServiceView(indexDir()).addGroup(workspaceId, relation);
            return ResponseEntity.status(HttpStatus.CREATED).body(expr);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    /**
     * 删除规则分组（连同组内规则）。
     * <p>
     * DELETE /api/workspace/{workspaceId}/rule-expression/groups/{groupId}
     * <p>
     * 删除分组及其引用的所有规则；删除后无分组时自动补一个空 OR 组。
     *
     * @param workspaceId 工作台 ID
     * @param groupId     分组 ID
     * @return 更新后的规则表达式
     */
    @DeleteMapping("/{workspaceId}/rule-expression/groups/{groupId}")
    public ResponseEntity<?> deleteRuleGroup(@PathVariable String workspaceId, @PathVariable String groupId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            RuleExpression expr = new WorkspaceRuleServiceView(indexDir()).deleteGroup(workspaceId, groupId);
            return ResponseEntity.ok(expr);
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
            recordAction("workspace_excluded", request.contentId(), workspaceId, "manual", Map.of());
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
            recordAction("workspace_excluded", contentId, workspaceId, "restore", Map.of());
            return ResponseEntity.noContent().build();
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/{workspaceId}/suggestions")
    public ResponseEntity<?> suggestions(@PathVariable String workspaceId) {
        try {
            Path indexDir = indexDir();
            WorkspaceIndexService wsService = workspaceIndexService();
            requireWorkspace(wsService, workspaceId);
            ContentIndexService contentIndex = new ContentIndexService(indexDir.resolve("content-index.json"));
            List<ContentRef> allRefs = contentIndex.readAll();
            List<WorkspaceMembership> members = wsService.members(workspaceId);
            WorkspaceResolution resolution = wsService.resolveWorkspace(workspaceId, allRefs, List.of());
            List<ContentRef> ruleMatched = resolution.visible().stream()
                    .filter(ref -> "rule".equals(resolution.contentSources().get(ref.id())))
                    .toList();
            HabitProfile profile = new HabitProfileService().aggregate(
                    new ActionEventService(indexDir.resolve("action-events.jsonl")).readAll());
            WorkspaceSuggestionService suggestionService = new WorkspaceSuggestionService(indexDir);
            List<SuggestionCandidate> pending = suggestionService.pendingSuggestions(workspaceId);
            if (pending.isEmpty()) {
                List<SuggestionCandidate> fresh = suggestionService.generateSuggestions(
                        workspaceId, allRefs, members, ruleMatched, profile);
                suggestionService.saveSuggestions(workspaceId, fresh);
                pending = suggestionService.pendingSuggestions(workspaceId);
            }
            return ResponseEntity.ok(pending);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/suggestions/{suggestionId}/accept")
    public ResponseEntity<?> acceptSuggestion(@PathVariable String suggestionId) {
        try {
            Path indexDir = indexDir();
            WorkspaceSuggestionService suggestionService = new WorkspaceSuggestionService(indexDir);
            WorkspaceSuggestionService.SuggestionResult result = suggestionService.acceptSuggestion(suggestionId);
            if (!result.success()) {
                return ResponseEntity.badRequest().body(Map.of("error", "建议不存在或已过期"));
            }
            WorkspaceIndexService wsService = workspaceIndexService();
            wsService.addMember(new WorkspaceMembership(result.suggestion().workspaceId(),
                    result.suggestion().contentId(), "suggestion", String.join(",", result.suggestion().reasons()),
                    result.suggestion().score(), "", 0, LocalDateTime.now(), LocalDateTime.now()));
            recordAction("suggestion_accepted", result.suggestion().contentId(),
                    result.suggestion().workspaceId(), "suggestion", Map.of("score", String.valueOf(result.suggestion().score())));
            return ResponseEntity.ok(Map.of("success", true, "suggestionId", suggestionId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/suggestions/{suggestionId}/ignore")
    public ResponseEntity<?> ignoreSuggestion(@PathVariable String suggestionId) {
        try {
            Path indexDir = indexDir();
            WorkspaceSuggestionService suggestionService = new WorkspaceSuggestionService(indexDir);
            SuggestionCandidate candidate = suggestionService.ignore(suggestionId);
            if (candidate == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "建议不存在或已过期"));
            }
            recordAction("suggestion_ignored", candidate.contentId(), candidate.workspaceId(), "suggestion", Map.of());
            return ResponseEntity.ok(Map.of("success", true, "suggestionId", suggestionId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/suggestions/{suggestionId}/reject")
    public ResponseEntity<?> rejectSuggestion(@PathVariable String suggestionId) {
        try {
            Path indexDir = indexDir();
            WorkspaceSuggestionService suggestionService = new WorkspaceSuggestionService(indexDir);
            SuggestionCandidate candidate = suggestionService.reject(suggestionId);
            if (candidate == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "建议不存在或已过期"));
            }
            recordAction("suggestion_rejected", candidate.contentId(), candidate.workspaceId(), "suggestion", Map.of());
            return ResponseEntity.ok(Map.of("success", true, "suggestionId", suggestionId));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @DeleteMapping("/{workspaceId}")
    public ResponseEntity<?> deleteWorkspace(@PathVariable String workspaceId) {
        log.info("event=deleteWorkspace.start workspaceId={}", workspaceId);
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            indexService.deleteWorkspace(workspaceId);
            log.info("event=deleteWorkspace.success workspaceId={}", workspaceId);
            return ResponseEntity.ok(Map.of("status", "ok", "message", "工作台已删除"));
        } catch (RuntimeException error) {
            log.warn("event=deleteWorkspace.error workspaceId={} errorType={} message={}",
                    workspaceId, error.getClass().getSimpleName(), error.getMessage());
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

    @PutMapping("/{workspaceId}/settings")
    public ResponseEntity<?> updateSettings(@PathVariable String workspaceId, @RequestBody WorkspaceSettingsRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            Workspace existing = indexService.readAll().stream()
                    .filter(w -> w.id().equals(workspaceId))
                    .findFirst()
                    .orElseThrow(() -> new WorkspaceNotFoundException("工作台不存在"));
            Workspace updated = new Workspace(workspaceId, existing.name(), existing.description(),
                    existing.color(), existing.type(), existing.status(),
                    request.matchAll() != null ? request.matchAll() : existing.matchAll(),
                    existing.isDefault(), existing.sortOrder(),
                    existing.createdAt(), LocalDateTime.now());
            indexService.saveWorkspace(updated);
            return ResponseEntity.ok(updated);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/{workspaceId}/set-default")
    public ResponseEntity<?> setDefault(@PathVariable String workspaceId) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            requireWorkspace(indexService, workspaceId);
            LocalDateTime now = LocalDateTime.now();
            List<Workspace> all = new ArrayList<>(indexService.readAll());
            for (int i = 0; i < all.size(); i++) {
                Workspace w = all.get(i);
                boolean isDefault = w.id().equals(workspaceId);
                if (w.isDefault() != isDefault || (isDefault && !w.updatedAt().equals(now))) {
                    all.set(i, new Workspace(w.id(), w.name(), w.description(), w.color(), w.type(), w.status(),
                            w.matchAll(), isDefault, w.sortOrder(), w.createdAt(), now));
                }
            }
            // Persist each updated workspace
            for (Workspace w : all) {
                indexService.saveWorkspace(w);
            }
            Workspace updated = all.stream().filter(w -> w.id().equals(workspaceId)).findFirst().orElseThrow();
            return ResponseEntity.ok(updated);
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @PutMapping("/reorder")
    public ResponseEntity<?> reorder(@RequestBody ReorderRequest request) {
        try {
            WorkspaceIndexService indexService = workspaceIndexService();
            indexService.reorderWorkspaces(request.workspaceIds());
            return ResponseEntity.ok(Map.of("success", true));
        } catch (RuntimeException error) {
            return errorResponse(error);
        }
    }

    @GetMapping("/field-values")
    public ResponseEntity<Map<String, List<String>>> fieldValues() {
        try {
            Path indexDir = indexDir();
            ContentIndexService contentIndex = new ContentIndexService(indexDir.resolve("content-index.json"));
            List<ContentRef> allRefs = contentIndex.readAll();
            Map<String, List<String>> result = new LinkedHashMap<>();
            // types: from WorkspaceRule.FIELDS minus sourcePath and updatedAt
            result.put("type", allRefs.stream().map(ContentRef::type).filter(t -> t != null).distinct().sorted().toList());
            result.put("category", allRefs.stream().map(ContentRef::category).filter(c -> c != null && !c.isBlank()).distinct().sorted().toList());
            result.put("tag", allRefs.stream().flatMap(ref -> ref.tags().stream()).filter(t -> t != null && !t.isBlank()).distinct().sorted().toList());
            result.put("workflowStatus", allRefs.stream().map(ContentRef::workflowStatus).filter(s -> s != null && !s.isBlank()).distinct().sorted().toList());
            return ResponseEntity.ok(result);
        } catch (RuntimeException error) {
            return ResponseEntity.ok(Map.of());
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

    private void recordAction(String type, String contentId, String workspaceId, String source, Map<String, String> metadata) {
        if (actionEventRecorder != null) {
            actionEventRecorder.record(type, contentId, workspaceId, source, metadata);
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

    public record RuleRequest(String field, String operator, String value, boolean enabled, Boolean negate, String groupId) {}

    public record GroupCreateRequest(String relation) {}

    public record ExclusionRequest(String contentId, String reason) {}

    public record WorkspaceRequest(String name, String description, String color, String type, Boolean matchAll) {}

    public record ColumnRequest(String key, String name) {}

    public record MoveRequest(String boardColumnId, int position) {}

    public record WorkspaceSettingsRequest(Boolean matchAll) {}

    public record ReorderRequest(List<String> workspaceIds) {}

    private static final class WorkspaceRuleServiceView {
        private final com.example.clip.index.WorkspaceRuleService service;

        private WorkspaceRuleServiceView(Path indexDir) {
            this.service = new com.example.clip.index.WorkspaceRuleService(indexDir);
        }

        private List<WorkspaceRule> rules(String workspaceId) { return service.rules(workspaceId); }
        private void saveRule(WorkspaceRule rule) { service.saveRule(rule); }
        private void saveRule(WorkspaceRule rule, String groupId) { service.saveRule(rule, groupId); }
        private void removeRule(String ruleId) { service.removeRule(ruleId); }
        private RuleExpression getExpression(String workspaceId) { return service.getExpression(workspaceId); }
        private RuleExpression saveExpression(RuleExpression expression) { return service.saveExpression(expression); }
        private RuleExpression addGroup(String workspaceId, String relation) { return service.addGroup(workspaceId, relation); }
        private RuleExpression deleteGroup(String workspaceId, String groupId) { return service.deleteGroup(workspaceId, groupId); }
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
                // Include board column id if this content is a manual member
                String colId = resolution.memberColumnMap().get(ref.id());
                if (colId != null) {
                    summary.put("boardColumnId", colId);
                }
                // Include source marker (rule/manual/relation)
                String source = resolution.contentSources().get(ref.id());
                if (source != null) {
                    summary.put("source", source);
                }
                return summary;
            }).toList());
            body.put("columns", resolution.columns().stream().map(col -> {
                Map<String, Object> colMap = new LinkedHashMap<>();
                colMap.put("id", col.id());
                colMap.put("key", col.key());
                colMap.put("name", col.name());
                colMap.put("position", col.position());
                colMap.put("isDefault", col.isDefault());
                return colMap;
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