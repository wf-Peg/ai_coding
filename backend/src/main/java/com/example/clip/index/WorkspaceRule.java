package com.example.clip.index;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.Set;

public record WorkspaceRule(String id, String workspaceId, String field, String operator, String value,
                            boolean enabled, LocalDateTime createdAt, LocalDateTime updatedAt) {
    public static final Set<String> FIELDS = Set.of("type", "category", "tag", "sourcePath", "workflowStatus", "updatedAt");
    public static final Set<String> OPERATORS = Set.of("equals", "contains", "in", "before", "after");

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
