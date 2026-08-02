package com.example.clip.index;

import java.time.LocalDateTime;

public record ContentRelation(
        String fromId,
        String toId,
        String relationType,
        String source,
        double confidence,
        LocalDateTime createdAt
) {}
