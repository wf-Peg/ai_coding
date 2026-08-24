package com.example.clip.index;

import java.util.List;

public record ProjectSuggestion(String id, String projectId, String contentId,
                                double score, List<String> reasons, String status) {
    public ProjectSuggestion {
        reasons = reasons == null ? List.of() : List.copyOf(reasons);
    }
}
