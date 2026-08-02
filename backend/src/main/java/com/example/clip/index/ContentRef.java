package com.example.clip.index;

import java.time.LocalDateTime;
import java.util.List;

/** Lightweight searchable reference to a stored content entity. */
public record ContentRef(
        String id,
        String type,
        String sourceId,
        String title,
        String category,
        List<String> tags,
        String sourcePath,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        String content
) {
    public ContentRef {
        tags = tags == null ? List.of() : List.copyOf(tags);
    }
}
