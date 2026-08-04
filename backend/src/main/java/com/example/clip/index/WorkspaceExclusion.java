package com.example.clip.index;

import java.time.LocalDateTime;

public record WorkspaceExclusion(String workspaceId, String contentId, String reason,
                                 LocalDateTime createdAt, LocalDateTime updatedAt) {
    public void validate() {
        if (workspaceId == null || workspaceId.isBlank()) throw new IllegalArgumentException("exclusion.workspaceId 不能为空");
        if (contentId == null || contentId.isBlank()) throw new IllegalArgumentException("exclusion.contentId 不能为空");
        if (createdAt == null || updatedAt == null) throw new IllegalArgumentException("exclusion 时间字段不能为空");
    }
}
