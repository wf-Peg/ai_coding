package com.example.clip.index;

import java.time.LocalDateTime;

public record BoardColumn(String id, String workspaceId, String key, String name, int position,
                          boolean isDefault, LocalDateTime createdAt, LocalDateTime updatedAt) {
    public void validate() {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("column.id 不能为空");
        if (workspaceId == null || workspaceId.isBlank()) throw new IllegalArgumentException("column.workspaceId 不能为空");
        if (key == null || key.isBlank()) throw new IllegalArgumentException("column.key 不能为空");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("column.name 不能为空");
        if (createdAt == null || updatedAt == null) throw new IllegalArgumentException("column 时间字段不能为空");
    }
}