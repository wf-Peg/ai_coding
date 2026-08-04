package com.example.clip.index;

import java.time.LocalDateTime;

public record Workspace(String id, String name, String description, String color, String type, String status,
                        LocalDateTime createdAt, LocalDateTime updatedAt) {}
