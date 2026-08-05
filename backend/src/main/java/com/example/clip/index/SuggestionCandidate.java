package com.example.clip.index;

import java.time.LocalDateTime;
import java.util.List;

public record SuggestionCandidate(String id, String workspaceId, String contentId,
                                  double score, List<String> reasons,
                                  LocalDateTime createdAt, LocalDateTime expiresAt,
                                  String status) {
    public SuggestionCandidate {
        reasons = reasons == null ? List.of() : List.copyOf(reasons);
    }

    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }

    public boolean isActionable() {
        return "pending".equals(status) && !isExpired();
    }
}