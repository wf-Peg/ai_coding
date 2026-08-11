package com.example.clip.index;

import java.util.List;
import java.util.UUID;

/**
 * 规则组：组内规则按 relation（AND/OR）折叠。
 * 注意：紧凑构造器兜底 id/relation/ruleIds，保证 JSON 反序列化与手工构造均安全。
 */
public record RuleGroup(String id, String relation, List<String> ruleIds) {

    public static final String AND = "AND";
    public static final String OR = "OR";

    public RuleGroup {
        if (id == null || id.isBlank()) id = UUID.randomUUID().toString();
        relation = normalizeRelation(relation);
        ruleIds = ruleIds == null ? List.of() : List.copyOf(ruleIds);
    }

    /** 非 AND 一律归一化为 OR。 */
    public static String normalizeRelation(String relation) {
        return (relation != null && "AND".equalsIgnoreCase(relation.trim())) ? AND : OR;
    }
}
