package com.example.clip.index;

import java.time.LocalDateTime;

public record ProjectMembership(String projectId, String contentId, String source,
                                double confidence, String reason, LocalDateTime createdAt) {}
