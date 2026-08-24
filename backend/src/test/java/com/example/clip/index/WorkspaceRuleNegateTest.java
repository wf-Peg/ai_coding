package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 否定条件（NOT / negate）测试。
 * <p>
 * 覆盖：negate 取反匹配、时间字段取反、非 negate 行为不变、
 * 组内组合协作、以及"排除产品开发内容"的隔离场景。
 * </p>
 */
class WorkspaceRuleNegateTest {

    @TempDir
    Path tempDir;

    private final LocalDateTime now = LocalDateTime.of(2026, 8, 11, 10, 0);

    @Test
    void negateRuleInvertsMatch() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "product-dev",
                true, true, now, now));

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "产品需求", "产品", List.of("product-dev"), now),
                ref("clip:2", "clip", "前端学习", "学习", List.of("frontend"), now));

        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        // negate：tag 不等于 product-dev 的内容命中 → 仅 clip:2
        assertEquals(List.of("clip:2"), resolution.visible().stream().map(ContentRef::id).toList());
    }

    @Test
    void negateUpdatedAtRuleInvertsTimeMatch() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        service.saveRule(new WorkspaceRule("r1", "w", "updatedAt", "before", "2026-08-10T00:00:00",
                true, true, now, now));

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "早于", "开发", List.of(), now.minusDays(5)),
                ref("clip:2", "clip", "晚于", "开发", List.of(), now.plusDays(5)));

        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        // negate：更新时间不早于 2026-08-10 的内容命中 → 仅 clip:2
        assertEquals(List.of("clip:2"), resolution.visible().stream().map(ContentRef::id).toList());
    }

    @Test
    void nonNegateRuleBehavesAsBefore() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "product-dev",
                true, false, now, now));

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "产品需求", "产品", List.of("product-dev"), now),
                ref("clip:2", "clip", "前端学习", "学习", List.of("frontend"), now));

        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        // 未取反：tag 等于 product-dev 的内容命中 → 仅 clip:1
        assertEquals(List.of("clip:1"), resolution.visible().stream().map(ContentRef::id).toList());
    }

    @Test
    void negateInsideOrGroupExcludesTargetContent() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        // 分组：tag=product-dev（取反） OR category=学习
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "product-dev",
                true, true, now, now), "g1");
        service.saveRule(new WorkspaceRule("r2", "w", "category", "equals", "学习",
                true, false, now, now), "g1");

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "产品需求", "产品", List.of("product-dev"), now),
                ref("clip:2", "clip", "前端学习", "学习", List.of("frontend"), now),
                ref("clip:3", "clip", "日常记录", "生活", List.of("life"), now));

        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        // clip:2 命中 category=学习；clip:3 命中 tag≠product-dev；clip:1 两者均不命中
        assertEquals(List.of("clip:2", "clip:3"),
                resolution.visible().stream().map(ContentRef::id).sorted().toList());
    }

    @Test
    void isolationScenario_excludesProductDevContent() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        // 新工作台隔离产品开发内容：标签 不等于 product-dev（取反）
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "equals", "product-dev",
                true, true, now, now));

        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "需求评审", "产品", List.of("product-dev"), now),
                ref("clip:2", "clip", "React 入门", "学习", List.of("react"), now),
                ref("clip:3", "todo", "买菜", "生活", List.of(), now));

        WorkspaceResolution resolution = service.resolve("w", refs, List.of(), List.of());
        assertFalse(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:1")),
                "带 product-dev 标签的内容应被排除");
        assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:2")));
        assertTrue(resolution.visible().stream().anyMatch(ref -> ref.id().equals("clip:3")),
                "无标签内容不属于产品开发，应可见");
    }

    private ContentRef ref(String id, String type, String title, String category, List<String> tags, LocalDateTime updatedAt) {
        return new ContentRef(id, type, id, title, category, tags, "source/" + id,
                updatedAt.minusDays(1), updatedAt, "body");
    }
}
