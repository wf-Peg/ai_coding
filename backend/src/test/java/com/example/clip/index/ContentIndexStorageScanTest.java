package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.model.LearningPlan;
import com.example.clip.model.TodoContent;
import com.example.clip.service.FileStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ContentIndexStorageScanTest {

    @TempDir
    Path tempDir;

    @Test
    void rebuildsReferencesFromAllSupportedStorageEntities() {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        KnowledgeEntry knowledge = new KnowledgeEntry();
        knowledge.setId(2L);
        TodoContent todo = new TodoContent();
        todo.setId(3L);
        LearningPlan plan = new LearningPlan();
        plan.setId(4L);
        FileStorageService storage = new FileStorageService(tempDir.toString()) {
            @Override public List<ClipContent> getAllClips() { return List.of(clip); }
            @Override public List<KnowledgeEntry> getAllKnowledgeEntries() { return List.of(knowledge); }
            @Override public List<TodoContent> getAllTodos() { return List.of(todo); }
            @Override public List<LearningPlan> getAllLearningPlans() { return List.of(plan); }
        };

        ContentIndexService index = new ContentIndexService(tempDir.resolve("index.json"));
        index.rebuildFromStorage(storage);

        assertEquals(4, index.readAll().size());
    }
}
