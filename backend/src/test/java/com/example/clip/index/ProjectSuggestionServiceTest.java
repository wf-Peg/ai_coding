package com.example.clip.index;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ProjectSuggestionServiceTest {
    @Test
    void scoresAndExplainsMatchingSignals() {
        LocalDateTime now = LocalDateTime.now();
        Project project = new Project("p1", "学习", "", "blue", "active", now, now);
        ContentRef candidate = new ContentRef("c1", "clip", "1", "Java", "study",
                List.of("Java", "Spring"), "/notes/java.md", now, now, "");
        HabitProfile profile = new HabitProfile(Map.of("study", 2L), Map.of(), Map.of(), Map.of());

        ProjectSuggestion suggestion = new ProjectSuggestionService().score(project, candidate,
                Set.of("study"), Set.of("spring"), Set.of("/notes"), List.of(), profile);

        assertEquals("pending", suggestion.status());
        assertEquals(0.9, suggestion.score(), 0.0001);
        assertTrue(suggestion.reasons().containsAll(List.of("category-match", "tag-match",
                "directory-match", "habit-category")));
    }
}
