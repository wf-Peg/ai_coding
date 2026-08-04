package com.example.clip.index;

import java.time.LocalDateTime;

public record WorkspaceMembership(String workspaceId, String contentId, String source, String reason,
                                  double confidence, LocalDateTime createdAt, LocalDateTime updatedAt) {}
