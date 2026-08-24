package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 规则分组（Group）增删测试。
 * <p>
 * 覆盖：新建分组、删除分组（连带组内规则）、删除唯一分组后补空组、
 * 删除不存在分组幂等、多分组时只影响目标组。
 * </p>
 */
class WorkspaceRuleGroupTest {

    @TempDir
    Path tempDir;

    private final LocalDateTime now = LocalDateTime.of(2026, 8, 11, 10, 0);

    @Test
    void addGroup_appendsEmptyGroupAndNormalizesRelation() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        // 先创建一条规则，产生一个默认表达式（1 个 OR 组）
        WorkspaceRule rule = new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now);
        service.saveRule(rule);

        RuleExpression after = service.addGroup("w", "and");
        assertEquals(2, after.groups().size());
        assertEquals("AND", after.groups().get(1).relation(), "非 OR 值应归一化为 AND");
        assertTrue(after.groups().get(1).ruleIds().isEmpty(), "新分组应为空");
        assertEquals("OR", after.relation(), "新建分组不影响根关系");
    }

    @Test
    void addGroup_withInvalidRelationNormalizesToOr() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        RuleExpression after = service.addGroup("w", "x");
        assertEquals("OR", after.groups().get(0).relation());
    }

    @Test
    void deleteGroup_removesGroupAndItsRules() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        WorkspaceRule r1 = new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now);
        WorkspaceRule r2 = new WorkspaceRule("r2", "w", "type", "in", "clip", true, now, now);
        service.saveRule(r1, "g1");
        service.saveRule(r2, "g2");
        // 手动构造表达式：两组
        RuleExpression expr = new RuleExpression("w", "OR",
                List.of(new RuleGroup("g1", "OR", List.of("r1")),
                        new RuleGroup("g2", "OR", List.of("r2"))));
        service.saveExpression(expr);

        RuleExpression after = service.deleteGroup("w", "g1");
        assertEquals(1, after.groups().size());
        assertEquals("g2", after.groups().get(0).id());
        // 组内规则 r1 应从规则文件删除，r2 保留
        List<WorkspaceRule> rules = service.rules("w");
        assertEquals(List.of("r2"), rules.stream().map(WorkspaceRule::id).toList());
    }

    @Test
    void deleteGroup_keepsAtLeastOneGroup() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now));
        // 删除默认分组
        RuleExpression expr = service.getExpression("w");
        String groupId = expr.groups().get(0).id();

        RuleExpression after = service.deleteGroup("w", groupId);
        assertEquals(1, after.groups().size(), "删除唯一分组后应保留 1 个空 OR 组");
        assertTrue(after.groups().get(0).ruleIds().isEmpty());
    }

    @Test
    void deleteGroup_nonexistentIsIdempotent() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        service.saveRule(new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now));
        RuleExpression before = service.getExpression("w");

        RuleExpression after = service.deleteGroup("w", "no-such-group");
        assertEquals(before, after, "删除不存在的分组应幂等返回当前表达式");
        assertEquals(1, service.rules("w").size(), "规则不受影响");
    }

    @Test
    void deleteGroup_otherGroupsAndRulesUntouched() {
        WorkspaceRuleService service = new WorkspaceRuleService(tempDir);
        WorkspaceRule r1 = new WorkspaceRule("r1", "w", "tag", "contains", "Java", true, now, now);
        WorkspaceRule r2 = new WorkspaceRule("r2", "w", "type", "in", "clip", true, now, now);
        WorkspaceRule r3 = new WorkspaceRule("r3", "w", "category", "contains", "dev", true, now, now);
        service.saveRule(r1, "g1");
        service.saveRule(r2, "g2");
        service.saveRule(r3, "g1");
        RuleExpression expr = new RuleExpression("w", "AND",
                List.of(new RuleGroup("g1", "OR", List.of("r1", "r3")),
                        new RuleGroup("g2", "OR", List.of("r2"))));
        service.saveExpression(expr);

        RuleExpression after = service.deleteGroup("w", "g1");
        assertEquals(1, after.groups().size());
        assertEquals("g2", after.groups().get(0).id());
        assertEquals("AND", after.relation(), "删除分组不影响根关系");
        // g1 的规则 r1/r3 删除，g2 的 r2 保留
        List<WorkspaceRule> rules = service.rules("w");
        assertEquals(List.of("r2"), rules.stream().map(WorkspaceRule::id).toList());
    }
}
