package com.example.clip.index;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class WorkspaceRuleService {
    private static final String EXPRESSION_FILE = "workspace-rule-expressions.json";
    private final Path rulesPath;
    private final Path exclusionsPath;
    private final Path expressionPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public WorkspaceRuleService(Path indexDir) {
        this.rulesPath = indexDir.resolve("workspace-rules.json");
        this.exclusionsPath = indexDir.resolve("workspace-exclusions.json");
        this.expressionPath = indexDir.resolve(EXPRESSION_FILE);
    }

    public synchronized void saveRule(WorkspaceRule rule) {
        saveRule(rule, null);
    }

    public synchronized void saveRule(WorkspaceRule rule, String groupId) {
        rule.validate();
        List<WorkspaceRule> values = new ArrayList<>(readRules(rule.workspaceId()));
        values.removeIf(item -> item.id().equals(rule.id()));
        values.add(rule);
        writeRules(values);

        RuleExpression expr = getExpression(rule.workspaceId());
        if (expr == null) expr = RuleExpression.empty(rule.workspaceId());
        List<RuleGroup> groups = new ArrayList<>(expr.groups());
        if (groups.isEmpty()) groups.add(new RuleGroup(UUID.randomUUID().toString(), "OR", List.of()));
        int target = 0;
        if (groupId != null && !groupId.isBlank()) {
            for (int i = 0; i < groups.size(); i++) {
                if (groupId.equals(groups.get(i).id())) { target = i; break; }
            }
        }
        List<String> ids = new ArrayList<>(groups.get(target).ruleIds());
        if (!ids.contains(rule.id())) ids.add(rule.id());
        groups.set(target, new RuleGroup(groups.get(target).id(), groups.get(target).relation(), ids));
        saveExpression(new RuleExpression(rule.workspaceId(), expr.relation(), groups));
    }

    public synchronized void removeRule(String ruleId) {
        requireText(ruleId, "ruleId");
        List<WorkspaceRule> all = readAllRules();
        all.removeIf(item -> item.id().equals(ruleId));
        writeRules(all);

        Map<String, RuleExpression> exprs = readExpressions();
        Map<String, RuleExpression> updated = new LinkedHashMap<>();
        for (RuleExpression expr : exprs.values()) {
            List<RuleGroup> groups = new ArrayList<>();
            for (RuleGroup g : expr.groups()) {
                List<String> ids = new ArrayList<>(g.ruleIds());
                ids.remove(ruleId);
                if (!ids.isEmpty()) groups.add(new RuleGroup(g.id(), g.relation(), ids));
            }
            if (groups.isEmpty()) groups.add(new RuleGroup(UUID.randomUUID().toString(), "OR", List.of()));
            updated.put(expr.workspaceId(), new RuleExpression(expr.workspaceId(), expr.relation(), groups));
        }
        if (!updated.isEmpty()) writeExpressions(updated);
    }

    public synchronized List<WorkspaceRule> rules(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        return readRules(workspaceId);
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
        Map<String, RuleExpression> exprs = readExpressions();
        if (exprs.remove(workspaceId) != null) writeExpressions(exprs);
    }

    // ---- 表达式存储 ----

    private Map<String, RuleExpression> readExpressions() {
        if (!Files.exists(expressionPath)) return new LinkedHashMap<>();
        try {
            JsonNode root = objectMapper.readTree(expressionPath.toFile());
            Map<String, RuleExpression> map = new LinkedHashMap<>();
            for (JsonNode node : root.path("expressions")) {
                RuleExpression expr = objectMapper.treeToValue(node, RuleExpression.class);
                map.put(expr.workspaceId(), expr);
            }
            return map;
        } catch (IOException e) {
            throw new IllegalStateException("读取规则表达式失败: " + expressionPath, e);
        }
    }

    private void writeExpressions(Map<String, RuleExpression> all) {
        Path tmp = expressionPath.resolveSibling(expressionPath.getFileName() + ".tmp");
        Map<String, List<RuleExpression>> wrapper = Map.of("expressions", new ArrayList<>(all.values()));
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), wrapper);
            Files.move(tmp, expressionPath, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new IllegalStateException("写入规则表达式失败: " + expressionPath, e);
        }
    }

    /**
     * 惰性迁移（幂等）：无表达式但有旧平铺规则时，建一个组（组 relation = OR，根 relation = OR），
     * 保持旧版"任一规则命中即可"的语义。
     */
    public synchronized RuleExpression getExpression(String workspaceId) {
        Map<String, RuleExpression> all = readExpressions();
        if (all.containsKey(workspaceId)) return all.get(workspaceId);
        List<WorkspaceRule> legacy = readRules(workspaceId);
        if (legacy.isEmpty()) return null;
        RuleGroup group = new RuleGroup(UUID.randomUUID().toString(), "OR",
                legacy.stream().map(WorkspaceRule::id).toList());
        RuleExpression expr = new RuleExpression(workspaceId, "OR", List.of(group));
        all.put(workspaceId, expr);
        writeExpressions(all);
        return expr;
    }

    public synchronized RuleExpression saveExpression(RuleExpression expression) {
        Map<String, RuleExpression> all = readExpressions();
        all.put(expression.workspaceId(), expression);
        writeExpressions(all);
        return expression;
    }

    public synchronized WorkspaceResolution resolve(String workspaceId, Collection<ContentRef> refs,
                                                    Collection<WorkspaceMembership> manualMembers,
                                                    Collection<WorkspaceMembership> relationMembers) {
        requireText(workspaceId, "workspaceId");
        Map<String, ContentRef> byId = new LinkedHashMap<>();
        if (refs != null) refs.forEach(ref -> { if (ref != null && ref.id() != null) byId.put(ref.id(), ref); });

        // 表达式逐条求值：内容须让整个表达式为 true 才被规则命中
        Set<String> ruleIds = new LinkedHashSet<>();
        RuleExpression expr = getExpression(workspaceId);
        if (expr != null && expr.groups() != null && !expr.groups().isEmpty()) {
            for (ContentRef ref : byId.values()) {
                List<Boolean> groupResults = new ArrayList<>();
                for (RuleGroup group : expr.groups()) {
                    if (group.ruleIds() == null || group.ruleIds().isEmpty()) continue;
                    List<Boolean> ruleResults = new ArrayList<>();
                    for (String ruleId : group.ruleIds()) {
                        WorkspaceRule rule = findRule(workspaceId, ruleId);
                        if (rule != null && rule.enabled()) ruleResults.add(matches(rule, ref));
                    }
                    if (!ruleResults.isEmpty()) groupResults.add(fold(group.relation(), ruleResults));
                }
                if (!groupResults.isEmpty() && fold(expr.relation(), groupResults)) {
                    ruleIds.add(ref.id());
                }
            }
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

    /** 布尔折叠：acc op value，首项直接取 value */
    private boolean fold(String relation, List<Boolean> values) {
        boolean acc = values.get(0);
        boolean and = RuleGroup.AND.equalsIgnoreCase(relation);
        for (int i = 1; i < values.size(); i++) acc = and ? (acc && values.get(i)) : (acc || values.get(i));
        return acc;
    }

    private WorkspaceRule findRule(String workspaceId, String ruleId) {
        return readRules(workspaceId).stream()
                .filter(r -> r.id().equals(ruleId)).findFirst().orElse(null);
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

    private List<WorkspaceRule> readRules(String workspaceId) {
        return read(rulesPath, new TypeReference<List<WorkspaceRule>>() {}).stream()
                .filter(item -> item.workspaceId().equals(workspaceId)).toList();
    }

    private List<WorkspaceRule> readAllRules() {
        return read(rulesPath, new TypeReference<List<WorkspaceRule>>() {});
    }

    private void writeRules(List<WorkspaceRule> values) {
        write(rulesPath, values);
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
