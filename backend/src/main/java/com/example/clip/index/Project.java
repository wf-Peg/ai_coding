package com.example.clip.index;

import java.time.LocalDateTime;

public record Project(String id, String name, String description, String color, String status,
                      LocalDateTime createdAt, LocalDateTime updatedAt) {}
