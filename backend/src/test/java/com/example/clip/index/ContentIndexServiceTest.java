package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ContentIndexServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void rebuildWritesMetadataOnlyIndex() throws Exception {
        ContentIndexService service = new ContentIndexService(tempDir.resolve("content-index.json"));
        ContentRef ref = new ContentRef("clip:1", "clip", "1", "Title", "study", List.of("java"), null,
                LocalDateTime.parse("2026-08-02T10:00:00"), null, null);

        service.rebuild(List.of(ref));

        assertEquals(List.of(ref), service.readAll());
        assertFalse(Files.readString(tempDir.resolve("content-index.json")).contains("large body"));
    }

    @Test
    void rebuildIsIdempotentAndReplacesStaleEntries() {
        ContentIndexService service = new ContentIndexService(tempDir.resolve("content-index.json"));
        ContentRef first = new ContentRef("clip:1", "clip", "1", "First", null, List.of(), null, null, null, null);
        ContentRef second = new ContentRef("clip:2", "clip", "2", "Second", null, List.of(), null, null, null, null);

        service.rebuild(List.of(first, second));
        service.rebuild(List.of(second));

        assertEquals(List.of(second), service.readAll());
    }
}
