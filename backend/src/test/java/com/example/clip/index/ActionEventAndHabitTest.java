package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ActionEventAndHabitTest {
    @TempDir Path tempDir;

    @Test
    void recordsEventsAndAggregatesExplainableCounts() {
        ActionEventService events = new ActionEventService(tempDir.resolve("events.jsonl"));
        LocalDateTime now = LocalDateTime.now();
        events.record(new ActionEvent("1", "content_opened", "clip:1", null, null, null,
                Map.of("category", "study", "tag", "java", "directory", "~/java"), now, 1));
        events.record(new ActionEvent("2", "ai_action_used", "clip:1", null, null, null,
                Map.of("category", "study", "tag", "java"), now, 1));

        HabitProfile profile = new HabitProfileService().aggregate(events.readAll());

        assertEquals(2, profile.categories().get("study"));
        assertEquals(2, profile.tags().get("java"));
        assertEquals(1, profile.actions().get("content_opened"));
    }

    @Test
    void skipsBadLinesDuringRead() {
        ActionEventService events = new ActionEventService(tempDir.resolve("events.jsonl"));
        LocalDateTime now = LocalDateTime.now();
        events.record(new ActionEvent("1", "content_opened", "clip:1", null, null, null,
                Map.of(), now, 1));
        assertEquals(0, events.skippedLineCount());
        assertEquals(1, events.readAll().size());
    }

    @Test
    void prunesEventsBeforeCutoff() {
        ActionEventService events = new ActionEventService(tempDir.resolve("events.jsonl"));
        LocalDateTime old = LocalDateTime.of(2026, 1, 1, 0, 0);
        LocalDateTime recent = LocalDateTime.of(2026, 8, 1, 0, 0);
        events.record(new ActionEvent("1", "content_created", "clip:1", null, null, null,
                Map.of(), old, 1));
        events.record(new ActionEvent("2", "content_created", "clip:2", null, null, null,
                Map.of(), recent, 1));

        events.pruneBefore(LocalDateTime.of(2026, 6, 1, 0, 0));
        assertEquals(1, events.readAll().size());
        assertEquals("clip:2", events.readAll().get(0).contentId());
    }

    @Test
    void handlesEmptyEventFile() {
        ActionEventService events = new ActionEventService(tempDir.resolve("empty.jsonl"));
        assertTrue(events.readAll().isEmpty());
        events.pruneBefore(LocalDateTime.now());
        assertTrue(events.readAll().isEmpty());
    }

    @Test
    void eventTypesConstantsAreDefined() {
        assertEquals("content_created", EventTypes.CONTENT_CREATED);
        assertEquals("content_opened", EventTypes.CONTENT_OPENED);
        assertEquals("content_edited", EventTypes.CONTENT_EDITED);
        assertEquals("content_deleted", EventTypes.CONTENT_DELETED);
        assertEquals("content_tagged", EventTypes.CONTENT_TAGGED);
        assertEquals("todo_created", EventTypes.TODO_CREATED);
        assertEquals("todo_completed", EventTypes.TODO_COMPLETED);
        assertEquals("todo_edited", EventTypes.TODO_EDITED);
        assertEquals("todo_deleted", EventTypes.TODO_DELETED);
        assertEquals("workspace_viewed", EventTypes.WORKSPACE_VIEWED);
        assertEquals("workspace_member_added", EventTypes.WORKSPACE_MEMBER_ADDED);
        assertEquals("workspace_member_removed", EventTypes.WORKSPACE_MEMBER_REMOVED);
        assertEquals("workspace_excluded", EventTypes.WORKSPACE_EXCLUDED);
        assertEquals("board_column_changed", EventTypes.BOARD_COLUMN_CHANGED);
        assertEquals("suggestion_shown", EventTypes.SUGGESTION_SHOWN);
        assertEquals("suggestion_accepted", EventTypes.SUGGESTION_ACCEPTED);
        assertEquals("suggestion_ignored", EventTypes.SUGGESTION_IGNORED);
        assertEquals("suggestion_rejected", EventTypes.SUGGESTION_REJECTED);
        assertEquals(1, EventTypes.SCHEMA_VERSION);
    }

    @Test
    void actionEventCompactConstructorNormalizesMetadata() {
        ActionEvent event = new ActionEvent("e_1", "test", "clip:1", null, null, null, null, null, null);
        assertTrue(event.metadata().isEmpty());
    }
}