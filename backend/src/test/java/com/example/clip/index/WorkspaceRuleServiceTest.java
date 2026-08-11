package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspaceRuleServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void persistsRulesAndExclusionsAndDeletesOnlyTargetWorkspaceData() throws Exception {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
        WorkspaceRule rule = new WorkspaceRule("rule-1", "workspace-1", "tag", "contains", "Java", true, now, now);
        WorkspaceExclusion exclusion = new WorkspaceExclusion("workspace-1", "clip:1", "已处理", now, now);

        service.saveRule(rule);
        service.saveExclusion(exclusion);

        assertEquals(List.of(rule), service.rules("workspace-1"));
        assertEquals(List.of(exclusion), service.exclusions("workspace-1"));
        assertTrue(Files.exists(tempDir.resolve("workspace-rules.json")));
        assertTrue(Files.exists(tempDir.resolve("workspace-exclusions.json")));

        service.saveRule(new WorkspaceRule("rule-1", "workspace-1", "tag", "contains", "Java", false, now, now.plusMinutes(1)));
        assertFalse(service.rules("workspace-1").get(0).enabled());
        service.deleteWorkspaceData("workspace-1");

        assertTrue(service.rules("workspace-2").isEmpty());
        assertTrue(service.exclusions("workspace-1").isEmpty());
        assertTrue(service.rules("workspace-1").isEmpty());
    }

    @Test
    void rejectsUnsupportedRuleContractAndCorruptedJson() throws Exception {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.now();
        assertThrows(IllegalArgumentException.class, () -> service.saveRule(new WorkspaceRule("r", "w", "title", "equals", "x", true, now, now)));
        assertThrows(IllegalArgumentException.class, () -> service.saveRule(new WorkspaceRule("r", "w", "tag", "regex", "x", true, now, now)));
        assertThrows(IllegalArgumentException.class, () -> service.saveRule(new WorkspaceRule("r", "w", "updatedAt", "before", "not-a-time", true, now, now)));
        Files.writeString(tempDir.resolve("workspace-rules.json"), "{broken");
        assertThrows(IllegalStateException.class, () -> service.rules("w"));
    }

    @Test
    void resolvesUnionDeduplicationDisabledRulesAndExclusionPriorityWithStatistics() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 后端", "开发", List.of("Java", "后端"), now),
                ref("clip:2", "knowledge", "Spring", "开发", List.of("Java"), now.minusDays(2)),
                ref("clip:3", "todo", "采购", "生活", List.of("采购"), now.plusDays(1))
        );
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now));
        service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));
        service.saveRule(new WorkspaceRule("r3", "w", "type", "equals", "todo", false, now, now));
        service.saveExclusion(new WorkspaceExclusion("w", "clip:1", "忽略", now, now));
        service.saveExclusion(new WorkspaceExclusion("w", "clip:3", "忽略", now, now));

        WorkspaceResolution resolution = service.resolve("w", refs,
                List.of(new WorkspaceMembership("w", "clip:3", "manual", "手动", 1.0, "", 1, now, now)),
                List.of(new WorkspaceMembership("w", "clip:2", "relation", "关联", 1.0, "", 1, now, now)));

        assertEquals(List.of("clip:2"), resolution.visible().stream().map(ContentRef::id).toList());
        assertEquals(2, resolution.ruleMatchedCount());
        assertEquals(1, resolution.manualCount());
        assertEquals(1, resolution.relationCount());
        assertEquals(2, resolution.excludedCount());
        assertEquals(1, resolution.visibleCount());
    }

    @Test
    void resolve_withNestedGroups() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "java", true, now, now));
        service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));
        service.saveRule(new WorkspaceRule("r3", "w", "type", "in", "clip,todo", true, now, now));
        service.saveExpression(new RuleExpression("w", "AND",
                List.of(new RuleGroup("g1", "OR", List.of("r1", "r2")),
                        new RuleGroup("g2", "AND", List.of("r3")))));

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 后端开发", "开发", List.of("Java"), now),
                ref("clip:2", "knowledge", "Spring Boot 入门", "开发", List.of("Java"), now.minusDays(2)),
                ref("clip:3", "todo", "采购清单", "生活", List.of("采购"), now.plusDays(1))
        );
        // r1: tag=java（clip:1, clip:2 命中）; r2: category=开发（clip:1, clip:2 命中）; r3: type in clip,todo（clip:1, clip:3 命中）
        // AND: 组1 OR 命中 && 组2 AND 命中 → clip:1 通过（组1 r1/r2 命中、组2 r3 命中）；clip:2 组2 失败；clip:3 组1 失败
        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());

        assertEquals(1, resolution.visibleCount(), "仅 clip:1 使整个表达式为 true");
        assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:1")));
        assertFalse(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:2")));
        assertFalse(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:3")));
        assertEquals("rule", resolution.contentSources().get("clip:1"));
    }

    @Test
    void resolve_emptyExpression_onlyBypassMembers() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 开发", "开发", List.of("Java"), now));
        WorkspaceResolution resolution = service.resolve("w", refs,
                List.of(new WorkspaceMembership("w", "clip:1", "manual", "手动", 1.0, "", 1, now, now)),
                List.of());
        assertEquals(1, resolution.visibleCount(), "无表达式时仅 manual 成员可见");
        assertEquals("manual", resolution.contentSources().get("clip:1"));
    }

    @Test
    void resolve_legacyRules_migrateToSingleOrGroup() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        LocalDateTime now = LocalDateTime.of(2026, 8, 4, 10, 0);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "Java", true, now, now));
        service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "开发", true, now, now));
        // 未写表达式 → getExpression 惰性迁移为单组 OR
        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 后端", "其他", List.of("Java"), now),
                ref("clip:3", "todo", "采购", "生活", List.of("采购"), now));
        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        assertEquals(1, resolution.visibleCount(), "迁移后单组 OR：任一规则命中即可见（仅 clip:1 命中 r1）");
        assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:1")));
    }

    private ContentRef ref(String id, String type, String title, String category, List<String> tags, LocalDateTime updatedAt) {
        return new ContentRef(id, type, id, title, category, tags, "source/" + id, updatedAt.minusDays(1), updatedAt, "body");
    }
}
