package com.example.clip.index;

import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;
import java.util.List;

public record SuggestionCandidate(String id, String workspaceId, String contentId,
                                  double score, List<String> reasons,
                                  LocalDateTime createdAt, LocalDateTime expiresAt,
                                  String status,
                                  String type,
                                  String title,
                                  String suggestedField,
                                  String suggestedValue) {
    public SuggestionCandidate(String id, String workspaceId, String contentId,
                               double score, List<String> reasons,
                               LocalDateTime createdAt, LocalDateTime expiresAt,
                               String status) {
        this(id, workspaceId, contentId, score, reasons, createdAt, expiresAt, status,
                "content-suggestion", null, null, null);
    }

    public SuggestionCandidate {
        type = type == null ? "content-suggestion" : type;
        reasons = reasons == null ? List.of() : List.copyOf(reasons);
    }

    @JsonIgnore
    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }

    @JsonIgnore
    public boolean isActionable() {
        return "pending".equals(status) && !isExpired();
    }
}