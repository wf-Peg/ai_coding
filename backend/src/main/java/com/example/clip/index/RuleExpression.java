package com.example.clip.index;

import java.util.List;
import java.util.UUID;

/**
 * 工作区规则表达式：根 relation（组间 AND/OR）+ 多个 RuleGroup。
 */
public record RuleExpression(String workspaceId, String relation, List<RuleGroup> groups) {

    public RuleExpression {
        relation = RuleGroup.normalizeRelation(relation);
        groups = groups == null ? List.of() : List.copyOf(groups);
    }

    /** 默认空表达式：一个默认组（组内 OR、组间 OR），供 saveRule 兜底。 */
    public static RuleExpression empty(String workspaceId) {
        return new RuleExpression(workspaceId, RuleGroup.OR,
                List.of(new RuleGroup(UUID.randomUUID().toString(), RuleGroup.OR, List.of())));
    }
}
