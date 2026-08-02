package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RelationIndexServiceTest {
    @TempDir Path tempDir;

    @Test
    void relationWritesAreIdempotentAndRemovable() {
        RelationIndexService service = new RelationIndexService(tempDir.resolve("relations.json"));
        ContentRelation relation = new ContentRelation("knowledge:2", "clip:1", "derived_from", "imported", 1, LocalDateTime.now());

        service.add(relation);
        service.add(relation);
        assertEquals(1, service.findFor("clip:1").size());

        service.remove("knowledge:2", "clip:1", "derived_from");
        assertEquals(0, service.readAll().size());
    }
}
