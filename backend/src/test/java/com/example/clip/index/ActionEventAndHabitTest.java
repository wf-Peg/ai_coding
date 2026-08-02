package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ActionEventAndHabitTest {
    @TempDir Path tempDir;

    @Test
    void recordsEventsAndAggregatesExplainableCounts() {
        ActionEventService events = new ActionEventService(tempDir.resolve("events.jsonl"));
        events.record(new ActionEvent("1", "content_opened", "clip:1", null, Map.of("category", "study", "tag", "java", "directory", "~/java"), LocalDateTime.now()));
        events.record(new ActionEvent("2", "ai_action_used", "clip:1", null, Map.of("category", "study", "tag", "java"), LocalDateTime.now()));

        HabitProfile profile = new HabitProfileService().aggregate(events.readAll());

        assertEquals(2, profile.categories().get("study"));
        assertEquals(2, profile.tags().get("java"));
        assertEquals(1, profile.actions().get("content_opened"));
    }
}
