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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 通过真实 {@link FileStorageService} 验证四类内容（剪藏/知识/待办/学习计划）
 * 经 {@link ContentIndexService#rebuildFromStorage} 重建索引时不漏内容。
 */
class ContentIndexStorageScanIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void rebuildFromRealStorageCoversAllFourContentTypes() {
        FileStorageService storage = new FileStorageService(tempDir.resolve("storage").toString());

        ClipContent clip = new ClipContent();
        clip.setTitle("剪藏标题");
        clip.setCategory("work");
        storage.saveClip(clip);

        Knowledge knowledge = new Knowledge();
        knowledge.setTitle("知识标题");
        knowledge.setCategory("知识库");
        storage.saveKnowledge(knowledge);

        TodoContent todo = new TodoContent();
        todo.setTitle("待办标题");
        todo.setCategory("inbox");
        storage.saveTodo(todo);

        LearningPlan plan = new LearningPlan();
        plan.setTitle("学习计划标题");
        storage.saveLearningPlan(plan);

        ContentIndexService index = new ContentIndexService(tempDir.resolve("index.json"));
        index.rebuildFromStorage(storage);

        List<ContentRef> refs = index.readAll();
        assertEquals(4, refs.size(), "四类内容应全部进入内容索引，不漏内容");

        assertEquals(Set.of("clip", "knowledge", "todo", "learning-plan"),
                refs.stream().map(ContentRef::type).collect(Collectors.toSet()));

        assertEquals(Set.of("clip:1", "knowledge:2", "todo:3", "learning-plan:4"),
                refs.stream().map(ContentRef::id).collect(Collectors.toSet()));

        // 每类内容都保留标题，可被工作台/观测页展示
        Set<String> titles = refs.stream().map(ContentRef::title)
                .filter(t -> t != null && !t.isBlank()).collect(Collectors.toSet());
        assertTrue(titles.containsAll(Set.of("剪藏标题", "知识标题", "待办标题", "学习计划标题")),
                "重建后的标题集合应包含四类内容标题");
    }
}