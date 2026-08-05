package com.example.clip.index;

import java.time.LocalDateTime;

public record Workspace(String id, String name, String description, String color, String type, String status,
                        LocalDateTime createdAt, LocalDateTime updatedAt) {
    public static final java.util.Set<String> TYPES = java.util.Set.of("general", "project", "learning");
}
