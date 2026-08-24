package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.Knowledge;
import com.example.clip.model.LearningPlan;
import com.example.clip.model.TodoContent;
import com.example.clip.service.FileStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ContentIndexStorageScanTest {

    @TempDir
    Path tempDir;

    @Test
    void rebuildsReferencesFromAllSupportedStorageEntities() {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        Knowledge knowledge = new Knowledge();
        knowledge.setId(2L);
        TodoContent todo = new TodoContent();
        todo.setId(3L);
        LearningPlan plan = new LearningPlan();
        plan.setId(4L);
        FileStorageService storage = new FileStorageService(tempDir.toString()) {
            @Override public List<ClipContent> getAllClips() { return List.of(clip); }
            @Override public List<Knowledge> getAllKnowledge() { return List.of(knowledge); }
            @Override public List<TodoContent> getAllTodos() { return List.of(todo); }
            @Override public List<LearningPlan> getAllLearningPlans() { return List.of(plan); }
        };

        ContentIndexService index = new ContentIndexService(tempDir.resolve("index.json"));
        index.rebuildFromStorage(storage);

        List<ContentRef> refs = index.readAll();
        assertEquals(4, refs.size());
        assertEquals(Set.of("clip", "knowledge", "todo", "learning-plan"),
                refs.stream().map(ContentRef::type).collect(Collectors.toSet()));
        assertEquals(Set.of("clip:1", "knowledge:2", "todo:3", "learning-plan:4"),
                refs.stream().map(ContentRef::id).collect(Collectors.toSet()));
    }

    @Test
    void rebuildFromStorageIgnoresNullImagesAndBlankIds() {
        // 空存储不报错，且不产生索引
        FileStorageService emptyStorage = new FileStorageService(tempDir.resolve("empty").toString());
        ContentIndexService index = new ContentIndexService(tempDir.resolve("empty-index.json"));
        index.rebuildFromStorage(emptyStorage);
        assertEquals(0, index.readAll().size());

        // 重复 id 去重，保留最后一条
        ClipContent a = new ClipContent();
        a.setId(1L);
        ClipContent b = new ClipContent();
        b.setId(1L);
        b.setCreatedAt(java.time.LocalDateTime.of(2026, 1, 2, 0, 0));
        FileStorageService storage = new FileStorageService(tempDir.toString()) {
            @Override public List<ClipContent> getAllClips() { return List.of(a, b); }
            @Override public List<Knowledge> getAllKnowledge() { return List.of(); }
            @Override public List<TodoContent> getAllTodos() { return List.of(); }
            @Override public List<LearningPlan> getAllLearningPlans() { return List.of(); }
        };
        ContentIndexService dedupeIndex = new ContentIndexService(tempDir.resolve("dedupe.json"));
        dedupeIndex.rebuildFromStorage(storage);
        List<ContentRef> refs = dedupeIndex.readAll();
        assertEquals(1, refs.size());
        assertEquals("clip:1", refs.get(0).id());
    }
}
