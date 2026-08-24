package com.example.clip.index;

import java.time.LocalDateTime;
import java.util.Map;

public record ActionEvent(String eventId, String type, String contentId, String workspaceId,
                          String source, String projectId, Map<String, String> metadata,
                          LocalDateTime createdAt, Integer schemaVersion) {
    public ActionEvent {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}