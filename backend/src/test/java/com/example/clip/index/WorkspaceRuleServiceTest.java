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

    private ContentRef ref(String id, String type, String title, String category, List<String> tags, LocalDateTime updatedAt) {
        return new ContentRef(id, type, id, title, category, tags, "source/" + id, updatedAt.minusDays(1), updatedAt, "body");
    }
}
