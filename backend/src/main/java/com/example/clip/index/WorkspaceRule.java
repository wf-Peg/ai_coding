package com.example.clip.index;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.Set;

public record WorkspaceRule(String id, String workspaceId, String field, String operator, String value,
                            boolean enabled, Boolean negate, LocalDateTime createdAt, LocalDateTime updatedAt) {
    public static final Set<String> FIELDS = Set.of("type", "category", "tag", "sourcePath", "workflowStatus", "updatedAt", "workspace");
    public static final Set<String> OPERATORS = Set.of("equals", "contains", "in", "before", "after");

    public WorkspaceRule {
        // 兼容旧数据：negate 缺失（null）时归一化为 false（不取反）
        if (negate == null) negate = false;
    }

    /** 兼容旧调用：不带 negate 时默认不取反 */
    public WorkspaceRule(String id, String workspaceId, String field, String operator, String value,
                         boolean enabled, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this(id, workspaceId, field, operator, value, enabled, false, createdAt, updatedAt);
    }

    public void validate() {
        requireText(id, "rule.id");
        requireText(workspaceId, "rule.workspaceId");
        requireText(value, "rule.value");
        if (!FIELDS.contains(field)) throw new IllegalArgumentException("rule.field 非法: " + field);
        if (!OPERATORS.contains(operator)) throw new IllegalArgumentException("rule.operator 非法: " + operator);
        if (createdAt == null || updatedAt == null) throw new IllegalArgumentException("rule 时间字段不能为空");
        if ((operator.equals("before") || operator.equals("after")) && dateValue() == null) {
            throw new IllegalArgumentException("rule.value 必须是合法时间");
        }
    }

    public LocalDateTime dateValue() {
        try {
            return LocalDateTime.parse(value);
        } catch (DateTimeParseException error) {
            return null;
        }
    }

    private void requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(fieldName + " 不能为空");
    }
}
