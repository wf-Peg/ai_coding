package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class WorkspaceRuleService {
    private final Path rulesPath;
    private final Path exclusionsPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public WorkspaceRuleService(Path indexDir) {
        this.rulesPath = indexDir.resolve("workspace-rules.json");
        this.exclusionsPath = indexDir.resolve("workspace-exclusions.json");
    }

    public synchronized void saveRule(WorkspaceRule rule) {
        rule.validate();
        List<WorkspaceRule> values = read(rulesPath, new TypeReference<>() {});
        values.removeIf(item -> item.id().equals(rule.id()));
        values.add(rule);
        write(rulesPath, values);
    }

    public synchronized void removeRule(String ruleId) {
        requireText(ruleId, "ruleId");
        write(rulesPath, read(rulesPath, new TypeReference<List<WorkspaceRule>>() {}).stream()
                .filter(item -> !item.id().equals(ruleId)).toList());
    }

    public synchronized List<WorkspaceRule> rules(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        return read(rulesPath, new TypeReference<List<WorkspaceRule>>() {}).stream()
                .filter(item -> item.workspaceId().equals(workspaceId)).toList();
    }

    public synchronized void saveExclusion(WorkspaceExclusion exclusion) {
        exclusion.validate();
        List<WorkspaceExclusion> values = read(exclusionsPath, new TypeReference<>() {});
        values.removeIf(item -> item.workspaceId().equals(exclusion.workspaceId()) && item.contentId().equals(exclusion.contentId()));
        values.add(exclusion);
        write(exclusionsPath, values);
    }

    public synchronized void removeExclusion(String workspaceId, String contentId) {
        requireText(workspaceId, "workspaceId");
        requireText(contentId, "contentId");
        write(exclusionsPath, read(exclusionsPath, new TypeReference<List<WorkspaceExclusion>>() {}).stream()
                .filter(item -> !(item.workspaceId().equals(workspaceId) && item.contentId().equals(contentId))).toList());
    }

    public synchronized List<WorkspaceExclusion> exclusions(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        return read(exclusionsPath, new TypeReference<List<WorkspaceExclusion>>() {}).stream()
                .filter(item -> item.workspaceId().equals(workspaceId)).toList();
    }

    public synchronized void deleteWorkspaceData(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        write(rulesPath, read(rulesPath, new TypeReference<List<WorkspaceRule>>() {}).stream()
                .filter(item -> !item.workspaceId().equals(workspaceId)).toList());
        write(exclusionsPath, read(exclusionsPath, new TypeReference<List<WorkspaceExclusion>>() {}).stream()
                .filter(item -> !item.workspaceId().equals(workspaceId)).toList());
    }

    public synchronized WorkspaceResolution resolve(String workspaceId, Collection<ContentRef> refs,
                                                    Collection<WorkspaceMembership> manualMembers,
                                                    Collection<WorkspaceMembership> relationMembers) {
        requireText(workspaceId, "workspaceId");
        Map<String, ContentRef> byId = new LinkedHashMap<>();
        if (refs != null) refs.forEach(ref -> { if (ref != null && ref.id() != null) byId.put(ref.id(), ref); });
        Set<String> ruleIds = new LinkedHashSet<>();
        for (WorkspaceRule rule : rules(workspaceId)) {
            if (!rule.enabled()) continue;
            byId.values().stream().filter(ref -> matches(rule, ref)).forEach(ref -> ruleIds.add(ref.id()));
        }
        Set<String> manualIds = memberIds(workspaceId, manualMembers);
        Set<String> relationIds = memberIds(workspaceId, relationMembers);
        Set<String> excludedIds = new LinkedHashSet<>();
        exclusions(workspaceId).forEach(item -> excludedIds.add(item.contentId()));
        Set<String> candidates = new LinkedHashSet<>(ruleIds);
        candidates.addAll(manualIds);
        candidates.addAll(relationIds);
        candidates.removeAll(excludedIds);
        List<ContentRef> visible = candidates.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();
        // 构建每个可见内容的来源映射
        Map<String, String> contentSources = new LinkedHashMap<>();
        for (ContentRef ref : visible) {
            if (ruleIds.contains(ref.id())) {
                contentSources.put(ref.id(), "rule");
            } else if (manualIds.contains(ref.id())) {
                contentSources.put(ref.id(), "manual");
            } else if (relationIds.contains(ref.id())) {
                contentSources.put(ref.id(), "relation");
            }
        }
        return new WorkspaceResolution(visible, ruleIds.size(), manualIds.size(), relationIds.size(),
                (int) excludedIds.stream().filter(byId::containsKey).count(), visible.size(),
                List.of(), Map.of(), contentSources);
    }

    private boolean matches(WorkspaceRule rule, ContentRef ref) {
        if (rule.field().equals("updatedAt")) {
            LocalDateTime date = rule.dateValue();
            if (date == null) return false;
            if (ref.updatedAt() == null) return false;
            return rule.operator().equals("before") ? ref.updatedAt().isBefore(date) : rule.operator().equals("after") && ref.updatedAt().isAfter(date);
        }
        List<String> values = switch (rule.field()) {
            case "type" -> safeValue(ref.type());
            case "category" -> safeValue(ref.category());
            case "tag" -> ref.tags();
            case "sourcePath" -> safeValue(ref.sourcePath());
            case "workflowStatus" -> safeValue(ref.workflowStatus());
            default -> List.of();
        };
        return switch (rule.operator()) {
            case "equals" -> values.stream().anyMatch(value -> rule.value().equals(value));
            case "contains" -> values.stream().anyMatch(value -> value != null && value.contains(rule.value()));
            case "in" -> values.stream().anyMatch(value -> List.of(rule.value().split(",")).stream().map(String::trim).anyMatch(value::equals));
            default -> false;
        };
    }

    private List<String> safeValue(String value) {
        return value == null ? List.of() : List.of(value);
    }

    private Set<String> memberIds(String workspaceId, Collection<WorkspaceMembership> members) {
        if (members == null) return Set.of();
        return members.stream().filter(item -> item != null && workspaceId.equals(item.workspaceId()))
                .map(WorkspaceMembership::contentId).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private <T> List<T> read(Path path, TypeReference<List<T>> type) {
        if (!Files.exists(path)) return new ArrayList<>();
        try {
            List<T> values = objectMapper.readValue(path.toFile(), type);
            return values == null ? new ArrayList<>() : values;
        } catch (IOException | RuntimeException error) {
            throw new IllegalStateException("无法读取工作台规则数据: " + path, error);
        }
    }

    private void write(Path path, List<?> values) {
        try {
            Files.createDirectories(path.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), values);
        } catch (IOException error) {
            throw new IllegalStateException("无法写入工作台规则数据: " + path, error);
        }
    }

    private void requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " 不能为空");
    }
}
