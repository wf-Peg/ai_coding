package com.example.clip.index;

import java.time.LocalDateTime;

public record WorkspaceMembership(String workspaceId, String contentId, String source, String reason,
                                  double confidence, String boardColumnId, int position,
                                  LocalDateTime createdAt, LocalDateTime updatedAt) {}